// 용머리성당 홈페이지 — Cloudflare Worker
//
// - 화면 파일(public/)은 Cloudflare가 바로 보내주고, /api/* 요청만 여기서 처리한다.
// - 글 데이터는 D1(env.DB)에 저장한다. 사진 파일은 GitHub 저장소에 커밋하고 경로만 D1에 둔다.
// - 관리자는 구글 로그인(Firebase)으로 확인하고, 관리자 명단은 D1에 있다.
//
// 필요한 비밀값 (npx wrangler secret put 이름):
//   GITHUB_TOKEN              사진을 저장소에 커밋할 GitHub 토큰 (이 저장소 Contents 읽기/쓰기)
//   FIREBASE_SERVICE_ACCOUNT  Firebase 서비스 계정 키 JSON 전체 (휴대폰 알림 발송용)
//   CRON_SECRET               오늘의 말씀 자동 갱신(GitHub Actions)이 이 서버를 부를 때 쓰는 암호

import {
  cfg, json, HttpError, str, dotDate, isoDate, safeImagePath, safeUploadPath, UPLOAD_PATH_RE, UPLOAD_DIR, readJson, safeEqual,
} from './util.js';
import { createBlob, commitUploads, fetchUploadFromGitHub } from './github.js';
import { verifyIdToken, sendPush } from './firebase.js';
import { updateTodayword, TodaywordError } from './todayword.js';

// ---------- 읽기 (홈페이지용, 로그인 불필요) ----------

// 공지 날짜 칸은 "상시 모집" 같은 문구일 수 있어서, 추가한 순서(최근 것이 위)로 보여준다
async function listNotices(db) {
  const { results } = await db.prepare('SELECT id, tag, title, date, body FROM notices ORDER BY id DESC').all();
  return results;
}

async function listSchedule(db) {
  const { results } = await db.prepare('SELECT id, date, end_date, title, time, place FROM schedule ORDER BY date, id').all();
  return results.map((r) => ({ id: r.id, date: r.date, endDate: r.end_date, title: r.title, time: r.time, place: r.place }));
}

async function listBulletins(db) {
  const [b, imgs] = await db.batch([
    db.prepare('SELECT id, date, title FROM bulletins ORDER BY date DESC, id DESC'),
    db.prepare('SELECT bulletin_id, path FROM bulletin_images ORDER BY bulletin_id, position'),
  ]);
  const byId = new Map(b.results.map((r) => [r.id, { ...r, images: [] }]));
  imgs.results.forEach((r) => { const it = byId.get(r.bulletin_id); if (it) it.images.push(r.path); });
  return [...byId.values()];
}

async function listAlbumSummaries(db) {
  const { results } = await db.prepare(
    `SELECT a.id, a.date, a.title,
       (SELECT path FROM gallery_photos p WHERE p.album_id = a.id ORDER BY position LIMIT 1) AS cover,
       (SELECT count(*) FROM gallery_photos p WHERE p.album_id = a.id) AS count
     FROM gallery_albums a ORDER BY a.date DESC, a.id DESC`
  ).all();
  return results;
}

async function listAlbumsWithPhotos(db) {
  const [a, photos] = await db.batch([
    db.prepare('SELECT id, date, title FROM gallery_albums ORDER BY date DESC, id DESC'),
    db.prepare('SELECT album_id, path FROM gallery_photos ORDER BY album_id, position'),
  ]);
  const byId = new Map(a.results.map((r) => [r.id, { ...r, photos: [] }]));
  photos.results.forEach((r) => { const it = byId.get(r.album_id); if (it) it.photos.push(r.path); });
  return [...byId.values()];
}

async function getAlbum(db, id) {
  const [a, photos] = await db.batch([
    db.prepare('SELECT id, date, title FROM gallery_albums WHERE id = ?').bind(id),
    db.prepare('SELECT path FROM gallery_photos WHERE album_id = ? ORDER BY position').bind(id),
  ]);
  if (!a.results.length) return null;
  return { ...a.results[0], photos: photos.results.map((r) => r.path) };
}

