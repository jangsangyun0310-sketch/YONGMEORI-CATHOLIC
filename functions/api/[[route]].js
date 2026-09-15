// 용머리성당 홈페이지 — 관리 기능 API (Cloudflare Pages Functions)
//
// 관리자 페이지(/admin/)에서 구글 로그인한 뒤 호출한다. 모든 요청은
//   1) Firebase ID 토큰을 구글 서버에서 확인하고
//   2) 그 이메일이 대표 관리자이거나 Firestore `admins/{이메일}` 문서가 있는지 확인한 뒤
// 처리된다. 저장은 GitHub 저장소에 직접 커밋해서, GitHub Pages(홈페이지)와 Cloudflare Pages(관리자 페이지)가
// 각자 자동으로 다시 배포한다.
//
// Cloudflare Pages 환경변수(Settings > Variables and Secrets)에 아래 값이 필요하다:
//   GITHUB_TOKEN              GitHub 개인 액세스 토큰 (저장소 내용 읽기/쓰기 권한)
//   FIREBASE_SERVICE_ACCOUNT  Firebase 서비스 계정 키 JSON 전체 (알림 발송용)
// 선택:
//   GITHUB_REPO   기본값 jangsangyun0310-sketch/YONGMEORI-CATHOLIC
//   GITHUB_BRANCH 기본값 main
//   OWNER_EMAIL   기본값 jangsangyun0310@gmail.com (관리자 명단이 비어 있어도 항상 관리자)
//
// 주의: 환경변수 이름 앞뒤에 빈칸이 들어가면 읽히지 않는다 (서학동성당에서 한 번 겪은 실수).
// 저장 후 "Retry deployment"로 한 번 다시 배포해야 적용된다. /api/health 로 설정 여부를 확인할 수 있다.

const DEFAULTS = {
  GITHUB_REPO: 'jangsangyun0310-sketch/YONGMEORI-CATHOLIC',
  GITHUB_BRANCH: 'main',
  OWNER_EMAIL: 'jangsangyun0310@gmail.com',
  FIREBASE_PROJECT_ID: 'yongmeori-church',
  // push-config.js와 같은 값. 비밀키가 아니라 공개되어도 되는 값이다.
  FIREBASE_API_KEY: 'AIzaSyAENs_exymTcWYciCX1txgp6oNqUwyOXys',
};

// 홈페이지 실제 주소(GitHub Pages). 알림을 눌렀을 때 열리는 곳과 알림 아이콘에 쓴다.
const SITE_URL = 'https://jangsangyun0310-sketch.github.io/YONGMEORI-CATHOLIC/';

// 관리자 페이지에서 편집할 수 있는 파일 목록 (이 밖의 파일은 절대 건드리지 않는다)
const CONTENT_FILES = {
  notices: 'content/notices.json',
  bulletins: 'content/bulletins.json',
  gallery: 'content/gallery.json',
  announce: 'content/announce.json',
  schedule: 'content/schedule.json',
};
const UPLOAD_DIR = 'images/uploads/';
const PUSH_TOPIC = 'all';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function cfg(env, key) {
  return (env && env[key]) || DEFAULTS[key];
}

// ---------- 관리자 확인 ----------

// Firebase ID 토큰을 구글 서버에 물어봐서 진짜인지 확인하고 이메일을 돌려준다
async function verifyIdToken(env, idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${cfg(env, 'FIREBASE_API_KEY')}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users && data.users[0];
  if (!user || !user.email) return null;
  return { email: String(user.email).toLowerCase(), name: user.displayName || '' };
}

