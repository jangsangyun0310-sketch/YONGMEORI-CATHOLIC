// 사진 파일은 GitHub 저장소(public/images/uploads/)에 커밋한다.
// 커밋되면 Cloudflare가 사이트를 다시 배포하고, 그 전까지는 worker.js가 GitHub에서 직접 읽어 보여준다.

import { cfg, HttpError } from './util.js';

const SITE_DIR = 'public/';

async function gh(env, path, options = {}) {
  if (!env.GITHUB_TOKEN) throw new HttpError(500, 'GITHUB_TOKEN 설정이 없어 사진을 저장할 수 없습니다. (관리자에게 문의)');
  const res = await fetch(`${cfg(env, 'GITHUB_API_URL')}${path}`, {
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

// 사진 한 장을 GitHub에 올려두기만 한다(아직 커밋 전). 돌려받은 sha로 나중에 한 번에 커밋한다.
export async function createBlob(env, base64) {
  const data = await gh(env, `/repos/${cfg(env, 'GITHUB_REPO')}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: base64, encoding: 'base64' }),
  });
  return data.sha;
}

// 올려둔 사진 추가 + 필요 없어진 사진 삭제를 한 번의 커밋으로 처리한다 (배포도 한 번만 일어난다).
// 여러 관리자가 동시에 저장해 커밋이 엇갈리면 최신 상태로 다시 시도한다.
async function createTree(env, repo, baseTreeSha, add, remove) {
  const adds = add.map((b) => ({ path: SITE_DIR + b.path, mode: '100644', type: 'blob', sha: b.sha }));
  const dels = remove.map((p) => ({ path: SITE_DIR + p, mode: '100644', type: 'blob', sha: null }));
  const post = (tree) => gh(env, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  try {
    return await post([...adds, ...dels]);
  } catch (err) {
    // 이미 없는 파일을 지우려 하면 422가 난다 → 지우기는 건너뛰고 추가만 한다
    if (err.status !== 422 || !dels.length) throw err;
    return adds.length ? post(adds) : null;
  }
}

export async function commitUploads(env, { message, add = [], remove = [] }) {
  if (!add.length && !remove.length) return null;
  const repo = cfg(env, 'GITHUB_REPO');
  const branch = encodeURIComponent(cfg(env, 'GITHUB_BRANCH'));
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await gh(env, `/repos/${repo}/git/ref/heads/${branch}`);
    const baseSha = ref.object.sha;
    const baseCommit = await gh(env, `/repos/${repo}/git/commits/${baseSha}`);
    const newTree = await createTree(env, repo, baseCommit.tree.sha, add, remove);
    if (!newTree) return null;
    const newCommit = await gh(env, `/repos/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
    });
    try {
      await gh(env, `/repos/${repo}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha, force: false }),
      });
      return newCommit.sha;
    } catch (err) {
      // 그 사이 다른 커밋이 들어와 앞질러졌으면 최신 상태에서 다시 만든다
      if (err.status !== 422 && err.status !== 409) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

// 방금 올려 아직 배포되지 않은 사진을 GitHub에서 직접 읽어 보여준다 (배포가 끝나면 이 경로는 쓰이지 않는다)
export async function fetchUploadFromGitHub(env, path) {
  if (!env.GITHUB_TOKEN) return null;
  const repo = cfg(env, 'GITHUB_REPO');
  const ref = encodeURIComponent(cfg(env, 'GITHUB_BRANCH'));
  const res = await fetch(`${cfg(env, 'GITHUB_API_URL')}/repos/${repo}/contents/${SITE_DIR}${path}?ref=${ref}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'yongmeori-church-site',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return res.ok ? res : null;
}
