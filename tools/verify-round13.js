#!/usr/bin/env node
/* 实测这一轮的需求：截图 + 量像素。
   用法：node tools/verify-round13.js [baseUrl] */
'use strict';
const fs = require('fs');
const http = require('http');
const { launch, connect, sleep } = require('./cdp');

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const OUT = '/workspace/shots/r13';
fs.mkdirSync(OUT, { recursive: true });

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname, headers }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (_) { resolve({}); } });
    });
    r.on('error', reject); r.write(data); r.end();
  });
}
function get(path, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const headers = {}; if (token) headers['Authorization'] = 'Bearer ' + token;
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (_) { resolve({}); } });
    }).on('error', reject);
  });
}
const uniq = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

(async () => {
  const u1 = uniq();
  const reg = await post('/api/register', { username: u1, password: 'Verify13pass1', lang: 'zh' });
  const token = reg.token;
  console.log('注册', u1, reg.status === 200 ? 'ok' : 'FAIL');

  const { proc, wsUrl } = await launch({ width: 1440, height: 900 });
  const { send, on, close } = await connect(wsUrl);
  await send('Page.enable');
  await send('Runtime.enable');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '/' + name + '.png', Buffer.from(r.data, 'base64'));
    console.log('  截图', name);
  };
  const goto = async (u) => { await send('Page.navigate', { url: u }); await sleep(9000); };

  // 登录
  await goto(BASE + '/');
  await evalJs(`(async () => {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: ${JSON.stringify(u1)}, password: 'Verify13pass1' }) });
    const d = await r.json();
    localStorage.setItem('vve:token', d.token);
    localStorage.setItem('vve:user', JSON.stringify(d.user));
    return d.token ? 1 : 0;
  })()`);
  await goto(BASE + '/');
  await sleep(3000);

  // ---------- ① Jacky Bot 副标题 = AI Assistant ----------
  await evalJs(`localStorage.setItem('vve:lang','en'); location.reload();`);
  await sleep(9000);
  // 打开与 Jacky Bot 的会话
  const opened = await evalJs(`(async () => {
    const r = await fetch('/api/conversations', { headers: { Authorization: 'Bearer ' + localStorage.getItem('vve:token') } });
    const list = await r.json();
    const arr = Array.isArray(list) ? list : (list.conversations || []);
    const t = localStorage.getItem('vve:token');
    const fr = await (await fetch('/api/friends', { headers: { Authorization: 'Bearer ' + t } })).json();
    const jacky = (fr.friends || []).find(f => /jacky|qwen/i.test(f.username || ''));
    if (!jacky) return 'no-jacky-friend';
    const c = arr.find(x => x.type === 'user' && String(x.id) === String(jacky.id));
    if (!c) return 'no-convo';
    window.__jackyId = jacky.id;
    return 'found';
  })()`);
  console.log('  Jacky 会话', opened);

  // 用点击进入：找到 Jacky Bot 在会话列表里的那一项
  const clicked = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('#chats-list .chat-item, #chats-list .conv-row, #chats-list > *')];
    for (const r of rows) {
      const txt = (r.textContent || '').toLowerCase();
      if (txt.includes('jacky') || txt.includes('qwen')) { r.click(); return 'clicked'; }
    }
    return 'not-found:' + rows.length;
  })()`);
  console.log('  点击 Jacky', clicked);
  await sleep(2500);
  const sub = await evalJs(`(document.querySelector('#chat-sub')||{}).textContent || ''`);
  console.log('  chat-sub =', JSON.stringify(sub));
  await shot('01-jacky-subtitle');

  // ② AI 面板：模型下拉只有 Jacky Bot + 思考档位
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('.rail-nav-item, .side-nav-item')].find(x => /assistant|\\bAI\\b/i.test(x.textContent||''));
    if (b) b.click();
    return b ? 'ok' : 'no-btn';
  })()`);
  await sleep(2500);
  const aiInfo = await evalJs(`(() => {
    const sel = document.querySelector('#ai-model');
    const lvl = document.querySelector('#ai-level');
    const wrap = document.querySelector('#ai-level-wrap');
    return {
      modelOptions: sel ? [...sel.options].map(o => o.textContent) : null,
      modelValue: sel ? sel.value : null,
      levelVisible: wrap ? !wrap.classList.contains('hidden') : null,
      levelOptions: lvl ? [...lvl.options].map(o => o.textContent) : null,
      status: (document.querySelector('#ai-status')||{}).textContent || ''
    };
  })()`);
  console.log('  AI 面板', JSON.stringify(aiInfo));
  await shot('02-ai-jacky-only');

  // ③ 朋友圈封面选择器
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('.rail-nav-item, .side-nav-item')].find(x => /日常|moment/i.test(x.textContent||''));
    if (b) b.click();
    return b ? 'ok' : 'no';
  })()`);
  await sleep(3000);
  const coverInfo = await evalJs(`(() => {
    const btn = document.querySelector('#btn-cover-pick');
    return { hasBtn: !!btn, coverImg: !!document.querySelector('#moment-cover-img') };
  })()`);
  console.log('  封面入口', JSON.stringify(coverInfo));
  await evalJs(`(document.querySelector('#btn-cover-pick')||{}).click && document.querySelector('#btn-cover-pick').click()`);
  await sleep(1500);
  const gridInfo = await evalJs(`(() => {
    const g = document.querySelector('#cover-grid');
    return { items: g ? g.querySelectorAll('.cover-item').length : 0,
             modalOpen: !document.querySelector('#modal-cover-picker').classList.contains('hidden') };
  })()`);
  console.log('  封面选择器', JSON.stringify(gridInfo));
  await shot('03-cover-picker');

  // 选一张官方封面
  await evalJs(`(() => { const it = document.querySelectorAll('#cover-grid .cover-item')[2]; if (it) it.click(); return 1; })()`);
  await sleep(2500);
  const applied = await evalJs(`(() => {
    const img = document.querySelector('#moment-cover-img');
    return { src: img ? (img.getAttribute('src')||'').slice(0,60) : null, hidden: img ? img.classList.contains('hidden') : null };
  })()`);
  console.log('  封面已应用', JSON.stringify(applied));
  await shot('04-cover-applied');

  // 跟 Jacky Bot 聊两句 —— 控制台的「Jacky Bot 的对话记录」才有内容
  await evalJs(`(async () => {
    const t = localStorage.getItem('vve:token');
    const fr = await (await fetch('/api/friends', { headers: { Authorization: 'Bearer ' + t } })).json();
    const jacky = (fr.friends || []).find(f => /jacky|qwen/i.test(f.username || ''));
    if (!jacky) return 'no-jacky';
    for (const msg of ['在吗','帮我看看这段代码']) {
      await fetch('/api/messages', { method:'POST',
        headers:{'Content-Type':'application/json', Authorization:'Bearer '+t},
        body: JSON.stringify({ conv_type:'user', conv_id: String(jacky.id), content: msg }) });
    }
    return 'sent';
  })()`);
  await sleep(1500);

  // 造几条日常(朋友圈),验证滚动高亮
  await evalJs(`(async () => {
    const t = localStorage.getItem('vve:token');
    for (const txt of ['第一条动态 A','第二条动态 B','第三条动态 C','第四条动态 D']) {
      await fetch('/api/moments', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+t},
        body: JSON.stringify({ content: txt }) });
    }
    return 1;
  })()`);
  await sleep(1500);
  await goto(BASE + '/');
  await sleep(4000);
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('.rail-nav-item, .side-nav-item')].find(x => /日常|moment/i.test(x.textContent||''));
    if (b) b.click();
    return b ? 'ok' : 'no';
  })()`);
  await sleep(3000);

  // ④ 日常条目滚动 → 框选
  const activeInfo = await evalJs(`(() => {
    const feed = document.querySelector('#moment-feed');
    if (!feed) return 'no-feed';
    const posts = [...feed.querySelectorAll('.moment-post')];
    return { count: posts.length, active: feed.querySelectorAll('.moment-post.is-active').length };
  })()`);
  console.log('  日常条目', JSON.stringify(activeInfo));
  await evalJs(`(() => {
    const feed = document.querySelector('#moment-feed');
    const posts = [...feed.querySelectorAll('.moment-post')];
    if (posts.length > 1) posts[1].scrollIntoView({block:'center'});
    return 1;
  })()`);
  await sleep(2000);
  const activeAfter = await evalJs(`(() => {
    const feed = document.querySelector('#moment-feed');
    const on = feed ? feed.querySelectorAll('.moment-post.is-active') : [];
    return { activeCount: on.length, activeIdx: on.length ? [...feed.querySelectorAll('.moment-post')].indexOf(on[0]) : -1 };
  })()`);
  console.log('  滚动后高亮', JSON.stringify(activeAfter));
  await shot('05-moment-highlight');

  // ⑤ 控制台
  await goto(BASE + '/control/');
  await sleep(2000);
  // 控制台用 sessionStorage 存 token —— 走真实登录流程更稳。
  await evalJs(`(async () => {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: 'Jack', password: 'Zhr121005' }) });
    const d = await r.json();
    if (d.token) sessionStorage.setItem('vve-ctl-token', d.token);
    return d.token ? 1 : 0;
  })()`);
  await goto(BASE + '/control/');
  await sleep(4000);
  // 还没登录就点登录按钮
  await evalJs(`(() => {
    const u = document.querySelector('#gate-user'), p = document.querySelector('#gate-pass');
    if (u) u.value = 'Jack';
    if (p) p.value = 'Zhr121005';
    const b = document.querySelector('#gate-go');
    if (b && !document.querySelector('#gate').classList.contains('hidden')) b.click();
    return 1;
  })()`);
  await sleep(5000);
  const ctlInfo = await evalJs(`(() => {
    const fold = document.querySelector('#jacky-fold');
    const kpis = [...document.querySelectorAll('#kpis .kpi')].map(k => k.querySelector('.k') && k.querySelector('.k').textContent);
    const bans = document.querySelector('#fw-bans');
    return {
      kpis,
      foldExists: !!fold, foldOpen: fold ? fold.open : null,
      foldSummary: fold ? fold.querySelector('summary').textContent.trim().slice(0,40) : null,
      jackyCount: (document.querySelector('#jacky-convo-count')||{}).textContent,
      bansInOwnBox: !!bans,
      eventRows: document.querySelectorAll('#fw-events .event').length,
      eventIps: [...document.querySelectorAll('#fw-events .event .ip')].slice(0,6).map(e => e.textContent),
      banIps: [...document.querySelectorAll('#fw-bans .event .ip')].map(e => e.textContent)
    };
  })()`);
  console.log('  控制台', JSON.stringify(ctlInfo, null, 1));
  await shot('06-console');

  // 展开 Jacky Bot 折叠块
  await evalJs(`(() => {
    const f = document.querySelector('#jacky-fold');
    if (f) { f.open = true; f.scrollIntoView({ block: 'center' }); }
    return 1;
  })()`);
  await sleep(1500);
  await shot('07a-console-jacky-open');
  const expanded = await evalJs(`(() => {
    const f = document.querySelector('#jacky-fold');
    return { open: f.open, rows: document.querySelectorAll('#jacky-convos .convo').length,
             hint: (f.querySelector('.fold-hint')||{}).textContent };
  })()`);
  console.log('  展开后', JSON.stringify(expanded));
  await shot('07-console-jacky-open');

  // 收起
  await evalJs(`(() => { const f = document.querySelector('#jacky-fold'); if (f) { f.open = false; } return 1; })()`);
  await sleep(1200);
  const collapsed = await evalJs(`(() => { const f = document.querySelector('#jacky-fold'); return { open: f.open, hint: (f.querySelector('.fold-hint')||{}).textContent }; })()`);
  console.log('  收起后', JSON.stringify(collapsed));

  // 造一条真实的封禁记录，量封禁行的排版（竖排会很高）
  await evalJs(`(async () => {
    const t = sessionStorage.getItem('vve-ctl-token');
    const r = await fetch('/api/security/block', { method:'POST',
      headers:{'Content-Type':'application/json', Authorization:'Bearer '+t},
      body: JSON.stringify({ ip:'198.51.100.77', minutes: 30, reason:'测试封禁' }) });
    return r.status;
  })()`);
  await sleep(500);
  await evalJs(`(() => { const b = document.querySelector('#btn-refresh'); if (b) b.click(); return 1; })()`);
  await sleep(4000);

  // 封禁 IP 格式：量一行的高度（竖排会很高）
  const banLayout = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('#fw-bans .event')];
    if (!rows.length) return { count: 0 };
    const r = rows[0].getBoundingClientRect();
    const ip = rows[0].querySelector('.ip');
    const ir = ip ? ip.getBoundingClientRect() : null;
    return { count: rows.length, rowH: Math.round(r.height), ipH: ir ? Math.round(ir.height) : null, ipW: ir ? Math.round(ir.width) : null };
  })()`);
  console.log('  封禁行布局', JSON.stringify(banLayout));

  await close();
  proc.kill();
  console.log('\n截图目录', OUT);
})().catch(e => { console.error(e); process.exit(1); });
