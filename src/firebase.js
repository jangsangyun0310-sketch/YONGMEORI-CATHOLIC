// Firebase는 두 가지에만 쓴다: 관리자 구글 로그인 확인, 휴대폰 푸시 알림 발송 (둘 다 무료).
// 데이터 저장은 모두 D1에서 한다.

import { cfg } from './util.js';

// 관리자 페이지가 보낸 Firebase 로그인 토큰을 구글 서버에 물어봐서 진짜인지 확인하고 이메일을 돌려준다
export async function verifyIdToken(env, idToken) {
  const res = await fetch(
    `${cfg(env, 'IDENTITY_TOOLKIT_URL')}/v1/accounts:lookup?key=${cfg(env, 'FIREBASE_API_KEY')}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users && data.users[0];
  if (!user || !user.email) return null;
  if (user.emailVerified === false) return null;
  return { email: String(user.email).toLowerCase(), name: user.displayName || '' };
}

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToArrayBuffer(pem) {
  const bin = atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}

// 서비스 계정으로 구글 인증 토큰을 받는다 (firebase-admin 없이 직접)
async function getServiceAccountToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT 설정이 없습니다.');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claim}.${b64url(sig)}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('구글 인증 토큰을 받지 못했습니다.');
  return { accessToken: data.access_token, projectId: sa.project_id || cfg(env, 'FIREBASE_PROJECT_ID') };
}

const PUSH_TOPIC = 'all';

// 알림 발송: 알림함(D1)에 먼저 남기고, 구독한 휴대폰 전체에 푸시를 보낸다
export async function sendPush(env, origin, title, body) {
  const announcementId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO announcements (id, title, body) VALUES (?, ?, ?)').bind(announcementId, title, body).run();

  const { results } = await env.DB.prepare('SELECT token FROM push_tokens').all();
  const tokens = results.map((r) => r.token);
  if (!tokens.length) {
    return { message: '알림함에는 저장했지만, 아직 알림을 구독한 사람이 없어 푸시는 못 보냈습니다.' };
  }

  const { accessToken, projectId } = await getServiceAccountToken(env);
  const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // 토큰마다 따로 보내면 요청 수 제한에 걸리므로, 모두 한 주제(topic)에 묶어 한 번에 보낸다
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

  const fcm = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      message: {
        topic: PUSH_TOPIC,
        notification: { title, body },
        data: { announcementId },
        webpush: {
          fcm_options: { link: `${origin}/` },
          notification: { icon: `${origin}/images/icons/icon-192.png`, tag: announcementId },
        },
      },
    }),
  });
  if (!fcm.ok) throw new Error(`FCM ${fcm.status}: ${await fcm.text()}`);

  // 만료된 구독은 정리
  if (invalid.length) {
    await env.DB.batch(invalid.map((t) => env.DB.prepare('DELETE FROM push_tokens WHERE token = ?').bind(t)));
  }

  const sent = tokens.length - invalid.length;
  return {
    message: `발송 완료: 구독자 ${sent}명에게 알림을 보냈습니다.`
      + (invalid.length ? ` (만료된 구독 ${invalid.length}건 정리)` : '')
      + ' 알림함에도 저장되었습니다.',
  };
}
