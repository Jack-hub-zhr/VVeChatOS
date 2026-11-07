#!/usr/bin/env node
/* 液态玻璃位移场自检
 *
 * 盯的是一条铁律:**边带里的采样方向不能反转**。
 * 反转了(Jacobian < 0)背景会被镜像 —— 壁纸的斜纹被切成碎片,
 * 看着像撕裂而不是弯。20261107d 就栽在这:边带 22px 拉距 34px,
 * pull > band ⇒ 边缘直接翻转。
 *
 * 这里的公式必须和 frontend/liquid-glass.js 的 buildMap() 保持一致。
 */
const assert = require('assert');

const PARAMS = { bandRatio: 0.107, bandMin: 6, bandMax: 60, pullRatio: 0.5, centerScale: 0.92, sphereP: 2.0 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothStep = (a, b, t) => { t = Math.max(0, Math.min(1, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
function rrectSDF(x, y, hw, hh, r) {
  r = Math.min(r, Math.min(hw, hh));
  const qx = Math.abs(x) - hw + r, qy = Math.abs(y) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

// 和 buildMap() 一样的采样函数:返回采样点相对原点的位移 (dx, dy)
function sampleOffset(ex, ey, W, H, radius) {
  const ax = W / 2, ay = H / 2, mn = Math.min(W, H);
  const band = clamp(PARAMS.bandRatio * mn, PARAMS.bandMin, PARAMS.bandMax);
  const pull = band * PARAMS.pullRatio;
  const r = Math.hypot(ex / ax, ey / ay);
  const d = rrectSDF(ex, ey, ax, ay, radius);
  let f = PARAMS.centerScale + (1 - PARAMS.centerScale) * Math.pow(r, PARAMS.sphereP);
  const t = smoothStep(-band, 0, d);
  if (t > 0) {
    const plen = Math.hypot(ex, ey);
    const p = Math.min(pull, plen * 0.6);
    f *= 1 - (t * p) / Math.max(plen, 1e-6);
  }
  return { dx: ex * (f - 1), dy: ey * (f - 1), band, pull };
}

// 采样映射的 Jacobian(水平方向):> 0 = 不反转;= 0 = 折叠;< 0 = 镜像
// 注意:算的是**采样位置** ex+dx 的导数,不是位移 dx 的导数(要 +1)
function jacobian(x, y, W, H, radius, eps = 0.5) {
  const a = sampleOffset(x - eps, y, W, H, radius).dx;
  const b = sampleOffset(x + eps, y, W, H, radius).dx;
  return 1 + (b - a) / (2 * eps);
}

const SIZES = [
  [36, 36, 18], [44, 44, 22], [120, 40, 12], [260, 150, 20],
  [440, 250, 26], [640, 400, 26], [900, 560, 26], [1290, 900, 28], [2000, 64, 0]
];

let worst = Infinity, worstCase = null, checked = 0;
for (const [W, H, radius] of SIZES) {
  const { band, pull } = sampleOffset(0, 0, W, H, radius);
  assert.ok(pull < band, `W=${W} H=${H}: 拉距 ${pull} 必须小于边带 ${band}(否则边缘内容被镜像)`);

  const ax = W / 2, ay = H / 2;
  // 扫每条边的内侧和外侧
  for (const [x, y] of [
    [ax - 1, 0], [ax - band / 2, 0], [-ax + 1, 0], [-ax + band / 2, 0],
    [0, ay - 1], [0, -ay + 1], [0, ay - band / 2], [0, -ay + band / 2],
    [ax * 0.7, ay * 0.7], [-ax * 0.7, ay * 0.7]
  ]) {
    const j = jacobian(x, y, W, H, radius);
    checked++;
    if (j < worst) { worst = j; worstCase = { W, H, x, y, j }; }
  }
}

assert.ok(worst > 0.2, `采样方向出现反转(Jacobian=${worst.toFixed(3)} @ ${JSON.stringify(worstCase)}) —— 边缘会被镜像成撕裂`);

// 边带外的位移必须是 0(中间干净)
const mid = sampleOffset(0, 0, 900, 560, 26);
assert.ok(Math.abs(mid.dx) < 1e-9 && Math.abs(mid.dy) < 1e-9, '中心不该有位移');

// 边缘要有可见的弯折(位移不能小到看不见)
const edge = sampleOffset(-900 / 2 + 1, 0, 900, 560, 26);
assert.ok(Math.abs(edge.dx) >= 8, `边缘位移 ${edge.dx.toFixed(1)}px 太小,看不出扭曲`);

console.log(`✓ 液态玻璃位移场自检通过:${checked} 个采样点,Jacobian 最小 ${worst.toFixed(3)}(>0,不镜像)`);
console.log(`  大面板 900×560:边带 ${sampleOffset(0, 0, 900, 560, 26).band}px,拉距 ${sampleOffset(0, 0, 900, 560, 26).pull}px,边缘位移 ${edge.dx.toFixed(1)}px`);
