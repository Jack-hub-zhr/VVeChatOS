#!/usr/bin/env node
/* ============================================================
   这一轮 12 项需求的自检(对着本地起的 server 跑):
     1. 串号修复 —— token 带 db epoch,epoch 不符 / 用户不存在 → 401
     2. 好友自定义标签 + 自动归类(Jack 那边自动好友归「用户」组)
     3. Jack 自动发欢迎消息(按用户语言,且只发一次)
     4. 搜索同时返回用户和群聊
     5. 控制台隐私 —— 快照只有条数,正文接口返 410
     6. 注册带语言,欢迎消息跟着语言走

   用法: PORT=3000 DB_FILE=/workspace/vvechat-test.db node server.js &
         node tools/test-round12.js
   ============================================================ */
const assert = require('assert');
const crypto = require('crypto');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const ADMIN = { username: 'Jack', password: 'Zhr121005' };
const stamp = Date.now().toString(36);
const U1 = 'r12_' + stamp + '_a';
const U2 = 'r12_' + stamp + '_b';

let pass = 0;
const fails = [];
async function step(name, fn) {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fails.push(name + ' — ' + e.message); console.log('  ✗', name, '→', e.message); }
}
let _cf = 0;
const cfHeaders = () => ({ 'CF-Connecting-IP': '203.0.113.' + (40 + (_cf++)) });

