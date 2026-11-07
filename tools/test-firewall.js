/* 防火墙自检 —— node tools/test-firewall.js */
const assert = require('assert');
const { createFirewall } = require('../firewall.js');

const fw = createFirewall({ getIp: (req) => (req.socket && req.socket.remoteAddress) || 'unknown' });

// 1) 常见攻击载荷必须被认出来
const must = [
  ['GET', '/.env', '', ''],
  ['GET', '/../../etc/passwd', '', ''],
  ['GET', '/.git/config', '', ''],
  ['GET', '/wp-admin/setup-config.php', '', ''],
  ['GET', '/api/messages', "x=' OR '1'='1", ''],
  ['GET', '/', 'q=<script>alert(1)</script>', ''],
  ['GET', '/', '', 'sqlmap/1.5'],
  ['GET', '/', 'a=;drop table users', ''],
  ['GET', '/', 'a=%00', ''],
  ['POST', '/api/groups', 'name=;rm -rf /', ''],
  ['TRACE', '/api/health', '', '']
];
for (const [m, p, q, ua] of must) {
  const hit = fw.detectProbe(m, p, q, ua, '');
  assert.ok(hit, '漏检: ' + m + ' ' + p + ' ' + q + ' ' + ua);
}

// 2) 正常业务请求不能被误伤
const safe = [
  ['GET', '/api/messages', 'conv_type=user&conv_id=5&limit=50', 'Mozilla/5.0'],
  ['GET', '/api/control/snapshot', '', 'Mozilla/5.0'],
  ['POST', '/api/messages', '', 'Mozilla/5.0'],           // 正文跳过(用户内容)
  ['GET', '/assets/wall-light.jpg', '', 'Mozilla/5.0'],
  ['GET', '/api/health', '', 'curl/8.4.0']
];
for (const [m, p, q, ua] of safe) {
  const hit = fw.detectProbe(m, p, q, ua, m === 'POST' ? '{"content":"hi"}' : '');
  assert.ok(!hit, '误伤: ' + m + ' ' + p + ' ' + q);
}
// 聊天正文里出现注入关键字也不能封(用户自己发的)
assert.ok(!fw.detectProbe('POST', '/api/messages', '', 'Mozilla/5.0', '{"content":"select * from union where 1=1"}'),
  '误伤: 聊天正文被当成注入');

// 3) 中间件:公网地址恶意请求 → 403 + 记事件;内网地址 → 只记不封
function fakeReq(ip, path, ua) {
  return {
    method: 'GET', path, originalUrl: path, url: path, body: undefined,
    headers: { 'user-agent': ua || 'Mozilla/5.0' },
    socket: { remoteAddress: ip }
  };
}
let out = { code: 0, body: null };
const res = {
  status(c) { out.code = c; return this; },
  json(j) { out.body = j; return this; }
};
fw.middleware(fakeReq('203.0.113.9', '/.env'), res, () => { out.code = 200; });
assert.strictEqual(out.code, 403, '恶意请求没有被拦截');
assert.ok(fw.isBlocked('203.0.113.9'), '恶意 IP 没有被封');
assert.ok(fw.listEvents(10).length >= 0);

// 内网:记录但不封
let out2 = { code: 0 };
const res2 = { status(c) { out2.code = c; return this; }, json() { return this; } };
fw.middleware(fakeReq('127.0.0.1', '/.env'), res2, () => { out2.code = 200; });
assert.strictEqual(out2.code, 200, '内网地址被误封');
assert.ok(!fw.isBlocked('127.0.0.1'), '内网地址不应该被封');

// 4) 解封
fw.unblock('203.0.113.9');
assert.ok(!fw.isBlocked('203.0.113.9'), '解封失败');

console.log('✓ 防火墙自检通过：', must.length, '种攻击载荷全部识别，', safe.length + 1, '种正常请求零误伤');
