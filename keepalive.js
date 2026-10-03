/**
 * VVeChat — keep-alive pinger
 *
 * Render's free tier spins an idle service down after ~15 min of no
 * inbound traffic, which kills the Socket.io connection and makes the
 * first user back wait 30-50s for a cold start.
 *
 * This process hits our own /api/health every KEEPALIVE_INTERVAL_MS so the
 * container never crosses the idle threshold. It is intentionally tiny and
 * dependency-free (node:http only) so it can run as a sidecar or as the
 * same container's second process.
 *
 *   node keepalive.js
 *
 * Optional env:
 *   KEEPALIVE_URL        default http://127.0.0.1:<PORT>/api/health
 *   KEEPALIVE_INTERVAL_MS default 600000 (10 minutes)
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 10000;
const TARGET = process.env.KEEPALIVE_URL || `http://127.0.0.1:${PORT}/api/health`;
const INTERVAL = Number(process.env.KEEPALIVE_INTERVAL_MS || 10 * 60 * 1000);

function ping() {
  let u;
  try { u = new URL(TARGET); } catch (e) {
    console.error('[keepalive] bad KEEPALIVE_URL:', TARGET);
    return;
  }
  const mod = u.protocol === 'https:' ? https : http;
  const req = mod.request(
    u,
    { method: 'GET', timeout: 15000, headers: { 'User-Agent': 'vvechat-keepalive/1.0' } },
    (res) => {
      res.resume(); // drain
      console.log(`[keepalive] ${new Date().toISOString()} -> ${res.statusCode}`);
    }
  );
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  req.on('error', (e) => console.error('[keepalive] error:', e.message));
  req.end();
}

console.log(`[keepalive] started — every ${INTERVAL / 1000}s -> ${TARGET}`);
// Stagger the first ping so we don't collide with server boot.
setTimeout(ping, 15000);
setInterval(ping, INTERVAL);
