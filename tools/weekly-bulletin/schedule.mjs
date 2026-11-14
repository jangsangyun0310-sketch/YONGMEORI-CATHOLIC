// 주보 글 → 홈페이지 본당 일정 자동 등록 (weekly.ps1이 주보를 올린 뒤 부른다, 2026-11-14 사용자 요청)
//  1) 이 컴퓨터의 Claude Code(claude -p)로 주보 글에서 날짜가 있는 일정을 뽑는다
//  2) 날짜·길이를 검사하고, 이미 있는 일정(같은 날짜·비슷한 이름)은 건너뛴다 — 관리자 페이지로 넣은 일정 보호
//  3) 같은 주보를 다시 처리하면(토요일 재확인·주보 수정) 지난번에 자동으로 넣은 일정 중 관리자 페이지에서
//     고치지 않은 것만 지우고 다시 넣는다
// 사용: node schedule.mjs --text 주보.txt --date 2026.11.15 --state 상태.json [--dry]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildPrompt(text, isoDate) {
  return `다음은 천주교 용머리성당 주보(${isoDate} 주일자) 글입니다. 성당 홈페이지 달력에 넣을 일정을 뽑아 주세요.

넣는 것: 날짜가 정해진 모든 일정 — 본당 행사, 특별 미사(수험생 미사, 성시간·성체강복 등), 단체 모임(사목회, 꾸리아, 분과 모임 등),
소공동체 반모임(구역·반, 시간, 장소), 위령성월 Pr.별 연미사 같은 표 속 일정, 2차 헌금, 신청·접수 마감일, 입교식, 세례식,
교우 가정 행사(혼인·결혼식 등), 수녀님·신부님 휴가처럼 기간이 있는 일, 교구 행사.
빼는 것: 날짜가 없는 것("금주", "다음 주"만 있는 납부의 날 등), 지난주 헌금 결과, 전례 봉사자·차량 봉사 명단, 계좌, 연락처.
날짜 규칙: 주보 날짜(${isoDate})가 기준. "오늘"은 ${isoDate}. 연도가 없으면 주보 날짜와 가장 가까운 앞뒤 날짜로(12월 주보의 1월은 다음 해).
"11/10(화) ~ 14일(토)"처럼 기간이면 date=시작, end_date=끝. 하루짜리는 end_date="".
title: 짧고 알아보기 쉽게(예: "사목회의", "수험생을 위한 미사", "5구역 2반 반모임", "상아탑 Pr. 연미사", "평신도 주일 2차 헌금",
"신유진(보나) 결혼식", "예비신자 입교식", "성탄 까치 원고 모집 마감"). 주보에 적힌 이름·단체명은 그대로.
time: 주보에 적힌 대로 짧게("19:30"→"19시 30분", "오후 2시"→"14시", "교중미사 후", "미사 중"). 없으면 "".
place: 적혀 있으면("지하 강당", "더 메이 호텔", "5동 1103(이영이 데레사)"), 없으면 "".
모임은 번호(①②…)마다 따로 넣으세요. 한 번호 안에 여러 단체가 함께 있으면 하나로(예: "대건회·바오로회 모임").
단체 모임 이름은 "단체명 모임" 꼴로(예: "사목회 모임", "황금궁전Cu 모임").

JSON 배열만 답하세요. 다른 말은 쓰지 마세요.
[{"date":"YYYY-MM-DD","end_date":"","title":"...","time":"...","place":"..."}]

--- 주보 글 ---
${text}`;
}

// claude -p 로 뽑기. 실패하면 오류를 던진다(주보 올림은 이미 끝났으므로 일정만 다음에 다시 시도)
export function extract(text, isoDate) {
  // npm으로 설치한 claude.exe를 바로 부른다(작업 스케줄러에서도 PATH와 상관없이 찾도록)
  const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  const args = ['-p', '--model', 'sonnet', '--output-format', 'text', '--no-session-persistence', '--strict-mcp-config'];
  const opt = { input: buildPrompt(text, isoDate), encoding: 'utf8', timeout: 300000, maxBuffer: 8 << 20, cwd: REPO, windowsHide: true };
  const r = fs.existsSync(exe) ? spawnSync(exe, args, opt) : spawnSync('claude ' + args.join(' '), { ...opt, shell: true });
  if (r.status !== 0) throw new Error(`claude 실행 실패(${r.status}): ${(r.stderr || r.stdout || '').slice(0, 300)}`);
  const m = r.stdout.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('claude 답에서 일정 목록을 찾지 못함: ' + r.stdout.slice(0, 200));
  return JSON.parse(m[0]);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clean = (s, max) => String(s ?? '').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// 뽑은 일정 검사: 날짜 형식, 주보 날짜 앞 2주 ~ 뒤 6개월, 칸 길이(표 제약과 같게).
// 이미 지난 일정은 넣지 않는다(오늘 이후만, 2026-11-14 사용자 결정). 기간 일정은 끝나는 날이 오늘 이후면 넣는다
export function validate(items, isoDate, today = todayIso()) {
  const lo = addDays(isoDate, -14), hi = addDays(isoDate, 183);
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const date = clean(it.date, 10), title = clean(it.title, 120);
    let end = clean(it.end_date, 10);
    if (!ISO.test(date) || Number.isNaN(Date.parse(date)) || !title || date < lo || date > hi) continue;
    if (!ISO.test(end) || end <= date || end > addDays(date, 60)) end = '';
    if ((end || date) < today) continue;
    out.push({ date, end_date: end, title, time: clean(it.time, 80), place: clean(it.place, 80) });
  }
  return out;
}

