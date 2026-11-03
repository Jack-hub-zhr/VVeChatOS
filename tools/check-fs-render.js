import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { launch, connect, sleep } = require('/workspace/tools/cdp.js');
const BASE = process.argv[2] || 'https://vvechat.onrender.com/';
const PANES = (process.argv[3] || 'chats,ai,discover,more').split(',');
const { proc, wsUrl } = await launch({ width: 1280, height: 860, headless: true });
const { send, close } = await connect(wsUrl);
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: BASE });
await sleep(2500);
await ev(`(() => {
  const u=document.querySelector('#auth-username'), p=document.querySelector('#auth-password');
  const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
  if(u&&p){set(u,'Jack');set(p,'Zhr121005');document.querySelector('#auth-submit').click();}
  return 1;
})()`);
await sleep(4000);

const COLLECT = `(() => {
  const out = [];
  const path = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.');
    return s;
  };
  document.querySelectorAll('body *').forEach(el => {
    // 只看自己直接带文字的元素
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length);
    if (!own) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (!el.offsetParent && cs.position !== 'fixed') return;
    out.push({ sel: path(el), fs: parseFloat(cs.fontSize), txt: el.textContent.trim().slice(0, 14) });
  });
  return JSON.stringify(out);
})()`;

const all = new Map();
for (const pane of PANES) {
  await ev(`(() => { const b=document.querySelector('.side-nav-item[data-pane="${pane}"]'); if(b) b.click(); return 1; })()`);
  await sleep(800);
  const raw = await ev(COLLECT);
  if (!raw) { console.log('✗ 采集失败', pane); continue; }
  JSON.parse(raw).forEach(r => {
    const k = r.sel + '|' + r.fs;
    if (!all.has(k)) all.set(k, r);
  });
}
const list = [...all.values()].sort((a, b) => a.fs - b.fs);
console.log('== 小于 11px 的实际渲染文字 ==');
let small = 0;
list.filter(r => r.fs < 11).forEach(r => { console.log(`  ${String(r.fs).padStart(6)}px  ${r.sel.padEnd(48).slice(0,48)}  「${r.txt}」`); small++; });
if (!small) console.log('  (无)');
console.log('== 全部(>=11px)==');
list.filter(r=>r.fs>=11).forEach(r=>console.log(`  ${String(r.fs).padStart(6)}px  ${r.sel.padEnd(46).slice(0,46)}  「${`${r.txt}`}」`));
console.log('\n== 字号分布(实际渲染)==');
const dist = {};
list.forEach(r => { dist[r.fs] = (dist[r.fs] || 0) + 1; });
Object.keys(dist).map(Number).sort((a, b) => a - b).forEach(v => console.log(`  ${String(v).padStart(6)}px × ${dist[v]}`));
console.log('  合计 ' + Object.keys(dist).length + ' 种');
close(); try { proc.kill(); } catch {}
