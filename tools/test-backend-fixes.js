#!/usr/bin/env node
/* ============================================================
   这轮后端改动的自检(对着本地起的 server 跑):
     1. stripTitleLine —— 标题行 + 它前后的空行要摘干净
     2. 默认联系人 —— 注册后有「我 / Jack / Jacky Bot / 文件传输助手」
     3. 文件上传下载 —— 上传后会话里的人能下,外人不能
     4. 群置顶 —— PUT /api/groups/:id 认 pinned
     5. format-all —— 格式化之后 Jacky Bot 还在

   用法: PORT=3000 DB_FILE=/workspace/vvechat-test.db node server.js &
         node tools/test-backend-fixes.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const ADMIN = { username: 'Jack', password: 'Zhr121005' };

let pass = 0;
const fails = [];
async function step(name, fn) {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fails.push(name + ' — ' + e.message); console.log('  ✗', name, '→', e.message); }
}

async function call(pathname, { method = 'GET', body, token, raw } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(`${BASE}/api${pathname}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  if (raw) return { status: resp.status, resp };
  let data = null;
  try { data = await resp.json(); } catch (_) { data = null; }
  return { status: resp.status, data };
}

// ---- 1. stripTitleLine:直接从 server.js 里抠出来跑,测的是真代码 ----
function loadFns() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const names = ['cleanAiTitle', 'parseTitleLine', 'stripTitleLine'];
  const code = names.map((n) => {
    const i = src.indexOf('function ' + n + '(');
    assert.ok(i >= 0, 'server.js 里找不到 ' + n);
    let depth = 0, end = src.indexOf('{', i);
    for (let k = end; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (!depth) { end = k; break; } }
    }
    return src.slice(i, end + 1);
  }).join('\n');
  return new Function(code + '\nreturn { cleanAiTitle, parseTitleLine, stripTitleLine };')();
}

(async () => {
  console.log('\n[1] stripTitleLine(标题行 + 前后空行)');
  const { stripTitleLine } = loadFns();
  await step('模型在标题前空两行 → 正文直接开头', () => {
    assert.equal(stripTitleLine('\n\n【标题:今天聊什么】\n\n正文第一段', true), '正文第一段');
  });
  await step('标题后跟空行 → 一起摘掉', () => {
    assert.equal(stripTitleLine('【标题:abc】\n\n正文', false), '正文');
  });
  await step('没有标题行 → 原样保留', () => {
    assert.equal(stripTitleLine('普通回答\n第二行', true), '普通回答\n第二行');
  });
  await step('只有空行开头 → 空行被吃掉', () => {
    assert.equal(stripTitleLine('\n\n正文', true), '正文');
  });

  console.log('\n[2] 默认联系人');
  const admin = await call('/login', { method: 'POST', body: ADMIN });
  assert.equal(admin.status, 200, '管理员登录失败: ' + JSON.stringify(admin.data));
  const adminToken = admin.data.token;

  const uname = 'zz_test_' + Date.now().toString().slice(-6);
  const reg = await call('/register', { method: 'POST', body: { username: uname, password: 'test12345' } });
  assert.equal(reg.status, 200, '注册失败: ' + JSON.stringify(reg.data));
  const userToken = reg.data.token;
  const me = await call('/me', { token: userToken });
  const myId = me.data.user.id;

  let convs = [];
  await step('新注册的用户有「我 / Jack / Jacky Bot / 文件传输助手」', async () => {
    const r = await call('/conversations', { token: userToken });
    assert.equal(r.status, 200);
    convs = r.data.conversations || [];
    const names = convs.map((c) => c.username);
    assert.ok(names.includes('我'), '没有「我」: ' + names.join(','));
    assert.ok(names.includes('Jack'), '没有 Jack: ' + names.join(','));
    assert.ok(names.includes('Jacky Bot'), '没有 Jacky Bot: ' + names.join(','));
    assert.ok(names.includes('文件传输助手'), '没有文件传输助手: ' + names.join(','));
  });
  await step('「我」这一条指向自己', () => {
    const self = convs.find((c) => c.special === 'self');
    assert.ok(self, '没有 special=self 的会话');
    assert.equal(String(self.id), String(myId));
  });

  console.log('\n[3] 文件上传 / 下载');
  const fa = convs.find((c) => c.username === '文件传输助手');
  let fileId = null;
  await step('上传文件拿到 id', async () => {
    const data = Buffer.from('VVeChat 文件传输自检\n').toString('base64');
    const r = await call('/upload', {
      method: 'POST', token: userToken,
      body: { name: '自检.txt', mime: 'text/plain', data, conv_type: 'user', conv_id: fa.id }
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.file && r.data.file.id);
    fileId = r.data.file.id;
  });
  await step('会话里的人能下载', async () => {
    const r = await call('/files/' + fileId, { token: userToken, raw: true });
    assert.equal(r.status, 200, 'HTTP ' + r.status);
    const text = await r.resp.text();
    assert.ok(text.includes('文件传输自检'), '下载内容不对: ' + text.slice(0, 40));
  });
  await step('外人不能下载', async () => {
    const r = await call('/files/' + fileId, { token: adminToken, raw: true });
    assert.equal(r.status, 403, 'HTTP ' + r.status);
  });
  await step('文件消息能发出去', async () => {
    const r = await call('/messages', {
      method: 'POST', token: userToken,
      body: { conv_type: 'user', conv_id: fa.id, content: fileId, type: 'file', meta: { name: '自检.txt', size: 26 } }
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.message.type, 'file');
  });
  await step('跟自己说话不需要好友关系', async () => {
    const r = await call('/messages', { method: 'POST', token: userToken, body: { conv_type: 'user', conv_id: myId, content: '给自己记一笔' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const g = await call('/messages?conv_type=user&conv_id=' + myId, { token: userToken });
    assert.equal(g.status, 200, JSON.stringify(g.data));
    assert.ok((g.data.messages || []).some((m) => m.content === '给自己记一笔'), '自己的会话读不到');
  });

  console.log('\n[4] 群置顶');
  const groups = await call('/groups/recommended', { token: adminToken });
  const gid = (groups.data.groups || [])[0] ? groups.data.groups[0].id : 1;
  await step('PUT pinned 真的写进库了', async () => {
    const r = await call('/groups/' + gid, { method: 'PUT', token: adminToken, body: { pinned: true } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(Number(r.data.group.pinned), 1, '返回的 pinned 不是 1');
    const convs2 = await call('/conversations', { token: adminToken });
    const g = (convs2.data.conversations || []).find((c) => c.type === 'group' && String(c.id) === String(gid));
    assert.ok(g, '会话列表里没有这个群');
    assert.equal(Number(g.pinned), 1, '会话列表里的 pinned 不是 1');
  });
  await step('取消置顶也认', async () => {
    const r = await call('/groups/' + gid, { method: 'PUT', token: adminToken, body: { pinned: false } });
    assert.equal(r.status, 200);
    assert.equal(Number(r.data.group.pinned), 0);
  });

  console.log('\n[5] 格式化之后 Jacky Bot 还在');
  await step('format-all 保留 Jacky Bot 与文件传输助手', async () => {
    const r = await call('/control/format-all', { method: 'POST', token: adminToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // Jack 自己还在(没被格式化掉)。
    const again = await call('/login', { method: 'POST', body: ADMIN });
    assert.equal(again.status, 200, 'Jack 账号被删了');
    const c = await call('/conversations', { token: adminToken });
    const names = (c.data.conversations || []).map((x) => x.username);
    assert.ok(names.includes('Jacky Bot'), 'Jacky Bot 被格式化了: ' + names.join(','));
    assert.ok(names.includes('文件传输助手'), '文件传输助手 被格式化了: ' + names.join(','));
  });

  console.log('\n通过 ' + pass + ' 项,失败 ' + fails.length + ' 项');
  if (fails.length) { fails.forEach((f) => console.log('  !', f)); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('自检崩了:', e); process.exit(1); });