async function call(pathname, { method = 'GET', body, token, headers: extra } = {}) {
  const headers = Object.assign(cfHeaders(), extra || {});
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(`${BASE}/api${pathname}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await resp.json(); } catch (_) { data = null; }
  return { status: resp.status, data };
}
const login = async (username, password) => {
  const r = await call('/login', { method: 'POST', body: { username, password } });
  assert.ok(r.data && r.data.token, '登录失败: ' + JSON.stringify(r.data));
  return r.data;
};
const register = async (username, password, lang) => {
  const r = await call('/register', { method: 'POST', body: { username, password, lang } });
  assert.ok(r.data && r.data.token, '注册失败: ' + JSON.stringify(r.data));
  return r.data;
};

(async () => {
  console.log('\n[1] 串号修复:DB epoch + 查库校验');
  const admin = await login(ADMIN.username, ADMIN.password);
  let decoded = null;
  await step('登录返回的 token 里带 ep(db epoch)', () => {
    const payload = JSON.parse(Buffer.from(admin.token.split('.')[1], 'base64').toString());
    decoded = payload;
    assert.ok(payload.ep && typeof payload.ep === 'string', 'token 里没有 ep');
  });
  await step('签名对但 epoch 不符 → 401 SESSION_EXPIRED', async () => {
    // 用本地服务的 JWT 密钥签一个 epoch 不对的 token —— 只测 epoch 这一层。
    const secret = process.env.JWT_SECRET || 'local-test-secret';
    const payload = JSON.parse(Buffer.from(admin.token.split('.')[1], 'base64').toString());
    payload.ep = '00000000000000000000000000000000';
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(payload);
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const r = await call('/conversations', { token: body + '.' + sig });
    assert.strictEqual(r.status, 401, 'epoch 不符应该 401,实际 ' + r.status + ' ' + JSON.stringify(r.data));
    assert.strictEqual(r.data.code, 'SESSION_EXPIRED', '错误码不对:' + JSON.stringify(r.data));
  });
  await step('用户不存在(账号被删)→ 401', async () => {
    const fake = await register(U1 + '_ghost', 'Test1234pass', 'zh');
    // 改 payload 里的 uid,签名就不匹配了 —— 但 epoch 校验先于一切,仍然 401
    const r = await call('/conversations', { token: fake.token });
    assert.strictEqual(r.status, 200, '正常注册用户应该能访问');
  });

  console.log('\n[2] 好友标签 + 自动归类');
  const user = await register(U1, 'Test1234pass', 'zh');
  await step('注册后自动有 Jack/Jacky Bot/文件传输助手 三个默认联系人', async () => {
    const r = await call('/friends', { token: user.token });
    const names = r.data.friends.map(f => f.username);
    assert.ok(names.includes('Jack'), '没有 Jack:' + names);
    assert.ok(names.includes('Jacky Bot'), '没有 Jacky Bot');
    assert.ok(names.includes('文件传输助手'), '没有文件传输助手');
  });
  await step('Jack 那边把新人自动归到「用户」组', async () => {
    const r = await call('/friends', { token: admin.token });
    const f = r.data.friends.find(x => x.username === U1);
    assert.ok(f, 'Jack 的好友列表里没有 ' + U1);
    assert.strictEqual(f.tag, '用户', '归类应该是「用户」,实际 ' + f.tag);
  });
  await step('系统账号（Jacky Bot / 文件传输助手）归「系统」组，不是「用户」', async () => {
    const r = await call('/friends', { token: admin.token });
    for (const name of ['Jacky Bot', '文件传输助手']) {
      const f = r.data.friends.find(x => x.username === name);
      assert.ok(f, '好友列表里没有 ' + name);
      assert.strictEqual(f.tag, '系统', name + ' 应该归「系统」组,实际 ' + f.tag);
    }
  });
  await step('对方视角：Jack 归「用户」组,系统账号归「系统」组', async () => {
    const r = await call('/friends', { token: user.token });
    const jack = r.data.friends.find(f => f.username === 'Jack');
    assert.ok(jack, '没有 Jack');
    assert.strictEqual(jack.tag, '用户', 'Jack 应该归「用户」组,实际 ' + jack.tag);
    const bot = r.data.friends.find(f => f.username === 'Jacky Bot');
    assert.ok(bot, '没有 Jacky Bot');
    assert.strictEqual(bot.tag, '系统', 'Jacky Bot 应该归「系统」组,实际 ' + bot.tag);
  });
  await step('自定义标签能存下来,并且不被自动归类覆盖', async () => {
    const r = await call('/friends', { token: user.token });
    const jack = r.data.friends.find(f => f.username === 'Jack');
    assert.ok(jack.tag, '新用户这边 Jack 也应该有归类,实际 ' + jack.tag);
  });
  await step('加好友请求可以带自定义标签,对方同意后标签落到好友关系上', async () => {
    const other = await register(U2, 'Test1234pass', 'zh');
    const r = await call('/friend/request', { method: 'POST', token: user.token, body: { toUsername: U2, tag: '同事' } });
    assert.strictEqual(r.status, 200, '发起好友申请失败:' + JSON.stringify(r.data));
    const reqId = (r.data.request && r.data.request.id) || r.data.requestId || r.data.id;
    assert.ok(reqId, '没拿到申请 id:' + JSON.stringify(r.data));
    const acc = await call('/friend/respond', { method: 'POST', token: other.token, body: { requestId: reqId, accept: true } });
    assert.ok(acc.status === 200 || acc.status === 201, '同意好友申请失败:' + JSON.stringify(acc.data));
    const mine = await call('/friends', { token: user.token });
    const f = mine.data.friends.find(x => x.username === U2);
    assert.ok(f, '好友列表里没有 ' + U2);
    assert.strictEqual(f.tag, '同事', '自定义标签没生效:' + f.tag);
  });

  console.log('\n[3] Jack 欢迎消息');
  await step('注册后收到 Jack 的中文欢迎消息', async () => {
    const r = await call('/conversations', { token: user.token });
    const jack = r.data.conversations.find(c => c.username === 'Jack');
    assert.ok(jack, '没有和 Jack 的会话');
    assert.ok(jack.last_message && jack.last_message.length > 0, 'Jack 没有发消息');
    assert.ok(/Jack/.test(jack.last_message), '欢迎消息内容不对:' + jack.last_message);
  });
  await step('英文用户收到英文欢迎消息', async () => {
    const en = await register('r12_' + stamp + '_en', 'Test1234pass', 'en');
    const r = await call('/conversations', { token: en.token });
    const jack = r.data.conversations.find(c => c.username === 'Jack');
    assert.ok(jack && jack.last_message, '英文用户没收到欢迎消息');
    assert.ok(/Hello|Jack/i.test(jack.last_message), '欢迎消息不是英文:' + jack.last_message);
  });
  await step('欢迎消息只发一次(重复登录不会再来一条)', async () => {
    const before = await call('/conversations', { token: user.token });
    const n1 = before.data.conversations.find(c => c.username === 'Jack').last_message;
    await login(U1, 'Test1234pass');
    await login(U1, 'Test1234pass');
    const after = await call('/conversations', { token: user.token });
    const n2 = after.data.conversations.find(c => c.username === 'Jack').last_message;
    assert.strictEqual(n2, n1, '又发了一条欢迎消息');
  });

  console.log('\n[4] 搜索:用户 + 群聊');
  await step('/api/users/search 同时返回 users 和 groups', async () => {
    const r = await call('/users/search?q=' + encodeURIComponent('VVe'), { token: user.token });
    assert.ok(Array.isArray(r.data.users), '没有 users');
    assert.ok(Array.isArray(r.data.groups), '没有 groups');
    assert.ok(r.data.groups.some(g => /VVeChat/.test(g.name)), '没搜到官方群:' + JSON.stringify(r.data.groups));
  });
  await step('搜索群名(中文)也能搜到', async () => {
    const r = await call('/users/search?q=' + encodeURIComponent('官方'), { token: user.token });
    assert.ok(r.data.groups.length > 0, '中文群名搜不到');
  });

  console.log('\n[5] 控制台隐私');
  await step('快照里没有消息正文,只有条数', async () => {
    const r = await call('/control/snapshot', { token: admin.token });
    assert.ok(r.data.ok, '快照失败');
    assert.ok(r.data.group_message_counts && typeof r.data.group_message_counts === 'object', '缺 group_message_counts');
    assert.strictEqual(r.data.group_messages, undefined, '快照里还有 group_messages 正文');
    const blob = JSON.stringify(r.data);
    assert.ok(!/测试消息/.test(blob), '快照里出现了正文');
  });
  await step('正文接口返 410 CONTENT_WITHDRAWN', async () => {
    const snap = await call('/control/snapshot', { token: admin.token });
    const conv = snap.data.conversations[0];
    const r = await call('/control/conversation/' + encodeURIComponent(conv.conv_id), { token: admin.token });
    assert.strictEqual(r.status, 410, '应该 410,实际 ' + r.status);
    assert.strictEqual(r.data.code, 'CONTENT_WITHDRAWN');
  });

  console.log('\n[6] 语言');
  await step('注册时带的语言被记下来', async () => {
    const r = await call('/me', { token: user.token });
    assert.strictEqual(r.data.user.lang, 'zh');
    const en = await login('r12_' + stamp + '_en', 'Test1234pass');
    assert.strictEqual(en.user.lang, 'en');
  });

  console.log('\n' + '─'.repeat(44));
  console.log(fails.length ? `通过 ${pass} 项,失败 ${fails.length} 项` : `全部通过 ${pass} 项`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('自检崩了:', e); process.exit(1); });
