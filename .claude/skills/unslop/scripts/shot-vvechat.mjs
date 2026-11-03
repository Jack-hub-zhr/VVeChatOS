#!/usr/bin/env node
/**
 * shot-vvechat.mjs — VVeChat 专用截图工具(unslop skill 配套)
 *
 * 登录 → 切主题 → 切屏幕 → 截图,截的是真实界面而不是代码。
 *
 *   node shot-vvechat.mjs --out shots/xx.png --screen chats --theme light --width 1280
 *   node shot-vvechat.mjs --out shots/xx.png --screen ai --theme dark --mobile
 *   node shot-vvechat.mjs --out shots/xx.png --screen group-info --theme 550c
 *   node shot-vvechat.mjs --list-screens
 *
 * --url    默认 https://vvechat.onrender.com/ (本地可用 http://127.0.0.1:3000/)
 * --user   默认 Jack
 * --pass   默认 Zhr121005
 * --theme  light | dark | 550c | auto
 * --screen chats | ai | discover | more | group-info | profile | auth
 * --mobile 手机尺寸 390x844
 * --wait   截图前额外等待毫秒(默认 1200)
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

// cdp.js 的位置:环境变量 → 沙盒 → 仓库里的 tools/
const cdpCandidates = [
  process.env.CDP_JS,
  '/workspace/tools/cdp.js',
  new URL('../../../../tools/cdp.js', import.meta.url).pathname,
  new URL('../../../tools/cdp.js', import.meta.url).pathname,
  new URL('../tools/cdp.js', import.meta.url).pathname,
].filter(Boolean);
const cdpPath = cdpCandidates.find(p => existsSync(p));
if (!cdpPath) {
  console.error('找不到 cdp.js。设 CDP_JS=<path> 或把 tools/cdp.js 放到仓库里。');
  process.exit(1);
}
const { launch, connect, sleep } = require(cdpPath);

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const eq = argv.find(a => a.startsWith(`--${n}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = argv.indexOf(`--${n}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return d;
};
const has = n => argv.includes(`--${n}`);

if (has('--list-screens')) {
  console.log('screens: chats | ai | discover | more | group-info | profile | auth');
  console.log('themes : light | dark | 550c | auto');
  process.exit(0);
}

const OUT = resolve(flag('out', '/workspace/shots/unslop.png'));
const TARGET = flag('url', 'https://vvechat.onrender.com/');
const USER = flag('user', 'Jack');
const PASS = flag('pass', 'Zhr121005');
const THEME = flag('theme', 'light');
const SCREEN = flag('screen', 'chats');
const MOBILE = has('--mobile');
const EXTRA_WAIT = Number(flag('wait', 1200));
const W = Number(flag('width', MOBILE ? 390 : 1280));
const H = Number(flag('height', MOBILE ? 844 : 860));

const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';
if (!existsSync(CHROME)) { console.error('找不到 Chromium:', CHROME); process.exit(1); }

const { proc, wsUrl } = await launch({ width: W, height: H, headless: true });
const { send, close } = await connect(wsUrl);

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE,
  });

  // 1. 先落到真实 origin,再写 localStorage(否则 SecurityError)
  await send('Page.navigate', { url: TARGET });
  await sleep(2200);

  // 2. 主题:550C 是独立开关,优先于 light/dark
  await evaluate(`(() => {
    try {
      localStorage.setItem('vve:theme', ${JSON.stringify(THEME === '550c' ? 'dark' : THEME)});
      localStorage.setItem('vve:boot550c', ${JSON.stringify(THEME === '550c' ? '1' : '0')});
      localStorage.setItem('vve:lang', 'zh');
    } catch (e) {}
    return true;
  })()`);

  // 3. 登录(表单登录最稳,不用管 token 过期)
  const loggedIn = await evaluate(`!!document.querySelector('#app-view:not(.hidden)')`);
  if (!loggedIn) {
    await evaluate(`(() => {
      const u = document.querySelector('#auth-username');
      const p = document.querySelector('#auth-password');
      if (!u || !p) return false;
      const set = (el, v) => {
        const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(u, ${JSON.stringify(USER)});
      set(p, ${JSON.stringify(PASS)});
      const btn = document.querySelector('#auth-submit');
      if (btn) btn.click();
      return true;
    })()`);
    for (let i = 0; i < 25; i++) {
      await sleep(400);
      const ok = await evaluate(`!!document.querySelector('#app-view:not(.hidden)')`);
      if (ok) break;
    }
  }

  // 4. 主题在登录后由 applyTheme 决定,再强制刷一次
  await evaluate(`(() => {
    try {
      localStorage.setItem('vve:boot550c', ${JSON.stringify(THEME === '550c' ? '1' : '0')});
      localStorage.setItem('vve:theme', ${JSON.stringify(THEME === 'dark' ? 'dark' : 'light')});
    } catch (e) {}
    location.reload();
    return true;
  })()`);
  await sleep(2600);

  // 4b. 550C 开机动画会盖住界面 —— 点一下跳过
  for (let i = 0; i < 12; i++) {
    const hasBoot = await evaluate(`!!document.querySelector('#boot550c-overlay')`);
    if (!hasBoot) break;
    await evaluate(`(() => {
      const o = document.querySelector('#boot550c-overlay');
      if (o) o.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`);
    await sleep(500);
  }
  await sleep(400);

  // 5. 切到目标屏幕
  if (SCREEN !== 'auth') {
    await evaluate(`(() => {
      const sel = '.side-nav-item[data-pane="' + ${JSON.stringify(SCREEN)} + '"]';
      const b = document.querySelector(sel);
      if (b) { b.click(); return true; }
      return false;
    })()`);
    await sleep(700);
    if (SCREEN === 'group-info') {
      await evaluate(`(() => {
        const open = document.querySelector('#group-info-btn, [data-group-info], .chat-title-btn, #chat-title');
        if (open) open.click();
        return true;
      })()`);
      await sleep(700);
    }
    if (SCREEN === 'profile') {
      await evaluate(`(() => { const b = document.querySelector('#btn-profile'); if (b) b.click(); return true; })()`);
      await sleep(700);
    }
  }

  await sleep(EXTRA_WAIT);

  // 6. 截图
  mkdirSync(dirname(OUT), { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

  const info = await evaluate(`(() => ({
    theme: document.body.className,
    screen: ${JSON.stringify(SCREEN)},
    title: (document.querySelector('#ai-head-title')?.textContent || document.title || '').trim().slice(0, 40),
    glass: !!document.querySelector('[data-liquid-glass], .lg-glass'),
  }))()`);
  console.log('✓', OUT, JSON.stringify(info));
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  close();
  try { proc.kill(); } catch {}
}
