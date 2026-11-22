#!/usr/bin/env node
/* 2026-11-23 一轮需求的端到端自检:
   ① AI 模式：只暴露 Jacky Bot 一个模型,深度思考档位可选
   ② 好友申请被接受 → 被添加人收到提醒
   ③ 朋友圈封面：官方图 + 自传图,存取往返
   ④ 日常条目滚动 → 自动框选高亮
   ⑤ 防火墙：本机 / self-check 不进事件流,内网地址不可封
   ⑥ 控制台：Jacky Bot 对话记录可折叠、群聊数量口径正确
   ⑦ 英文版：服务端错误文案都有英文映射
   用法：node tools/test-round13.js  （需先起本地服务 PORT=3000） */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); }
};

function req(method, p, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p);
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (_) {}
        resolve({ status: res.statusCode, body: j, raw: b });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const uniq = () => 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

(async () => {
  console.log('=== round13 自检 ===');

  // ---------- 准备两个用户 ----------
  const u1 = uniq(), u2 = uniq();
  const r1 = await req('POST', '/api/register', { body: { username: u1, password: 'Round13pass1', lang: 'zh' } });
  const r2 = await req('POST', '/api/register', { body: { username: u2, password: 'Round13pass2', lang: 'en' } });
  ok('注册两个测试用户', r1.status === 200 && r2.status === 200, JSON.stringify(r1.body).slice(0, 120));
  if (r1.status !== 200 || r2.status !== 200) { console.log('\n中止：注册失败'); process.exit(1); }
  const t1 = r1.body.token, t2 = r2.body.token;
  const id1 = r1.body.user.id, id2 = r2.body.user.id;

  // ---------- ① AI 模式：只有 Jacky Bot ----------
  console.log('\n① AI 模式');
  const ai = await req('GET', '/api/ai/status', { token: t1 });
  const models = (ai.body && ai.body.models) || [];
  ok('只暴露 1 个模型', models.length === 1, '实际 ' + models.length);
  ok('模型是 Jacky Bot', models[0] && models[0].label === 'Jacky Bot', JSON.stringify(models[0] && models[0].label));
  ok('模型 id = jacky', models[0] && models[0].id === 'jacky');
  ok('defaultModel = jacky', ai.body && ai.body.defaultModel === 'jacky');
  ok('没有任何 Qwen 型号外露', !JSON.stringify(models).match(/Qwen/i), JSON.stringify(models.map(m => m.label)));

  const app = read('frontend/app.js');
  const html = read('frontend/index.html');
  ok('前端模型下拉只填 Jacky Bot', /o\.textContent = m\.label/.test(app) && !/provider === 'ovh'/.test(app));
  ok('思考档位选择器不再 hidden', /id="ai-level-wrap">/.test(html) && !/id="ai-level-wrap" class="[^"]*hidden/.test(html));
  ok('思考档位有 change 监听', /ai-level[\s\S]{0,400}addEventListener\('change'/.test(app));
  ok('system prompt 不再自称 Qwen', !/你是 VVeChat 内置的通义千问/.test(read('server.js')));
  ok('source 事件统一报 Jacky Bot', /label: 'Jacky Bot'/.test(read('server.js')));

  // ---------- ② 好友申请被接受 → 提醒 ----------
  console.log('\n② 好友申请被接受');
  await req('POST', '/api/friend/request', { token: t1, body: { toUsername: u2 } });
  const pending = await req('GET', '/api/friend/requests', { token: t2 });
  const reqRow = (pending.body && pending.body.requests || [])[0];
  ok('对方收到好友申请', !!reqRow);
  if (reqRow) {
    const resp = await req('POST', '/api/friend/respond', { token: t2, body: { requestId: reqRow.id, accept: true } });
    ok('接受申请成功', resp.status === 200, JSON.stringify(resp.body).slice(0, 120));
    ok('后端会推 friend:accepted', /friend:accepted/.test(read('server.js')));
    ok('前端注册了监听', /s\.on\('friend:accepted', onFriendAccepted\)/.test(app));
    ok('前端有处理函数', /function onFriendAccepted/.test(app));
    ok('复用群聊新消息弹窗', /showMessagePopup\(/.test(app));
  }
  const fr = await req('GET', '/api/friends', { token: t1 });
  ok('两人成为好友', ((fr.body && fr.body.friends) || []).some(f => Number(f.id) === id2));

  // ---------- ③ 朋友圈封面 ----------
  console.log('\n③ 朋友圈封面');
  const g1 = await req('GET', '/api/me/cover', { token: t1 });
  ok('GET /api/me/cover 可用', g1.status === 200 && 'cover_id' in (g1.body || {}), JSON.stringify(g1.body).slice(0, 120));
  const s1 = await req('PUT', '/api/me/cover', { token: t1, body: { cover_id: 'cov-03' } });
  ok('设置官方封面 cov-03', s1.status === 200, JSON.stringify(s1.body).slice(0, 120));
  const g2 = await req('GET', '/api/me/cover', { token: t1 });
  ok('官方封面往返正确', g2.body && g2.body.cover_id === 'cov-03');
  const bad = await req('PUT', '/api/me/cover', { token: t1, body: { cover_id: 'cov-99' } });
  ok('非法封面 id 被拒', bad.status === 400, String(bad.status));
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await req('PUT', '/api/me/cover', { token: t1, body: { cover_id: '', photo: px } });
  ok('上传自传封面成功', up.status === 200, JSON.stringify(up.body).slice(0, 120));
  const g3 = await req('GET', '/api/me/cover', { token: t1 });
  ok('自传封面往返正确', !!(g3.body && g3.body.photo && g3.body.photo.startsWith('data:image/png')));
  ok('后端 6 张官方图都在', [1, 2, 3, 4, 5, 6].every((n) => fs.existsSync(path.join(ROOT, 'frontend/assets/covers')) &&
    fs.readdirSync(path.join(ROOT, 'frontend/assets/covers')).some(f => f.startsWith('cover-0' + n))));
  ok('前端有封面选择器', /id="modal-cover-picker"/.test(html) && /id="cover-grid"/.test(html));
  ok('前端能渲染封面图', /moment-cover-img/.test(html) && /COVER_PRESETS/.test(app));

  // ---------- ④ 日常条目框选高亮 ----------
  console.log('\n④ 日常条目框选高亮');
  ok('有 is-active 样式', /\.moment-post\.is-active/.test(read('frontend/style.css')));
  ok('setActiveMoment 会打标记', /classList\.toggle\('is-active'/.test(app));

  // ---------- ⑤ 防火墙 ----------
  console.log('\n⑤ 防火墙');
  const fw = read('firewall.js');
  ok('内部来源有统一判定', /function isInternalSource/.test(fw) && /function isInternalSource/.test(read('control/app.js')));
  ok('self-check / agent 被识别', /s === 'self-check' \|\| s === 'agent'/.test(fw));
  ok('回环地址被识别', /Number\(m\[1\]\) === 127/.test(fw));
  // 事件表仍全量留痕(审计用),过滤只发生在展示层。
  ok('事件表保留全量', !/rows\.filter/.test(fw) && /SELECT \* FROM security_events ORDER BY id DESC/.test(fw));
  ok('控制台展示层过滤掉自己人', /\.filter\(\(e\) => !isInternalSource\(e\.ip\)\)/.test(read('control/app.js')));
  ok('对外事件统计排除自己人', /if \(isInternalSource\(r\.ip\)\) continue;/.test(fw));
  ok('手动封禁拦内网', /内网地址不封禁/.test(read('server.js')));
  ok('控制台封禁按钮禁用内网', /isLocal/.test(read('control/app.js')));

  // ---------- ⑥ 控制台 ----------
  console.log('\n⑥ 控制台');
  const ctrl = read('control/app.js');
  ok('KPI 用「群聊数量」', /k: '群聊数量'/.test(ctrl));
  ok('KPI 用「好友会话」', /k: '好友会话'/.test(ctrl));
  ok('群聊数量 = 群个数', /v: groupCount/.test(ctrl) && /groupCount = \(d\.groups \|\| \[\]\)\.length/.test(ctrl));
  ok('Jacky Bot 对话可折叠', /id="jacky-fold"/.test(read('control/index.html')));
  ok('折叠默认收起（无 open 属性）', !/<details[^>]*id="jacky-fold"[^>]*open/.test(read('control/index.html')));
  ok('渲染 Jacky Bot 对话列表', /jacky_conversations/.test(ctrl) && /jacky-convos/.test(ctrl));
  ok('展开/收起有 toggle 监听', /addEventListener\('toggle', syncHint\)/.test(ctrl));
  ok('后端下发 jacky_conversations', /jacky_conversations/.test(read('server.js')));
  ok('封禁名单单独容器', /id="fw-bans"/.test(read('control/index.html')));

  // ---------- ⑦ 英文版 ----------
  console.log('\n⑦ 英文版');
  const errMap = JSON.parse(read('tools/err-en.json'));
  const serverSrc = read('server.js');
  const missing = [];
  serverSrc.split('\n').forEach((line, i) => {
    const re = /\berror:\s*'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(line))) {
      const v = m[1].replace(/\\'/g, "'");
      if (/[一-鿿]/.test(v) && !errMap[v]) missing.push(`第 ${i + 1} 行：${v}`);
    }
  });
  ok('后端中文 error 全有英文映射', missing.length === 0, missing.slice(0, 3).join(' / '));
  const enVals = Object.values(errMap);
  ok('英文映射值不含中文', enVals.every(v => !/[一-鿿]/.test(v)));
  ok('前端有 srvErrText 翻译函数', /function srvErrText/.test(app));
  ok('apiRaw 用 srvErrText', /new Error\(srvErrText\(/.test(app));

  // ---------- ⑧ 上一轮的 6 项也得还在 ----------
  console.log('\n⑧ 上一轮改动仍在');
  ok('中文「编写文案」', /编写文案/.test(html) && !/边写文案/.test(html));
  // 英文版不该出现中文的「编写文案」—— 它只在 index.html 的中文兜底里,
  // 英文界面由 STRINGS.en 覆盖。
  const enBlock = app.slice(app.indexOf('en: {'), app.indexOf('en: {') + 40000);
  ok('英文词条里没有「编写文案」', !/编写文案|边写文案/.test(enBlock));
  ok('毛玻璃 blur 变量 +30%', /--blur-l2: 10\.4px/.test(read('frontend/style.css')) && /--blur-l3: 23\.4px/.test(read('frontend/style.css')));
  ok('rail 加宽修 Moments 截断', /\.rail-pane \{ width: 84px; \}/.test(read('frontend/style.css')));
  ok('头像 bug 已修（avatarHtml）', /av\.innerHTML = d\.avatarHtml/.test(app) && !/d\.avatarText/.test(app));
  ok('多尺寸巡检工具在', fs.existsSync(path.join(ROOT, 'tools/sweep-sizes.js')));

  console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
