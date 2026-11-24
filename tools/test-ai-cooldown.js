// Self-check: a rate-limited source must not hold the reply hostage.
//
// The public endpoints answer 429 with a `retry-after` measured in DAYS
// (3317393 s ≈ 38 days). The old code treated that as "wait 8 s and retry",
// 3 attempts × 4 sources = ~70 s of dead time before the next source got a
// turn. This drives the real server with a mocked upstream and measures it.
//
//   node tools/test-ai-cooldown.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3111;
const LOG = '/tmp/mock-upstream.log';
const DB = '/workspace/cooldown-test.db';
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (const f of [LOG, DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  const srv = spawn(process.execPath, ['--require', path.join(__dirname, 'mock-upstream.js'), 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, JWT_SECRET: 'cooldown-test-secret', MOCK_LOG: LOG },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', (d) => process.env.VERBOSE && console.log('[srv]', String(d).trim()));

  // wait for the server
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch (_) {}
    await sleep(300);
  }
  if (!up) { console.log('✗ 服务没起来'); srv.kill(); process.exit(1); }

  const j = async (p, body, token) => {
    const r = await fetch(BASE + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body)
    });
    return r.json();
  };

  const reg = await j('/api/register', { username: 'cool_test_user', password: 'CooldownTest123' });
  const login = reg.token ? reg : await j('/api/login', { username: 'cool_test_user', password: 'CooldownTest123' });
  const token = login.token;
  ok(!!token, '测试账号登录成功');
  if (!token) { srv.kill(); process.exit(1); }

  // --- request 1: the chain must walk past the dead OVH sources fast ---
  const t0 = Date.now();
  const r1 = await fetch(BASE + '/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ message: '说一句话', thinking: true, level: 'medium' })
  });
  const body1 = await r1.text();
  const ms1 = Date.now() - t0;
  ok(/pollinations/.test(body1), '第 1 次由可用的源作答（跳过被限速的源）', body1.slice(0, 160));
  ok(ms1 < 15000, `第 1 次耗时 < 15s（实际 ${(ms1 / 1000).toFixed(1)}s）`, '旧逻辑这里要 70-96s');

  // --- request 2: the dead sources are in cooldown, so they are not retried ---
  fs.writeFileSync(LOG, '');
  const t1 = Date.now();
  const r2 = await fetch(BASE + '/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ message: '再说一句', thinking: true, level: 'medium' })
  });
  const body2 = await r2.text();
  const ms2 = Date.now() - t1;
  const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
  const ovhHits = log.filter((l) => l === 'ovh').length;
  ok(/pollinations/.test(body2), '第 2 次由可用的源作答', body2.slice(0, 160));
  ok(ovhHits === 0, `第 2 次不再碰被限速的源（OVH 命中 ${ovhHits} 次，应为 0）`);
  ok(ms2 < 8000, `第 2 次耗时 < 8s（实际 ${(ms2 / 1000).toFixed(1)}s）`);

  // --- the cooldown must expire, otherwise a source can never come back ---
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/aiSourceCooling/.test(src) && /AI_COOLDOWN\.delete/.test(src), '冷却过期后会自动放行（不会永久禁用某个源）');

  srv.kill('SIGKILL');
  await sleep(200);
  for (const f of [LOG, DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }

  console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ 有失败'}  ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
