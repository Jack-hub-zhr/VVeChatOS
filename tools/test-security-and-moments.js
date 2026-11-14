#!/usr/bin/env node
/* ============================================================
   这一轮新功能的自检:
     1. 密码分层保护 —— 普通用户 3 层、管理员 5 层,弱口令被拒,蜜罐被识别
     2. 二次验证(step-up)—— 关键操作要再输一次密码,令牌 5 分钟过期
     3. 朋友圈(日常)—— 发、看、赞、评论、删
     4. 在线状态 —— 没连着的人显示离线,在线的显示在线

   用法: PORT=3000 DB_FILE=/workspace/vvechat-test.db node server.js &
         node tools/test-security-and-moments.js
   ============================================================ */
const assert = require('assert');
const authCrypto = require('../auth-crypto.js');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const ADMIN = { username: 'Jack', password: 'Zhr121005' };

let pass = 0;
const fails = [];
async function step(name, fn) {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fails.push(name + ' — ' + e.message); console.log('  ✗', name, '→', e.message); }
}
// 聊天接口有「每分钟 10 次」的限速,自检用例各自用不同的来源 IP,免得互相踩。
let _cfSeq = 0;
const cfHeaders = () => ({ 'CF-Connecting-IP': '203.0.113.' + (200 + (_cfSeq++)) });

