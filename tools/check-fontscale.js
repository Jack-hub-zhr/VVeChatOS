import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { launch, connect, sleep } = require('/workspace/tools/cdp.js');
const BASE = process.argv[2] || 'http://127.0.0.1:3000/';
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
const PROBE = `(() => {
  const g = (sel) => { const e=document.querySelector(sel); return e ? getComputedStyle(e).fontSize : 'MISSING'; };
  return JSON.stringify({
    scale: getComputedStyle(document.body).getPropertyValue('--font-scale').trim(),
    section: g('.side-section-title'), name: g('.list-item .name'),
    bubble: g('.msg-bubble'), brand: g('.brand-name'), preview: g('.list-item .preview'),
  });
})()`;
for (const sc of ['0.9', '1', '1.15']) {
  await ev(`(() => { document.body.style.setProperty('--font-scale', '${sc}'); return 1; })()`);
  await sleep(400);
  console.log('scale=' + sc.padEnd(5), await ev(PROBE));
}
close(); try { proc.kill(); } catch {}
