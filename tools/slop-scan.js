#!/usr/bin/env node
/* 扫一遍前端里上游 unslop 点名的几类 slop,给出实际数字。 */
const fs = require('fs');
const files = process.argv.slice(2);
const pats = [
  ['transition: all', /transition:\s*all/i],
  ['text-transform: uppercase', /text-transform:\s*uppercase/i],
  ['letter-spacing (负值)', /letter-spacing:\s*-[\d.]+/i],
  ['hover 里 scale', /:hover[^{]*\{[^}]*scale\(/i],
  ['font-size < 11px', /font-size:\s*(9|9\.5|10|10\.5)px/i],
  ['emoji 当图标(标签附近)', /[\u{1F300}-\u{1FAFF}✀-➿]/u],
  ['!important', /!important/i],
  ['animation: infinite', /animation[^;]*infinite/i],
  ['box-shadow 带彩色', /box-shadow:[^;]*rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0?\.[0-9]+\s*\)/i],
  ['渐变(linear-gradient)', /linear-gradient/i],
  ['transition width/height/top/left', /transition:[^;]*(width|height|top|left|margin)/i],
  ['缓动曲线种类', /cubic-bezier\([^)]*\)/i],
];
const sizeCount = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n=== ' + f + ' ===');
  for (const [name, re] of pats) {
    const m = src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    console.log('  ' + String(m ? m.length : 0).padStart(4) + '  ' + name);
  }
  const sizes = src.match(/font-size:\s*([\d.]+)px/gi) || [];
  for (const s of sizes) {
    const v = parseFloat(s.replace(/[^\d.]/g, ''));
    sizeCount[v] = (sizeCount[v] || 0) + 1;
  }
}
console.log('\n=== 字号分布(全部文件)===');
Object.entries(sizeCount).sort((a, b) => b[1] - a[1]).forEach(([v, n]) => console.log('  ' + String(n).padStart(4) + '× ' + v + 'px'));
console.log('  合计 ' + Object.keys(sizeCount).length + ' 种字号');
