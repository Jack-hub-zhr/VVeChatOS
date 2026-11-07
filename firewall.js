/* ============================================================
   VVeChat 防火墙
   ------------------------------------------------------------
   挡住常见的网络攻击,每一次拦截都记一条事件(带来源 IP),
   控制台能直接看到「谁在打、从哪打、打的什么」。

   覆盖的攻击类型:
     · 路径穿越 / 敏感文件探测(/.env、/.git、/wp-admin…)
     · SQL 注入、命令注入、模板注入
     · XSS 载荷
     · 扫描器 UA(sqlmap / nikto / nmap / nuclei…)
     · 登录爆破(失败次数超阈值 → 封 IP)
     · 超大包、超长 URL、异常方法、头注入

   另外有一个常驻的「安全 agent」:24 小时待命,
   每 5 分钟自检一遍防火墙还活着没、有没有异常流量,
   有问题立刻写进事件表 —— 控制台那边就能看到。
   ============================================================ */
'use strict';

// ---------- 规则表 ----------
// path: 命中路径的一部分(小写比较); ua: UA 关键字; body: 正文关键字
const PATH_RULES = [
  { re: /(^|\/)\.\.(\/|\\|%2e%2e)/i, kind: 'path_traversal', sev: 'high' },
  { re: /%00/, kind: 'null_byte', sev: 'high' },
  { re: /\/\.env/i, kind: 'env_probe', sev: 'high' },
  { re: /\/\.git/i, kind: 'git_probe', sev: 'high' },
  { re: /\/\.ssh|\/id_rsa|\/\.aws\/|\/\.docker/i, kind: 'secret_probe', sev: 'high' },
  { re: /\/wp-admin|\/wp-login|\/wp-content|\/phpmyadmin|\/adminer|\/xmlrpc\.php/i, kind: 'cms_probe', sev: 'medium' },
  { re: /\/actuator|\/jolokia|\/server-status|\/server-info|\/cgi-bin/i, kind: 'server_probe', sev: 'medium' },
  { re: /\/vendor\/phpunit|\/vendor\/\.env|\/debug\/|\/console\/|\/telescope/i, kind: 'framework_probe', sev: 'medium' },
  { re: /\.(bak|old|orig|sql|dump|swp|tar|zip|7z|rar)(\?|$|\/)/i, kind: 'backup_probe', sev: 'medium' },
  { re: /\/etc\/passwd|\/proc\/self\/environ|\/var\/log\//i, kind: 'lfi_probe', sev: 'high' },
];

const BODY_RULES = [
  { re: /(\%27|\')\s*(or|and)\s+[\'\"0-9]/i, kind: 'sqli', sev: 'high' },
  { re: /union\s+(all\s+)?select\s/i, kind: 'sqli', sev: 'high' },
  { re: /;\s*(drop|delete|update|insert|truncate)\s+/i, kind: 'sqli', sev: 'high' },
  { re: /\b(sleep|benchmark|pg_sleep|waitfor\s+delay)\s*\(/i, kind: 'sqli', sev: 'medium' },
  { re: /<\s*script\b|<\s*iframe\b|<\s*svg\s+onload/i, kind: 'xss', sev: 'medium' },
  { re: /javascript\s*:|on(error|load|mouseover)\s*=/i, kind: 'xss', sev: 'medium' },
  { re: /(\|\s*(bash|sh)\b)|(;\s*rm\s+-rf)|(\$\()|(&&\s*curl)|(\bwget\s+http)/i, kind: 'cmdi', sev: 'high' },
  { re: /\{\{\s*\d+\s*\*\s*\d+\s*\}\}|\$\{jndi:|<\#assign/i, kind: 'template_injection', sev: 'high' },
];

const UA_RULES = [
  { re: /sqlmap|nikto|acunetix|nessus|masscan|zgrab|nuclei|wpscan|joomscan|arachni|havij|gobuster|dirbuster|metsploit|burp|metasploit|zaproxy|commix|xsser/i, kind: 'scanner_ua', sev: 'high' },
  { re: /python-urllib|python-requests|go-http-client|okhttp|java\/.*apache-httpclient|libwww-perl|lwp-trivial/i, kind: 'bot_ua', sev: 'low' },
];

const BAD_METHODS = ['TRACE', 'TRACK', 'CONNECT', 'DEBUG'];

const MAX_URL_LEN = 2000;
const MAX_BODY_BYTES = 6 * 1024 * 1024;

// 这些接口的正文是用户自己写的聊天内容 —— 里面出现 "select"、"union" 是常事,
// 拿 WAF 的注入规则去扫它们只会误伤真人。所以正文只在别的接口上扫,
// 查询串(URL 参数)永远扫。
const CONTENT_PATHS = ['/api/messages', '/api/ai/chat', '/api/register', '/api/login', '/api/ai/chats'];

function isContentPath(p) {
  return CONTENT_PATHS.some((c) => p === c || p.indexOf(c) === 0);
}

// 内网/回环地址永远不封 ——
// 防火墙自己的自检就是从 127.0.0.1 发起的,把它自己封了等于自杀。
function isPrivateIp(ip) {
  const s = String(ip || '');
  if (s === '::1' || s === '::ffff:127.0.0.1') return true;
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

// 登录爆破:失败多少次开始封 IP(封多久随次数递增)
const BRUTE_FAIL_MAX = 8;
const BRUTE_BASE_MINUTES = 15;

function createFirewall(opts) {
  opts = opts || {};
  const db = opts.db || null;
  const getIp = opts.getIp || ((req) => req.ip || 'unknown');
  const log = opts.log || console.warn;

  // ip -> { until, reason, count, at }
  const blocked = new Map();
  // ip -> { fails, at }
  const authFails = new Map();
  const stats = {
    scanned: 0, blocked: 0, startedAt: Date.now(),
    agentChecks: 0, agentFailures: 0, lastCheckAt: 0, lastCheckOk: true
  };
  const listeners = [];

  try {
    if (db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS security_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          ip TEXT NOT NULL,
          kind TEXT NOT NULL,
          severity TEXT NOT NULL,
          method TEXT,
          path TEXT,
          ua TEXT,
          action TEXT NOT NULL,
          detail TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_security_events_ts ON security_events(ts DESC);
      `);
    }
  } catch (e) {
    log('[firewall] cannot create security_events:', e.message);
  }

  function now() { return Date.now(); }

  function record(ev) {
    const row = {
      ts: ev.ts || now(),
      ip: ev.ip || 'unknown',
      kind: ev.kind || 'unknown',
      severity: ev.severity || 'low',
      method: ev.method || null,
      path: ev.path || null,
      ua: (ev.ua || '').slice(0, 240) || null,
      action: ev.action || 'logged',
      detail: (ev.detail || '').slice(0, 400) || null
    };
    if (db) {
      try {
        db.prepare(
          'INSERT INTO security_events (ts, ip, kind, severity, method, path, ua, action, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(row.ts, row.ip, row.kind, row.severity, row.method, row.path, row.ua, row.action, row.detail);
        // 只留最近 2000 条,免得表无限长。
        db.prepare('DELETE FROM security_events WHERE id < (SELECT MAX(id) - 2000 FROM security_events)').run();
      } catch (e) { /* 记不进去也不能影响请求 */ }
    }
    for (const fn of listeners) { try { fn(row); } catch (_) {} }
    return row;
  }

  function isBlocked(ip) {
    const b = blocked.get(ip);
    if (!b) return null;
    if (b.until && b.until < now()) { blocked.delete(ip); return null; }
    return b;
  }

  function block(ip, reason, minutes) {
    const b = blocked.get(ip) || { count: 0 };
    b.count++;
    b.reason = reason;
    b.at = now();
    b.until = now() + minutes * 60 * 1000;
    blocked.set(ip, b);
    return b;
  }

  function unblock(ip) {
    const had = blocked.delete(ip);
    authFails.delete(ip);
    return had;
  }

  // ---------- 命中检测(纯函数,自检也用它) ----------
  function safeDecode(s) {
    try { return decodeURIComponent(String(s || '')); } catch (_) { return String(s || ''); }
  }

  function detectProbe(method, path, query, ua, body) {
    const m = String(method || 'GET').toUpperCase();
    const p = String(path || '');
    const q = String(query || '');
    const u = String(ua || '');
    const b = String(body || '');
    // 攻击者会把载荷编码(%20、%27…),所以编码前后都要扫一遍。
    const hay = p + ' ' + q + ' ' + safeDecode(p) + ' ' + safeDecode(q);
    const hayBody = b + ' ' + safeDecode(b);

    if (BAD_METHODS.indexOf(m) >= 0) {
      return { kind: 'bad_method', sev: 'medium', detail: 'method ' + m };
    }
    if (q.length > MAX_URL_LEN) {
      return { kind: 'long_url', sev: 'low', detail: 'url ' + q.length + ' chars' };
    }
    for (const r of PATH_RULES) {
      if (r.re.test(hay)) return { kind: r.kind, sev: r.sev, detail: 'path' };
    }
    // 查询串永远扫注入载荷(那里不可能有用户正文)。
    for (const r of BODY_RULES) {
      if (r.re.test(hay)) return { kind: r.kind, sev: r.sev, detail: 'query' };
    }
    // 正文只在「不是用户内容」的接口上扫。
    if (!isContentPath(p)) {
      for (const r of BODY_RULES) {
        if (r.re.test(hayBody)) return { kind: r.kind, sev: r.sev, detail: 'body' };
      }
    }
    for (const r of UA_RULES) {
      if (u && r.re.test(u)) return { kind: r.kind, sev: r.sev, detail: 'ua' };
    }
    return null;
  }

  function inspect(req) {
    const rawUrl = req.originalUrl || req.url || '';
    const path = String(req.path || rawUrl.split('?')[0] || '');
    const q = String(rawUrl);
    const ua = String(req.headers['user-agent'] || '');
    const body = (req.body && typeof req.body === 'object')
      ? JSON.stringify(req.body).slice(0, 20000)
      : String(req.body || '').slice(0, 20000);

    const hit = detectProbe(req.method, path, q, ua, body);
    if (hit) return hit;
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_BODY_BYTES) {
      return { kind: 'huge_body', sev: 'medium', detail: 'content-length ' + len };
    }
    for (const k of Object.keys(req.headers)) {
      const v = req.headers[k];
      if (typeof v === 'string' && /[\r\n]/.test(v)) {
        return { kind: 'header_injection', sev: 'high', detail: 'header ' + k };
      }
    }
    return null;
  }

  // ---------- Express 中间件 ----------
  function middleware(req, res, next) {
    stats.scanned++;
    const ip = getIp(req);
    const b = isBlocked(ip);
    if (b) {
      stats.blocked++;
      record({
        ip, kind: 'blocked_ip', severity: 'high',
        method: req.method, path: req.path, ua: req.headers['user-agent'],
        action: 'blocked', detail: 'repeat: ' + (b.reason || '')
      });
      return res.status(403).json({ error: '请求已被防火墙拦截' });
    }
    const hit = inspect(req);
    if (hit) {
      stats.blocked++;
      const internal = isPrivateIp(ip);
      // 只拦高危 + 中危;低危(可疑 UA)只记录,别误伤正常用户。
      // 内网/回环地址永远不封(自检自己就是从这儿发起的)。
      if ((hit.sev === 'high' || hit.sev === 'medium') && !internal) {
        const minutes = hit.sev === 'high' ? BRUTE_BASE_MINUTES : 5;
        block(ip, hit.kind, minutes);
        record({
          ip, kind: hit.kind, severity: hit.sev,
          method: req.method, path: req.path, ua: req.headers['user-agent'],
          action: 'blocked', detail: hit.detail + ' — 封 ' + minutes + ' 分钟'
        });
        log('[firewall] blocked', ip, hit.kind, hit.detail);
        return res.status(403).json({ error: '请求已被防火墙拦截' });
      }
      record({
        ip, kind: hit.kind, severity: hit.sev,
        method: req.method, path: req.path, ua: req.headers['user-agent'],
        action: internal ? 'logged' : 'logged',
        detail: hit.detail + (internal ? ' — 内网地址,不封禁' : '')
      });
    }
    next();
  }

  // 登录失败:调用方(登录接口)在认证失败时调一下
  function noteAuthFailure(req) {
    const ip = getIp(req);
    const f = authFails.get(ip) || { fails: 0, at: now() };
    if (now() - f.at > 10 * 60 * 1000) f.fails = 0;
    f.fails++; f.at = now();
    authFails.set(ip, f);
    if (f.fails >= BRUTE_FAIL_MAX) {
      const minutes = BRUTE_BASE_MINUTES * Math.min(8, Math.floor(f.fails / BRUTE_FAIL_MAX));
      if (!isPrivateIp(ip)) block(ip, 'brute_force', minutes);
      record({
        ip, kind: 'brute_force', severity: 'high',
        method: req.method, path: req.path, ua: req.headers && req.headers['user-agent'],
        action: 'blocked', detail: f.fails + ' 次登录失败 — 封 ' + minutes + ' 分钟'
      });
      log('[firewall] brute force from', ip, f.fails, 'failures');
    }
  }

  function listEvents(limit) {
    if (!db) return [];
    try {
      return db.prepare('SELECT * FROM security_events ORDER BY id DESC LIMIT ?')
        .all(Math.min(Number(limit) || 50, 300));
    } catch (_) { return []; }
  }

  function snapshot() {
    const ipList = Array.from(blocked.entries()).map(([ip, b]) => ({
      ip, reason: b.reason, until: b.until, count: b.count
    }));
    let events = 0;
    let today = 0;
    if (db) {
      try {
        events = db.prepare('SELECT COUNT(*) AS n FROM security_events').get().n;
        const dayAgo = now() - 24 * 3600 * 1000;
        today = db.prepare('SELECT COUNT(*) AS n FROM security_events WHERE ts >= ?').get(dayAgo).n;
      } catch (_) {}
    }
    return {
      enabled: true,
      startedAt: stats.startedAt,
      scanned: stats.scanned,
      blocked: stats.blocked,
      events,
      events24h: today,
      blockedIps: ipList,
      agent: {
        checks: stats.agentChecks,
        failures: stats.agentFailures,
        lastCheckAt: stats.agentCheckAt || 0,
        lastCheckOk: stats.lastCheckOk !== false,
        intervalMs: agentInterval
      }
    };
  }

  // ---------- 24 小时待命的安全 agent ----------
  // 每 5 分钟:
  //   1) 自检 —— 用几个已知攻击载荷打自己,确认防火墙真的在拦;
  //   2) 巡场  —— 看最近的拦截量,突然暴涨就是有人在扫;
  //   3) 报数  —— 结果写进事件表,控制台能看。
  const agentInterval = 5 * 60 * 1000;
  let agentTimer = null;
  let agentBusy = false;

  async function selfTest(baseUrl, get) {
    // 用已知载荷过一遍检测规则。
    // 注意:不发这些请求 —— 万一规则真把它们拦了,拦的可是防火墙自己
    // (自检走的是 127.0.0.1)。检测是纯函数,直接问它「这个你拦不拦」。
    const probes = [
      { method: 'GET', path: '/.env', query: '', ua: '', body: '' },
      { method: 'GET', path: '/../../etc/passwd', query: '', ua: '', body: '' },
      { method: 'GET', path: '/wp-admin/install.php', query: '', ua: '', body: '' },
      { method: 'GET', path: '/api/messages', query: "x=' OR '1'='1", ua: '', body: '' },
      { method: 'GET', path: '/', query: 'q=<script>alert(1)</script>', ua: '', body: '' },
      { method: 'GET', path: '/', query: '', ua: 'sqlmap/1.5', body: '' },
      { method: 'GET', path: '/', query: '?a=;drop%20table%20users', ua: '', body: '' }
    ];
    const missed = [];
    for (const p of probes) {
      if (!detectProbe(p.method, p.path, p.query, p.ua, p.body)) {
        missed.push((p.path + p.query).slice(0, 60));
      }
    }
    // 服务本身还得是活的
    if (get) {
      try {
        const r = await get(baseUrl + '/api/health');
        if (r.status !== 200) missed.push('/api/health → ' + r.status);
      } catch (e) { missed.push('/api/health → ' + e.message); }
    }
    return missed;
  }

  async function runAgentCheck(get, baseUrl) {
    if (agentBusy) return;
    agentBusy = true;
    try {
      stats.agentChecks++;
      stats.agentCheckAt = now();
      const bad = await selfTest(baseUrl, get);
      stats.lastCheckOk = bad.length === 0;
      if (bad.length) {
        stats.agentFailures++;
        record({
          ip: 'self-check', kind: 'agent_self_test_failed', severity: 'high',
          action: 'logged', detail: '防火墙没能拦住: ' + bad.join(' / ')
        });
        log('[firewall] self-check failed:', bad.join(' / '));
      }
      // 巡场:最近 5 分钟被拦了 50 次以上 —— 有人在集中扫。
      if (db) {
        try {
          const since = now() - 5 * 60 * 1000;
          const row = db.prepare(
            'SELECT COUNT(*) AS n, COUNT(DISTINCT ip) AS ips FROM security_events WHERE ts >= ? AND action = ?'
          ).get(since, 'blocked');
          if (row.n >= 50) {
            record({
              ip: 'agent', kind: 'attack_spike', severity: 'high',
              action: 'logged', detail: row.n + ' 次拦截 / ' + row.ips + ' 个 IP(5 分钟内)'
            });
          }
        } catch (_) {}
      }
    } catch (e) {
      stats.lastCheckOk = false;
      record({ ip: 'agent', kind: 'agent_error', severity: 'low', action: 'logged', detail: e.message });
    } finally {
      agentBusy = false;
    }
  }

  function startAgent(get, baseUrl) {
    if (agentTimer) return;
    agentTimer = setInterval(() => { runAgentCheck(get, baseUrl); }, agentInterval);
    if (agentTimer.unref) agentTimer.unref();
    setTimeout(() => { runAgentCheck(get, baseUrl); }, 20 * 1000);
  }

  return {
    middleware,
    noteAuthFailure,
    record,
    listEvents,
    snapshot,
    unblock,
    isBlocked,
    block,
    detectProbe,
    startAgent,
    runAgentCheck,
    onEvent(fn) { listeners.push(fn); }
  };
}

module.exports = { createFirewall };