// Firestore `admins/{이메일}` 문서가 있는지 확인. 사용자의 ID 토큰으로 읽으므로
// Firestore 보안 규칙("본인 이메일 문서만 읽기 가능")이 그대로 적용된다.
async function isListedAdmin(env, email, idToken) {
  const pid = cfg(env, 'FIREBASE_PROJECT_ID');
  const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/admins/${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  return res.status === 200;
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!idToken) return { error: json({ error: '로그인이 필요합니다.' }, 401) };
  const user = await verifyIdToken(env, idToken);
  if (!user) return { error: json({ error: '로그인 정보가 만료되었습니다. 다시 로그인해주세요.' }, 401) };
  const owner = String(cfg(env, 'OWNER_EMAIL')).toLowerCase();
  const ok = user.email === owner || (await isListedAdmin(env, user.email, idToken));
  if (!ok) return { error: json({ error: '관리자로 등록되지 않은 계정입니다.' }, 403) };
  return { user };
}

// ---------- GitHub ----------

async function gh(env, path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'yongmeori-church-admin',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`GitHub ${res.status}: ${(data && data.message) || text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 파일 내용 읽기 (배포 전 최신 커밋 기준)
async function readContentFile(env, name) {
  const repo = cfg(env, 'GITHUB_REPO');
  const branch = cfg(env, 'GITHUB_BRANCH');
  const path = CONTENT_FILES[name];
  const data = await gh(env, `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  // GitHub는 base64를 줄바꿈 섞어서 주므로 정리한 뒤 UTF-8로 되돌린다
  const bin = atob(String(data.content || '').replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// 이미지 파일을 GitHub blob으로 올린다 (base64 문자열을 그대로 전달)
async function createBlob(env, base64) {
  const repo = cfg(env, 'GITHUB_REPO');
  const data = await gh(env, `/repos/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: base64, encoding: 'base64' }),
  });
  return data.sha;
}

// JSON 파일 + 올린 이미지들을 한 번의 커밋으로 저장한다 (배포도 한 번만 일어난다)
async function commitFiles(env, { message, jsonFiles, blobs }) {
  const repo = cfg(env, 'GITHUB_REPO');
  const branch = cfg(env, 'GITHUB_BRANCH');
  const ref = await gh(env, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const baseSha = ref.object.sha;
  const baseCommit = await gh(env, `/repos/${repo}/git/commits/${baseSha}`);

  const tree = [];
  for (const f of jsonFiles) tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.content });
  for (const b of blobs) tree.push({ path: b.path, mode: '100644', type: 'blob', sha: b.sha });

  const newTree = await gh(env, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  });
  const newCommit = await gh(env, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
  });
  await gh(env, `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  return newCommit.sha;
}

// ---------- 저장 데이터 정리 (이상한 값이 홈페이지에 들어가지 않도록) ----------

function str(v, max) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);
}
function safeImagePath(v) {
  const s = str(v, 400);
  if (!s || s.includes('..')) return '';
  // 우리 저장소 안의 이미지 경로
  if (/^images\/[A-Za-z0-9_\-./]+\.(jpe?g|png|webp|gif)$/i.test(s)) return s;
  // 예전 주보는 다음카페 첨부파일 주소를 그대로 쓰고 있어 그것도 허용한다
  if (/^https:\/\/t1\.daumcdn\.net\/cafeattach\/[A-Za-z0-9_\-./]+$/.test(s)) return s;
  return '';
}
function sanitizeContent(name, data) {
  const items = Array.isArray(data && data.items) ? data.items : [];
  if (name === 'notices') {
    // 날짜 칸은 "2026.09.20" 같은 날짜뿐 아니라 "상시 모집" 같은 문구도 쓸 수 있다
    return {
      items: items.slice(0, 300).map((n) => ({
        tag: str(n.tag, 30), title: str(n.title, 120), date: str(n.date, 30), body: str(n.body, 5000),
      })),
    };
  }
  if (name === 'bulletins') {
    // 주보 한 부에 앞면·뒷면처럼 여러 장이 들어갈 수 있다. image는 첫 장(예전 형식 호환용).
    return {
      items: items.slice(0, 2000).map((b) => {
        const images = (Array.isArray(b.images) ? b.images : [b.image]).map(safeImagePath).filter(Boolean).slice(0, 20);
        return { date: str(b.date, 20), title: str(b.title, 120), image: images[0] || '', images };
      }),
    };
  }
  if (name === 'gallery') {
    return {
      items: items.slice(0, 5000).map((g) => ({
        date: str(g.date, 20), title: str(g.title, 200), image: safeImagePath(g.image),
      })),
    };
  }
  if (name === 'announce') {
    return {
      active: !!(data && data.active),
      title: str(data && data.title, 120),
      text: str(data && data.text, 3000),
      image: safeImagePath(data && data.image),
    };
  }
  if (name === 'schedule') {
    return {
      items: items.slice(0, 1000)
        .map((s) => ({ date: str(s.date, 10), title: str(s.title, 120), time: str(s.time, 80), place: str(s.place, 80) }))
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.title)
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
  return null;
}
function safeUploadPath(p) {
  const s = String(p || '');
  if (!s.startsWith(UPLOAD_DIR) || s.includes('..')) return '';
  if (!/^images\/uploads\/[0-9]{4}\/[A-Za-z0-9_\-]+\.(jpg|png|webp)$/.test(s)) return '';
  return s;
}

// ---------- 알림 발송 (Firebase 서비스 계정으로 직접 호출; firebase-admin 없이) ----------

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}
async function getServiceAccountToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT 환경변수가 없습니다.');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const jwt = `${header}.${claim}.${b64url(sig)}`;
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('구글 인증 토큰을 받지 못했습니다.');
  return { accessToken: data.access_token, projectId: sa.project_id || cfg(env, 'FIREBASE_PROJECT_ID') };
}

