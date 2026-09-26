// 공통 도우미 — 응답, 입력값 정리, 설정값

export const DEFAULTS = {
  GITHUB_REPO: 'jangsangyun0310-sketch/YONGMEORI-CATHOLIC',
  GITHUB_BRANCH: 'main',
  OWNER_EMAIL: 'jangsangyun0310@gmail.com',
  FIREBASE_PROJECT_ID: 'yongmeori-church',
  // push-config.js와 같은 값. 비밀키가 아니라 공개되어도 되는 값이다.
  FIREBASE_API_KEY: 'AIzaSyAENs_exymTcWYciCX1txgp6oNqUwyOXys',
  IDENTITY_TOOLKIT_URL: 'https://identitytoolkit.googleapis.com',
  GITHUB_API_URL: 'https://api.github.com',
};

export function cfg(env, key) {
  return (env && env[key]) || DEFAULTS[key];
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function str(v, max) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);
}

// 주보·갤러리 날짜 (예: 2026.09.26)
export function dotDate(v) {
  const s = str(v, 10);
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(s)) throw new HttpError(400, '날짜 형식이 올바르지 않습니다. (예: 2026.09.26)');
  return s;
}

// 본당 일정 날짜 (예: 2026-09-26)
export function isoDate(v) {
  const s = str(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, '날짜를 골라주세요.');
  return s;
}

// 홈페이지에 넣을 수 있는 사진 경로: 우리 사이트 images/ 안의 이미지만
export function safeImagePath(v) {
  const s = str(v, 300);
  if (!s) return '';
  if (s.includes('..') || !/^images\/[A-Za-z0-9_\-./]+\.(jpe?g|png|webp|gif)$/i.test(s)) return '';
  return s;
}

export const UPLOAD_DIR = 'images/uploads/';
export const UPLOAD_PATH_RE = /^images\/uploads\/[0-9]{4}\/[A-Za-z0-9_\-]+\.(jpg|png|webp)$/;

export function safeUploadPath(p) {
  const s = String(p || '');
  return UPLOAD_PATH_RE.test(s) && !s.includes('..') ? s : '';
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    throw new HttpError(400, '요청 내용을 읽을 수 없습니다.');
  }
}

// 시간에 따라 비교 결과가 달라지지 않는 문자열 비교 (비밀값 확인용)
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
