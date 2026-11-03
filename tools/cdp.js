#!/usr/bin/env node
/* Minimal Chrome DevTools Protocol driver.
   usage: node cdp.js <script.js> -- the script gets { send, on, close } helpers.
*/
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch({ width = 1280, height = 900, headless = true } = {}) {
  const port = 9222 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const args = [
    `--remote-debugging-port=${port}`,
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');
  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false });
  let wsUrl = null;
  for (let i = 0; i < 100; i++) {
    await sleep(150);
    try {
      const list = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch (_) {}
  }
  if (!wsUrl) { proc.kill(); throw new Error('chrome did not start'); }
  return { proc, wsUrl, port };
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    } else if (msg.method) {
      listeners.forEach(fn => fn(msg));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 60000);
  });
  const on = fn => listeners.push(fn);
  const close = () => { try { ws.close(); } catch (_) {} };
  return { send, on, close };
}

module.exports = { launch, connect, sleep };
