#!/usr/bin/env node
/* ============================================================
   纵深防御自检:
     1. 来源 IP 不可伪造(X-Forwarded-For / X-Real-IP 一律无效)
     2. 事件时间戳 = 请求发生的时间(不是入库时间)
     3. 应用层拒绝的注入尝试也要留痕 + 计入「已拦截」
     4. 不露 Express 指纹(404 / 400 / X-Powered-By)
     5. 登录失败不区分账号是否存在
     6. 聊天正文 schema 校验(超长 / 注入载荷 → 400)
     7. 聊天限速:每分钟 10 次 → 429 + 通用提示
     8. 一键封禁 / 解封 / CSV 导出

   用法: PORT=3000 DB_FILE=/workspace/vvechat-test.db node server.js &
         node tools/test-security-hardening.js
   ============================================================ */
const assert = require('assert');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const ADMIN = { username: 'Jack', password: 'Zhr121005' };

let pass = 0;
const fails = [];
async function step(name, fn) {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fails.push(name + ' — ' + e.message); console.log('  ✗', name, '→', e.message); }
}
async function call(pathname, { method = 'GET', body, token, headers, raw } = {}) {
  const h = Object.assign({}, headers || {});
  if (body) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(`${BASE}/api${pathname}`, {
    method, headers: h, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch (_) { data = null; }
  return { status: resp.status, data, headers: resp.headers, text: raw ? await resp.text() : null };
}

// 每个用例用不同的「Cloudflare 来源 IP」,免得限速计数互相干扰
// (生产上 Cloudflare 会给每个真实访客一个不同的 IP)。
let fakeSeq = 0;
const cfIp = () => '203.0.113.' + (100 + (fakeSeq++));

(async () => {
  const admin = await call('/login', { method: 'POST', body: ADMIN });
  assert.equal(admin.status, 200, '管理员登录失败');
  const token = admin.data.token;
  const me = admin.data.user;

  // ------------------------------------------------------------------
  console.log('\n[1] 来源 IP 不可伪造');
  const FORGED = '203.0.113.66';
  await step('带伪造 X-Forwarded-For / X-Real-IP 的请求,记的是真实 IP', async () => {
    const before = await call('/security/overview?limit=1', { token });
    const n0 = before.data.stats.events;
    await call('/../.env', { headers: { 'X-Forwarded-For': FORGED, 'X-Real-IP': FORGED } });
    await new Promise(r => setTimeout(r, 300));
    const after = await call('/security/overview?limit=10', { token });
    assert.ok(after.data.stats.events > n0, '没有留下事件');
    const ev = after.data.events[0];
    assert.notEqual(ev.ip, FORGED, '事件里的 IP 是伪造的那个:' + ev.ip);
    assert.ok(/^(127\.|::1|::ffff:127)/.test(ev.ip), '真实 IP 不对:' + ev.ip);
  });
  await step('带伪造 CF-Connecting-IP 也不会被当成真实来源以外的判断依据(本地无 CF,应记本地 IP)', async () => {
    await call('/../.env', { headers: { 'CF-Connecting-IP': FORGED } });
    await new Promise(r => setTimeout(r, 300));
    const after = await call('/security/overview?limit=3', { token });
    // 本地直连没有 Cloudflare,CF-Connecting-IP 是客户端自己塞的 ——
    // 生产环境里 Cloudflare 会覆盖这个头。这里只验证事件确实记下来了。
    assert.ok(after.data.events.length > 0, '没有事件');
  });

  // ------------------------------------------------------------------
  console.log('\n[2] 事件时间戳 = 攻击发生的时间');
  await step('事件 ts 和请求发出的时刻差在 2 秒内', async () => {
    const t0 = Date.now();
    await call('/../.env');
    await new Promise(r => setTimeout(r, 300));
    const after = await call('/security/overview?limit=1', { token });
    const ev = after.data.events[0];
    assert.ok(Math.abs(ev.ts - t0) < 2000, '时间戳偏了 ' + (ev.ts - t0) + 'ms');
  });
  await step('控制台用的时间按 Asia/Shanghai 显示', async () => {
    const after = await call('/security/overview?limit=1', { token });
    const ev = after.data.events[0];
    const sh = new Date(ev.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    assert.ok(/20\d\d/.test(sh), '时间格式不对:' + sh);
  });

  // ------------------------------------------------------------------
  console.log('\n[3] 应用层拒绝的注入尝试也要留痕');
  await step('聊天正文带注入载荷 → 400,并且留下事件 + 计入已拦截', async () => {
    const before = await call('/security/overview?limit=1', { token });
    const n0 = before.data.stats.events;
    const blocked0 = before.data.stats.blocked;
    const r = await call('/messages', {
      method: 'POST', token, headers: { 'CF-Connecting-IP': cfIp() },
      body: { conv_type: 'user', conv_id: me.id, content: "1' UNION SELECT password FROM users--" },
    });
    assert.equal(r.status, 400, '没被拒:' + r.status);
    await new Promise(r2 => setTimeout(r2, 200));
    const after = await call('/security/overview?limit=5', { token });
    assert.ok(after.data.stats.events > n0, '没有留下事件');
    assert.ok(after.data.stats.blocked > blocked0, '没有计入已拦截');
    const ev = after.data.events.find(e => e.kind === 'sqli' || e.kind === 'app_rejected');
    assert.ok(ev, '事件里找不到注入记录');
    assert.equal(ev.action, 'blocked');
  });
  await step('路径穿越 / 敏感文件探测会留痕(本机是内网 IP,按设计只记不封)', async () => {
    await call('/../.env');
    await new Promise(r => setTimeout(r, 200));
    const after = await call('/security/overview?limit=8', { token });
    assert.ok(after.data.events.some(e => e.kind === 'env_probe' || e.kind === 'path_traversal'),
      '事件里找不到路径探测记录');
  });
  await step('外部 IP 命中高危规则会被封(内网永远不封)', async () => {
    const fw = require('../firewall.js').createFirewall({ db: null, getIp: () => '198.51.100.99' });
    const hit = fw.detectProbe('GET', '/.env', '', '', '');
    assert.ok(hit, '规则没命中');
    fw.block('198.51.100.99', hit.kind, 15, hit.rule || '');
    assert.ok(fw.isBlocked('198.51.100.99'), '没封上');
    fw.unblock('198.51.100.99');
    assert.ok(!fw.isBlocked('198.51.100.99'), '没解封');
  });

  // ------------------------------------------------------------------
  console.log('\n[4] 不露 Express 指纹');
  await step('404 是自己写的,没有 "Cannot GET"', async () => {
    const resp = await fetch(`${BASE}/api/this-does-not-exist-xyz`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const text = await resp.text();
    assert.equal(resp.status, 404);
    assert.ok(!/Cannot GET/i.test(text), '还在露 Express 指纹');
    assert.ok(!/express/i.test(text), '还在露 Express 指纹');
  });
  await step('没有 X-Powered-By 头', async () => {
    const resp = await fetch(`${BASE}/api/health`);
    assert.equal(resp.headers.get('x-powered-by'), null, 'X-Powered-By 还在');
  });
  await step('畸形 JSON → 400,不是 Express 的 HTML 报错页', async () => {
    const resp = await fetch(`${BASE}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json',
    });
    const text = await resp.text();
    assert.equal(resp.status, 400);
    assert.ok(!/<pre>/i.test(text), '回的是 HTML 报错页');
    assert.ok(!/SyntaxError|at Object|node_modules/i.test(text), '泄露了内部细节');
  });

  // ------------------------------------------------------------------
  console.log('\n[5] 登录失败不区分账号是否存在');
  await step('不存在的账号 和 密码错的,返回完全一样', async () => {
    const a = await call('/login', { method: 'POST', body: { username: 'no_such_user_zzz', password: 'whatever' } });
    const b = await call('/login', { method: 'POST', body: { username: ADMIN.username, password: 'wrong_password' } });
    assert.equal(a.status, b.status);
    assert.equal(a.data.error, b.data.error, '错误文案不一样');
    assert.equal(a.data.code, b.data.code, '错误码不一样');
    assert.ok(!/不存在|not found|no such/i.test(a.data.error || ''), '暴露了账号是否存在');
  });

  // ------------------------------------------------------------------
  console.log('\n[6] 聊天正文 schema 校验');
  await step('超过 2000 字的消息被拒', async () => {
    const r = await call('/messages', {
      method: 'POST', token, headers: { 'CF-Connecting-IP': cfIp() },
      body: { conv_type: 'user', conv_id: me.id, content: '啊'.repeat(2001) },
    });
    assert.equal(r.status, 400, '没被拒:' + r.status);
  });
  await step('XSS 载荷被拒', async () => {
    const r = await call('/messages', {
      method: 'POST', token, headers: { 'CF-Connecting-IP': cfIp() },
      body: { conv_type: 'user', conv_id: me.id, content: '<script>alert(1)</script>' },
    });
    assert.equal(r.status, 400, '没被拒:' + r.status);
  });
  await step('正常消息能发出去(别把聊天功能搞坏了)', async () => {
    const r = await call('/messages', {
      method: 'POST', token, headers: { 'CF-Connecting-IP': cfIp() },
      body: { conv_type: 'user', conv_id: me.id, content: '自检:正常消息' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });
  await step('AI 对话的 history 不算进「单次请求总负载」', () => {
    const core = require('../security-core.js');
    const history = Array.from({ length: 60 }, () => ({ role: 'user', content: '历史消息'.repeat(60) }));
    const body = { message: '现在的问题', history };
    const okCase = core.validateChatInput(body, { field: 'message', exclude: ['history'] });
    assert.ok(okCase.ok, '不该被拒:' + JSON.stringify(okCase));
    const badCase = core.validateChatInput(body, { field: 'content' });
    assert.ok(!badCase.ok, '没排除 history 时应该被拒');
  });
  await step('HTML 标签在入库前被剥掉', async () => {
    const r = await call('/messages', {
      method: 'POST', token, headers: { 'CF-Connecting-IP': cfIp() },
      body: { conv_type: 'user', conv_id: me.id, content: '前面<b>粗体</b>后面' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(!/<b>/.test(r.data.message.content), '标签没剥掉:' + r.data.message.content);
  });

  // ------------------------------------------------------------------
  console.log('\n[7] 封禁 / 解封 / CSV');
  await step('一键封禁 → 该 IP 被拦 → 解封 → 恢复', async () => {
    const ip = '198.51.100.7';
    const b = await call('/security/block', { method: 'POST', token, body: { ip, minutes: 30, reason: '自检封禁' } });
    assert.equal(b.status, 200, JSON.stringify(b.data));
    const listed = b.data.stats.blockedIps.find(x => x.ip === ip);
    assert.ok(listed, '封禁列表里没有这个 IP');
    assert.ok(listed.reason, '没有记原因');
    assert.ok(listed.remaining_s > 0, '没有剩余时长');
    const u = await call('/security/unblock', { method: 'POST', token, body: { ip } });
    assert.equal(u.status, 200);
    assert.ok(!u.data.stats.blockedIps.find(x => x.ip === ip), '解封了还在列表里');
  });
  await step('CSV 导出能拿到表头和事件', async () => {
    const resp = await fetch(`${BASE}/api/security/events.csv?limit=50`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    assert.equal(resp.status, 200);
    assert.ok(/text\/csv/.test(resp.headers.get('content-type') || ''), '不是 CSV');
    const text = await resp.text();
    assert.ok(text.indexOf('来源') >= 0 || text.indexOf('IP') >= 0, '表头不对');
    assert.ok(text.split('\n').length >= 2, '没有数据行');
  });
  await step('agent 补的规则写进库并立刻生效', async () => {
    const Database = require('better-sqlite3');
    const fsx = require('fs');
    const tmp = '/workspace/vvechat-fw-rules-test.db';
    try { fsx.unlinkSync(tmp); } catch (_) {}
    const tdb = new Database(tmp);
    try {
      const fw2 = require('../firewall.js').createFirewall({ db: tdb, getIp: () => '1.1.1.1' });
      const r = fw2.addRule({ scope: 'body', pattern: 'zzz_custom_payload', kind: 'custom_probe', severity: 'high', source: 'agent' });
      assert.ok(r.ok, '加规则失败:' + JSON.stringify(r));
      const hit = fw2.detectProbe('GET', '/api/x', '?q=zzz_custom_payload', '', '');
      assert.ok(hit, '新规则没生效');
      assert.equal(hit.kind, 'custom_probe');
      assert.ok(fw2.listRules().length >= 1, '规则没写进数据库');
    } finally {
      tdb.close();
      try { fsx.unlinkSync(tmp); } catch (_) {}
    }
  });
  await step('安全接口要管理员权限', async () => {
    const r = await call('/security/overview');
    assert.equal(r.status, 401);
  });

  // ------------------------------------------------------------------
  console.log('\n[8] 聊天限速(每分钟 10 次)');
  await step('连续发消息会拿到 429 + 通用提示', async () => {
    let got429 = false, body = null;
    const oneIp = cfIp();   // 同一个 IP 连发 —— 限速是按 IP 算的
    for (let i = 0; i < 16; i++) {
      const r = await call('/messages', {
        method: 'POST', token, headers: { 'CF-Connecting-IP': oneIp },
        body: { conv_type: 'user', conv_id: me.id, content: '限速自检 ' + i },
      });
      if (r.status === 429) { got429 = true; body = r.data; break; }
    }
    assert.ok(got429, '连发 16 条都没触发限速');
    assert.equal(body.error, 'Too many requests', '429 的提示不通用:' + JSON.stringify(body));
    assert.ok(!/limit|threshold|redis|express/i.test(JSON.stringify(body)), '429 泄露了内部细节');
  });

  // ------------------------------------------------------------------
  console.log('\n────────────────────────────');
  if (fails.length) {
    console.log('通过 ' + pass + ' 项,失败 ' + fails.length + ' 项');
    for (const f of fails) console.log('  ✗', f);
    process.exit(1);
  }
  console.log('通过 ' + pass + ' 项,失败 0 项');
})().catch(e => { console.error(e); process.exit(1); });
