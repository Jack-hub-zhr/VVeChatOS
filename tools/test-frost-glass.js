#!/usr/bin/env node
/* 磨砂玻璃自检
   ------------------------------------------------------------
   验三件事:
     1. 结构面板不透光 —— 底色不透明度够高,且身上没有 backdrop-filter
        （面板不透明了还模糊 = 纯浪费;壁纸在动时更是每帧重算的元凶）
     2. 壁纸会动,而且比以前快 —— 漂移动画在、周期 ≤ 40s
     3. 壁纸是柔焦的 —— 背景本身被糊过,透出来也认不出原图

   用法: node tools/test-frost-glass.js
   退出码 0 = 全过。
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const style = read('frontend/style.css');
const glass = read('frontend/glass.css');
const boot = read('frontend/boot550c.css');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---------- CSS 小工具 ---------- */
// 注释里的字样不算声明
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// 找出所有选择器里包含 target 的规则体（选择器组按逗号拆）
function ruleBodies(css, target) {
  const out = [];
  // 用后行断言而不是吃掉前一个 }，否则上一条规则的收尾会把下一条的选择器吞掉
  const re = /(?:^|(?<=\}))\s*([^{}@]+?)\{([^{}]*)\}/g;
  let m;
  const clean = stripComments(css);
  while ((m = re.exec(clean))) {
    const sels = m[1].split(',').map(s => s.trim().replace(/\s+/g, ' '));
    if (sels.some(s => s === target || s.endsWith(' ' + target))) out.push(m[2]);
  }
  return out;
}
const hasBackdropFilter = (css, target) =>
  ruleBodies(stripComments(css), target).some(b => /(^|[;\s])(-webkit-)?backdrop-filter\s*:\s*(?!none)/i.test(b));

// 取某个变量的 rgba 不透明度
function alphaOf(css, varName) {
  const m = css.match(new RegExp('--' + varName + '\\s*:\\s*[^;]*?rgba\\([^)]*?,\\s*([0-9.]+)\\s*\\)'));
  return m ? parseFloat(m[1]) : null;
}

console.log('\n[1] 结构面板:不透光 + 没有 backdrop-filter');
const PANELS = ['.app-shell', '.topbar', '.rail-pane', '.list-pane', '.right-pane',
                '.chat-header', '.chat-composer', '.auth-card', '.modal-card'];
for (const sel of PANELS) {
  ok(!hasBackdropFilter(style, sel), sel + ' 上没有 backdrop-filter');
}

console.log('\n[2] 磨砂底色:不透明度够高（≥0.85）');
const lightScope = style.slice(0, style.indexOf('body.dark, body.theme-dark'));
const lightA = alphaOf(lightScope, 'frost-panel');
ok(lightA !== null && lightA >= 0.85, '浅色 --frost-panel 不透明度 ≥0.85', '实际 ' + lightA);
const darkBlock = style.slice(style.indexOf('body.dark, body.theme-dark'));
const darkA = alphaOf(darkBlock.slice(0, darkBlock.indexOf('}')), 'frost-panel');
ok(darkA !== null && darkA >= 0.85, '暗色 --frost-panel 不透明度 ≥0.85', '实际 ' + darkA);
const canvasA = alphaOf(lightScope, 'frost-canvas');
ok(canvasA !== null && canvasA >= 0.6, '聊天画布面纱 ≥0.6（背景只剩一层柔光）', '实际 ' + canvasA);

console.log('\n[3] 磨砂颗粒 + 柔焦背景');
ok(/--frost-grain\s*:\s*url\("data:image\/svg\+xml/.test(style), '--frost-grain 是一张噪声图');
ok(/--frost-panel\s*:\s*var\(--frost-grain\)/.test(style), '--frost-panel 叠了颗粒');
ok(/filter:\s*blur\(var\(--frost-canvas-blur\)\)/.test(style), '壁纸层自带柔焦 blur');
ok(/--frost-canvas-blur\s*:\s*(\d+)px/.test(style) &&
   parseInt(style.match(/--frost-canvas-blur\s*:\s*(\d+)px/)[1], 10) <= 40,
   '柔焦半径 ≤40px（太厚就成糊了）');

console.log('\n[4] 背景在动,而且比以前快');
ok(/@keyframes\s+wallpaperDrift/.test(style), '有 wallpaperDrift 关键帧');
const drift = style.match(/animation:\s*wallpaperDrift\s+([\d.]+)s/);
ok(!!drift, '壁纸层挂了漂移动画');
if (drift) {
  const dur = parseFloat(drift[1]);
  ok(dur > 0 && dur <= 40, '漂移周期 ≤40s（旧版 64s）', '实际 ' + dur + 's');
}
ok(/translate3d\(-?[0-9.]+%/.test(style), '漂移是位移（合成器能扛）');

console.log('\n[5] 变量两处不能打架');
const rootGlass = alphaOf(lightScope, 'glass-bg');
const bodyGlass = alphaOf(glass, 'glass-bg');
ok(rootGlass !== null && bodyGlass !== null && Math.abs(rootGlass - bodyGlass) < 0.001,
   'style.css 与 glass.css 的 --glass-bg 一致', rootGlass + ' vs ' + bodyGlass);
// --frost-panel 只在 style.css 里定义一次；glass.css 再写一份就迟早对不上
ok(!/--frost-panel\s*:/.test(glass), '--frost-panel 只有一处定义（style.css）');
ok(/--frost-panel\s*:/.test(boot), '550C 终端主题也定义了 --frost-panel');

console.log('\n[6] 面板底下不许再有「透光」的老写法');
for (const sel of ['.topbar', '.rail-pane', '.list-pane', '.chat-header', '.chat-composer']) {
  const bodies = ruleBodies(style, sel);
  const seeThrough = bodies.some(b => {
    const m = b.match(/background\s*:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\)/);
    return m && parseFloat(m[1]) < 0.5;
  });
  ok(!seeThrough, sel + ' 不是半透明白（背景透得过来）');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
