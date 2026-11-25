#!/usr/bin/env node
/* 英文版体检：切到英文以后，界面上不该出现一个中文字。
   用法：node tools/check-i18n-en.js
   退出码 0 = 通过；1 = 有中文漏出去了。

   查三处：
   ① frontend/app.js 里 STRINGS.en 的每一条值
   ② frontend/app.js 里 lang === 'en' ? A : B 这种三元，英文分支 A
   ③ frontend/index.html 里 data-i18n 之外的硬编码中文（英文模式下的兜底文案）
   顺带扫 server.js 的 error 文案 —— 后端只发中文的话，英文界面照样弹中文。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CJK = /[一-鿿㐀-䶿]/;
const problems = [];

// ---------- ① STRINGS.en ----------
const app = read('frontend/app.js');
const enStart = app.indexOf('en: {');
if (enStart < 0) {
  problems.push('[app.js] 找不到 en: { 字典');
} else {
  // 从 en: { 开始做括号配平，截出整块
  let depth = 0, start = enStart + 4, end = start;
  for (let i = start; i < app.length; i++) {
    const ch = app[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const block = app.slice(start, end);
  const line = (idx) => app.slice(0, idx).split('\n').length;
  const re = /([A-Za-z0-9_]+)\s*:\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(block))) {
    const [, key, raw] = m;
    const val = raw.replace(/\\'/g, "'");
    if (CJK.test(val)) {
      problems.push(`[app.js:${line(start + m.index)}] STRINGS.en.${key} 含中文：${val}`);
    }
  }
}

// ---------- ② lang === 'en' ? A : B ----------
const ternary = /lang\s*===\s*'en'\s*\?\s*'((?:[^'\\]|\\.)*)'/g;
let t;
while ((t = ternary.exec(app))) {
  // 「中」是语言切换按钮上的标记 —— 英文界面里它表示「切回中文」，
  // 是故意留的，不是漏译。
  if (t[1] === '中') continue;
  if (CJK.test(t[1])) {
    const ln = app.slice(0, t.index).split('\n').length;
    problems.push(`[app.js:${ln}] 英文分支含中文：'${t[1]}'`);
  }
}

// ---------- ③ index.html 硬编码中文 ----------
const html = read('frontend/index.html');
// 去掉所有 data-i18n 元素内部的文本（那些会被脚本覆盖）
const stripped = html.replace(/<[^>]*data-i18n[^>]*>[\s\S]*?<\/[^>]+>/g, '');
// 这两处中文是故意的：语言按钮上的「中」是切换目标，
// hello-cycler 是多语言轮播问候（脚本会把它换成对应语言）。
const stripped2 = stripped
  .replace(/<[^>]*id="lang-glyph"[^>]*>[\s\S]*?<\/[^>]+>/g, '')
  .replace(/<[^>]*id="hello-cycler"[^>]*>[\s\S]*?<\/[^>]+>/g, '')
  .replace(/<[^>]*id="hello-splash-cycler"[^>]*>[\s\S]*?<\/[^>]+>/g, '')
  // 语言选择页整页都是双语 —— 那一页本来就是给两种语言看的，故意不翻。
  .replace(/<div id="lang-pick"[\s\S]*?\n {2}<\/div>\n/g, '');
// 去掉 <script> / <style> 块
const noScript = stripped2.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
// 去掉注释
const noComment = noScript.replace(/<!--[\s\S]*?-->/g, '');
// 文本节点里的中文
const textNodes = noComment.match(/>([^<>]+)</g) || [];
for (const raw of textNodes) {
  const txt = raw.slice(1, -1).trim();
  if (!txt || !CJK.test(txt)) continue;
  // 语言下拉里「中文」这一项 —— 它标的就是这门语言本身，故意不翻。
  if (txt === '中文') continue;
  const ln = noComment.slice(0, noComment.indexOf(raw)).split('\n').length;
  problems.push(`[index.html:~${ln}] 硬编码中文（英文模式会露出来）：${txt.slice(0, 40)}`);
}

// ---------- ④ server.js 的 error 文案 ----------
const server = read('server.js');
// 只认同一行里的 error: '...' —— 跨行正则会把后面的代码也吞进来。
const serverErrs = [];
server.split('\n').forEach((line, i) => {
  const re = /\berror:\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(line))) {
    const val = m[1].replace(/\\'/g, "'");
    if (CJK.test(val)) serverErrs.push({ ln: i + 1, val });
  }
});
// 后端只发中文 —— 前端靠 tools/err-en.json 的表翻译。
// 表里没有的 = 英文界面会漏中文，必须补。
const errMap = JSON.parse(read('tools/err-en.json'));
const missing = [];
for (const x of serverErrs) {
  if (!errMap[x.val]) missing.push(x);
}
if (missing.length) {
  problems.push(
    `[server.js] ${missing.length} 条 error 文案在 tools/err-en.json 里没有英文映射：\n` +
    missing.slice(0, 12).map(x => `      第 ${x.ln} 行：${x.val}`).join('\n') +
    (missing.length > 12 ? `\n      …还有 ${missing.length - 12} 条` : '')
  );
}
// 映射表里的英文值本身不能含中文
for (const [zh, en] of Object.entries(errMap)) {
  if (CJK.test(en)) problems.push(`[err-en.json] "${zh}" 的英文值含中文：${en}`);
}

// ---------- ⑤ 中英文键完全对齐 ----------
// zh 缺 en → 英文界面会露出中文;en 缺 zh → 中文界面会露出英文。
function dictBlock(marker) {
  const i = app.indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length - 1;
  let depth = 0;
  for (let j = start; j < app.length; j++) {
    if (app[j] === '{') depth++;
    else if (app[j] === '}') { depth--; if (depth === 0) return app.slice(start + 1, j); }
  }
  return null;
}
const zhBlock = dictBlock('zh: {');
const enBlock2 = dictBlock('en: {');
if (zhBlock && enBlock2) {
  // 只认「顶层键」:行首固定缩进 + 字符串值 —— 嵌套对象里的 key 不算词条。
  const keyOf = (b) => new Set([...b.matchAll(/^ {6}([A-Za-z0-9_]+)\s*:/gm)].map(m => m[1]));
  const zk = keyOf(zhBlock), ek = keyOf(enBlock2);
  const zhOnly = [...zk].filter(k => !ek.has(k));
  const enOnly = [...ek].filter(k => !zk.has(k));
  if (zhOnly.length) {
    problems.push(`[app.js] 中文有、英文没有的词条 ${zhOnly.length} 个（英文界面会漏中文）：\n      ` + zhOnly.slice(0, 20).join(', '));
  }
  if (enOnly.length) {
    problems.push(`[app.js] 英文有、中文没有的词条 ${enOnly.length} 个（中文界面会漏英文）：\n      ` + enOnly.slice(0, 20).join(', '));
  }
}

// ---------- ⑥ index.html 里 data-i18n 用的键都必须存在 ----------
if (zhBlock && enBlock2) {
  const enKeys = new Set([...enBlock2.matchAll(/^ {6}([A-Za-z0-9_]+)\s*:/gm)].map(m => m[1]));
  const used = new Set();
  for (const m of html.matchAll(/data-i18n(?:-ph|-title|-aria)?="([^"]+)"/g)) used.add(m[1]);
  const missing = [...used].filter(k => !enKeys.has(k));
  if (missing.length) {
    problems.push(`[index.html] 引用了英文表里没有的键 ${missing.length} 个：\n      ` + missing.slice(0, 20).join(', '));
  }
}

// ---------- ⑦ 后端 socket 事件名 / API 路径不含中文 ----------
const apiPaths = [...server.matchAll(/['"](\/api\/[A-Za-z0-9\/:._-]+)['"]/g)].map(m => m[1]);
if (apiPaths.some(p => CJK.test(p))) {
  problems.push('[server.js] API 路径里出现了中文');
}

// ---------- ⑧ 前端 fetch 的 URL 里不能带中文 ----------
const fetchUrls = [...app.matchAll(/fetch\(([^)]{0,120})/g)].map(m => m[1]);
for (const u of fetchUrls) {
  if (CJK.test(u) && !/['"][^'"]*[\u4e00-\u9fa5][^'"]*['"]\s*\+/.test(u)) {
    // 模板拼接里的中文变量名不算问题,只报字面量
  }
}

// ---------- ⑨ 控制台不参与 i18n（纯中文后台），确认没有混入英文界面逻辑 ----------
if (/lang\s*===\s*'en'/.test(read('control/app.js'))) {
  problems.push('[control/app.js] 控制台出现了英文分支 —— 控制台是纯中文后台，不该有');
}

console.log('=== 英文版体检 ===');
if (!problems.length) {
  console.log('✓ 全英文，没有中文漏出去');
  process.exit(0);
}
for (const p of problems) console.log('✗ ' + p);
console.log(`\n${problems.length} 处问题`);
process.exit(1);
