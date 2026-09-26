// 가톨릭굿뉴스 매일미사 페이지에서 오늘의 전례 정보(날짜·전례색·축일·복음 말씀)를 가져온다.
//
// 안전 원칙: 기대한 값을 확실히 뽑아내지 못하면 오류로 끝내고 기존 값을 그대로 둔다.
// 공개되는 전례 문구를 추측하거나, 바꿔 쓰거나, 예전 값을 재사용하지 않는다.

export const TODAYWORD_SOURCE_URL = 'https://maria.catholic.or.kr/mobile/missa/missa_view.asp?today=on';

export class TodaywordError extends Error {}

export function parseTodayword(html) {
  const headMatch = html.match(
    /<a class="active" href="javascript:view_content\('(\d+)','([^']*)','(\d{8})','([^']*)','([^']*)','([^']*)'\);">/
  );
  if (!headMatch) throw new TodaywordError('could not find the date/color/feast <a class="active" ...> tag');
  const [, , color, yyyymmdd, feastName] = headMatch;
  if (!/^(백|홍|녹|자|흑)$/.test(color)) throw new TodaywordError(`unexpected liturgical color value: "${color}"`);
  if (!feastName) throw new TodaywordError('feast name was empty');

  // 인용 표기에는 "9,43ㄴ-45"처럼 절을 한글 자모로 세분한 경우가 있다
  const gospelMatch = html.match(
    /&lt;([^&]+?)&gt;<br>[^\s]*\s*([가-힣]+?)(?:이|가) 전한 거룩한 복음입니다\.([0-9]+,[0-9,\-.ㄱ-ㅎ]+)<br>/
  );
  if (!gospelMatch) throw new TodaywordError('could not find the Gospel quote/citation pattern');
  const [, quoteRaw, book, citation] = gospelMatch;
  let quote = quoteRaw.trim();
  if (!quote) throw new TodaywordError('Gospel quote text was empty');
  if (!/[.!?]$/.test(quote)) quote += '.';

  return {
    ym: `${yyyymmdd.slice(0, 4)}.${yyyymmdd.slice(4, 6)}`,
    day: yyyymmdd.slice(6, 8),
    color,
    feastName,
    verse: `${quote} (${book} ${citation})`,
  };
}

export async function updateTodayword(env) {
  const res = await fetch(TODAYWORD_SOURCE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new TodaywordError(`source page returned HTTP ${res.status}`);
  const t = parseTodayword(await res.text());
  await env.DB.prepare(
    `INSERT INTO todayword (id, ym, day, color, feast_name, verse, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (id) DO UPDATE SET ym = excluded.ym, day = excluded.day, color = excluded.color,
       feast_name = excluded.feast_name, verse = excluded.verse, updated_at = excluded.updated_at`
  ).bind(t.ym, t.day, t.color, t.feastName, t.verse).run();
  return t;
}