async function sendPush(env, title, body) {
  const { accessToken, projectId } = await getServiceAccountToken(env);
  const fsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // 1) 알림함(announcements)에 먼저 남긴다 — 구독자가 없어도 홈페이지 알림함에는 보이도록
  const created = await fetch(`${fsBase}/announcements`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      fields: {
        title: { stringValue: title },
        body: { stringValue: body },
        createdAt: { timestampValue: new Date().toISOString() },
      },
    }),
  }).then((r) => r.json());
  if (!created.name) throw new Error('알림함 저장 실패');
  const announcementId = created.name.split('/').pop();

  // 2) 구독 토큰 목록
  const rows = await fetch(`${fsBase}:runQuery`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'push_tokens' }],
        select: { fields: [{ fieldPath: '__name__' }] },
        limit: 10000,
      },
    }),
  }).then((r) => r.json());
  const tokens = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.document && r.document.name)
    .map((r) => r.document.name.split('/').pop());

  if (!tokens.length) {
    return { message: '알림함에는 저장했지만, 아직 알림을 구독한 사람이 없어 푸시는 못 보냈습니다.' };
  }

  // 3) 토큰마다 따로 보내면 요청 수 제한에 걸리므로, 모두 한 주제(topic)에 묶어 한 번에 보낸다
  const invalid = [];
  for (let i = 0; i < tokens.length; i += 1000) {
    const chunk = tokens.slice(i, i + 1000);
    const r = await fetch('https://iid.googleapis.com/iid/v1:batchAdd', {
      method: 'POST',
      headers: { ...authHeaders, access_token_auth: 'true' },
      body: JSON.stringify({ to: `/topics/${PUSH_TOPIC}`, registration_tokens: chunk }),
    }).then((x) => x.json());
    (r.results || []).forEach((res, idx) => {
      if (res && res.error && /NOT_FOUND|INVALID_ARGUMENT/.test(res.error)) invalid.push(chunk[idx]);
    });
  }

  // tag를 알림함 문서 id로 지정해두면, 홈페이지 알림함에서 지울 때 실제 휴대폰 알림도 같이 지울 수 있다
  const fcm = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      message: {
        topic: PUSH_TOPIC,
        notification: { title, body },
        data: { announcementId },
        webpush: {
          fcm_options: { link: SITE_URL },
          notification: { icon: `${SITE_URL}images/icons/icon-192.png`, tag: announcementId },
        },
      },
    }),
  });
  if (!fcm.ok) throw new Error(`FCM ${fcm.status}: ${await fcm.text()}`);

  // 4) 만료된 구독은 정리
  if (invalid.length) {
    for (let i = 0; i < invalid.length; i += 400) {
      await fetch(`${fsBase}:commit`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ writes: invalid.slice(i, i + 400).map((t) => ({ delete: `${fsBase}/push_tokens/${t}` })) }),
      });
    }
  }

  const sent = tokens.length - invalid.length;
  return {
    message: `발송 완료: 구독자 ${sent}명에게 알림을 보냈습니다.`
      + (invalid.length ? ` (만료된 구독 ${invalid.length}건 정리)` : '')
      + ' 알림함에도 저장되었습니다.',
  };
}