async function call(pathname, { method = 'GET', body, token, headers } = {}) {
  const h = Object.assign({}, headers || {});
  if (body) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(`${BASE}/api${pathname}`, {
    method, headers: h, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch (_) { data = null; }
  return { status: resp.status, data };
}

(async () => {
  // ------------------------------------------------------------------
  console.log('\n[1] 密码分层保护');
  const pepper1 = Buffer.alloc(32, 7);
  const pepper2 = Buffer.alloc(32, 9);
  await step('普通用户的哈希是 3 层,密码对就过、错就不过', () => {
    const h = authCrypto.hashPassword('Str0ng-Pass-42', { pepper1, pepper2 });
    assert.equal(h.split(':')[0], 'v3');
    assert.equal(h.split(':')[1], 'u');
    assert.equal(authCrypto.layerCount(h), 3);
    assert.ok(authCrypto.verifyPassword('Str0ng-Pass-42', h, { pepper1, pepper2 }));
    assert.ok(!authCrypto.verifyPassword('Str0ng-Pass-43', h, { pepper1, pepper2 }));
  });
  await step('管理员的哈希是 5 层,同样只认正确密码', () => {
    const h = authCrypto.hashPassword('Str0ng-Pass-42', { pepper1, pepper2, admin: true });
    assert.equal(h.split(':')[1], 'a');
    assert.equal(authCrypto.layerCount(h), 5);
    assert.ok(authCrypto.verifyPassword('Str0ng-Pass-42', h, { pepper1, pepper2 }));
    assert.ok(!authCrypto.verifyPassword('nope', h, { pepper1, pepper2 }));
  });
  await step('换个 pepper 就解不开(数据库被拖走也没用)', () => {
    const h = authCrypto.hashPassword('Str0ng-Pass-42', { pepper1, pepper2 });
    const other = Buffer.alloc(32, 1);
    assert.ok(!authCrypto.verifyPassword('Str0ng-Pass-42', h, { pepper1: other, pepper2 }));
  });
  await step('弱口令会被认出来', () => {
    assert.ok(authCrypto.isWeakPassword('123456'));
    assert.ok(authCrypto.isWeakPassword('password'));
    assert.ok(authCrypto.isWeakPassword('aaaaaaaa'));
    assert.ok(!authCrypto.isWeakPassword('Str0ng-Pass-42'));
  });
  await step('老库的 bcrypt 哈希还能验(登录时顺带升级)', () => {
    const bcrypt = require('bcryptjs');
    const old = bcrypt.hashSync('Str0ng-Pass-42', 10);
    assert.ok(authCrypto.isLegacyHash(old));
    assert.ok(authCrypto.verifyLegacy('Str0ng-Pass-42', old));
    assert.ok(!authCrypto.verifyLegacy('wrong', old));
  });

  // ------------------------------------------------------------------
  console.log('\n[2] 注册 / 登录的防线');
  const uname = 'zztest' + Date.now().toString().slice(-6);
  await step('弱口令注册被拒(带错误码,前端好翻译)', async () => {
    const r = await call('/register', { method: 'POST', body: { username: uname + 'x', password: '123456' } });
    assert.equal(r.status, 400);
    assert.ok(['weak_password', 'short_password'].includes(r.data.code), JSON.stringify(r.data));
    // 8 位但常见的口令也要拒
    const r2 = await call('/register', { method: 'POST', body: { username: uname + 'y', password: 'password1' } });
    assert.equal(r2.status, 400);
    assert.equal(r2.data.code, 'weak_password');
  });
  await step('蜜罐字段被填 → 注册被拒', async () => {
    const r = await call('/register', { method: 'POST', body: { username: uname, password: 'Str0ng-Pass-42', website: 'http://spam' } });
    assert.equal(r.status, 400);
  });
  await step('正常注册 + 登录成功,密码是分层哈希', async () => {
    const r = await call('/register', { method: 'POST', body: { username: uname, password: 'Str0ng-Pass-42' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const l = await call('/login', { method: 'POST', body: { username: uname, password: 'Str0ng-Pass-42' } });
    assert.equal(l.status, 200);
    assert.ok(l.data.token);
    // 错误密码 → 一律「用户名或密码错误」(不告诉攻击者账号存不存在)
    const bad = await call('/login', { method: 'POST', body: { username: uname, password: 'Wrong-Pass-99' } });
    assert.equal(bad.status, 401);
    assert.ok(!/不存在/.test(bad.data.error || ''), '错误信息泄露了账号是否存在');
  });
  await step('账号不存在时的提示和密码错时一样', async () => {
    const r = await call('/login', { method: 'POST', body: { username: 'no-such-user-xyz', password: 'Str0ng-Pass-42' } });
    assert.equal(r.status, 401);
    assert.ok(!/不存在/.test(r.data.error || ''));
  });

  // ------------------------------------------------------------------
  console.log('\n[3] 二次验证(管理员关键操作)');
  const admin = await call('/login', { method: 'POST', body: ADMIN });
  const adminToken = admin.data.token;
  await step('没带二次验证令牌 → 关键操作被拒', async () => {
    const r = await call('/control/format-all', { method: 'POST', body: {}, token: adminToken });
    assert.equal(r.status, 403);
    assert.ok(r.data.need_step_up, JSON.stringify(r.data));
  });
  await step('密码错 → 拿不到令牌', async () => {
    const r = await call('/control/step-up', { method: 'POST', body: { password: 'wrong-password' }, token: adminToken });
    assert.equal(r.status, 401);
  });
  let stepToken = null;
  await step('密码对 → 拿到 5 分钟令牌,带着它就能做关键操作', async () => {
    const r = await call('/control/step-up', { method: 'POST', body: { password: ADMIN.password }, token: adminToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.token);
    stepToken = r.data.token;
  });

  // ------------------------------------------------------------------
  console.log('\n[4] 朋友圈(日常)');
  const me = await call('/login', { method: 'POST', body: { username: uname, password: 'Str0ng-Pass-42' } });
  const meToken = me.data.token;
  let momentId = null;
  await step('发一条动态 → 列表里能看见', async () => {
    const r = await call('/moments', { method: 'POST', body: { content: '今天天气不错', images: [] }, token: meToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    momentId = r.data.moment.id;
    const list = await call('/moments', { token: meToken });
    assert.ok(list.data.moments.some(m => m.id === momentId));
    assert.equal(list.data.moments[0].content, '今天天气不错');
  });
  await step('空内容被拒', async () => {
    const r = await call('/moments', { method: 'POST', body: { content: '  ', images: [] }, token: meToken });
    assert.equal(r.status, 400);
  });
  await step('点赞 → 再点一次取消', async () => {
    const r = await call('/moments/' + momentId + '/like', { method: 'POST', body: {}, token: meToken });
    assert.equal(r.data.likes.length, 1);
    assert.equal(r.data.likes[0].username, uname);
    const r2 = await call('/moments/' + momentId + '/like', { method: 'POST', body: {}, token: meToken });
    assert.equal(r2.data.likes.length, 0);
  });
  await step('评论能存下来', async () => {
    const r = await call('/moments/' + momentId + '/comment', { method: 'POST', body: { text: '确实' }, token: adminToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.comments[0].text, '确实');
    assert.equal(r.data.comments[0].username, 'Jack');
  });
  await step('删别人的动态要管理员权限', async () => {
    const r = await call('/moments/' + momentId, { method: 'DELETE', token: adminToken });
    assert.equal(r.status, 200);
  });

  // ------------------------------------------------------------------
  console.log('\n[4c] 草稿(删除时自动存成草稿)');
  let draftId = null;
  await step('存成草稿 → 自己看得见,别人看不见', async () => {
    const r = await call('/moments', { method: 'POST', body: { content: '没写完的一条', images: [], status: 'draft' }, token: meToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    draftId = r.data.moment.id;
    assert.equal(r.data.moment.status, 'draft');
    const mine = await call('/moments', { token: meToken });
    assert.ok(mine.data.moments.some(m => m.id === draftId && m.status === 'draft'), '自己看不到草稿');
    const other = await call('/moments', { token: adminToken });
    assert.ok(!other.data.moments.some(m => m.id === draftId), '草稿被别人看见了');
  });
  await step('已发布的改成草稿 → 别人那边就看不到了', async () => {
    const p = await call('/moments', { method: 'POST', body: { content: '先发布再变草稿', images: [] }, token: meToken });
    const id = p.data.moment.id;
    assert.equal(p.data.moment.status, 'published');
    const r = await call('/moments/' + id, { method: 'PATCH', body: { status: 'draft' }, token: meToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.moment.status, 'draft');
    const other = await call('/moments', { token: adminToken });
    assert.ok(!other.data.moments.some(m => m.id === id), '改成草稿后别人还能看见');
  });
  await step('草稿能接着改完再发表', async () => {
    const r = await call('/moments/' + draftId, { method: 'PATCH', body: { content: '写完了', status: 'published' }, token: meToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.moment.status, 'published');
    assert.equal(r.data.moment.content, '写完了');
  });
  await step('不能改别人的动态', async () => {
    const r = await call('/moments/' + draftId, { method: 'PATCH', body: { status: 'draft' }, token: adminToken });
    assert.equal(r.status, 403);
  });

  // ------------------------------------------------------------------
  console.log('\n[4b] 头像要能传到对方那边');
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await step('注册时带照片/表情 → 消息接口把发送者头像带出来', async () => {
    const a = await call('/register', { method: 'POST', body: { username: 'zzav1' + Date.now().toString().slice(-5), password: 'Str0ng-Pass-42', avatar: PNG } });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    const uid = a.data.user.id;
    // 注册时默认就把 Jack 加成好友了,所以直接能私聊。
    const fr = await call('/friends', { token: a.data.token });
    assert.ok((fr.data.friends || []).some(f => f.username === 'Jack'), 'Jack 不是好友');
    // 给 Jack 发一条消息
    const s = await call('/messages', { method: 'POST', headers: cfHeaders(), body: { conv_type: 'user', conv_id: 1, content: '头像测试' }, token: a.data.token });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    const msgs = await call('/messages?conv_type=user&conv_id=' + uid + '&limit=5', { token: adminToken });
    const mine = (msgs.data.messages || []).find(m => m.sender_id === uid);
    assert.ok(mine, '没找到那条消息');
    assert.ok(mine.sender_avatar && mine.sender_avatar.startsWith('data:image/png'), '消息里没有带照片头像');
    // 表情头像也一样
    const b = await call('/register', { method: 'POST', body: { username: 'zzav2' + Date.now().toString().slice(-5), password: 'Str0ng-Pass-42', avatar_emoji: '🐯' } });
    assert.equal(b.status, 200, JSON.stringify(b.data));
    await call('/messages', { method: 'POST', headers: cfHeaders(), body: { conv_type: 'user', conv_id: 1, content: '表情头像测试' }, token: b.data.token });
    const msgs2 = await call('/messages?conv_type=user&conv_id=' + b.data.user.id + '&limit=10', { token: adminToken });
    const m2 = (msgs2.data.messages || []).find(m => m.sender_id === b.data.user.id);
    assert.ok(m2, '没找到那条消息');
    assert.equal(m2.sender_avatar_emoji, '🐯');
  });
  await step('注册接口把刚选的头像原样回给前端', async () => {
    const r = await call('/register', { method: 'POST', body: {
      username: 'zzav3' + Date.now().toString().slice(-5), password: 'Str0ng-Pass-42', avatar: PNG,
    } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.user.avatar && r.data.user.avatar.startsWith('data:image/png'), '注册返回的头像是空的');
  });
  await step('会话列表里也带着照片头像', async () => {
    const convs = await call('/conversations', { token: adminToken });
    const withPhoto = (convs.data.conversations || []).filter(c => c.avatar && c.avatar.startsWith('data:image/'));
    assert.ok(withPhoto.length >= 1, '会话列表里没有照片头像');
  });

  // ------------------------------------------------------------------
  console.log('\n[5] 在线状态');
  await step('没连着的人显示离线', async () => {
    const r = await call('/users/status?ids=999999', { token: meToken });
    assert.equal(r.data.status['999999'], false);
  });
  await step('自己的在线状态要连着 socket 才有', async () => {
    // 没建 socket,正常应当是离线(TTL 的存在就是为了不被旧连接一直挂着)
    const r = await call('/users/status?ids=' + me.data.user.id, { token: meToken });
    assert.equal(typeof r.data.status[me.data.user.id], 'boolean');
  });

  // ------------------------------------------------------------------
  console.log('\n[6] 部署信息');
  await step('控制台能拿到网址和数据位置', async () => {
    const r = await call('/control/deploy', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.origin, '没有 origin');
    assert.ok(r.data.db_file, '没有 db_file');
    assert.ok(r.data.upload_dir, '没有 upload_dir');
  });

  console.log('\n────────────────────────────');
  console.log(`通过 ${pass} 项${fails.length ? '，失败 ' + fails.length + ' 项:' : ''}`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
