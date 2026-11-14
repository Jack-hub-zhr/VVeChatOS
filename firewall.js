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
   自检不通过时,它会自己写一条新规则补上漏掉的检测(写进 firewall_rules 表),
   规则立刻生效 —— 不用等人来改代码。

   来源 IP:只信 Cloudflare 注入的 CF-Connecting-IP,兜底用 socket 真实地址。
   X-Forwarded-For / X-Real-IP 客户端能伪造,安全逻辑一律不读。
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
  // 原型污染:把 __proto__ / constructor[ 塞进 JSON,让下游 merge 污染原型。
  { re: /__proto__|constructor\s*\[|prototype\s*\[/i, kind: 'proto_pollution', sev: 'high' },
];

const UA_RULES = [
  { re: /sqlmap|nikto|acunetix|nessus|masscan|zgrab|nuclei|wpscan|joomscan|arachni|havij|gobuster|dirbuster|metsploit|burp|metasploit|zaproxy|commix|xsser/i, kind: 'scanner_ua', sev: 'high' },
];

// agent 自检失败时会往 firewall_rules 表里写新规则,启动时加载进来。
const EXTRA_RULES = [];

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
        CREATE TABLE IF NOT EXISTS firewall_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL,
          pattern TEXT NOT NULL,
          kind TEXT NOT NULL,
          severity TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'manual',
          created_at INTEGER NOT NULL
        );
      `);
      // 老库补列:完整请求头 / 请求正文 / 命中的规则
      for (const [col, decl] of [['rule', 'TEXT'], ['headers', 'TEXT'], ['payload', 'TEXT']]) {
        try {
          const cols = db.prepare(`PRAGMA table_info(security_events)`).all().map(r => r.name);
          if (!cols.includes(col)) db.exec(`ALTER TABLE security_events ADD COLUMN ${col} ${decl}`);
        } catch (_) {}
      }
      loadExtraRules();
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
      detail: (ev.detail || '').slice(0, 400) || null,
      rule: (ev.rule || '').slice(0, 120) || null,
      headers: ev.headers ? String(ev.headers).slice(0, 2000) : null,
      payload: ev.payload ? String(ev.payload).slice(0, 2000) : null
    };
    if (db) {
      try {
        db.prepare(
          'INSERT INTO security_events (ts, ip, kind, severity, method, path, ua, action, detail, rule, headers, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(row.ts, row.ip, row.kind, row.severity, row.method, row.path, row.ua, row.action, row.detail, row.rule, row.headers, row.payload);
        // 只留最近 2000 条,免得表无限长。
        db.prepare('DELETE FROM security_events WHERE id < (SELECT MAX(id) - 2000 FROM security_events)').run();
      } catch (e) { /* 记不进去也不能影响请求 */ }
    }
    for (const fn of listeners) { try { fn(row); } catch (_) {} }
    return row;
  }

  // agent 自检失败时写进数据库的规则,启动时加载,写完立刻生效。
  function loadExtraRules() {
    EXTRA_RULES.length = 0;
    if (!db) return 0;
    try {
      const rows = db.prepare('SELECT scope, pattern, kind, severity FROM firewall_rules ORDER BY id ASC').all();
      for (const r of rows) {
        try {
          EXTRA_RULES.push({ scope: r.scope, re: new RegExp(r.pattern, 'i'), kind: r.kind, sev: r.severity, pattern: r.pattern });
        } catch (e) { log('[firewall] bad rule pattern:', r.pattern); }
      }
    } catch (_) {}
    return EXTRA_RULES.length;
  }
  // 加一条规则(scope: path | body)。source 记是谁写的(agent / 管理员)。
  function addRule(rule) {
    if (!db) return { ok: false, error: '没有数据库' };
    const scope = rule.scope === 'path' ? 'path' : 'body';
    const pattern = String(rule.pattern || '');
    try { new RegExp(pattern, 'i'); } catch (e) { return { ok: false, error: '正则不合法' }; }
    try {
      const info = db.prepare(
        'INSERT INTO firewall_rules (scope, pattern, kind, severity, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(scope, pattern, rule.kind || 'suspicious', rule.severity || 'high', rule.source || 'manual', now());
      loadExtraRules();
      return { ok: true, id: info.lastInsertRowid, count: EXTRA_RULES.length };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  function listRules() {
    if (!db) return [];
    try { return db.prepare('SELECT * FROM firewall_rules ORDER BY id DESC').all(); } catch (_) { return []; }
  }

  function isBlocked(ip) {
    const b = blocked.get(ip);
    if (!b) return null;
    if (b.until && b.until < now()) { blocked.delete(ip); return null; }
    return b;
  }

  function block(ip, reason, minutes, rule) {
    const b = blocked.get(ip) || { count: 0 };
    b.count++;
    b.reason = reason;
    b.rule = rule || '';
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
    for (const r of EXTRA_RULES) {
      if (r.scope === 'path' && r.re.test(hay)) return { kind: r.kind, sev: r.sev, detail: 'path', rule: r.pattern };
    }
    // 查询串永远扫注入载荷(那里不可能有用户正文)。
    for (const r of BODY_RULES) {
      if (r.re.test(hay)) return { kind: r.kind, sev: r.sev, detail: 'query' };
    }
    for (const r of EXTRA_RULES) {
      if (r.scope !== 'path' && r.re.test(hay)) return { kind: r.kind, sev: r.sev, detail: 'query', rule: r.pattern };
    }
    // 正文只在「不是用户内容」的接口上扫。
    if (!isContentPath(p)) {
      for (const r of BODY_RULES) {
        if (r.re.test(hayBody)) return { kind: r.kind, sev: r.sev, detail: 'body' };
      }
      for (const r of EXTRA_RULES) {
        if (r.scope !== 'path' && r.re.test(hayBody)) return { kind: r.kind, sev: r.sev, detail: 'body', rule: r.pattern };
      }
    }
    for (const r of UA_RULES) {
      if (u && r.re.test(u)) return { kind: r.kind, sev: r.sev, detail: 'ua' };
    }
    for (const r of EXTRA_RULES) {
      if (r.scope === 'ua' && u && r.re.test(u)) return { kind: r.kind, sev: r.sev, detail: 'ua', rule: r.pattern };
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
    // 请求到达的时刻 —— 事件时间用它,精确等于攻击发生的时间。
    // (server 的第一个中间件就打了这个时间戳,body 传得慢也不会偏。)
    const arrivedAt = req._vveArrivedAt || Date.now();
    req._vveArrivedAt = arrivedAt;
    const ip = getIp(req);
    const b = isBlocked(ip);
    if (b) {
      stats.blocked++;
      record({
        ts: arrivedAt, ip, kind: 'blocked_ip', severity: 'high',
        method: req.method, path: req.path, ua: req.headers['user-agent'],
        action: 'blocked', detail: 'repeat: ' + (b.reason || ''), rule: b.rule || '',
        headers: safeJson(req.headers), payload: safeJson(req.body)
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
        block(ip, hit.kind, minutes, hit.rule);
        record({
          ts: arrivedAt, ip, kind: hit.kind, severity: hit.sev,
          method: req.method, path: req.path, ua: req.headers['user-agent'],
          action: 'blocked', detail: hit.detail + ' — 封 ' + minutes + ' 分钟', rule: hit.rule || '',
          headers: safeJson(req.headers), payload: safeJson(req.body)
        });
        log('[firewall] blocked', ip, hit.kind, hit.detail);
        return res.status(403).json({ error: '请求已被防火墙拦截' });
      }
      record({
        ts: arrivedAt, ip, kind: hit.kind, severity: hit.sev,
        method: req.method, path: req.path, ua: req.headers['user-agent'],
        action: 'logged',
        detail: hit.detail + (internal ? ' — 内网地址,不封禁' : ''), rule: hit.rule || '',
        headers: safeJson(req.headers), payload: safeJson(req.body)
      });
    }
    next();
  }

  function safeJson(v) {
    if (v === undefined || v === null) return null;
    try { return JSON.stringify(v).slice(0, 2000); } catch (_) { return null; }
  }

  // 应用层拒绝掉的请求(聊天正文的注入校验之类)也得留痕、也得算进「已拦截」。
  function noteRejected(req, kind, severity, detail, rule) {
    const ip = getIp(req);
    stats.blocked++;
    record({
      ts: (req && req._vveArrivedAt) || now(),
      ip, kind: kind || 'app_rejected', severity: severity || 'medium',
      method: req && req.method, path: req && req.path,
      ua: req && req.headers && req.headers['user-agent'],
      action: 'blocked', detail: detail || '', rule: rule || '',
      headers: req && req.headers ? safeJson(req.headers) : null,
      payload: safeJson(req && req.body)
    });
    log('[firewall] app-layer rejected', ip, kind);
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
      ip, reason: b.reason, rule: b.rule || '', until: b.until, count: b.count,
      remaining_s: b.until ? Math.max(0, Math.round((b.until - now()) / 1000)) : 0
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
        fixes: stats.agentFixes || 0,
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

  // 自检用的探针。每个都带一条「万一没拦住,就写这条规则」的补救方案。
  const PROBES = [
    { name: '环境变量探测', method: 'GET', path: '/.env', query: '', ua: '', body: '',
      rule: { scope: 'path', pattern: '/\\.env', kind: 'env_probe', severity: 'high' } },
    { name: '路径穿越', method: 'GET', path: '/../../etc/passwd', query: '', ua: '', body: '',
      rule: { scope: 'path', pattern: '\\.\\./\\.\\./', kind: 'path_traversal', severity: 'high' } },
    { name: 'CMS 探测', method: 'GET', path: '/wp-admin/install.php', query: '', ua: '', body: '',
      rule: { scope: 'path', pattern: '/wp-admin', kind: 'cms_probe', severity: 'medium' } },
    { name: 'SQL 注入', method: 'GET', path: '/api/messages', query: "x=' OR '1'='1", ua: '', body: '',
      rule: { scope: 'body', pattern: "('|\\x27)\\s*(or|and)\\s+['\\\"0-9]", kind: 'sqli', severity: 'high' } },
    { name: 'XSS', method: 'GET', path: '/', query: 'q=<script>alert(1)</script>', ua: '', body: '',
      rule: { scope: 'body', pattern: '<\\s*script\\b', kind: 'xss', severity: 'medium' } },
    { name: '扫描器 UA', method: 'GET', path: '/', query: '', ua: 'sqlmap/1.5', body: '',
      rule: { scope: 'ua', pattern: 'sqlmap|nuclei|nikto|masscan', kind: 'scanner_ua', severity: 'high' } },
    { name: 'DROP TABLE', method: 'GET', path: '/', query: '?a=;drop%20table%20users', ua: '', body: '',
      rule: { scope: 'body', pattern: ';\\s*(drop|delete)\\s+', kind: 'sqli', severity: 'high' } },
    { name: '原型污染', method: 'GET', path: '/', query: '?a=__proto__', ua: '', body: '',
      rule: { scope: 'body', pattern: '__proto__', kind: 'proto_pollution', severity: 'high' } },
  ];

  async function selfTest(baseUrl, get) {
    // 用已知载荷过一遍检测规则。
    // 注意:不发这些请求 —— 万一规则真把它们拦了,拦的可是防火墙自己
    // (自检走的是 127.0.0.1)。检测是纯函数,直接问它「这个你拦不拦」。
    const missed = [];
    for (const p of PROBES) {
      if (!detectProbe(p.method, p.path, p.query, p.ua, p.body)) {
        missed.push({ name: p.name, rule: p.rule });
      }
    }
    // 服务本身还得是活的
    if (get) {
      try {
        const r = await get(baseUrl + '/api/health');
        if (r.status !== 200) missed.push({ name: '服务存活', rule: null });
      } catch (e) { missed.push({ name: '服务存活:' + e.message, rule: null }); }
    }
    // IP 可信度校验:带伪造的 X-Forwarded-For / X-Real-IP 发一个请求,
    // 看事件表里记的是不是真实来源 IP。
    const trust = await checkIpTrust(baseUrl, get);
    for (const t of trust) missed.push({ name: t, rule: null });
    return missed;
  }

  // IP 可信度校验:伪造 X-Forwarded-For / X-Real-IP,事件里必须是真实 IP。
  async function checkIpTrust(baseUrl, get) {
    const forged = '203.0.113.66';
    let before = 0;
    try { before = db ? db.prepare('SELECT COUNT(*) AS n FROM security_events').get().n : 0; } catch (_) {}
    if (get) {
      try {
        await get(baseUrl + '/.env', { headers: { 'X-Forwarded-For': forged, 'X-Real-IP': forged } });
      } catch (_) {}
    }
    if (!db) return [];
    await new Promise(r => setTimeout(r, 400));
    let row = null;
    try { row = db.prepare('SELECT ip FROM security_events WHERE id > ? ORDER BY id DESC LIMIT 1').get(before); } catch (_) {}
    if (!row) return [];                       // 没留下事件就查不了,不算失败
    if (row.ip === forged) return ['来源 IP 被伪造(' + row.ip + ')—— 还在采信 X-Forwarded-For / X-Real-IP'];
    return [];
  }

  // agent 有权限自己写规则:漏掉的载荷直接补一条检测规则,立刻生效。
  function remediate(missed) {
    const written = [];
    for (const m of missed) {
      if (!m || !m.rule || !m.rule.pattern) continue;
      const exists = (listRules() || []).some(r => r.pattern === m.rule.pattern && r.scope === m.rule.scope);
      if (exists) continue;
      const r = addRule({ ...m.rule, source: 'agent' });
      if (r.ok) written.push(m.rule.kind + ' ← ' + m.rule.pattern);
    }
    return written;
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
        const names = bad.map(b => b.name);
        record({
          ip: 'self-check', kind: 'agent_self_test_failed', severity: 'high',
          action: 'logged', detail: '防火墙没能拦住: ' + names.join(' / ')
        });
        log('[firewall] self-check failed:', names.join(' / '));
        // agent 自己动手:给漏掉的载荷补规则,然后立刻重测。
        const written = remediate(bad);
        if (written.length) {
          stats.agentFixes = (stats.agentFixes || 0) + written.length;
          record({
            ip: 'agent', kind: 'agent_rule_written', severity: 'medium',
            action: 'logged', detail: 'agent 补了 ' + written.length + ' 条规则: ' + written.join('; ')
          });
          const again = await selfTest(baseUrl, get);
          stats.lastCheckOk = again.length === 0;
          if (again.length === 0) {
            record({
              ip: 'agent', kind: 'agent_rule_effective', severity: 'low',
              action: 'logged', detail: '补规则后重测通过,防火墙恢复正常'
            });
          }
        }
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
    noteRejected,
    record,
    listEvents,
    snapshot,
    unblock,
    isBlocked,
    block,
    detectProbe,
    startAgent,
    runAgentCheck,
    addRule,
    listRules,
    loadExtraRules,
    onEvent(fn) { listeners.push(fn); }
  };
}

module.exports = { createFirewall };
