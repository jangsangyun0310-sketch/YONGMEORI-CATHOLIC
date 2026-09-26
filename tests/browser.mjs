// 실제 브라우저로 홈페이지·관리자 페이지를 눌러보는 테스트 (로컬 D1 + 가짜 구글 로그인/GitHub)
// 실행: npm run test:browser   → 결과 화면은 test-results/ 폴더에 저장된다
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { startStack } from './helpers.mjs';

const OUT = 'test-results';
mkdirSync(OUT, { recursive: true });

// 구글 로그인 대신 "대표 관리자로 로그인된 상태"를 흉내 내는 가짜 Firebase 로그인 모듈
const FAKE_AUTH = `(function () {
  var user = { email: 'jangsangyun0310@gmail.com', displayName: '대표', getIdToken: function () { return Promise.resolve('owner-token'); } };
  var auth = {
    currentUser: user,
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(user); }, 0); },
    signOut: function () {}, signInWithPopup: function () { return Promise.resolve(); }, signInWithRedirect: function () {}
  };
  firebase.auth = function () { return auth; };
  firebase.auth.GoogleAuthProvider = function () { this.setCustomParameters = function () {}; };
})();`;

// 2x2 PNG (관리자 페이지가 올리기 전에 JPEG로 줄여 변환한다)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY_ISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const stack = await startStack({ port: 8798, persist: '.wrangler/browser-state' });
const errors = [];
try {
  const api = async (path, method = 'GET', body) => {
    const res = await fetch(stack.base + path, {
      method,
      headers: { Authorization: 'Bearer owner-token', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(res.ok, `${method} ${path} → ${res.status} ${await res.clone().text()}`);
    return res.json();
  };
  const upload = async (name) => {
    const res = await fetch(stack.base + '/api/admin/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'text/plain', 'X-Upload-Path': `images/uploads/2026/${name}.jpg` },
      body: PNG.toString('base64'),
    });
    return res.json();
  };

  // ---------- 예시 데이터 ----------
  await api('/api/admin/notices', 'POST', { tag: '채용', title: '사무장 채용 안내', date: '상시 모집', body: '첫째 줄\n둘째 줄' });
  const b1 = await upload('b1');
  await api('/api/admin/bulletins', 'POST', { date: '2026.09.20', title: '연중 제25주일', images: [b1.path], blobs: [b1] });
  const g1 = await upload('g1');
  const g2 = await upload('g2');
  await api('/api/admin/gallery', 'POST', { date: '2026.09.15', title: '본당의 날', photos: [g1.path, g2.path], blobs: [g1, g2] });
  await api('/api/admin/schedule', 'POST', { date: TODAY_ISO, endDate: '', title: '오늘의 본당 행사', time: '10:30', place: '대성전' });
  await api('/api/admin/announce', 'PUT', { active: true, title: '추석 합동위령미사 안내', text: '안내 내용', image: '', blobs: [] });
  await api('/api/admin/push', 'POST', { title: '첫 알림', body: '알림함 확인용' });

  const browser = await chromium.launch();

  // ---------- 1. 홈페이지 (휴대폰) ----------
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR' });
  await ctx.addInitScript(() => { localStorage.setItem('yongmeori-welcome-install-shown', '1'); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('home: ' + e.message));
  await page.goto(stack.base + '/', { waitUntil: 'load' });
  await page.waitForSelector('#announceModal.open', { timeout: 10000 });
  assert.equal(await page.textContent('#announceModalTitle'), '추석 합동위령미사 안내');
  await page.screenshot({ path: `${OUT}/home-announce.png` });
  await page.click('#announceModalCloseBtn');

  await page.waitForSelector('#noticeList .notice-title');
  assert.equal(await page.textContent('#noticeList .notice-title'), '사무장 채용 안내');
  assert.equal(await page.textContent('#noticeList .notice-date'), '상시 모집');
  assert.match(await page.textContent('#bulletinLatest h3'), /연중 제25주일/);
  assert.equal(await page.textContent('.gallery-cap-title'), '본당의 날');
  assert.equal((await page.textContent('.gallery-count')).trim(), '+1');
  assert.ok((await page.$$('#calBody .cal-day.has-event')).length >= 1, '본당 일정이 달력에 표시되어야 함');
  assert.equal((await page.textContent('#notifBellBtnMobile .notif-bell-badge')).trim(), '1');
  assert.equal(await page.$$eval('.map-link', (els) => els.length), 3);

  // 앨범 열기 → 두 장
  await page.click('.gallery-item');
  await page.waitForSelector('#lightbox.open');
  await page.waitForFunction(() => /\(1\/2\)/.test(document.getElementById('lightboxCap').textContent));
  const photoOk = await page.waitForFunction(() => {
    const img = document.querySelector('#lightboxImg img');
    return img && img.complete && img.naturalWidth > 0;
  });
  assert.ok(photoOk, '배포 전 사진도 GitHub에서 읽어 보여야 함');
  await page.screenshot({ path: `${OUT}/home-album.png` });
  await page.click('#lightboxClose');

  // 오늘 날짜를 눌러 일정 보기
  await page.click('#calBody .cal-day.today');
  await page.waitForSelector('#calDetail .cal-item-title');
  // 공휴일(예: 추석 연휴)이 겹치면 공휴일이 먼저 나오므로 목록 안에 있는지만 본다
  const dayTitles = await page.$$eval('#calDetail .cal-item-title', (els) => els.map((e) => e.textContent));
  assert.ok(dayTitles.includes('오늘의 본당 행사'), JSON.stringify(dayTitles));

  // 알림함
  await page.click('#notifBellBtnMobile');
  await page.waitForSelector('#notifPanel.open .notif-item-title');
  assert.equal(await page.textContent('.notif-item-title'), '첫 알림');
  await page.screenshot({ path: `${OUT}/home-inbox.png` });
  await ctx.close();

  // ---------- 2. 관리자 페이지 (PC) ----------
  const actx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'ko-KR' });
  const admin = await actx.newPage();
  admin.on('pageerror', (e) => errors.push('admin: ' + e.message));
  admin.on('dialog', (d) => d.accept());
  await admin.route('**/firebase-auth-compat.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_AUTH }));
  await admin.goto(stack.base + '/admin/', { waitUntil: 'load' });
  await admin.waitForSelector('#viewHome:not([hidden])');
  assert.equal(await admin.isVisible('#adminsTile'), true);

  // 공지 추가 (날짜 칸에 문구)
  await admin.click('[data-section="notices"]');
  await admin.waitForSelector('.card');
  await admin.click('#addBtn');
  await admin.fill('[data-k="title"]', '관리자 화면에서 쓴 공지');
  await admin.fill('[data-k="date"]', '접수마감 2026.10.10');
  await admin.fill('[data-k="body"]', '본문입니다');
  await admin.click('[data-save]');
  await admin.waitForSelector('#sectionStatus.ok');
  const notices = (await api('/api/home')).notices;
  assert.equal(notices[0].title, '관리자 화면에서 쓴 공지', '새 공지가 맨 위에');
  assert.equal(notices[0].date, '접수마감 2026.10.10');

  // 본당 일정 추가 (1박2일)
  await admin.click('#backBtn');
  await admin.click('[data-section="schedule"]');
  await admin.waitForSelector('.card');
  await admin.click('#addBtn');
  await admin.fill('[data-k="date"]', '2026-11-07');
  await admin.fill('[data-k="endDate"]', '2026-11-08');
  await admin.fill('[data-k="title"]', '성지순례');
  await admin.fill('[data-k="place"]', '나바위성지');
  await admin.click('[data-save]');
  await admin.waitForSelector('#sectionStatus.ok');
  const pilgrimage = (await api('/api/admin/schedule')).items.find((s) => s.title === '성지순례');
  assert.equal(pilgrimage.endDate, '2026-11-08');
  await admin.screenshot({ path: `${OUT}/admin-schedule.png` });

  // 갤러리: 사진 두 장으로 새 앨범
  await admin.click('#backBtn');
  await admin.click('[data-section="gallery"]');
  await admin.waitForSelector('.card');
  await admin.click('#addBtn');
  await admin.fill('[data-k="title"]', '관리자 화면 앨범');
  const treesBefore = stack.gh.trees.length;
  await admin.setInputFiles('.file-box input[type=file]', [
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await admin.waitForFunction(() => document.querySelectorAll('.file-box .preview img').length === 2);
  await admin.click('[data-save]');
  await admin.waitForSelector('#sectionStatus.ok', { timeout: 15000 });
  assert.equal(stack.gh.trees.length, treesBefore + 1, '사진 두 장이 한 번의 커밋으로 저장되어야 함');
  const created = (await api('/api/admin/gallery')).items.find((a) => a.title === '관리자 화면 앨범');
  assert.equal(created.photos.length, 2);
  assert.ok(created.photos.every((p) => p.startsWith('images/uploads/')));
  await admin.screenshot({ path: `${OUT}/admin-gallery.png` });

  // 관리자 명단
  await admin.click('#backBtn');
  await admin.click('[data-section="admins"]');
  await admin.fill('#adminEmail', 'helper@example.com');
  await admin.click('#adminAddBtn');
  await admin.waitForSelector('#adminList .card');
  assert.equal(await admin.textContent('#adminList .title'), 'helper@example.com');
  await actx.close();

  await browser.close();
  assert.deepEqual(errors, [], 'JS 오류가 없어야 함');
  console.log('브라우저 테스트 통과 — 화면은 test-results/ 에 저장');
} finally {
  stack.stop();
}
