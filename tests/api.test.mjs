// 서버(Worker + 로컬 D1) 통합 테스트.
// 실제 구글 로그인·GitHub 대신 가짜 서버(mock)를 띄워서, 관리자 저장·사진 커밋 흐름까지 확인한다.
// 실행: npm test   (wrangler dev를 로컬 모드로 잠깐 띄웠다가 끝나면 닫는다)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './helpers.mjs';
import { parseTodayword } from '../src/todayword.js';

let stack;
let BASE;
let gh;
before(async () => {
  stack = await startStack();
  BASE = stack.base;
  gh = stack.gh;
});
after(() => stack && stack.stop());

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data, res };
}

const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).toString('base64');
async function upload(name) {
  const r = await call('/api/admin/upload', {
    token: 'owner-token', method: 'POST', body: JPEG_B64,
    headers: { 'Content-Type': 'text/plain', 'X-Upload-Path': `images/uploads/2026/${name}.jpg` },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

// ---------- 테스트 ----------

test('홈페이지 데이터: 처음에는 비어 있고 기본 팝업은 꺼져 있다', async () => {
  const r = await call('/api/home');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.notices, []);
  assert.deepEqual(r.data.gallery, []);
  assert.equal(r.data.announce.active, false);
  assert.equal(r.data.todayword, null);
});

test('화면 파일은 public/만 공개되고 서버 코드·설정은 보이지 않는다', async () => {
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/admin/')).status, 200);
  for (const p of ['/src/worker.js', '/wrangler.jsonc', '/migrations/0001_initial.sql', '/package.json']) {
    assert.equal((await call(p)).status, 404, p);
  }
});

test('관리자 확인: 로그인 없음 401, 명단에 없는 계정 403, 대표 관리자 통과', async () => {
  assert.equal((await call('/api/admin/me')).status, 401);
  assert.equal((await call('/api/admin/me', { token: 'bad-token' })).status, 401);
  assert.equal((await call('/api/admin/me', { token: 'stranger-token' })).status, 403);
  const me = await call('/api/admin/me', { token: 'owner-token' });
  assert.equal(me.status, 200);
  assert.equal(me.data.owner, true);
});

test('관리자 명단: 대표 관리자만 추가·삭제, 추가된 관리자는 관리 화면 사용 가능', async () => {
  const add = await call('/api/admin/admins', { token: 'owner-token', method: 'POST', body: { email: 'Helper@Example.com' } });
  assert.equal(add.status, 200);
  assert.deepEqual(add.data.items.map((a) => a.email), ['helper@example.com']);
  const me = await call('/api/admin/me', { token: 'admin-token' });
  assert.equal(me.status, 200);
  assert.equal(me.data.owner, false);
  assert.equal((await call('/api/admin/admins', { token: 'admin-token' })).status, 403);
  assert.equal((await call('/api/admin/admins', { token: 'owner-token', method: 'POST', body: { email: 'not-an-email' } })).status, 400);
});

test('공지사항: 추가·수정·삭제가 바로 홈페이지에 반영된다', async () => {
  const bad = await call('/api/admin/notices', { token: 'admin-token', method: 'POST', body: { title: '제목', date: '' } });
  assert.equal(bad.status, 400);
  const phrase = await call('/api/admin/notices', { token: 'admin-token', method: 'POST', body: { tag: '채용', title: '사무장 모집', date: '상시 모집', body: '' } });
  assert.equal(phrase.status, 200, JSON.stringify(phrase.data));
  assert.equal(phrase.data.items[0].date, '상시 모집');
  await call(`/api/admin/notices/${phrase.data.items[0].id}`, { token: 'admin-token', method: 'DELETE' });
  const created = await call('/api/admin/notices', { token: 'admin-token', method: 'POST', body: { tag: '공지', title: '추석 미사', date: '2026.09.26', body: '첫째 줄\n둘째 줄' } });
  assert.equal(created.status, 200);
  const id = created.data.items[0].id;
  let home = await call('/api/home');
  assert.equal(home.data.notices[0].body, '첫째 줄\n둘째 줄');
  await call(`/api/admin/notices/${id}`, { token: 'admin-token', method: 'PUT', body: { tag: '안내', title: '추석 미사 변경', date: '2026.09.27', body: '' } });
  home = await call('/api/home');
  assert.equal(home.data.notices[0].title, '추석 미사 변경');
  await call(`/api/admin/notices/${id}`, { token: 'admin-token', method: 'DELETE' });
  home = await call('/api/home');
  assert.equal(home.data.notices.length, 0);
});

test('주보: 사진을 커밋하고, 사진을 바꾸면 빠진 사진은 저장소에서 지운다', async () => {
  const a = await upload('bulletin-a');
  const b = await upload('bulletin-b');
  const treesBefore = gh.trees.length;
  const created = await call('/api/admin/bulletins', { token: 'owner-token', method: 'POST', body: { date: '2026.09.20', title: '연중 제25주일', images: [a.path, b.path], blobs: [a, b] } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const added = gh.trees[treesBefore];
  assert.deepEqual(added.map((t) => t.path).sort(), [`public/${a.path}`, `public/${b.path}`].sort());

  const id = created.data.items[0].id;
  const c = await upload('bulletin-c');
  const updated = await call(`/api/admin/bulletins/${id}`, { token: 'owner-token', method: 'PUT', body: { date: '2026.09.20', title: '연중 제25주일', images: [c.path], blobs: [c] } });
  assert.equal(updated.status, 200);
  const change = gh.trees[gh.trees.length - 1];
  assert.ok(change.some((t) => t.path === `public/${c.path}` && t.sha), 'new photo added');
  assert.ok(change.some((t) => t.path === `public/${a.path}` && t.sha === null), 'old photo removed');

  const home = await call('/api/home');
  assert.deepEqual(home.data.bulletins[0].images, [c.path]);
});

test('사진 정보 위조 방지: 올리지 않은 업로드 경로는 거부한다', async () => {
  const r = await call('/api/admin/bulletins', { token: 'owner-token', method: 'POST', body: { date: '2026.09.21', title: '가짜', images: ['images/uploads/2026/never-uploaded.jpg'], blobs: [] } });
  assert.equal(r.status, 400);
});

test('갤러리 앨범: 대표 사진·장수는 첫 화면에, 사진 목록은 앨범을 열 때', async () => {
  const p1 = await upload('album-1');
  const p2 = await upload('album-2');
  const created = await call('/api/admin/gallery', { token: 'owner-token', method: 'POST', body: { date: '2026.09.15', title: '본당의 날 (2부)', photos: [p1.path, p2.path], blobs: [p1, p2] } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const album = created.data.items[0];
  const home = await call('/api/home');
  assert.equal(home.data.gallery[0].cover, p1.path);
  assert.equal(home.data.gallery[0].count, 2);
  const detail = await call(`/api/gallery/${album.id}`);
  assert.deepEqual(detail.data.album.photos, [p1.path, p2.path]);

  // 사진 한 장 빼기
  await call(`/api/admin/gallery/${album.id}`, { token: 'owner-token', method: 'PUT', body: { date: '2026.09.15', title: '본당의 날 (2부)', photos: [p2.path], blobs: [] } });
  assert.deepEqual((await call(`/api/gallery/${album.id}`)).data.album.photos, [p2.path]);

  // 앨범 삭제
  await call(`/api/admin/gallery/${album.id}`, { token: 'owner-token', method: 'DELETE' });
  assert.equal((await call(`/api/gallery/${album.id}`)).status, 404);
});

test('방금 올려 아직 배포되지 않은 사진도 바로 보인다 (GitHub에서 직접 읽기)', async () => {
  const p = await upload('fresh');
  await call('/api/admin/gallery', { token: 'owner-token', method: 'POST', body: { date: '2026.09.16', title: '새 사진', photos: [p.path], blobs: [p] } });
  const r = await fetch(`${BASE}/${p.path}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await r.arrayBuffer()).toString('base64'), JPEG_B64);
});

test('접속 시 팝업: 켜기·끄기와 사이트에 원래 있는 사진 사용', async () => {
  const r = await call('/api/admin/announce', { token: 'owner-token', method: 'PUT', body: { active: true, title: '추석 안내', text: '내용', image: 'images/og-image.png', blobs: [] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const home = await call('/api/home');
  assert.deepEqual(home.data.announce, { active: true, title: '추석 안내', text: '내용', image: 'images/og-image.png' });
  assert.equal((await call('/api/admin/announce', { token: 'owner-token', method: 'PUT', body: { active: true, title: '' } })).status, 400);
});

test('알림 구독: 이상한 토큰 거부, 새 토큰 저장 시 이전 토큰 정리, 구독 해제', async () => {
  assert.equal((await call('/api/push/subscribe', { method: 'POST', body: { token: 'bad token!' } })).status, 400);
  const t1 = 'tok_' + 'x'.repeat(40);
  const t2 = 'tok_' + 'y'.repeat(40);
  assert.equal((await call('/api/push/subscribe', { method: 'POST', body: { token: t1 } })).status, 200);
  assert.equal((await call('/api/push/subscribe', { method: 'POST', body: { token: t2, previous: t1 } })).status, 200);
  assert.equal((await call('/api/push/unsubscribe', { method: 'POST', body: { token: t2 } })).status, 200);
  // 구독자가 없으면 구글에 보내지 않고 알림함에만 남긴다
  const sent = await call('/api/admin/push', { token: 'owner-token', method: 'POST', body: { title: '테스트 알림', body: '내용' } });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.match(sent.data.message, /구독한 사람이 없어/);
  const inbox = await call('/api/announcements');
  assert.equal(inbox.data.items[0].title, '테스트 알림');
});

test('오늘의 말씀 자동 갱신 주소는 암호가 있어야 호출된다', async () => {
  assert.equal((await call('/api/cron/todayword', { method: 'POST' })).status, 401);
  assert.equal((await call('/api/cron/todayword', { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
});

test('오늘의 말씀 추출: 한글 자모가 섞인 절 표기도 읽는다', () => {
  const html = `<a class="active" href="javascript:view_content('1','녹','20260926','연중 제25주간 토요일','x','y');">`
    + '<span>&lt;사람의 아들은 넘겨질 것이다.&gt;<br>✠ 루카가 전한 거룩한 복음입니다.9,43ㄴ-45<br></span>';
  assert.deepEqual(parseTodayword(html), {
    ym: '2026.09', day: '26', color: '녹', feastName: '연중 제25주간 토요일',
    verse: '사람의 아들은 넘겨질 것이다. (루카 9,43ㄴ-45)',
  });
  assert.throws(() => parseTodayword('<html>no data</html>'));
});

test('본당 일정: 여러 날짜 일정·하루 일정 추가, 잘못된 날짜 거부, 홈페이지에 날짜순으로', async () => {
  assert.equal((await call('/api/admin/schedule', { token: 'owner-token', method: 'POST', body: { date: '2026.10.01', title: '잘못된 날짜' } })).status, 400);
  assert.equal((await call('/api/admin/schedule', { token: 'owner-token', method: 'POST', body: { date: '2026-10-05', endDate: '2026-10-03', title: '거꾸로' } })).status, 400);
  const a = await call('/api/admin/schedule', { token: 'owner-token', method: 'POST', body: { date: '2026-10-10', endDate: '2026-10-11', title: '청년 피정', time: '', place: '교육관' } });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const b = await call('/api/admin/schedule', { token: 'owner-token', method: 'POST', body: { date: '2026-10-03', endDate: '', title: '개천절 미사', time: '10:30', place: '' } });
  assert.equal(b.status, 200);
  let home = await call('/api/home');
  assert.deepEqual(home.data.schedule.map((s) => s.title), ['개천절 미사', '청년 피정']);
  assert.equal(home.data.schedule[1].endDate, '2026-10-11');
  const id = home.data.schedule[0].id;
  await call('/api/admin/schedule/' + id, { token: 'owner-token', method: 'PUT', body: { date: '2026-10-03', endDate: '2026-10-03', title: '개천절 미사(변경)', time: '11:00', place: '대성전' } });
  home = await call('/api/home');
  assert.equal(home.data.schedule[0].title, '개천절 미사(변경)');
  assert.equal(home.data.schedule[0].endDate, '', '시작일과 같은 끝나는 날은 하루짜리로 저장');
  await call('/api/admin/schedule/' + id, { token: 'owner-token', method: 'DELETE' });
  assert.equal((await call('/api/home')).data.schedule.length, 1);
});