// ---------- 라우팅 ----------

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  // 설정 점검용 (값은 보여주지 않고 있는지 없는지만) — 처음 설정할 때 환경변수가 제대로 들어갔는지 확인하는 용도
  if (route === 'health' && request.method === 'GET') {
    return json({
      ok: true,
      GITHUB_TOKEN: !!env.GITHUB_TOKEN,
      FIREBASE_SERVICE_ACCOUNT: !!env.FIREBASE_SERVICE_ACCOUNT,
      repo: cfg(env, 'GITHUB_REPO'),
    });
  }

  try {
    const auth = await requireAdmin(request, env);
    if (auth.error) return auth.error;
    const who = auth.user.email;

    // 로그인·권한 확인만 (관리자 페이지 진입 시)
    if (route === 'me' && request.method === 'GET') {
      return json({ email: who, name: auth.user.name, admin: true });
    }

    if (route === 'content' && request.method === 'GET') {
      const name = url.searchParams.get('name');
      if (!CONTENT_FILES[name]) return json({ error: '알 수 없는 항목입니다.' }, 400);
      if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다.' }, 500);
      return json({ name, data: await readContentFile(env, name) });
    }

    if (route === 'upload' && request.method === 'POST') {
      if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다.' }, 500);
      const path = safeUploadPath(request.headers.get('X-Upload-Path'));
      if (!path) return json({ error: '파일 경로가 올바르지 않습니다.' }, 400);
      const base64 = (await request.text()).trim();
      if (!base64 || base64.length > 8 * 1024 * 1024) return json({ error: '사진이 비어 있거나 너무 큽니다.' }, 400);
      const sha = await createBlob(env, base64);
      return json({ path, sha });
    }

    if (route === 'save' && request.method === 'POST') {
      if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN 환경변수가 설정되지 않았습니다.' }, 500);
      const payload = await request.json();
      const name = payload && payload.name;
      if (!CONTENT_FILES[name]) return json({ error: '알 수 없는 항목입니다.' }, 400);
      const data = sanitizeContent(name, payload.data);
      const blobs = (Array.isArray(payload.blobs) ? payload.blobs : [])
        .map((b) => ({ path: safeUploadPath(b.path), sha: String(b.sha || '') }))
        .filter((b) => b.path && /^[0-9a-f]{40}$/.test(b.sha));
      const label = { notices: '공지사항', bulletins: '주보', gallery: '갤러리', announce: '접속 시 팝업', schedule: '본당 일정' }[name];
      const sha = await commitFiles(env, {
        message: `${label} 수정 (관리자 페이지: ${who})`,
        jsonFiles: [{ path: CONTENT_FILES[name], content: JSON.stringify(data, null, 2) + '\n' }],
        blobs,
      });
      return json({ ok: true, commit: sha, data });
    }

    if (route === 'send-push' && request.method === 'POST') {
      const payload = await request.json();
      const title = str(payload && payload.title, 60);
      const body = str(payload && payload.body, 500);
      if (!title || !body) return json({ error: '제목과 내용을 모두 입력해주세요.' }, 400);
      return json(await sendPush(env, title, body));
    }

    return json({ error: '없는 주소입니다.' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: '처리 중 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err)) }, 500);
  }
}
