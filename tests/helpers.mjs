// 테스트용 실행 환경: 로컬 D1 + wrangler dev + 가짜 구글 로그인/GitHub 서버
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

export const USERS = {
  'owner-token': { email: 'jangsangyun0310@gmail.com', displayName: '대표' },
  'admin-token': { email: 'helper@example.com', displayName: '도우미' },
  'stranger-token': { email: 'stranger@example.com', displayName: '손님' },
};
export const CRON_SECRET = 'test-cron-secret';

export async function startStack({ port = 8799, persist = '.wrangler/test-state' } = {}) {
  const gh = { blobs: new Map(), trees: [], commits: 0, head: 'a'.repeat(40) };
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, data, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
      };
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/v1/accounts:lookup') {
        const u = USERS[JSON.parse(body || '{}').idToken];
        return u ? send(200, { users: [{ ...u, emailVerified: true }] }) : send(400, { error: { message: 'INVALID_ID_TOKEN' } });
      }
      const m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/(.+)$/);
      if (!m) return send(404, { message: 'Not Found' });
      const p = m[1];
      if (p === 'git/blobs' && req.method === 'POST') {
        const sha = (gh.blobs.size + 1).toString(16).padStart(40, 'b');
        gh.blobs.set(sha, Buffer.from(JSON.parse(body).content, 'base64'));
        return send(201, { sha });
      }
      if (p.startsWith('git/ref/heads/')) return send(200, { object: { sha: gh.head } });
      if (p.startsWith('git/commits/') && req.method === 'GET') return send(200, { tree: { sha: 'c'.repeat(40) } });
      if (p === 'git/trees' && req.method === 'POST') { gh.trees.push(JSON.parse(body).tree); return send(201, { sha: 'd'.repeat(40) }); }
      if (p === 'git/commits' && req.method === 'POST') { gh.commits++; return send(201, { sha: gh.commits.toString(16).padStart(40, 'e') }); }
      if (p.startsWith('git/refs/heads/') && req.method === 'PATCH') return send(200, {});
      if (p.startsWith('contents/public/')) {
        const path = p.slice('contents/'.length);
        for (const tree of gh.trees) {
          const entry = tree.find((t) => t.path === path && t.sha);
          if (entry) return send(200, gh.blobs.get(entry.sha), 'application/octet-stream');
        }
      }
      return send(404, { message: 'Not Found' });
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;

  rmSync(persist, { recursive: true, force: true });
  execSync(`npx wrangler d1 migrations apply DB --local --persist-to ${persist}`, { stdio: 'ignore' });
  // 인자는 모두 이 파일에 고정된 값이라 shell 사용이 안전하다 (Windows에서 npx.cmd 실행용)
  const worker = spawn('npx', [
    'wrangler', 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist,
    '--var', `IDENTITY_TOOLKIT_URL:${mockUrl}`, '--var', `GITHUB_API_URL:${mockUrl}`,
    '--var', 'GITHUB_TOKEN:test-github-token', '--var', `CRON_SECRET:${CRON_SECRET}`,
  ], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('wrangler dev did not start')), 90000);
    const onData = (d) => { if (/Ready on/i.test(String(d))) { clearTimeout(timer); resolve(); } };
    worker.stdout.on('data', onData);
    worker.stderr.on('data', onData);
  });

  return {
    base: `http://127.0.0.1:${port}`,
    gh,
    stop() {
      mock.close();
      if (process.platform === 'win32') execSync(`taskkill /pid ${worker.pid} /T /F`, { stdio: 'ignore' });
      else worker.kill('SIGTERM');
    },
  };
}
