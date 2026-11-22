#!/usr/bin/env node
/* 屏幕尺寸巡检：在一批主流分辨率下量布局，找出溢出/挤压/错位。
   用法：node tools/sweep-sizes.js [baseUrl] [截图目录]
   只报告问题，不改代码 —— 判断留给眼睛。 */
const fs = require('fs');
const path = require('path');
const { launch, connect, sleep } = require('./cdp');

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const OUT = process.argv[3] || '/workspace/shots/sweep';

// 主流设备（含笔记本、平板、折叠屏、超宽屏）
const SIZES = [
  ['iphone-se', 375, 667],
  ['short-1280x600', 1280, 600],
  ['short-1366x640', 1366, 640],
  ['short-1024x600', 1024, 600],
  ['ultrawide-2560x1080', 2560, 1080],
  ['ultrawide-3440x1440b', 3440, 1440],
  ['sq-1280x1024', 1280, 1024],
  ['tall-800x1200', 800, 1200],
  ['iphone-14', 390, 844],
  ['iphone-14-pro-max', 430, 932],
  ['android-360', 360, 800],
  ['ipad-portrait', 768, 1024],
  ['ipad-air-portrait', 820, 1180],
  ['ipad-pro-11', 834, 1194],
  ['ipad-landscape', 1024, 768],
  ['ipad-pro-landscape', 1194, 834],
  ['macbook-air', 1280, 800],
  ['laptop-1366', 1366, 768],
  ['macbook-pro-14', 1512, 982],
  ['desktop-1440', 1440, 900],
  ['desktop-1600', 1600, 900],
  ['desktop-1920', 1920, 1080],
  ['desktop-2560', 2560, 1440],
  ['ultrawide-3440', 3440, 1440],
  ['folded-open', 2208, 1768],
];

// 在页面里跑：量关键元素的盒子和溢出
const PROBE = `(() => {
  const R = [];
  const push = (k, v) => R.push(k + '=' + v);
  const de = document.documentElement;
  push('scrollW', de.scrollWidth);
  push('clientW', de.clientWidth);
  push('scrollH', de.scrollHeight);
  push('clientH', de.clientHeight);
  push('hOverflow', de.scrollWidth > de.clientWidth + 1);
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  for (const sel of ['.app-shell', '.topbar', '.rail-pane', '.list-pane', '.right-pane', '#chat-window', '.chat-composer', '#chats-list', '.moment-view', '.moment-cover', '#moment-feed']) {
    const b = box(sel);
    if (b) push(sel, JSON.stringify(b));
  }
  // 顶栏元素是否被挤到可视区外
  const tb = document.querySelector('.topbar');
  if (tb) {
    const kids = [...tb.querySelectorAll('.topbar-left > *, .topbar-right > *')];
    const tbR = tb.getBoundingClientRect();
    const bad = kids.filter(e => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;          // 隐藏元素不算
      if (getComputedStyle(e).display === 'none') return false;
      return r.right > tbR.right + 1 || r.left < tbR.left - 1;
    }).map(e => e.className + '(' + Math.round(e.getBoundingClientRect().right) + '/' + Math.round(tbR.right) + ')');
    push('topbarOverflow', JSON.stringify(bad));
  }
  // 按钮之间是否重叠
  const btns = [...document.querySelectorAll('.topbar-right > *')].map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; }).sort((a, b) => a.l - b.l);
  let overlap = 0;
  for (let i = 1; i < btns.length; i++) if (btns[i].l < btns[i - 1].r - 1) overlap++;
  push('topbarOverlap', overlap);
  // 文本溢出容器
  const clipped = [];
  for (const e of document.querySelectorAll('.brand-name, .chat-header-name, .side-nav-label, .moment-top-title, .list-pane .side-section-title')) {
    if (!e.clientWidth) continue;                       // 隐藏的不算
    if (e.scrollWidth > e.clientWidth + 2) clipped.push((e.className || e.id) + ':' + e.textContent.trim().slice(0, 20));
  }
  push('clippedText', JSON.stringify(clipped));
  return R.join('\\n');
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, wsUrl } = await launch({ width: 1440, height: 900 });
  const c = await connect(wsUrl);
  let id = 0;
  const send = (method, params) => c.send(method, params);
  await send('Page.enable');
  await send('Runtime.enable');

  // 注册一个测试号并登录
  const user = 'sweep_' + Date.now().toString(36);
  const reg = await fetch(BASE + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: 'Sweep12345', lang: 'en' }),
  }).then(r => r.json());
  if (!reg.token) { console.error('注册失败', reg); process.exit(1); }

  const report = [];
  for (const [name, w, h] of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: w < 820,
    });
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(1200);
    // 注入登录态
    await send('Runtime.evaluate', {
      expression: `localStorage.setItem('vve:token', ${JSON.stringify(reg.token)});
                   localStorage.setItem('vve:user', ${JSON.stringify(JSON.stringify(reg.user))});
                   localStorage.setItem('vve:lang','en');`,
    });
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(3500);
    const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    const info = r.result && r.result.value ? r.result.value : 'NO PROBE';
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
    const map = {};
    for (const line of info.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
    }
    const issues = [];
    if (map.hOverflow === 'true') issues.push('横向溢出 ' + map.scrollW + '>' + map.clientW);
    if (map.topbarOverlap !== '0') issues.push('顶栏按钮重叠 x' + map.topbarOverlap);
    if (map.topbarOverflow && map.topbarOverflow !== '[]') issues.push('顶栏溢出 ' + map.topbarOverflow);
    if (map.clippedText && map.clippedText !== '[]') issues.push('文字截断 ' + map.clippedText);
    report.push({ name, size: w + 'x' + h, issues, raw: info });
    console.log((issues.length ? '✗ ' : '✓ ') + name.padEnd(20) + (w + 'x' + h).padEnd(11) + issues.join(' | '));
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  c.close(); proc.kill();
  console.log('\n截图目录：' + OUT);
})();
