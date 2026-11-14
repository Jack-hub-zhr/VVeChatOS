/* ============================================================
   VVeChat 安全内核 —— 纵深防御的公共件
   ------------------------------------------------------------
   realIp(req)          取真实来源 IP(只信 Cloudflare,兜底 socket)
   validateChatInput()  聊天正文 schema 校验 + 注入模式拦截 + 剥标签
   createChatRateLimiter()  按 IP 滑窗限速(10/分钟、100/小时)
   escapeHtml()         输出侧的 HTML 转义
   ============================================================ */
'use strict';

// ------------------------------------------------------------
// 1. 来源 IP
// ------------------------------------------------------------
// 链路:Cloudflare → Render → 本进程(两跳)。
// 只有 Cloudflare 注入的 CF-Connecting-IP 是客户端碰不到的头 ——
// Cloudflare 会用真实来源覆盖掉客户端自己塞的任何 IP 头。
// X-Forwarded-For / X-Real-IP 客户端可以随便伪造,安全逻辑一律不读。
function realIp(req) {
  return realIpOf(req && req.headers, req && req.socket && req.socket.remoteAddress);
}
// socket.io 的握手也能拿到同样的头,所以抽出来给两边共用。
function realIpOf(headers, sockAddr) {
  const h = headers || {};
  const cf = h['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return normalizeIp(cf.trim().split(',')[0]);
  if (sockAddr) return normalizeIp(sockAddr);
  return 'unknown';
}
// ::ffff:1.2.3.4 和 1.2.3.4 是同一个 IP,统一成后者,
// 不然封禁名单里同一个人会占两条。
function normalizeIp(ip) {
  const s = String(ip == null ? '' : ip).trim();
  if (s.toLowerCase().indexOf('::ffff:') === 0) return s.slice(7);
  return s;
}

// ------------------------------------------------------------
// 2. 输入校验(第一道防线)
// ------------------------------------------------------------
const CHAT_MAX_MESSAGE = 2000;    // 单条消息上限
const CHAT_MAX_PAYLOAD = 4000;    // 单次请求正文总量上限
const CHAT_MAX_IMAGE = 5 * 1024 * 1024;  // 图片(data URL)另算

// 命中即拒的注入模式。聊天正文里出现这些,基本没有正当用途。
const INJECTION_PATTERNS = [
  { re: /<\s*script\b/i, kind: 'xss' },
  { re: /<\s*\/\s*script\s*>/i, kind: 'xss' },
  { re: /<\s*iframe\b/i, kind: 'xss' },
  { re: /<\s*svg\b/i, kind: 'xss' },
  { re: /javascript\s*:/i, kind: 'xss' },
  { re: /vbscript\s*:/i, kind: 'xss' },
  { re: /\bon(error|load|click|mouseover|focus|animationstart)\s*=/i, kind: 'xss' },
  { re: /union\s+(all\s+)?select\s/i, kind: 'sqli' },
  { re: /(\%27|')\s*(or|and)\s+['"0-9]/i, kind: 'sqli' },
  { re: /;\s*(drop|delete|update|insert|truncate)\s+/i, kind: 'sqli' },
  { re: /\b(sleep|benchmark|pg_sleep|waitfor\s+delay)\s*\(/i, kind: 'sqli' },
  { re: /\.\.\//, kind: 'path_traversal' },
  { re: /\.\.\\/, kind: 'path_traversal' },
  { re: /%2e%2e|%252e|%c0%ae/i, kind: 'path_traversal' },
  { re: /\0/, kind: 'null_byte' },
  { re: /\$\(|;\s*(rm|curl|wget|cat|nc)\s/i, kind: 'cmdi' },
  { re: /\{\{\s*\d+\s*\*\s*\d+\s*\}\}|\$\{jndi:/i, kind: 'template_injection' },
];

// 剥掉 HTML 标签(存库前)。前端渲染时还会再转义一次 —— 两层都要有。
function stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/[<>]/g, '');
}

// 聊天正文校验。返回 { ok, text, error, kind, detail }。
// error 是给用户看的通用提示,kind/detail 只进服务端日志。
function validateChatInput(body, opts = {}) {
  const maxMsg = opts.maxMessage || CHAT_MAX_MESSAGE;
  const maxPayload = opts.maxPayload || CHAT_MAX_PAYLOAD;
  const b = body || {};
  const field = opts.field || 'content';
  const exclude = new Set(opts.exclude || []);
  const isImage = b.type === 'image';
  const text = typeof b[field] === 'string' ? b[field] : '';

  if (isImage) {
    if (text.length > CHAT_MAX_IMAGE) {
      return { ok: false, error: '图片过大', kind: 'payload_too_large', detail: 'image bytes ' + text.length };
    }
  } else {
    if (text.length > maxMsg) {
      return { ok: false, error: '消息太长了', kind: 'message_too_long', detail: 'message chars ' + text.length };
    }
    let total = 0;
    for (const k of Object.keys(b)) {
      if (exclude.has(k)) continue;
      const v = b[k];
      if (typeof v === 'string') total += v.length;
      else if (v && typeof v === 'object') { try { total += JSON.stringify(v).length; } catch (_) {} }
    }
    if (total > maxPayload) {
      return { ok: false, error: '内容太长', kind: 'payload_too_large', detail: 'payload chars ' + total };
    }
  }

  // 注入模式:正文 + meta 都查一遍(meta 也会被存进库里)。
  let probe = text;
  if (b.meta) probe += ' ' + (typeof b.meta === 'string' ? b.meta : (() => { try { return JSON.stringify(b.meta); } catch (_) { return ''; } })());
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(probe)) {
      return { ok: false, error: '内容里有不允许的字符', kind: p.kind, detail: 'injection pattern: ' + p.kind };
    }
  }
  return { ok: true, text: isImage ? text : stripTags(text) };
}

// ------------------------------------------------------------
// 3. 速率限制(第二道防线)
// ------------------------------------------------------------
// 按 IP 的滑窗计数。换成 Redis 时,把 hits 换成 INCR + EXPIRE 就行,
// 对外暴露的 check(ip) 接口不变,调用方不用改。
function createChatRateLimiter(opts = {}) {
  const perMinute = opts.perMinute || 10;
  const perHour = opts.perHour || 100;
  const hits = new Map();   // ip -> [秒级时间戳...]
  return {
    perMinute, perHour,
    check(ip, now = Date.now()) {
      const t = now / 1000;
      const arr = (hits.get(ip) || []).filter(x => t - x < 3600);
      const inMinute = arr.filter(x => t - x < 60).length;
      if (inMinute >= perMinute) return { ok: false, scope: 'minute' };
      if (arr.length >= perHour) return { ok: false, scope: 'hour' };
      arr.push(t);
      hits.set(ip, arr);
      return { ok: true, remaining: Math.min(perMinute - inMinute - 1, perHour - arr.length) };
    },
    reset(ip) { hits.delete(ip); },
    size() { return hits.size; },
    // 定期清掉没动静的 IP,别让 Map 无限长。
    sweep() {
      const t = Date.now() / 1000;
      for (const [ip, arr] of hits) {
        const keep = arr.filter(x => t - x < 3600);
        if (keep.length) hits.set(ip, keep); else hits.delete(ip);
      }
    },
  };
}

// ------------------------------------------------------------
// 4. 输出转义(第三道防线)
// ------------------------------------------------------------
// 服务端拼 HTML 时用。JSON 响应本身不需要(序列化已经转义了)。
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  realIp, realIpOf, normalizeIp,
  validateChatInput, stripTags, INJECTION_PATTERNS,
  CHAT_MAX_MESSAGE, CHAT_MAX_PAYLOAD, CHAT_MAX_IMAGE,
  createChatRateLimiter, escapeHtml,
};
