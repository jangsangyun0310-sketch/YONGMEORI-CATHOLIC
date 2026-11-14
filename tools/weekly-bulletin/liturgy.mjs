// 주일 날짜 → 한국 천주교 전례 이름. 주보 머리글에서 제목을 못 읽었을 때만 쓴다.
// 사용: node liturgy.mjs 2026.11.15  → 연중 제33주일
const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const DAY = 86400000;
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return D(y, mo, da);
}
const advent1 = (y) => { const x = D(y, 12, 25); const back = x.getUTCDay() === 0 ? 7 : x.getUTCDay(); return new Date(x - (back + 21) * DAY); };
export function liturgicalName(dateStr) {
  const [y, m, d] = dateStr.split('.').map(Number);
  const t = D(y, m, d);
  const E = easter(y), wk = (a, b) => Math.round((a - b) / (7 * DAY));
  const A = advent1(y);
  if (t >= A && t < D(y, 12, 25)) return `대림 제${wk(t, A) + 1}주일`;
  if (m === 12 && d === 25) return '주님 성탄 대축일';
  if (m === 12 && d > 25) return '성가정 축일';
  if (m === 1 && d === 1) return '천주의 성모 마리아 대축일';
  if (m === 1 && d >= 2 && d <= 8) return '주님 공현 대축일';
  let ep = D(y, 1, 2); while (ep.getUTCDay() !== 0) ep = new Date(+ep + DAY);
  // 공현이 1월 7·8일이면 세례 축일은 다음 날(월)이라 주일이 아님 → 다음 주일이 연중 제2주일
  const late = ep.getUTCDate() >= 7;
  const bap = late ? ep : new Date(+ep + 7 * DAY);
  if (!late && +t === +bap) return '주님 세례 축일';
  const ash = new Date(+E - 46 * DAY);
  if (t > bap && t < ash) return `연중 제${wk(t, bap) + 1}주일`;
  const w = wk(t, E);
  if (w >= -6 && w <= -2) return `사순 제${w + 7}주일`;
  if (w === -1) return '주님 수난 성지 주일';
  if (w === 0) return '주님 부활 대축일';
  if (w >= 1 && w <= 5) return `부활 제${w + 1}주일`;
  if (w === 6) return '주님 승천 대축일';
  if (w === 7) return '성령 강림 대축일';
  if (w === 8) return '삼위일체 대축일';
  if (w === 9) return '그리스도의 성체 성혈 대축일';
  const king = new Date(+A - 7 * DAY);
  if (+t === +king) return '그리스도 왕 대축일';
  if (t < king) return `연중 제${34 - wk(king, t)}주일`;
  return '';
}
if (process.argv[2]) console.log(liturgicalName(process.argv[2]));