// 이름 비교: 띄어쓰기·문장부호·흔한 꼬리말을 빼고, 한쪽이 다른 쪽을 품거나 두 글자 묶음이 많이 겹치면 같은 일정
export const norm = (s) => String(s).toLowerCase().replace(/[\s.,·:()\[\]~\-_'"!?/]/g, '').replace(/(모임|회의|미사)$/, '');
function bigrams(s) { const b = new Set(); for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2)); return b; }
export function similar(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  // "6구역"과 "7구역", "1반"과 "2반"처럼 숫자가 다르면 다른 일정
  if ((x.match(/\d+/g) || []).join(',') !== (y.match(/\d+/g) || []).join(',')) return false;
  if (x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)))) return true;
  const A = bigrams(x), B = bigrams(y); let n = 0; for (const g of A) if (B.has(g)) n++;
  return A.size && B.size ? (2 * n) / (A.size + B.size) >= 0.6 : false;
}

// 이미 있는 일정과 겹치는 것, 같은 주보 안에서 겹치는 것 빼기
export function dedupe(items, existing) {
  const keep = [], skip = [];
  for (const it of items) {
    const hit = [...existing, ...keep].find(e => e.date === it.date && similar(e.title, it.title));
    (hit ? skip : keep).push(hit ? { ...it, same: hit.title } : it);
  }
  return { keep, skip };
}

// ---------- D1 (wrangler) ----------
const WRANGLER = path.join(REPO, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
function wrangler(args) {
  const r = spawnSync(process.execPath, [WRANGLER, 'd1', 'execute', 'DB', '--remote', ...args], { encoding: 'utf8', cwd: REPO, maxBuffer: 32 << 20, windowsHide: true });
  if (r.status !== 0) throw new Error('D1 실패: ' + (r.stderr || r.stdout).slice(-300));
  return r.stdout;
}
// 읽기: --command는 결과를 돌려준다(--file은 결과 없이 건수만)
function d1Query(sql) {
  const out = wrangler(['--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('['))).flatMap(x => x.results || []);
}
function d1Write(sql) {
  const f = path.join(REPO, '.wrangler', `sched-${process.pid}.sql`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, sql);
  try { wrangler(['--file', f]); } finally { fs.rmSync(f, { force: true }); }
}
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

async function main() {
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
  const dry = process.argv.includes('--dry');
  const ds = arg('date'), isoDate = ds.replace(/\./g, '-');
  const text = fs.readFileSync(arg('text'), 'utf8');
  const stateFile = arg('state');
  const state = stateFile && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};

  const items = validate(extract(text, isoDate), isoDate);
  const lo = addDays(isoDate, -14);
  let existing = d1Query(`SELECT id, date, title, created_at, updated_at FROM schedule WHERE date >= ${q(lo)} OR end_date >= ${q(lo)}`);
  const maxId = Number(d1Query('SELECT coalesce(max(id), 0) AS m FROM schedule')[0].m);

  // 지난번 이 주보로 자동으로 넣은 것: 사람이 고치지 않은 것은 지우고 다시 넣고,
  // 고친 것은 이제 사람 것으로 보고 그대로 두며, 사람이 지운 것은 다시 넣지 않는다
  const prev = (state[ds] || []).filter(p => p && typeof p === 'object');
  const byId = new Map(existing.map(e => [Number(e.id), e]));
  const redo = prev.map(p => byId.get(Number(p.id))).filter(e => e && e.created_at === e.updated_at);
  const removed = prev.filter(p => !byId.has(Number(p.id)));
  existing = existing.filter(e => !redo.includes(e));
  const { keep, skip } = dedupe(items, [...existing, ...removed]);

  for (const s of skip) console.log(`건너뜀(이미 있음: ${s.same}) ${s.date} ${s.title}`);
  for (const k of keep) console.log(`${dry ? '[미리보기] ' : ''}넣음 ${k.date}${k.end_date ? '~' + k.end_date : ''} ${k.title} / ${k.time} / ${k.place}`);
  if (dry) return;

  const sql = [];
  if (redo.length) sql.push(`DELETE FROM schedule WHERE id IN (${redo.map(e => Number(e.id)).join(',')});`);
  for (const k of keep) sql.push(`INSERT INTO schedule (date, end_date, title, time, place) VALUES (${q(k.date)}, ${q(k.end_date)}, ${q(k.title)}, ${q(k.time)}, ${q(k.place)});`);
  if (sql.length) d1Write(sql.join('\n') + '\n');
  const added = keep.length ? d1Query(`SELECT id, date, title FROM schedule WHERE id > ${maxId} ORDER BY id`) : [];
  if (added.length !== keep.length) throw new Error(`일정 넣기 확인 실패(${added.length}/${keep.length})`);
  if (stateFile) { state[ds] = [...prev.filter(p => !redo.some(e => Number(e.id) === Number(p.id))), ...added]; fs.writeFileSync(stateFile, JSON.stringify(state, null, 1)); }
  console.log(`일정 ${keep.length}개 넣음, ${skip.length}개 건너뜀${redo.length ? `, 지난번 자동 일정 ${redo.length}개 다시 넣음` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('오류: ' + e.message); process.exit(1); });
}