async function getBulletin(db, id) {
  const [b, imgs] = await db.batch([
    db.prepare('SELECT id, date, title FROM bulletins WHERE id = ?').bind(id),
    db.prepare('SELECT path FROM bulletin_images WHERE bulletin_id = ? ORDER BY position').bind(id),
  ]);
  if (!b.results.length) return null;
  return { ...b.results[0], images: imgs.results.map((r) => r.path) };
}

async function getAnnounce(db) {
  const r = await db.prepare('SELECT active, title, text, image FROM announce WHERE id = 1').first();
  return r ? { active: !!r.active, title: r.title, text: r.text, image: r.image } : { active: false, title: '', text: '', image: '' };
}

async function getTodayword(db) {
  const r = await db.prepare('SELECT ym, day, color, feast_name, verse, updated_at FROM todayword WHERE id = 1').first();
  return r ? { ym: r.ym, day: r.day, color: r.color, feastName: r.feast_name, verse: r.verse, updatedAt: r.updated_at } : null;
}

async function listAnnouncements(db) {
  const { results } = await db.prepare('SELECT id, title, body, created_at FROM announcements ORDER BY created_at DESC LIMIT 30').all();
  return results.map((r) => ({ id: r.id, title: r.title, body: r.body, createdAt: r.created_at }));
}

// ---------- 관리자 확인 ----------

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!idToken) throw new HttpError(401, '로그인이 필요합니다.');
  const user = await verifyIdToken(env, idToken);
  if (!user) throw new HttpError(401, '로그인 정보가 만료되었습니다. 다시 로그인해주세요.');
  const owner = user.email === String(cfg(env, 'OWNER_EMAIL')).toLowerCase();
  if (!owner) {
    const row = await env.DB.prepare('SELECT 1 FROM admins WHERE email = ?').bind(user.email).first();
    if (!row) throw new HttpError(403, '관리자로 등록되지 않은 계정입니다.');
  }
  return { ...user, owner };
}

// ---------- 사진 추가·삭제 ----------

function readBlobs(list) {
  return (Array.isArray(list) ? list : [])
    .map((b) => ({ path: safeUploadPath(b && b.path), sha: String((b && b.sha) || '') }))
    .filter((b) => b.path && /^[0-9a-f]{40}$/.test(b.sha));
}

function readPaths(list, max) {
  return (Array.isArray(list) ? list : []).map(safeImagePath).filter(Boolean).slice(0, max);
}

// 이 항목에서 빠진 업로드 사진 중, 다른 곳(주보·갤러리·팝업)에서 쓰지 않는 것만 저장소에서 지운다
async function unusedUploads(db, paths, exclude) {
  const candidates = [...new Set(paths.filter((p) => UPLOAD_PATH_RE.test(p)))];
  if (!candidates.length) return [];
  const ph = candidates.map(() => '?').join(',');
  const [b, g, a] = await db.batch([
    db.prepare(`SELECT path FROM bulletin_images WHERE path IN (${ph}) AND bulletin_id != ?`).bind(...candidates, exclude.kind === 'bulletin' ? exclude.id : -1),
    db.prepare(`SELECT path FROM gallery_photos WHERE path IN (${ph}) AND album_id != ?`).bind(...candidates, exclude.kind === 'album' ? exclude.id : -1),
    db.prepare(`SELECT image AS path FROM announce WHERE image IN (${ph})${exclude.kind === 'announce' ? ' AND 0' : ''}`).bind(...candidates),
  ]);
  const used = new Set([...b.results, ...g.results, ...a.results].map((r) => r.path));
  return candidates.filter((p) => !used.has(p));
}

// 새 사진 경로는 방금 올린 것(blobs)이거나 원래 이 항목에 있던 것, 또는 사이트에 원래 있는 이미지여야 한다
function checkNewPaths(newPaths, oldPaths, blobs) {
  const allowed = new Set([...oldPaths, ...blobs.map((b) => b.path)]);
  const bad = newPaths.find((p) => UPLOAD_PATH_RE.test(p) && !allowed.has(p));
  if (bad) throw new HttpError(400, '사진 정보가 올바르지 않습니다. 다시 시도해주세요.');
}

