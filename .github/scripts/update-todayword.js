// Fetches today's Korean Catholic liturgical info from the official 가톨릭굿뉴스
// daily-mass page and updates the "오늘의 말씀" widget in 성당홈페이지.html.
//
// Safety rule: if any expected value cannot be extracted with confidence,
// this script exits with an error and leaves the HTML file untouched —
// it never guesses, paraphrases, or reuses a stale value for public-facing
// liturgical text.

const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://maria.catholic.or.kr/mobile/missa/missa_view.asp?today=on';
const HTML_PATH = path.join(__dirname, '..', '..', '성당홈페이지.html');

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

async function main() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });
  if (!res.ok) fail(`source page returned HTTP ${res.status}`);
  const html = await res.text();

  // A) date / liturgical color / feast name, from the first Korean (class="active") view_content(...) link
  const headMatch = html.match(
    /<a class="active" href="javascript:view_content\('(\d+)','([^']*)','(\d{8})','([^']*)','([^']*)','([^']*)'\);">/
  );
  if (!headMatch) fail('could not find the date/color/feast <a class="active" ...> tag');
  const [, , color, yyyymmdd, feastName] = headMatch;
  if (!/^(백|홍|녹|자|흑)$/.test(color)) fail(`unexpected liturgical color value: "${color}"`);
  if (!feastName) fail('feast name was empty');

  // B) today's Gospel quote, book, and citation
  const gospelMatch = html.match(
    /&lt;([^&]+?)&gt;<br>[^\s]*\s*([가-힣]+)가 전한 거룩한 복음입니다\.([0-9]+,[0-9,\-.]+)<br>/
  );
  if (!gospelMatch) fail('could not find the Gospel quote/citation pattern');
  const [, quoteRaw, book, citation] = gospelMatch;
  let quote = quoteRaw.trim();
  if (!quote) fail('Gospel quote text was empty');
  if (!/[.!?]$/.test(quote)) quote += '.';

  const ym = `${yyyymmdd.slice(0, 4)}.${yyyymmdd.slice(4, 6)}`;
  const day = yyyymmdd.slice(6, 8);
  const verse = `${quote} (${book} ${citation})`;

  console.log('Extracted:', JSON.stringify({ ym, day, color, feastName, verse }, null, 2));

  let file = fs.readFileSync(HTML_PATH, 'utf8');
  const blockMatch = file.match(/<!-- TODAYWORD:AUTO-UPDATED[\s\S]*?<!-- \/TODAYWORD -->/);
  if (!blockMatch) fail('could not find the <!-- TODAYWORD:AUTO-UPDATED --> ... <!-- /TODAYWORD --> block in the HTML file');
  let block = blockMatch[0];
  const original = block;

  const replaceTag = (src, id, attr, newValue) => {
    const tagRe = new RegExp(`(<[a-zA-Z0-9]+ [^>]*id="${id}"[^>]*>)([\\s\\S]*?)(</[a-zA-Z0-9]+>)`);
    const m = src.match(tagRe);
    if (!m) fail(`could not find element with id="${id}" inside the TODAYWORD block`);
    let openTag = m[1];
    if (attr) {
      const attrRe = new RegExp(`${attr}="[^"]*"`);
      if (!attrRe.test(openTag)) fail(`element id="${id}" is missing the "${attr}" attribute`);
      openTag = openTag.replace(attrRe, `${attr}="${newValue}"`);
    }
    return src.replace(tagRe, `${openTag}${newValue}${m[3]}`);
  };

  block = replaceTag(block, 'twYm', null, ym);
  block = replaceTag(block, 'twDay', null, day);
  block = replaceTag(block, 'twColor', 'data-color', color);
  block = replaceTag(block, 'twFeast', null, feastName);
  block = replaceTag(block, 'twVerse', null, verse);

  if (block === original) {
    console.log('No change: today\'s values already match the file. Nothing to commit.');
    process.exit(0);
  }

  file = file.replace(original, block);
  fs.writeFileSync(HTML_PATH, file, 'utf8');
  console.log('Updated 성당홈페이지.html');
  // Signal to the workflow that a real content change was written.
  console.log('::set-output name=changed::true');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
  }
}

main().catch((err) => fail(err.stack || String(err)));