async function syncPhotos(env, who, label, { blobs, newPaths, oldPaths, exclude }) {
  checkNewPaths(newPaths, oldPaths, blobs);
  const add = blobs.filter((b) => newPaths.includes(b.path));
  const removedPaths = oldPaths.filter((p) => !newPaths.includes(p));
  const remove = await unusedUploads(env.DB, removedPaths, exclude);
  if (!add.length && !remove.length) return;
  if (!env.GITHUB_TOKEN) {
    if (add.length) throw new HttpError(500, 'GITHUB_TOKEN 설정이 없어 사진을 저장할 수 없습니다. (관리자에게 문의)');
    return; // 지울 사진만 있으면 저장소 정리는 건너뛴다 (홈페이지에는 이미 안 보임)
  }
  await commitUploads(env, { message: `${label} 사진 수정 (관리자 페이지: ${who})`, add, remove });
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// ---------- 관리자 API ----------

async function handleAdmin(request, env, url, route) {
  const me = await requireAdmin(request, env);
  const db = env.DB;
  const method = request.method;
  const idMatch = (prefix) => {
    const m = route.match(new RegExp(`^${prefix}/(\\d+)$`));
    return m ? Number(m[1]) : null;
  };

  if (route === 'me' && method === 'GET') return json({ email: me.email, name: me.name, owner: me.owner });

  // 공지사항
  if (route === 'notices' && method === 'GET') return json({ items: await listNotices(db) });
  if ((route === 'notices' && method === 'POST') || (idMatch('notices') && method === 'PUT')) {
    const p = await readJson(request);
    // 날짜 칸: "2026.09.20" 같은 날짜뿐 아니라 "상시 모집", "접수마감 2026.09.20" 같은 문구도 된다
    const n = { tag: str(p.tag, 30), title: str(p.title, 120), date: str(p.date, 30), body: str(p.body, 5000) };
    if (!n.title) throw new HttpError(400, '제목을 적어주세요.');
    if (!n.date) throw new HttpError(400, '날짜(또는 문구)를 적어주세요.');
    const id = idMatch('notices');
    if (id) {
      const r = await db.prepare(`UPDATE notices SET tag = ?, title = ?, date = ?, body = ?, updated_at = ${NOW} WHERE id = ?`)
        .bind(n.tag, n.title, n.date, n.body, id).run();
      if (!r.meta.changes) throw new HttpError(404, '이미 삭제된 공지입니다.');
    } else {
      await db.prepare('INSERT INTO notices (tag, title, date, body) VALUES (?, ?, ?, ?)').bind(n.tag, n.title, n.date, n.body).run();
    }
    return json({ ok: true, items: await listNotices(db) });
  }
  if (idMatch('notices') && method === 'DELETE') {
    await db.prepare('DELETE FROM notices WHERE id = ?').bind(idMatch('notices')).run();
    return json({ ok: true, items: await listNotices(db) });
  }

  // 주보 (한 부에 앞면·뒷면 등 여러 장)
  if (route === 'bulletins' && method === 'GET') return json({ items: await listBulletins(db) });
  if ((route === 'bulletins' && method === 'POST') || (idMatch('bulletins') && method === 'PUT')) {
    const p = await readJson(request);
    const date = dotDate(p.date);
    const title = str(p.title, 120);
    if (!title) throw new HttpError(400, '제목을 적어주세요.');
    const images = readPaths(p.images, 20);
    const id = idMatch('bulletins');
    const old = id ? await getBulletin(db, id) : { images: [] };
    if (!old) throw new HttpError(404, '이미 삭제된 주보입니다.');
    await syncPhotos(env, me.email, '주보', { blobs: readBlobs(p.blobs), newPaths: images, oldPaths: old.images, exclude: { kind: 'bulletin', id: id || -1 } });
    const stmts = [];
    if (id) {
      stmts.push(db.prepare(`UPDATE bulletins SET date = ?, title = ?, updated_at = ${NOW} WHERE id = ?`).bind(date, title, id));
      stmts.push(db.prepare('DELETE FROM bulletin_images WHERE bulletin_id = ?').bind(id));
      images.forEach((path, i) => stmts.push(db.prepare('INSERT INTO bulletin_images (bulletin_id, path, position) VALUES (?, ?, ?)').bind(id, path, i)));
    } else {
      stmts.push(db.prepare('INSERT INTO bulletins (date, title) VALUES (?, ?)').bind(date, title));
      // 한 번에 묶어 실행(batch)하는 동안에는 다른 쓰기가 끼어들지 않으므로 방금 넣은 주보 번호가 max(id)다
      images.forEach((path, i) => stmts.push(db.prepare('INSERT INTO bulletin_images (bulletin_id, path, position) VALUES ((SELECT max(id) FROM bulletins), ?, ?)').bind(path, i)));
    }
    await db.batch(stmts);
    return json({ ok: true, items: await listBulletins(db) });
  }
  if (idMatch('bulletins') && method === 'DELETE') {
    const id = idMatch('bulletins');
    const old = await getBulletin(db, id);
    if (old) {
      await syncPhotos(env, me.email, '주보', { blobs: [], newPaths: [], oldPaths: old.images, exclude: { kind: 'bulletin', id } });
      await db.batch([
        db.prepare('DELETE FROM bulletin_images WHERE bulletin_id = ?').bind(id),
        db.prepare('DELETE FROM bulletins WHERE id = ?').bind(id),
      ]);
    }
    return json({ ok: true, items: await listBulletins(db) });
  }

  // 갤러리 앨범
  if (route === 'gallery' && method === 'GET') return json({ items: await listAlbumsWithPhotos(db) });
  if ((route === 'gallery' && method === 'POST') || (idMatch('gallery') && method === 'PUT')) {
    const p = await readJson(request);
    const date = dotDate(p.date);
    const title = str(p.title, 200);
    if (!title) throw new HttpError(400, '앨범 제목을 적어주세요.');
    const photos = readPaths(p.photos, 500);
    if (!photos.length) throw new HttpError(400, '사진이 한 장도 없습니다.');
    const id = idMatch('gallery');
    const old = id ? await getAlbum(db, id) : { photos: [] };
    if (!old) throw new HttpError(404, '이미 삭제된 앨범입니다.');
    await syncPhotos(env, me.email, '갤러리', { blobs: readBlobs(p.blobs), newPaths: photos, oldPaths: old.photos, exclude: { kind: 'album', id: id || -1 } });
    const stmts = [];
    if (id) {
      stmts.push(db.prepare(`UPDATE gallery_albums SET date = ?, title = ?, updated_at = ${NOW} WHERE id = ?`).bind(date, title, id));
      stmts.push(db.prepare('DELETE FROM gallery_photos WHERE album_id = ?').bind(id));
      photos.forEach((path, i) => stmts.push(db.prepare('INSERT INTO gallery_photos (album_id, path, position) VALUES (?, ?, ?)').bind(id, path, i)));
    } else {
      stmts.push(db.prepare('INSERT INTO gallery_albums (date, title) VALUES (?, ?)').bind(date, title));
      photos.forEach((path, i) => stmts.push(db.prepare('INSERT INTO gallery_photos (album_id, path, position) VALUES ((SELECT max(id) FROM gallery_albums), ?, ?)').bind(path, i)));
    }
    await db.batch(stmts);
    return json({ ok: true, items: await listAlbumsWithPhotos(db) });
  }
  if (idMatch('gallery') && method === 'DELETE') {
    const id = idMatch('gallery');
    const old = await getAlbum(db, id);
    if (old) {
      await syncPhotos(env, me.email, '갤러리', { blobs: [], newPaths: [], oldPaths: old.photos, exclude: { kind: 'album', id } });
      await db.batch([
        db.prepare('DELETE FROM gallery_photos WHERE album_id = ?').bind(id),
        db.prepare('DELETE FROM gallery_albums WHERE id = ?').bind(id),
      ]);
    }
    return json({ ok: true, items: await listAlbumsWithPhotos(db) });
  }

  // 본당 일정 (1박2일처럼 여러 날짜에 걸치면 끝나는 날짜 endDate, 하루짜리면 빈 값)
  if (route === 'schedule' && method === 'GET') return json({ items: await listSchedule(db) });
  if ((route === 'schedule' && method === 'POST') || (idMatch('schedule') && method === 'PUT')) {
    const p = await readJson(request);
    const date = isoDate(p.date);
    const endRaw = str(p.endDate, 10);
    if (endRaw && !/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) throw new HttpError(400, '끝나는 날짜 형식이 올바르지 않습니다.');
    if (endRaw && endRaw < date) throw new HttpError(400, '끝나는 날짜가 시작 날짜보다 빠릅니다.');
    const endDate = endRaw > date ? endRaw : '';
    const title = str(p.title, 120);
    if (!title) throw new HttpError(400, '일정 이름을 적어주세요.');
    const time = str(p.time, 80);
    const place = str(p.place, 80);
    const id = idMatch('schedule');
    if (id) {
      const r = await db.prepare(`UPDATE schedule SET date = ?, end_date = ?, title = ?, time = ?, place = ?, updated_at = ${NOW} WHERE id = ?`)
        .bind(date, endDate, title, time, place, id).run();
      if (!r.meta.changes) throw new HttpError(404, '이미 삭제된 일정입니다.');
    } else {
      await db.prepare('INSERT INTO schedule (date, end_date, title, time, place) VALUES (?, ?, ?, ?, ?)').bind(date, endDate, title, time, place).run();
    }
    return json({ ok: true, items: await listSchedule(db) });
  }
  if (idMatch('schedule') && method === 'DELETE') {
    await db.prepare('DELETE FROM schedule WHERE id = ?').bind(idMatch('schedule')).run();
    return json({ ok: true, items: await listSchedule(db) });
  }

  // 접속 시 팝업
  if (route === 'announce' && method === 'GET') return json({ data: await getAnnounce(db) });
  if (route === 'announce' && method === 'PUT') {
    const p = await readJson(request);
    const a = { active: !!p.active, title: str(p.title, 120), text: str(p.text, 3000), image: safeImagePath(p.image) };
    if (a.active && !a.title) throw new HttpError(400, '제목을 적어주세요.');
    const old = await getAnnounce(db);
    await syncPhotos(env, me.email, '접속 시 팝업', {
      blobs: readBlobs(p.blobs), newPaths: a.image ? [a.image] : [], oldPaths: old.image ? [old.image] : [], exclude: { kind: 'announce' },
    });
    await db.prepare(`UPDATE announce SET active = ?, title = ?, text = ?, image = ?, updated_at = ${NOW} WHERE id = 1`)
      .bind(a.active ? 1 : 0, a.title, a.text, a.image).run();
    return json({ ok: true, data: await getAnnounce(db) });
  }

  // 사진 올리기 (아직 커밋 전 — 저장할 때 한 번에 커밋)
  if (route === 'upload' && method === 'POST') {
    const path = safeUploadPath(request.headers.get('X-Upload-Path'));
    if (!path || !path.startsWith(UPLOAD_DIR)) throw new HttpError(400, '파일 경로가 올바르지 않습니다.');
    const base64 = (await request.text()).trim();
    if (!base64 || base64.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new HttpError(400, '사진이 비어 있거나 너무 큽니다.');
    return json({ path, sha: await createBlob(env, base64) });
  }

  // 알림 보내기
  if (route === 'push' && method === 'POST') {
    const p = await readJson(request);
    const title = str(p.title, 60);
    const body = str(p.body, 500);
    if (!title || !body) throw new HttpError(400, '제목과 내용을 모두 입력해주세요.');
    return json(await sendPush(env, url.origin, title, body));
  }

  // 관리자 명단 (대표 관리자만)
  if (route === 'admins' || route.startsWith('admins/')) {
    if (!me.owner) throw new HttpError(403, '대표 관리자만 관리자 명단을 바꿀 수 있습니다.');
    const list = async () => (await db.prepare('SELECT email, added_by, added_at FROM admins ORDER BY email').all()).results;
    if (route === 'admins' && method === 'GET') return json({ items: await list() });
    if (route === 'admins' && method === 'POST') {
      const p = await readJson(request);
      const email = str(p.email, 254).toLowerCase();
      if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) throw new HttpError(400, '이메일 주소를 정확히 적어주세요.');
      await db.prepare('INSERT INTO admins (email, added_by) VALUES (?, ?) ON CONFLICT (email) DO NOTHING').bind(email, me.email).run();
      return json({ ok: true, items: await list() });
    }
    const del = route.match(/^admins\/(.+)$/);
    if (del && method === 'DELETE') {
      await db.prepare('DELETE FROM admins WHERE email = ?').bind(decodeURIComponent(del[1]).toLowerCase()).run();
      return json({ ok: true, items: await list() });
    }
  }

  throw new HttpError(404, '없는 주소입니다.');
}

// ---------- 공개 API ----------

const PUSH_TOKEN_RE = /^[A-Za-z0-9_:\-]{20,4096}$/;

async function handleApi(request, env, url) {
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const method = request.method;
  const db = env.DB;

  if (route.startsWith('admin/') || route === 'admin') {
    return handleAdmin(request, env, url, route.replace(/^admin\/?/, ''));
  }

  if (route === 'home' && method === 'GET') {
    const [notices, bulletins, gallery, schedule, announce, todayword] = await Promise.all([
      listNotices(db), listBulletins(db), listAlbumSummaries(db), listSchedule(db), getAnnounce(db), getTodayword(db),
    ]);
    return json({ notices, bulletins, gallery, schedule, announce, todayword });
  }

  const albumMatch = route.match(/^gallery\/(\d+)$/);
  if (albumMatch && method === 'GET') {
    const album = await getAlbum(db, Number(albumMatch[1]));
    if (!album) throw new HttpError(404, '앨범을 찾을 수 없습니다.');
    return json({ album });
  }

  if (route === 'announcements' && method === 'GET') return json({ items: await listAnnouncements(db) });

  if (route === 'push/subscribe' && method === 'POST') {
    const p = await readJson(request);
    const token = String(p.token || '');
    const previous = String(p.previous || '');
    if (!PUSH_TOKEN_RE.test(token)) throw new HttpError(400, 'bad token');
    const stmts = [
      db.prepare(`INSERT INTO push_tokens (token, ua) VALUES (?, ?) ON CONFLICT (token) DO UPDATE SET ua = excluded.ua, updated_at = ${NOW}`)
        .bind(token, str(request.headers.get('User-Agent'), 300)),
    ];
    // 토큰이 새로 발급되면 예전 토큰을 지워, 이미 무효해진 토큰이 쌓여 발송 실패로 잡히지 않게 한다
    if (previous && previous !== token && PUSH_TOKEN_RE.test(previous)) stmts.push(db.prepare('DELETE FROM push_tokens WHERE token = ?').bind(previous));
    await db.batch(stmts);
    return json({ ok: true });
  }
  if (route === 'push/unsubscribe' && method === 'POST') {
    const p = await readJson(request);
    const token = String(p.token || '');
    if (PUSH_TOKEN_RE.test(token)) await db.prepare('DELETE FROM push_tokens WHERE token = ?').bind(token).run();
    return json({ ok: true });
  }

  // 오늘의 말씀 자동 갱신 — GitHub Actions가 매일 호출한다 (실패하면 GitHub가 메일로 알려준다)
  if (route === 'cron/todayword' && method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) throw new HttpError(401, 'unauthorized');
    try {
      return json({ ok: true, todayword: await updateTodayword(env) });
    } catch (err) {
      if (err instanceof TodaywordError) return json({ ok: false, error: err.message }, 502);
      throw err;
    }
  }

  throw new HttpError(404, '없는 주소입니다.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        const detail = url.pathname.startsWith('/api/admin/') && err && err.message ? ': ' + err.message : '';
        return json({ error: '처리 중 오류가 발생했습니다' + detail }, 500);
      }
    }

    // 여기까지 왔다면 배포된 화면 파일에 없는 주소다.
    // 방금 올려 아직 배포되지 않은 사진이면 GitHub에서 직접 읽어 보여준다.
    const path = url.pathname.slice(1);
    if (request.method === 'GET' && UPLOAD_PATH_RE.test(path)) {
      const res = await fetchUploadFromGitHub(env, path);
      if (res) {
        const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        return new Response(res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
