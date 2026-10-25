/**
 * VVeChat backend (v2 — online status, typing, read receipts, reactions, profile, reply, delete)
 * - Express REST API
 * - Socket.io realtime channel
 * - SQLite (better-sqlite3) for persistence
 * - JWT for auth
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server: SocketIOServer } = require('socket.io');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vvechat-dev-secret-change-me';
// DB location. On Render Free the container FS is ephemeral, so a restart
// wipes the database. Point DB_FILE at a mounted persistent disk to survive
// restarts (e.g. DB_FILE=/var/data/vvechat.db). Falls back to the repo dir.
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'vvechat.db');

// Make sure the parent directory of the DB file exists (matters when
// DB_FILE points at a mounted volume like /var/data).
try { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); } catch (_) {}
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- schema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    bio TEXT,
    avatar_color TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER,
    is_official INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_type TEXT NOT NULL,         -- 'user' | 'group'
    conv_id INTEGER NOT NULL,        -- user_id (peer) or group_id
    sender_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'image' | 'system'
    meta TEXT,                       -- JSON (image width/height, etc.)
    reply_to INTEGER,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_type, conv_id, created_at);

  -- Runtime configuration for the AI relay (so the admin can plug in a key
  -- from the UI instead of editing Render's environment variables).
  CREATE TABLE IF NOT EXISTS ai_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id, status);

  CREATE TABLE IF NOT EXISTS read_receipts (
    conv_type TEXT NOT NULL,
    conv_id    TEXT NOT NULL,        -- user chat: normalized u_x_y ; group: numeric group id as text
    user_id    INTEGER NOT NULL,
    last_read_msg_id INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (conv_type, conv_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );
`);

// Add recommended + announcement + pinned columns to groups if missing
{
  const cols = db.prepare("PRAGMA table_info(groups)").all();
  const names = new Set(cols.map(c => c.name));
  if (!names.has('recommended')) db.exec("ALTER TABLE groups ADD COLUMN recommended INTEGER NOT NULL DEFAULT 1");
  if (!names.has('announcement')) db.exec("ALTER TABLE groups ADD COLUMN announcement TEXT");
  if (!names.has('pinned')) db.exec("ALTER TABLE groups ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  if (!names.has('icon_color')) db.exec("ALTER TABLE groups ADD COLUMN icon_color TEXT");
  if (!names.has('owner_id')) db.exec("ALTER TABLE groups ADD COLUMN owner_id INTEGER");
  // Emoji avatar: a single character chosen by the user, rendered instead of
  // the auto-generated initial. Takes priority over the colour/initial.
  {
    const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map(r => r.name));
    if (!userCols.has('avatar_emoji')) db.exec("ALTER TABLE users ADD COLUMN avatar_emoji TEXT");
  }
  // Backfill: existing groups (official group) default to recommended=1
  db.exec("UPDATE groups SET recommended = 1 WHERE recommended = 0");
}

// lightweight migrations — add columns to existing tables if missing
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
}
function ensureColumn(table, col, decl) {
  if (!columnExists(table, col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    console.log(`[migrate] ${table}.${col} added`);
  }
}
ensureColumn('users', 'bio', 'TEXT');
ensureColumn('users', 'avatar_color', 'TEXT');
ensureColumn('messages', 'type', "TEXT NOT NULL DEFAULT 'text'");
ensureColumn('messages', 'meta', 'TEXT');
ensureColumn('messages', 'reply_to', 'INTEGER');
ensureColumn('messages', 'is_deleted', "INTEGER NOT NULL DEFAULT 0");

// ---------- helpers ----------
function now() { return Date.now(); }
function userPublic(u) {
  return {
    id: u.id,
    username: u.username,
    avatar: u.avatar || null,
    bio: u.bio || null,
    avatar_color: u.avatar_color || null,
    avatar_emoji: u.avatar_emoji || null,
    is_admin: u.username === ADMIN_USERNAME,
  };
}
function ensureOfficialGroup() {
  const row = db.prepare('SELECT id FROM groups WHERE is_official = 1 LIMIT 1').get();
  if (row) return row.id;
  const info = db.prepare(
    'INSERT INTO groups (name, owner_id, is_official, created_at) VALUES (?, NULL, 1, ?)'
  ).run('VVeChat 官方群', now());
  return info.lastInsertRowid;
}
let OFFICIAL_GROUP_ID = ensureOfficialGroup();
console.log('[VVeChat] official group id =', OFFICIAL_GROUP_ID);

// ============================================================
// Self-heal on boot: the official group is the app's lobby — every
// registered account must be a member, otherwise /api/conversations
// returns an empty list and the sidebar shows "暂无会话".
// ============================================================
try {
  const allUsers = db.prepare('SELECT id FROM users').all();
  const addMember = db.prepare(
    'INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)'
  );
  let healed = 0;
  for (const u of allUsers) {
    const r = addMember.run(OFFICIAL_GROUP_ID, u.id, now());
    if (r.changes > 0) healed++;
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?')
    .get(OFFICIAL_GROUP_ID).n;
  console.log(`[VVeChat] official group self-heal: +${healed} member(s), total ${count}`);
} catch (e) {
  console.error('[VVeChat] self-heal failed:', e.message);
}

// ============================================================
// Seed the built-in admin on boot. Previously Jack was only created by
// /api/admin/wipe, so a fresh database had no admin at all and nobody could
// log in with Jack / Zhr121005.
// ============================================================
try {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('Jack');
  if (!existing) {
    db.prepare(
      `INSERT INTO users (username, password_hash, avatar_color, bio, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('Jack', bcrypt.hashSync('Zhr121005', 10), '#fbbf24', 'VVeChat 官方管理员', now());
    console.log('[VVeChat] seeded admin account: Jack');
  } else {
    console.log('[VVeChat] admin account already present: Jack');
  }
  // Make sure Jack is in the official group too.
  const jack = db.prepare('SELECT id FROM users WHERE username = ?').get('Jack');
  if (jack) {
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
      .run(OFFICIAL_GROUP_ID, jack.id, now());
  }
} catch (e) {
  console.error('[VVeChat] admin seed failed:', e.message);
}


function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, username: payload.username };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

function getFriends(uid) {
  return db.prepare(`
    SELECT friend_id FROM friends WHERE user_id = ?
  `).all(uid).map(r => r.friend_id);
}
function userConvId(a, b) { return a < b ? `u_${a}_${b}` : `u_${b}_${a}`; }

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // Render sits behind a proxy; needed for correct client IPs

// ---------- Security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // The app is fully self-hosted, so the origin can be locked down hard.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
  next();
});

// ---------- CORS (tightened) ----------
// Same-origin only by default. Set ALLOW_ORIGIN="*" to open it up when the
// frontend is served from a different host during development.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '';
app.use(cors({
  origin: ALLOW_ORIGIN === '*' ? true : (origin, cb) => {
    if (!origin) return cb(null, true);                       // curl / native
    if (/localhost|127\.0\.0\.1/.test(origin)) return cb(null, true);
    if (/\.onrender\.com$/.test(origin)) return cb(null, true);
    if (ALLOW_ORIGIN && origin === ALLOW_ORIGIN) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
}));

app.use(express.json({ limit: '5mb' }));  // larger limit for image messages

// ---------- Rate limiter (per-IP token bucket, in-memory) ----------
// Protects login/register from brute force and every endpoint from floods.
const RATE_BUCKETS = new Map();
const RATE_LIMIT = {
  windowMs: 60 * 1000,
  global: 1200,  // 1200 req/min per IP across the whole API
  auth: 60,      // 60 req/min for login/register (a person can retry freely)
  write: 240,    // 240 req/min for mutating endpoints
};
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateLimit(kind) {
  return (req, res, next) => {
    const ip = clientIp(req);
    const now = Date.now();
    let b = RATE_BUCKETS.get(ip);
    if (!b || now - b.start > RATE_LIMIT.windowMs) {
      b = { start: now, count: 0, authFail: 0, write: 0 };
      RATE_BUCKETS.set(ip, b);
    }
    b.count++;
    if (b.count > RATE_LIMIT.global) {
      return res.status(429).json({ error: '请求太频繁，请稍等几秒再试' });
    }
    if (kind === 'auth') {
      // Only *failed* auth attempts count toward the brute-force limit, so a
      // real user who mistypes a password or retries is never locked out.
      if ((b.authFail || 0) > RATE_LIMIT.auth) {
        return res.status(429).json({ error: '登录失败次数过多，请 1 分钟后再试' });
      }
    }
    if (kind === 'write' && ++b.write > RATE_LIMIT.write) {
      return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
    }
    next();
  };
}

// Called by the login/register handlers when authentication fails.
function noteAuthFailure(req) {
  const ip = clientIp(req);
  const b = RATE_BUCKETS.get(ip);
  if (!b) return;
  b.authFail = (b.authFail || 0) + 1;
}
// Drop stale buckets so the Map cannot grow without bound.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT.windowMs * 2;
  for (const [ip, b] of RATE_BUCKETS) if (b.start < cutoff) RATE_BUCKETS.delete(ip);
}, 60 * 1000).unref();

app.get('/api/health', (_, res) => res.json({ ok: true, name: 'VVeChat' }));

// ============ ADMIN (Jack-only, no separate key) ============
// The account with username "Jack" is the built-in admin.
// No external key. Jack authenticates normally with password 1234.
const ADMIN_USERNAME = 'Jack';
function isAdmin(user) { return user && user.username === ADMIN_USERNAME; }
function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: '需要 Jack 账号' });
  next();
}
app.post('/api/admin/wipe', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  try {
    db.exec(`
      DELETE FROM message_reactions;
      DELETE FROM read_receipts;
      DELETE FROM messages;
      DELETE FROM group_members;
      DELETE FROM friend_requests;
      DELETE FROM friends;
      DELETE FROM groups;
      DELETE FROM users;
      DELETE FROM sqlite_sequence;
    `);
    // re-seed Jack so the admin can immediately log back in (use Zhr121005 password)
    const jackHash = bcrypt.hashSync('Zhr121005', 10);
    db.prepare(
      `INSERT INTO users (username, password_hash, avatar_color, bio, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('Jack', jackHash, '#fbbf24', 'VVeChat 官方管理员', now());
    // recreate official group and update OFFICIAL_GROUP_ID
    OFFICIAL_GROUP_ID = ensureOfficialGroup();
    res.json({ ok: true, wiped: true, official_group_id: OFFICIAL_GROUP_ID, jack_reseeded: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ============================================================
// Control panel (Jack only) — powers vvechat-control.onrender.com
// ============================================================

// Full snapshot: every user, every 1:1 conversation with its messages.
app.get('/api/control/snapshot', authRequired, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, avatar, avatar_color, bio, created_at
    FROM users ORDER BY id ASC
  `).all();

  // 1:1 conversations: friend pairs + every user-to-user conversation
  const convos = db.prepare(`
    SELECT DISTINCT conv_id FROM messages WHERE conv_type = 'user' ORDER BY conv_id
  `).all();
  const conversations = [];
  for (const c of convos) {
    const m = /^u_(\d+)_(\d+)$/.exec(c.conv_id);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    const ua = db.prepare('SELECT id, username, avatar_color FROM users WHERE id = ?').get(a);
    const ub = db.prepare('SELECT id, username, avatar_color FROM users WHERE id = ?').get(b);
    if (!ua || !ub) continue;
    const msgs = db.prepare(`
      SELECT m.id, m.content, m.type, m.created_at, m.is_deleted, u.username AS sender
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conv_type='user' AND m.conv_id = ? AND m.is_deleted = 0
      ORDER BY m.id ASC
    `).all(c.conv_id);
    conversations.push({
      conv_id: c.conv_id,
      user_a: ua,
      user_b: ub,
      messages: msgs,
    });
  }

  const groupMsgs = db.prepare(`
    SELECT m.id, m.content, m.type, m.created_at, g.name AS group_name, u.username AS sender
    FROM messages m
    JOIN groups g ON CAST(g.id AS TEXT) = m.conv_id
    JOIN users u ON u.id = m.sender_id
    WHERE m.conv_type='group' AND m.is_deleted = 0
    ORDER BY m.id ASC
  `).all();

  res.json({ ok: true, generated_at: now(), users, conversations, group_messages: groupMsgs });
});

// Delete one account and every trace of it (messages, friendships, requests).
app.post('/api/control/purge-user/:id', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  const uid = Number(req.params.id);
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(uid);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.username === ADMIN_USERNAME) return res.status(400).json({ error: '不能注销管理员 Jack' });

  const tx = db.transaction(() => {
    // messages authored by this user
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(uid);
    // messages addressed to this user in 1:1 chats (now orphaned)
    db.prepare("DELETE FROM messages WHERE conv_type='user' AND conv_id LIKE ?").run('%_' + uid);
    db.prepare("DELETE FROM messages WHERE conv_type='user' AND conv_id LIKE ?").run(uid + '_%');
    db.prepare('DELETE FROM friends WHERE user_id = ? OR friend_id = ?').run(uid, uid);
    db.prepare('DELETE FROM friend_requests WHERE from_user_id = ? OR to_user_id = ?').run(uid, uid);
    db.prepare('DELETE FROM group_members WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM read_receipts WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM message_reactions WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  });
  try {
    tx();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  io.emit('user:purged', { id: uid, username: u.username });
  res.json({ ok: true, purged: u.username });
});

// Factory reset: keep the app working, keep Jack, wipe everything else.
app.post('/api/control/format-all', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  try {
    db.exec(`
      DELETE FROM messages;
      DELETE FROM friends;
      DELETE FROM friend_requests;
      DELETE FROM read_receipts;
      DELETE FROM message_reactions;
      DELETE FROM group_members;
      DELETE FROM users WHERE username <> '${ADMIN_USERNAME}';
      DELETE FROM groups WHERE is_official = 0;
    `);
    OFFICIAL_GROUP_ID = ensureOfficialGroup();
    const jack = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME);
    if (jack) {
      db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
        .run(OFFICIAL_GROUP_ID, jack.id, now());
    }
    io.emit('control:formatted', { at: now() });
    res.json({ ok: true, formatted: true, official_group_id: OFFICIAL_GROUP_ID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/stats', authRequired, requireAdmin, (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    groups: db.prepare('SELECT COUNT(*) AS n FROM groups').get().n,
    messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
    messages_in_official: db.prepare("SELECT COUNT(*) AS n FROM messages m JOIN groups g ON g.id = m.conv_id AND m.conv_type = 'group' WHERE g.is_official = 1").get().n,
    friends: db.prepare('SELECT COUNT(*) AS n FROM friends').get().n,
  };
  res.json({ ok: true, stats });
});
// batch-delete messages (Jack only) — same filters as before
app.post('/api/admin/messages/batch', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  const { group_id, sender_id, before, after, content_contains, official, dry_run } = req.body || {};
  const where = [];
  const params = [];
  if (group_id != null && group_id !== '') { where.push('m.conv_id = ?'); params.push(group_id); }
  if (sender_id != null && sender_id !== '') { where.push('m.sender_id = ?'); params.push(sender_id); }
  if (before != null) { where.push('m.created_at < ?'); params.push(Number(before)); }
  if (after != null) { where.push('m.created_at > ?'); params.push(Number(after)); }
  if (content_contains) { where.push('m.content LIKE ?'); params.push(`%${content_contains}%`); }
  if (official) { where.push("g.is_official = 1"); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const joinSql = official ? "JOIN groups g ON g.id = m.conv_id AND m.conv_type = 'group'" : '';
  const sql = `SELECT m.id FROM messages m ${joinSql} ${whereSql}`;
  const ids = db.prepare(sql).all(...params).map(r => r.id);
  if (!ids.length) return res.json({ ok: true, matched: 0, deleted: 0 });
  if (dry_run) return res.json({ ok: true, matched: ids.length, ids, deleted: 0 });
  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM message_reactions WHERE message_id IN (${placeholders})`).run(...ids);
    return db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids).changes;
  });
  const deleted = tx();
  res.json({ ok: true, matched: ids.length, deleted });
});
// wipe all messages in one group (Jack only)
app.post('/api/admin/messages/wipe-group/:id', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  const gid = Number(req.params.id);
  const ids = db.prepare("SELECT id FROM messages WHERE conv_type = 'group' AND conv_id = ?").all(gid).map(r => r.id);
  if (!ids.length) return res.json({ ok: true, matched: 0, deleted: 0 });
  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM message_reactions WHERE message_id IN (${placeholders})`).run(...ids);
    return db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids).changes;
  });
  const deleted = tx();
  db.prepare("DELETE FROM read_receipts WHERE conv_type = 'group' AND conv_id = ?").run(String(gid));
  try { if (io) io.emit('group:wiped', { group_id: gid }); } catch {}
  res.json({ ok: true, matched: ids.length, deleted });
});
// ============================================================
// Qwen relay — a free-first, multi-source proxy.
//
// Every model the AI panel offers is a Qwen model. The sources come
// in two flavours:
//   • no key at all — OVH's public endpoint answers anonymously, so
//     the panel works the moment the app is deployed;
//   • a free key — SiliconFlow / ModelScope / Groq / Cerebras /
//     DashScope(百炼). The admin pastes a key in the UI; it is stored
//     in the database and takes effect immediately, no redeploy.
//
// The browser never sees a key: every request goes through here.
//
// The response is streamed as NDJSON so the browser can show the
// reasoning trace and the answer as they arrive.
// ============================================================
// Runtime configuration lives in the database so the admin can plug in a
// key from the UI without touching Render's environment variables.
// Table: ai_config(key TEXT PRIMARY KEY, value TEXT)
function aiConfigGet(key) {
  try {
    const row = db.prepare('SELECT value FROM ai_config WHERE key = ?').get(key);
    return row ? row.value : '';
  } catch (_) { return ''; }
}
function aiConfigSet(key, value) {
  db.prepare('INSERT INTO ai_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value === null || value === undefined ? '' : String(value));
}

// --- provider registry -------------------------------------------------
// needKey:false → the endpoint answers anonymously, so the panel works
// out of the box. needKey:true → a (free) key is required; the admin
// pastes it in the UI or sets one of the env vars.
const QWEN_PROVIDERS = {
  ovh: {
    label: 'OVH 公共端点',
    base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    path: '/chat/completions',
    needKey: false,
    env: [],
    note: '匿名可用，无需密钥；同一 IP 每个模型 2 次/分钟'
  },
  siliconflow: {
    label: 'SiliconFlow',
    base: 'https://api.siliconflow.cn/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['RELAY_SILICONFLOW_KEY', 'SILICONFLOW_API_KEY'],
    note: '注册送 14 元，Qwen3-8B 等模型永久免费'
  },
  modelscope: {
    label: '魔搭 ModelScope',
    base: 'https://api-inference.modelscope.cn/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['RELAY_MODELSCOPE_KEY', 'MODELSCOPE_API_KEY'],
    note: '魔搭社区推理 API，注册即免费（需绑定阿里云并实名）'
  },
  groq: {
    label: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['RELAY_GROQ_KEY', 'GROQ_API_KEY'],
    note: 'LPU 推理极快，免费额度 14400 次/天'
  },
  cerebras: {
    label: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['RELAY_CEREBRAS_KEY', 'CEREBRAS_API_KEY'],
    note: '约 2600 tok/s，免费额度 100 万 token/天'
  },
  dashscope: {
    label: '阿里百炼',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['DASHSCOPE_API_KEY', 'RELAY_DASHSCOPE_KEY'],
    note: '通义千问官方，新用户有免费额度；支持联网搜索与思考档位'
  }
};

// --- model catalogue ---------------------------------------------------
// Every entry points at ONE concrete upstream model, so the label the
// user picks is exactly the model that answers.
//   thinking: 'none'   → no thinking control
//            'always' → the endpoint always thinks (cannot be turned off)
//            'toggle' → enable_thinking: true/false
//            'budget' → enable_thinking + thinking_budget (档位)
//   search:   'client' → the server searches and feeds the results in
//            'provider'→ the provider searches (enable_search)
const QWEN_MODELS = [
  // --- 免密钥，开箱即用 ---
  { id: 'ovh-qwen3-6-27b', provider: 'ovh', model: 'Qwen3.6-27B', label: 'Qwen3.6 27B', tag: '免密钥', desc: '开箱即用，27B 通用模型', thinking: 'always', search: 'client' },
  { id: 'ovh-qwen3-5-9b', provider: 'ovh', model: 'Qwen3.5-9B', label: 'Qwen3.5 9B', tag: '免密钥', desc: '最快的一档，延迟最低', thinking: 'always', search: 'client' },
  { id: 'ovh-qwen3-5-397b', provider: 'ovh', model: 'Qwen3.5-397B-A17B', label: 'Qwen3.5 397B-A17B', tag: '免密钥', desc: 'MoE 大模型，匿名即可触达', thinking: 'always', search: 'client' },
  // --- SiliconFlow ---
  { id: 'sf-qwen3-8b', provider: 'siliconflow', model: 'Qwen/Qwen3-8B', label: 'Qwen3 8B', tag: 'SiliconFlow', desc: '永久免费，可开关深度思考', thinking: 'toggle', search: 'client' },
  { id: 'sf-qwen2-5-72b', provider: 'siliconflow', model: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5 72B', tag: 'SiliconFlow', desc: '上一代大参数通用模型', thinking: 'none', search: 'client' },
  // --- 魔搭 ---
  { id: 'ms-qwen3-5-27b', provider: 'modelscope', model: 'Qwen/Qwen3.5-27B', label: 'Qwen3.5 27B', tag: '魔搭', desc: '魔搭社区免费推理', thinking: 'none', search: 'client' },
  { id: 'ms-qwen3-5-35b', provider: 'modelscope', model: 'Qwen/Qwen3.5-35B-A3B', label: 'Qwen3.5 35B-A3B', tag: '魔搭', desc: '魔搭社区免费推理', thinking: 'none', search: 'client' },
  // --- Groq ---
  { id: 'groq-qwen3-32b', provider: 'groq', model: 'qwen3-32b', label: 'Qwen3 32B', tag: 'Groq', desc: 'LPU 极速输出', thinking: 'none', search: 'client' },
  // --- Cerebras ---
  { id: 'cb-qwen3-235b', provider: 'cerebras', model: 'qwen-3-235b-a22b-instruct-2507', label: 'Qwen3 235B', tag: 'Cerebras', desc: '约 2600 tok/s，免费额度高', thinking: 'none', search: 'client' },
  // --- 百炼官方 ---
  { id: 'ds-qwen3-235b', provider: 'dashscope', model: 'qwen3-235b-a22b', label: 'Qwen3 235B', tag: '百炼官方', desc: '官方旗舰，支持思考档位 + 联网搜索', thinking: 'budget', search: 'provider' },
  { id: 'ds-qwen3-max', provider: 'dashscope', model: 'qwen3-max', label: 'Qwen3-Max', tag: '百炼官方', desc: '官方最强，支持思考档位 + 联网搜索', thinking: 'budget', search: 'provider' },
  { id: 'ds-qwen-plus', provider: 'dashscope', model: 'qwen-plus', label: 'Qwen-Plus', tag: '百炼官方', desc: '官方均衡版，支持联网搜索', thinking: 'none', search: 'provider' },
  { id: 'ds-qwen-turbo', provider: 'dashscope', model: 'qwen-turbo', label: 'Qwen-Turbo', tag: '百炼官方', desc: '官方极速版，支持联网搜索', thinking: 'none', search: 'provider' },
  { id: 'ds-qwen-flash', provider: 'dashscope', model: 'qwen-flash', label: 'Qwen-Flash', tag: '百炼官方', desc: '官方轻量版，最省额度', thinking: 'none', search: 'provider' }
];

// 上游超时：免费端点偶尔连上了却不出声，必须自己先放弃。
const UPSTREAM_FIRST_TOKEN_MS = 40000;   // 第一个 token 的最长等待
const UPSTREAM_TOTAL_MS = 120000;        // 整个上游请求的最长时间
// 一个源最多试几次：配额类的 429 值得重试，沉默的源试一次就换人。
const MAX_TIMEOUT_ATTEMPTS = 2;
// 思考链超过这个长度还没正文，就当这个模型想不出答案了。
const REASON_LIMIT = 12000;

// 思考档位 → thinking_budget（token 数）
const THINK_BUDGETS = { low: 1024, medium: 4096, high: 16384 };

// The key for a provider: env var first, then the database.
function aiProviderKey(pid) {
  const p = QWEN_PROVIDERS[pid];
  if (!p) return '';
  for (const envName of (p.env || [])) {
    const v = process.env[envName];
    if (v && String(v).trim()) return String(v).trim();
  }
  return String(aiConfigGet('ai_key_' + pid) || '').trim();
}

// A provider is usable when it needs no key, or when a key is present.
function aiProviderReady(pid) {
  const p = QWEN_PROVIDERS[pid];
  if (!p) return false;
  return !p.needKey || !!aiProviderKey(pid);
}

// The catalogue as the browser sees it.
function aiModelCatalog() {
  return QWEN_MODELS.map((m) => {
    const p = QWEN_PROVIDERS[m.provider];
    return {
      id: m.id,
      label: m.label,
      model: m.model,
      tag: m.tag,
      desc: m.desc,
      provider: m.provider,
      providerLabel: p ? p.label : m.provider,
      thinking: m.thinking,
      search: m.search,
      ready: aiProviderReady(m.provider)
    };
  });
}

// Build the upstream body for one catalogue entry.
function buildQwenBody(entry, opts) {
  const body = {
    model: entry.model,
    messages: opts.messages,
    stream: true,
    temperature: 0.7
  };
  const wantThink = !!opts.thinking;
  const budget = THINK_BUDGETS[opts.level] || THINK_BUDGETS.medium;

  if (entry.thinking === 'budget') {
    // DashScope hybrid models: think or not, and how long to think.
    body.enable_thinking = wantThink;
    if (wantThink) body.thinking_budget = budget;
    // max_tokens must leave room for the answer on top of the thinking.
    body.max_tokens = wantThink ? Math.max(8192, budget + 4096) : 2048;
  } else if (entry.thinking === 'toggle') {
    body.enable_thinking = wantThink;
    body.max_tokens = 4096;
  } else if (entry.thinking === 'always') {
    // The endpoint always thinks; the trace is streamed back to the UI.
    // The trace alone can eat 2-3k tokens, so give it real headroom —
    // otherwise the model thinks itself out of the answer and says nothing.
    body.max_tokens = 8192;
  } else {
    body.max_tokens = 2048;
  }

  // Provider-side search (百炼 enable_search).
  if (entry.search === 'provider' && opts.search) body.enable_search = true;

  return body;
}

// Strip tags from an HTML snippet.
function stripHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}


// Words that say nothing about the topic. Without this list every result
// "matched" because the query contained words like "the" and "one".
const SEARCH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'of', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its',
  'this', 'that', 'these', 'those', 'as', 'by', 'from', 'you', 'your', 'i',
  'we', 'they', 'he', 'she', 'do', 'does', 'did', 'has', 'have', 'had',
  'will', 'would', 'can', 'could', 'should', 'what', 'who', 'whom', 'which',
  'when', 'where', 'why', 'how', 'tell', 'give', 'answer', 'sentence',
  'one', 'plus', 'also', 'just', 'very', 'much', 'many', 'more', 'most',
  'some', 'any', 'all', 'both', 'each', 'few', 'other', 'such', 'than',
  'then', 'there', 'their', 'them', 'same', 'only', 'own', 'too',
  'source', 'please', 'about', 'me', 'my', 'our', 'not', 'no', 'so',
  '一个', '一句', '请', '告诉', '回答', '来源', '句子', '一下'
]);

// Does a result actually look like it is about the query? Chinese search
// engines sometimes answer a long Chinese question with dictionary
// entries for a single character ("通_百度百科" for a question about
// 通义千问), so a result must share a real term with the query — a
// two-character CJK fragment or a distinctive Latin word — to be kept.
function searchTerms(query) {
  const terms = [];
  const q = String(query || '');
  // CJK runs → 2-grams (通义千问 → 通义 / 义千 / 千问)
  for (const run of (q.match(/[\u4e00-\u9fff]+/g) || [])) {
    if (run.length === 1) { terms.push(run); continue; }
    for (let i = 0; i < run.length - 1; i++) terms.push(run.slice(i, i + 2));
  }
  // Latin / digit words — but only the distinctive ones. Trailing
  // punctuation has to go ("source." must still match the stop word
  // "source", otherwise the instruction leaks into the query).
  for (const raw of (q.toLowerCase().match(/[a-z0-9][a-z0-9._+-]*/g) || [])) {
    const w = raw.replace(/[._+-]+$/, '');
    if (w.length >= 3 && !SEARCH_STOPWORDS.has(w)) terms.push(w);
  }
  return terms;
}

// The question the user asked is not always the best thing to hand to a
// search engine: "Who won the 2022 World Cup? One sentence plus the source."
// drags the instruction along. Take the question part first, and keep a
// keyword-only version as a second try.
function searchVariants(raw) {
  const q = String(raw || '').trim();
  const variants = [];
  const m = q.match(/^[^?？]*[?？]/);
  if (m && m[0].trim().length >= 5) variants.push(m[0].replace(/[?？]\s*$/, '').trim());
  else variants.push(q.slice(0, 120));
  // Keyword-only fallback: drop the stop words, keep what identifies the topic.
  const cjk = (q.match(/[\u4e00-\u9fff]+/g) || []).join('');
  const words = (q.toLowerCase().match(/[a-z0-9][a-z0-9._+-]*/g) || [])
    .map((w) => w.replace(/[._+-]+$/, ''))
    .filter((w) => w.length >= 3 && !SEARCH_STOPWORDS.has(w));
  const kw = [cjk ? cjk.slice(0, 24) : '', words.slice(0, 8).join(' ')].filter(Boolean).join(' ').trim();
  if (kw && kw !== variants[0]) variants.push(kw);
  return variants;
}

function resultMatches(result, terms) {
  if (!terms.length) return true;
  const hay = ((result && result.title) || '').toLowerCase() + ' ' +
              ((result && result.snippet) || '').toLowerCase() + ' ' +
              ((result && result.url) || '').toLowerCase();
  return terms.some((t) => hay.includes(String(t).toLowerCase()));
}

const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// One engine must never hold the whole request hostage.
const SEARCH_TIMEOUT_MS = 7000;

// Web search for the 搜索 button. No key is required: the engines below
// are scraped from the server. If the admin pastes a Tavily key the
// result quality is noticeably better, so that one is tried first.
//
// Every engine is wrapped in a timeout: a blocked or slow engine must
// not turn a chat reply into a half-minute wait.
async function webSearch(query, limit) {
  const out = [];
  const q = String(query || '').trim();
  if (!q) return out;
  const max = Math.max(1, Math.min(Number(limit) || 5, 8));
  const terms = searchTerms(q);

  const collect = (items) => {
    let kept = 0;
    for (const it of items) {
      if (out.length >= max) break;
      if (!resultMatches(it, terms)) continue;
      out.push(it);
      kept++;
    }
    return kept;
  };

  const fetchText = async (url, headers) => {
    try {
      const r = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
      if (!r.ok) return '';
      return await r.text();
    } catch (_) { return ''; }
  };

  // Run every keyless engine against one query string.
  const runEngines = async (queryStr) => {
    const items = [];

    // 1) Tavily — optional, best quality.
    const tavilyKey = String(process.env.TAVILY_API_KEY || aiConfigGet('ai_key_tavily') || '').trim();
    if (tavilyKey) {
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query: queryStr, max_results: max }),
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
        });
        if (r.ok) {
          const j = await r.json();
          for (const it of (j.results || [])) {
            items.push({ title: it.title || '', url: it.url || '', snippet: String(it.content || '').slice(0, 400) });
          }
        }
      } catch (_) { /* fall through to the keyless engines */ }
    }

    // 2) DuckDuckGo HTML — no key, and it handles Chinese well.
    {
      const html = await fetchText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(queryStr), { 'User-Agent': SEARCH_UA });
      if (html) {
        const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = re.exec(html)) && items.length < max) {
          let url = m[1];
          const um = url.match(/[?&]uddg=([^&]+)/);
          if (um) { try { url = decodeURIComponent(um[1]); } catch (_) {} }
          items.push({
            title: stripHtml(m[2]).slice(0, 160),
            url,
            snippet: stripHtml(m[3]).slice(0, 400)
          });
        }
      }
    }

    // 3) Bing HTML — no key.
    {
      const html = await fetchText(
        'https://www.bing.com/search?q=' + encodeURIComponent(queryStr) + '&setlang=zh-hans',
        { 'User-Agent': SEARCH_UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }
      );
      if (html) {
        for (const b of html.split('<li class="b_algo"').slice(1)) {
          const m = b.match(/<h2>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
          if (!m) continue;
          const sn = b.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
          items.push({
            title: stripHtml(m[2]).slice(0, 160),
            url: m[1],
            snippet: sn ? stripHtml(sn[1]).slice(0, 400) : ''
          });
          if (items.length >= max) break;
        }
      }
    }

    // 4) DuckDuckGo instant answer — no key, structured JSON.
    {
      const html = await fetchText(
        'https://api.duckduckgo.com/?q=' + encodeURIComponent(queryStr) + '&format=json&no_html=1',
        { 'User-Agent': SEARCH_UA }
      );
      if (html) {
        try {
          const j = JSON.parse(html);
          if (j && j.AbstractText) {
            items.push({ title: String(j.Heading || queryStr).slice(0, 160), url: j.AbstractURL || '', snippet: String(j.AbstractText).slice(0, 400) });
          }
          for (const t of (j.RelatedTopics || [])) {
            if (items.length >= max) break;
            if (t && t.Text && t.FirstURL) {
              items.push({ title: String(t.Text).split(' - ')[0].slice(0, 160), url: t.FirstURL, snippet: String(t.Text).slice(0, 400) });
            }
          }
        } catch (_) { /* not JSON — ignore */ }
      }
    }

    return items;
  };

  // Try the question as asked first; if that produced nothing usable, try
  // the keyword-only version.
  for (const variant of searchVariants(q)) {
    const items = await runEngines(variant);
    if (collect(items)) return out;
  }

  return out;
}

// Turn a noisy upstream error into one readable line.
function summarizeUpstreamError(text) {
  if (!text) return '未知错误';
  let msg = String(text);
  // Pull the upstream's own message field if there is one.
  const m = msg.match(/"message"\s*:\s*"([^"]+)"/);
  if (m) msg = m[1];
  else if (/<[^>]+>/.test(msg)) msg = msg.replace(/<[^>]+>/g, ' ');
  msg = msg.replace(/\s+/g, ' ').trim();
  if (/Daily token quota exceeded/i.test(msg)) msg = '免费源的每日额度已用完，请稍后再试或接入自己的密钥';
  else if (/previous request is still running|RATE_LIMITED/i.test(msg)) msg = '请求过于频繁，请稍后再试';
  else if (/rate limit|too many requests|429/i.test(msg)) msg = '请求过于频繁，请稍后再试';
  else if (/concurrent/i.test(msg)) msg = '并发过高，请稍后再试';
  else if (/insufficient_quota|402/i.test(msg)) msg = '余额不足';
  else if (/401|invalid_api_key|Missing API key/i.test(msg)) msg = '密钥无效';
  else if (/model_not_found|model_unavailable|not exist/i.test(msg)) msg = '该模型当前不可用';
  return msg.length > 90 ? msg.slice(0, 90) + '…' : msg;
}

// Read an OpenAI-compatible SSE stream and forward each chunk as
// {type:'reasoning'|'delta'|'done', text} NDJSON lines.
//
// Node 18's global fetch (undici) returns a WHATWG ReadableStream, not a
// Node Readable — it has no .on('data'), only .getReader(). Reading it the
// Node way threw "upstreamBody.on is not a function" and every relay
// source failed. Support both shapes so the code also works on Node 20+.
function relayStream(res, upstreamBody, source, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let done = false;
    // Watchdog: a free upstream can accept the connection and then never
    // say a word. If the FIRST chunk does not arrive in time, kill it and
    // let the caller move on to the next source — otherwise one stalled
    // endpoint holds the whole reply hostage.
    let firstTimer = setTimeout(() => {
      // Abort the upstream; the reader below will throw and the route
      // moves on to the next source. The response is NOT ended here —
      // the caller may still have other sources to try.
      try { if (o.abort) o.abort(); } catch (_) {}
      finish('first_token_timeout');
    }, o.firstTokenMs || 50000);
    let firstAnnounced = false;
    const onFirstChunk = () => {
      if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
      // onFirst must fire ONCE, not on every chunk.
      if (firstAnnounced) return;
      firstAnnounced = true;
      if (o.onFirst) { try { o.onFirst(); } catch (_) {} }
    };
    // On success the response is closed here. On failure it is left open
    // so the caller can fall back to another source; the caller closes it
    // once every source has been tried.
    const finish = (err) => {
      if (done) return;
      done = true;
      if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
      if (!err) {
        try { res.write(JSON.stringify({ type: 'done', source: source.name, error: null }) + '\n'); } catch (_) {}
        try { res.end(); } catch (_) {}
      }
      resolve(err ? { ok: false, error: err } : { ok: true, error: null });
    };
    const write = (obj) => {
      try { res.write(JSON.stringify(obj) + '\n'); } catch (_) { finish('write_failed'); }
    };

    // Parse an SSE buffer into relay events.
    let buf = '';
    const consume = (chunkText) => {
      buf += chunkText;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let j;
        try { j = JSON.parse(payload); } catch (_) { continue; }
        const ch = j.choices && j.choices[0];
        if (!ch) continue;
        const d = ch.delta || {};
        // Qwen's thinking models expose the chain-of-thought in
        // `reasoning`; some OpenAI-compatible gateways use
        // `reasoning_content` instead. Accept both.
        const think = d.reasoning || d.reasoning_content || null;
        if (think) {
          onFirstChunk();
          if (o.onReasoning) { try { o.onReasoning(String(think)); } catch (_) {} }
          write({ type: 'reasoning', text: String(think) });
        }
        if (d.content) {
          onFirstChunk();
          if (o.onDelta) { try { o.onDelta(String(d.content)); } catch (_) {} }
          write({ type: 'delta', text: String(d.content) });
        }
      }
    };

    // --- WHATWG stream (Node 18+ global fetch) ---
    if (upstreamBody && typeof upstreamBody.getReader === 'function') {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { value, done: rdone } = await reader.read();
            if (rdone) break;
            consume(decoder.decode(value, { stream: true }));
          }
          finish(null);
        } catch (e) {
          finish(String((e && e.message) || e));
        }
      })();
      return;
    }

    // --- Node Readable (older runtimes / proxies) ---
    if (upstreamBody && typeof upstreamBody.on === 'function') {
      upstreamBody.on('data', (chunk) => consume(chunk.toString('utf8')));
      upstreamBody.on('end', () => finish(null));
      upstreamBody.on('error', (e) => finish(String(e.message || e)));
      return;
    }

    finish('upstream body is not readable');
  });
}

app.post('/api/ai/chat', rateLimit('write'), authRequired, async (req, res) => {
  const { message, history, model, thinking, level, search } = req.body || {};
  const userMsg = String(message || '').trim();
  if (!userMsg) return res.status(400).json({ error: '消息不能为空' });

  const wantThink = thinking === true || thinking === 'true' || thinking === 'on';
  const wantSearch = search === true || search === 'true' || search === 'on';
  const thinkLevel = ['low', 'medium', 'high'].includes(String(level)) ? String(level) : 'medium';

  // The chain: the model the user picked first, then every other model
  // whose provider is ready. If the picked model has no key yet (or its
  // endpoint is down) the request still gets an answer, and the client
  // is told which model actually replied.
  const catalog = aiModelCatalog();
  const wanted = catalog.find((m) => m.id === String(model || ''));
  const chain = [];
  if (wanted && wanted.ready) chain.push(wanted);
  for (const m of catalog) {
    if (wanted && m.id === wanted.id) continue;
    if (!m.ready) continue;
    chain.push(m);
  }
  if (!chain.length) {
    return res.status(503).json({ error: '没有可用的 Qwen 源，请在设置里接入一个免费密钥' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  // Build a small conversation from the last few user turns.
  const msgs = [];
  const hist = Array.isArray(history) ? history.slice(-8) : [];
  for (const h of hist) {
    if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim()) {
      msgs.push({ role: h.role, content: h.content.slice(0, 4000) });
    }
  }
  msgs.push({ role: 'user', content: userMsg.slice(0, 4000) });

  // The system prompt. When 搜索 is on, the live results are appended to
  // it so the model can actually ground its answer.
  const BASE_SYSTEM = '你是 VVeChat 内置的通义千问（Qwen）助手。请用简体中文回答，简洁、直接、有条理；不确定的地方要明说。';
  let searchCtx = null;
  const getSearchCtx = async () => {
    if (searchCtx !== null) return searchCtx;
    const q = userMsg.slice(0, 200);
    const results = await webSearch(q, 5);
    // Tell the client the search really happened — otherwise a model that
    // already knew the answer looks exactly like one that never searched.
    try {
      res.write(JSON.stringify({ type: 'search', count: results.length, query: q }) + '\n');
    } catch (_) {}
    if (!results.length) {
      searchCtx = '\n\n【联网搜索】本次搜索没有取到结果，请基于你已有的知识回答，并提醒用户信息可能不是最新的。';
      return searchCtx;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    searchCtx = '\n\n【联网搜索结果】以下是关于「' + q + '」的实时搜索结果（' + stamp + ' UTC）。' +
      '请优先依据这些内容回答，并在结尾用「参考来源」列出用到的标题 + 链接。' +
      '如果这些结果与问题无关，请直接说明没有查到相关信息，不要硬套：\n' +
      results.map((r, i) => (i + 1) + '. ' + r.title + '\n   ' + r.url + '\n   ' + r.snippet).join('\n');
    return searchCtx;
  };

  const errors = [];
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const provider = QWEN_PROVIDERS[entry.provider];
    const key = aiProviderKey(entry.provider);
    const source = { name: entry.provider, model: entry.model };

    // 百炼 cannot search natively while it is thinking, so in that case
    // the search is done here instead.
    const nativeSearch = entry.search === 'provider' && wantSearch && !(entry.thinking === 'budget' && wantThink);
    if (nativeSearch) {
      // The provider does the searching itself; we only know it was asked to.
      try {
        res.write(JSON.stringify({ type: 'search', count: -1, query: userMsg.slice(0, 200), provider: true }) + '\n');
      } catch (_) {}
    }

    const messages = [{ role: 'system', content: BASE_SYSTEM }];
    if (wantSearch && !nativeSearch) {
      try { messages[0].content += await getSearchCtx(); } catch (_) {}
    }
    for (const m of msgs) messages.push(m);

    // The public tiers are shared and heavily rate-limited, so every
    // source gets a couple of attempts with a growing backoff. The
    // upstream's own "retry after N seconds" hint is honoured.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let wrote = false;
      let ac = null;
      let hardKill = null;
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (key) headers['Authorization'] = `Bearer ${key}`;
        const body = buildQwenBody(entry, { messages, thinking: wantThink, level: thinkLevel, search: nativeSearch });
        const url = `${provider.base}${provider.path || '/chat/completions'}`;
        // A free endpoint can accept the connection and then go quiet.
        // The abort signal makes sure such a request cannot hang forever.
        ac = new AbortController();
        hardKill = setTimeout(() => { try { ac.abort(); } catch (_) {} }, UPSTREAM_TOTAL_MS);
        const upstream = await fetch(url, {
          method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal
        });
        if (!upstream.ok) {
          clearTimeout(hardKill);
          const txt = await upstream.text().catch(() => '');
          const retryAfter = Number(upstream.headers.get('retry-after')) || 0;
          const quotaHit = /429|quota|RATE_LIMIT|rate limit/i.test(upstream.status + txt);
          errors.push(`${entry.label}: HTTP ${upstream.status} ${summarizeUpstreamError(txt)}`);
          if (!quotaHit || attempt === MAX_ATTEMPTS) break;
          // Wait before the next attempt. Respect the upstream hint, but
          // cap it so a request never hangs for minutes.
          const wait = Math.min(retryAfter > 0 ? retryAfter * 1000 : 1200 * attempt, 8000);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        // Tell the client which model answered, then stream the payload.
        // The event is sent with the FIRST chunk, not before the request:
        // if the upstream stalls, no model is announced and the next
        // source in the chain gets its turn.
        // `fallback` is true whenever the model that answered is NOT the one
        // the user picked — the UI says so, instead of silently swapping.
        let gotContent = false;
        let reasonLen = 0;
        let gaveUp = false;
        const result = await relayStream(res, upstream.body, source, {
          onReasoning: (t) => {
            reasonLen += t.length;
            // Some models think forever and never answer. Once the trace
            // is this long with no answer in sight, give up on them.
            if (!gotContent && reasonLen > REASON_LIMIT) {
              gaveUp = true;
              try { ac.abort(); } catch (_) {}
            }
          },
          abort: () => { try { ac.abort(); } catch (_) {} },
          firstTokenMs: UPSTREAM_FIRST_TOKEN_MS,
          onDelta: (t) => { if (String(t || '').trim()) gotContent = true; },
          onFirst: () => {
            wrote = true;
            res.write(JSON.stringify({
              type: 'source',
              source: entry.provider,
              provider: entry.providerLabel,
              model: entry.model,
              label: entry.label,
              free: true,
              fallback: !!wanted && entry.id !== wanted.id
            }) + '\n');
          }
        });
        clearTimeout(hardKill);
        if (result && result.ok) {
          // A model that thought a lot but never wrote an answer is a
          // failure, not a reply — try the next source instead of showing
          // the user an empty bubble. Retrying the same model would not
          // help, so move on right away.
          if (!gotContent) {
            errors.push(`${entry.label}: 只返回了思考过程，没有正文`);
            break;
          }
          return;
        }
        // The source stalled or died mid-stream. Nothing was written to
        // the client yet, so the next source in the chain gets a turn.
        const err = (result && result.error) || 'stream_failed';
        errors.push(`${entry.label}: ${err}`);
        if (gaveUp) {
          // We gave up on this model on purpose. Tell the client to drop
          // the dead-end trace, then move on — the user must still get an
          // answer from the next source.
          try { res.write(JSON.stringify({ type: 'reset' }) + '\n'); } catch (_) {}
          wrote = false;
        } else if (wrote) {
          try { res.end(); } catch (_) {}
          return;
        }
        // A silent upstream is not worth three rounds of waiting.
        if (err === 'first_token_timeout' && attempt >= MAX_TIMEOUT_ATTEMPTS) break;
        if (attempt === MAX_ATTEMPTS) break;
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      } catch (e) {
        if (hardKill) clearTimeout(hardKill);
        errors.push(`${entry.label}: ${e.message || e}`);
        // Something was already streamed to the client — the answer is
        // incomplete but real, so end it here instead of switching models
        // mid-sentence.
        if (wrote) { try { res.end(); } catch (_) {} return; }
        if (attempt === MAX_ATTEMPTS) break;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    // A short pause before the next source: hammering a shared endpoint
    // right after it refused us is what gets the whole IP throttled.
    await new Promise(r => setTimeout(r, 600));
  }
  try {
    // Keep the message short — the raw upstream JSON is unreadable on a
    // phone and used to fill the whole screen with red text.
    const reason = summarizeUpstreamError(errors.join(' | '));
    res.write(JSON.stringify({
      type: 'error',
      message: '所有 Qwen 中转源都失败了：' + reason,
      detail: errors.slice(0, 6)
    }) + '\n');
    res.end();
  } catch (_) {}
});

// Report the catalogue and which providers are configured (no keys leaked).
app.get('/api/ai/status', authRequired, (req, res) => {
  const models = aiModelCatalog();
  const ready = models.filter((m) => m.ready);
  res.json({
    ok: ready.length > 0,
    defaultModel: (models.find((m) => m.ready && m.id === 'ovh-qwen3-6-27b') || ready[0] || {}).id,
    models,
    providers: Object.keys(QWEN_PROVIDERS).map((pid) => ({
      id: pid,
      label: QWEN_PROVIDERS[pid].label,
      note: QWEN_PROVIDERS[pid].note,
      needKey: QWEN_PROVIDERS[pid].needKey,
      ready: aiProviderReady(pid),
      hasKey: !!aiProviderKey(pid)
    }))
  });
});

// Admin-only: plug in a relay key from the UI. Stored in the database, so
// no redeploy and no environment-variable editing is needed.
app.post('/api/ai/config', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  const { source, key } = req.body || {};
  const allowed = Object.keys(QWEN_PROVIDERS).concat(['tavily']);
  if (!allowed.includes(source)) return res.status(400).json({ error: '未知的源' });
  if (key === null || key === '') {
    aiConfigSet('ai_key_' + source, '');
  } else {
    const k = String(key).trim();
    if (k.length < 8 || k.length > 300) return res.status(400).json({ error: '密钥格式不正确' });
    aiConfigSet('ai_key_' + source, k);
  }
  res.json({ ok: true, models: aiModelCatalog() });
});

// Remove a member from a group. Allowed for the group owner and for Jack.

// register
app.post('/api/register', rateLimit('auth'), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 2 || username.length > 24) return res.status(400).json({ error: '用户名长度需 2-24' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  // Relaxed uniqueness: allow registration if EITHER the username OR the
  // password does not collide with any existing account. This means a user
  // can have multiple accounts as long as one of the two fields differs.
  const exact = db.prepare(
    'SELECT id FROM users WHERE username = ? AND password_hash = ?'
  ).get(username, password);
  if (exact) return res.status(409).json({ error: '该用户名+密码组合已存在' });
  const sameBoth = db.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).get(username);
  const samePwd = db.prepare(
    'SELECT id FROM users WHERE password_hash = ?'
  ).get(bcrypt.hashSync(password, 10));
  if (sameBoth && samePwd) {
    return res.status(409).json({ error: '用户名和密码都已被注册（请至少修改一项）' });
  }

  // pick a fun color for new users (Jack is the official admin → signature gold)
  const palette = ['#5eead4','#60a5fa','#c084fc','#f472b6','#fbbf24','#fb923c','#4ade80','#22d3ee','#a78bfa','#f87171'];
  const color = username === 'Jack' ? '#fbbf24' : palette[Math.floor(Math.random() * palette.length)];

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, avatar, bio, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(username, hash, null, '', color, now());
  const userId = info.lastInsertRowid;
  // auto-join official group
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(OFFICIAL_GROUP_ID, userId, now());
  const token = jwt.sign({ uid: userId, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: userPublic({ id: userId, username, avatar: null, bio: '', avatar_color: color }) });
});

// login
app.post('/api/login', rateLimit('auth'), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) { noteAuthFailure(req); return res.status(401).json({ error: '账号不存在' }); }
  if (!bcrypt.compareSync(password, u.password_hash)) {
    noteAuthFailure(req);
    return res.status(401).json({ error: '密码错误' });
  }
  // re-join official group if previously removed
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(OFFICIAL_GROUP_ID, u.id, now());
  const token = jwt.sign({ uid: u.id, username: u.username }, JWT_SECRET, { expiresIn: '30d' });
  // Successful login clears this IP's failure counter.
  try { const b = RATE_BUCKETS.get(clientIp(req)); if (b) b.authFail = 0; } catch (_) {}
  res.json({ token, user: userPublic(u) });
});

// me / profile
app.get('/api/me', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  res.json({ user: userPublic(u) });
});

app.put('/api/me', rateLimit('write'), authRequired, (req, res) => {
  const { bio, username, avatar_color, avatar, avatar_emoji } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  const updates = [];
  const values = [];
  if (typeof bio === 'string') {
    if (bio.length > 200) return res.status(400).json({ error: '简介不超过 200 字' });
    updates.push('bio = ?'); values.push(bio);
  }
  // avatar_color: user can now pick (any CSS color string, max 32 chars)
  if (typeof avatar_color === 'string' && avatar_color.trim()) {
    const c = avatar_color.trim();
    if (c.length > 32) return res.status(400).json({ error: '颜色格式无效' });
    updates.push('avatar_color = ?'); values.push(c);
  }
  // avatar: data URL (data:image/...;base64,...) or null/empty to clear
  if (typeof avatar === 'string') {
    if (avatar === '' || avatar === null) {
      updates.push('avatar = ?'); values.push(null);
    } else {
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(avatar)) {
        return res.status(400).json({ error: '头像图片格式不支持（仅 PNG/JPG/WebP/GIF）' });
      }
      // base64 payload size check (~2.5MB max → 3.3MB b64)
      const b64 = avatar.split(',')[1] || '';
      if (b64.length > 3.5 * 1024 * 1024) {
        return res.status(413).json({ error: '头像图片过大（>2.5MB）' });
      }
      updates.push('avatar = ?'); values.push(avatar);
    }
  }
  // avatar_emoji: a single emoji character, or empty to clear it.
  if (avatar_emoji !== undefined) {
    if (avatar_emoji === null || avatar_emoji === '') {
      updates.push('avatar_emoji = ?'); values.push(null);
    } else {
      const e = String(avatar_emoji).trim();
      // One code point (emoji may be a surrogate pair), max 8 chars overall.
      if ([...e].length > 1 || e.length > 8) {
        return res.status(400).json({ error: '请选择单个 emoji' });
      }
      updates.push('avatar_emoji = ?'); values.push(e);
    }
  }
  if (typeof username === 'string' && username.trim() && username !== u.username) {
    if (username.length < 2 || username.length > 24) return res.status(400).json({ error: '用户名长度需 2-24' });
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, u.id);
    if (existing) return res.status(409).json({ error: '该用户名已被使用' });
    updates.push('username = ?'); values.push(username);
  }
  if (!updates.length) return res.json({ user: userPublic(u) });
  values.push(u.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  // notify friends about profile change so avatars/badges can refresh
  const friends = getFriends(u.id);
  for (const f of friends) io.to(`user:${f}`).emit('user:updated', userPublic(fresh));
  res.json({ user: userPublic(fresh) });
});

// search users (substring match — typing any part of a username finds it)
app.get('/api/users/search', authRequired, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ users: [] });
  const rows = db.prepare(
    'SELECT id, username, avatar, bio, avatar_color FROM users WHERE username LIKE ? AND id != ? ORDER BY username LIMIT 20'
  ).all(`%${q}%`, req.user.id);
  res.json({ users: rows });
});

// search groups to join (substring match)

// online status of specific users
app.get('/api/users/status', authRequired, (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => Number(s)).filter(Boolean);
  if (!ids.length) return res.json({ status: {} });
  const status = {};
  for (const id of ids) status[id] = onlineUsers.has(id);
  res.json({ status });
});

// friends
app.get('/api/friends', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio, u.avatar_color
    FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.username
  `).all(req.user.id);
  res.json({ friends: rows });
});

// groups (joined)
app.get('/api/groups', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT g.id, g.name, g.is_official, g.owner_id, g.icon_color, g.recommended, g.pinned, g.announcement,
           (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY g.is_official DESC, g.id ASC
  `).all(req.user.id);
  res.json({ groups: rows });
});

// create group

// group members
// Can `user` manage this group's membership? Owner or the built-in admin (Jack).
function canManageGroup(user, group) {
  if (!user || !group) return false;
  if (isAdmin(user)) return true;
  return Number(group.owner_id) === Number(user.id);
}

app.get('/api/groups/:id/members', authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const inGroup = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, req.user.id);
  if (!inGroup) return res.status(403).json({ error: 'not in group' });
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio, u.avatar_color
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY u.username
  `).all(gid);
  res.json({ members: rows });
});

// ------------------------------------------------------------
// Group administration (the official group only).
//
// The user-created-group feature was removed, but Jack still needs to
// manage the official group: pull people in, remove them, rename it and
// set the notice. The frontend still calls these endpoints, so they are
// restored here — scoped to the official group so no second group can be
// created behind the scenes.
function isOfficialGroup(gid) {
  const row = db.prepare('SELECT id FROM groups WHERE id = ? AND is_official = 1').get(Number(gid));
  return !!row;
}

// Pull a member in. Owner or Jack only.
app.post('/api/groups/:id/members', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  if (!isOfficialGroup(gid)) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, db.prepare('SELECT * FROM groups WHERE id = ?').get(gid))) {
    return res.status(403).json({ error: '只有群主或管理员可以添加成员' });
  }
  const memberId = Number((req.body || {}).memberId);
  if (!Number.isFinite(memberId)) return res.status(400).json({ error: '成员无效' });
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(memberId);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(gid, memberId, now());
  try { if (io) io.to(`group:${gid}`).emit('group:member-added', { group_id: gid, user_id: memberId }); } catch {}
  res.json({ ok: true });
});

// Remove a member. Owner or Jack only.
app.delete('/api/groups/:id/members/:uid', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const uid = Number(req.params.uid);
  if (!isOfficialGroup(gid)) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, db.prepare('SELECT * FROM groups WHERE id = ?').get(gid))) {
    return res.status(403).json({ error: '只有群主或管理员可以移除成员' });
  }
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(gid, uid);
  try { if (io) io.to(`group:${gid}`).emit('group:member-removed', { group_id: gid, user_id: uid }); } catch {}
  res.json({ ok: true });
});

// Members that are NOT in this group yet — powers the "添加成员" picker.
app.get('/api/groups/:gid/candidates', authRequired, (req, res) => {
  const gid = Number(req.params.gid);
  if (!isOfficialGroup(gid)) return res.status(404).json({ error: '群不存在' });
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar_color FROM users u
    WHERE u.id != ? AND u.id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?)
    ORDER BY u.username LIMIT 100
  `).all(req.user.id, gid);
  res.json({ candidates: rows });
});

// Rename the official group. Jack only (the name is a shared label).
app.put('/api/groups/:id', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  const gid = Number(req.params.id);
  if (!isOfficialGroup(gid)) return res.status(404).json({ error: '群不存在' });
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: '群名称不能为空' });
  if (name.length > 40) return res.status(400).json({ error: '群名称不超过 40 字' });
  db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, gid);
  try { if (io) io.emit('group:renamed', { groupId: gid, name }); } catch {}
  res.json({ ok: true, group: { id: gid, name } });
});

// Announcement. Jack only.
app.post('/api/groups/:id/announcement', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  const gid = Number(req.params.id);
  if (!isOfficialGroup(gid)) return res.status(404).json({ error: '群不存在' });
  const text = String((req.body || {}).text || '').trim();
  if (text.length > 500) return res.status(400).json({ error: '公告不超过 500 字' });
  db.prepare('UPDATE groups SET announcement = ? WHERE id = ?').run(text || null, gid);
  try { if (io) io.emit('group:announcement', { groupId: gid, announcement: text }); } catch {}
  res.json({ ok: true });
});

// Re-join the official group (self-service, used by the empty-state CTA).
app.post('/api/groups/:id/join', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  if (!isOfficialGroup(gid)) return res.status(404).json({ error: '群不存在' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(gid, req.user.id, now());
  res.json({ ok: true });
});

// Add a member to a group. Owner or Jack only.

// List users who are NOT yet in this group — powers the "add member" picker.

// Update group name. Only the official group requires Jack; regular groups allow any member.

// Leave a group

// Disband a group (Jack / owner)

// Discover: list recommended public groups (not joined yet)

// self-join a public group (any logged-in user can join)

// friend requests
// Send (or auto-accept) a friend request from me to `target`.
// Shared by the username-search flow and the "tap avatar in a group" flow.
function sendFriendRequest(me, target) {
  if (!target) return { status: 404, body: { error: '该用户不存在' } };
  if (target.id === me.id) return { status: 400, body: { error: '不能加自己' } };
  const already = db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(me.id, target.id);
  if (already) return { status: 400, body: { error: '已经是好友了' } };
  const pending = db.prepare(
    "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(me.id, target.id);
  if (pending) return { status: 400, body: { error: '已发送过申请，等待对方处理' } };
  const reverse = db.prepare(
    "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(target.id, me.id);
  if (reverse) {
    db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(reverse.id);
    const ts = now();
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(me.id, target.id, ts);
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(target.id, me.id, ts);
    io.to(`user:${me.id}`).emit('friend:added', { id: target.id, username: target.username, avatar: target.avatar, avatar_color: target.avatar_color });
    io.to(`user:${target.id}`).emit('friend:added', { id: me.id, username: me.username, avatar: me.avatar, avatar_color: me.avatar_color });
    return { status: 200, body: { ok: true, autoAccepted: true } };
  }
  const info = db.prepare(
    'INSERT INTO friend_requests (from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, ?)'
  ).run(me.id, target.id, 'pending', now());
  io.to(`user:${target.id}`).emit('friend:request', {
    id: info.lastInsertRowid,
    from: { id: me.id, username: me.username, avatar: me.avatar, avatar_color: me.avatar_color },
    created_at: now(),
  });
  return { status: 200, body: { ok: true, requestId: info.lastInsertRowid } };
}

// Existing flow: look the user up by username.
// Minimal public profile lookup — used when you tap an avatar of someone
// you have not befriended yet (e.g. a fellow member of a group).
app.get('/api/users/by-id/:id', authRequired, (req, res) => {
  const u = db.prepare('SELECT id, username, avatar, avatar_color, bio FROM users WHERE id = ?')
    .get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json({ user: { id: u.id, username: u.username, avatar: u.avatar, avatar_color: u.avatar_color, bio: u.bio, is_admin: u.username === ADMIN_USERNAME } });
});

// Remove a friend (unfriend). Also clears the 1:1 conversation between them.
app.delete('/api/friends/:id', rateLimit('write'), authRequired, (req, res) => {
  const fid = Number(req.params.id);
  if (!Number.isFinite(fid)) return res.status(400).json({ error: '参数错误' });
  if (fid === req.user.id) return res.status(400).json({ error: '不能对自己操作' });
  const f = db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, fid);
  if (!f) return res.status(404).json({ error: '对方不是你的好友' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(req.user.id, fid);
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(fid, req.user.id);
    // Clear the 1:1 chat so it disappears from both sides.
    db.prepare("DELETE FROM messages WHERE conv_type='user' AND conv_id = ?").run(userConvId(req.user.id, fid));
  });
  try { tx(); } catch (e) { return res.status(500).json({ error: e.message }); }
  io.to(`user:${fid}`).emit('friend:removed', { id: req.user.id });
  io.to(`user:${req.user.id}`).emit('friend:removed', { id: fid });
  res.json({ ok: true });
});

app.post('/api/friend/request', rateLimit('write'), authRequired, (req, res) => {
  const { toUsername } = req.body || {};
  if (!toUsername) return res.status(400).json({ error: '请输入对方用户名' });
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(toUsername);
  const r = sendFriendRequest(req.user, target);
  res.status(r.status).json(r.body);
});

// New flow: add a user you already met in a group, addressed by id.
app.post('/api/friend/request/:id', rateLimit('write'), authRequired, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  const r = sendFriendRequest(req.user, target);
  res.status(r.status).json(r.body);
});

app.get('/api/friend/requests', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT fr.id, fr.status, fr.created_at,
           u.id AS from_id, u.username AS from_username, u.avatar AS from_avatar
    FROM friend_requests fr
    JOIN users u ON u.id = fr.from_user_id
    WHERE fr.to_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `).all(req.user.id);
  res.json({ requests: rows });
});

app.post('/api/friend/respond', rateLimit('write'), authRequired, (req, res) => {
  const { requestId, accept } = req.body || {};
  const id = Number(requestId);
  if (!id) return res.status(400).json({ error: 'invalid requestId' });
  const fr = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(id);
  if (!fr) return res.status(404).json({ error: '申请不存在' });
  if (fr.to_user_id !== req.user.id) return res.status(403).json({ error: '无权操作' });
  if (fr.status !== 'pending') return res.status(400).json({ error: '申请已处理' });
  const status = accept ? 'accepted' : 'rejected';
  db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run(status, id);
  if (accept) {
    const ts = now();
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(fr.from_user_id, fr.to_user_id, ts);
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(fr.to_user_id, fr.from_user_id, ts);
    const me = db.prepare('SELECT id, username, avatar, avatar_color FROM users WHERE id = ?').get(req.user.id);
    const them = db.prepare('SELECT id, username, avatar, avatar_color FROM users WHERE id = ?').get(fr.from_user_id);
    io.to(`user:${fr.to_user_id}`).emit('friend:added', them);
    io.to(`user:${fr.from_user_id}`).emit('friend:added', me);
  }
  io.to(`user:${fr.from_user_id}`).emit('friend:request:resolved', { id, accept: !!accept });
  res.json({ ok: true });
});

// conversations list — friends + groups with last message preview and unread count
app.get('/api/conversations', authRequired, (req, res) => {
  const uid = req.user.id;
  const friends = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.avatar_color, 'user' AS type
    FROM friends f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? ORDER BY u.username
  `).all(uid);
  const groups = db.prepare(`
    SELECT g.id, g.name AS username, NULL AS avatar, NULL AS avatar_color, 'group' AS type, g.is_official
    FROM group_members gm JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ? ORDER BY g.is_official DESC, g.id ASC
  `).all(uid);
  const all = [...friends, ...groups];
  const lastUserStmt = db.prepare(`
    SELECT id, content, sender_id, created_at, type FROM messages
    WHERE conv_type = 'user' AND conv_id = ? AND is_deleted = 0
    ORDER BY id DESC LIMIT 1
  `);
  const lastGroupStmt = db.prepare(`
    SELECT id, content, sender_id, created_at, type FROM messages
    WHERE conv_type = 'group' AND conv_id = ? AND is_deleted = 0
    ORDER BY id DESC LIMIT 1
  `);
  const unreadStmt = (conv_type, conv_id) => {
    const rec = db.prepare(
      'SELECT last_read_msg_id FROM read_receipts WHERE conv_type = ? AND conv_id = ? AND user_id = ?'
    ).get(conv_type, conv_id, uid);
    const lr = rec ? rec.last_read_msg_id : 0;
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM messages
      WHERE conv_type = ? AND conv_id = ? AND id > ? AND sender_id != ? AND is_deleted = 0
    `).get(conv_type, conv_id, lr, uid);
    return r.n || 0;
  };
  for (const c of all) {
    const last = c.type === 'user' ? lastUserStmt.get(userConvId(uid, c.id)) : lastGroupStmt.get(c.id);
    c.last_message = last ? (last.type === 'image' ? '🖼  图片' : last.content) : '';
    c.last_sender_id = last ? last.sender_id : null;
    c.last_at = last ? last.created_at : 0;
    c.unread = c.type === 'user' ? unreadStmt('user', userConvId(uid, c.id)) : unreadStmt('group', String(c.id));
  }
  res.json({ conversations: all });
});

// helper: build a message response object
function buildMessage(row) {
  let meta = null; let reactions = [];
  if (row.meta) { try { meta = JSON.parse(row.meta); } catch {} }
  if (row._reactions) reactions = row._reactions;
  let reply_to = null;
  if (row.reply_to) {
    const r = db.prepare('SELECT id, sender_id, sender_username, content, type FROM messages_view WHERE id = ?').get(row.reply_to);
    if (r) reply_to = r;
  }
  return {
    id: row.id,
    conv_type: row.conv_type,
    conv_id: row.conv_id,
    sender_id: row.sender_id,
    sender_username: row.sender_username,
    sender_avatar_color: row.sender_avatar_color || null,
    content: row.is_deleted ? '' : row.content,
    type: row.type || 'text',
    meta,
    reply_to,
    reactions,
    is_deleted: !!row.is_deleted,
    created_at: row.created_at,
  };
}

// a view for reply joins
db.exec(`
  CREATE VIEW IF NOT EXISTS messages_view AS
  SELECT m.*, u.username AS sender_username, u.avatar_color AS sender_avatar_color
  FROM messages m
  JOIN users u ON u.id = m.sender_id
`);

// send message
app.post('/api/messages', rateLimit('write'), authRequired, (req, res) => {
  let { conv_type, conv_id, content, type, meta, reply_to } = req.body || {};
  if (!['user', 'group'].includes(conv_type)) return res.status(400).json({ error: 'invalid conv_type' });
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  // image type content is a data URL; allow long strings
  if (typeof content !== 'string') return res.status(400).json({ error: 'invalid content' });
  if (type === 'image' && content.length > 5 * 1024 * 1024) return res.status(413).json({ error: '图片过大（>5MB）' });
  if (type !== 'image' && content.length > 4000) return res.status(400).json({ error: '内容过长' });

  let normalizedConvId;
  if (conv_type === 'group') {
    conv_id = Number(conv_id);
    const inGroup = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(conv_id, req.user.id);
    if (!inGroup) return res.status(403).json({ error: 'not in group' });
    normalizedConvId = String(conv_id);
  } else {
    const peerId = Number(conv_id);
    const isFriend = db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, peerId);
    if (!isFriend) return res.status(403).json({ error: 'not friends' });
    normalizedConvId = userConvId(req.user.id, peerId);
  }
  if (reply_to) {
    const ref = db.prepare('SELECT id FROM messages WHERE id = ?').get(Number(reply_to));
    if (!ref) return res.status(400).json({ error: '回复的消息不存在' });
    reply_to = ref.id;
  }
  const msgType = ['text','image','system'].includes(type) ? type : 'text';
  const metaStr = meta ? JSON.stringify(meta) : null;
  const info = db.prepare(
    'INSERT INTO messages (conv_type, conv_id, sender_id, content, type, meta, reply_to, is_deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(conv_type, normalizedConvId, req.user.id, content, msgType, metaStr, reply_to || null, now());
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  const msg = buildMessage({ ...row, sender_username: req.user.username });
  broadcastMessage(msg, conv_type, conv_id, req.user.id);
  res.json({ message: msg });
});

// list messages
app.get('/api/messages', authRequired, (req, res) => {
  const conv_type = req.query.conv_type;
  let conv_id = req.query.conv_id;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  if (!['user', 'group'].includes(conv_type) || !conv_id) return res.status(400).json({ error: 'invalid query' });
  let normalizedConvId;
  if (conv_type === 'group') {
    conv_id = Number(conv_id);
    const ok = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(conv_id, req.user.id);
    if (!ok) return res.status(403).json({ error: 'not in group' });
    normalizedConvId = String(conv_id);
  } else {
    const peerId = Number(conv_id);
    const ok = db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, peerId);
    if (!ok) return res.status(403).json({ error: 'not friends' });
    normalizedConvId = userConvId(req.user.id, peerId);
  }
  const rows = db.prepare(`
    SELECT m.*, u.username AS sender_username, u.avatar_color AS sender_avatar_color
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conv_type = ? AND m.conv_id = ?
    ORDER BY m.id DESC LIMIT ?
  `).all(conv_type, normalizedConvId, limit);
  const reversed = rows.reverse();
  // fetch reactions
  const msgIds = reversed.map(r => r.id);
  const reactionsByMsg = {};
  if (msgIds.length) {
    const placeholders = msgIds.map(() => '?').join(',');
    const rxs = db.prepare(`
      SELECT message_id, user_id, emoji FROM message_reactions
      WHERE message_id IN (${placeholders})
    `).all(...msgIds);
    for (const rx of rxs) {
      if (!reactionsByMsg[rx.message_id]) reactionsByMsg[rx.message_id] = [];
      reactionsByMsg[rx.message_id].push({ user_id: rx.user_id, emoji: rx.emoji });
    }
  }
  const messages = reversed.map(r => buildMessage({ ...r, _reactions: reactionsByMsg[r.id] || [] }));
  res.json({ messages });
});

function broadcastMessage(msg, conv_type, originalConvId, senderId) {
  if (conv_type === 'user') {
    const m = String(msg.conv_id).match(/^u_(\d+)_(\d+)$/);
    const peer = m ? (Number(m[1]) === senderId ? Number(m[2]) : Number(m[1])) : null;
    io.to(`user:${senderId}`).emit('message:new', msg);
    if (peer != null) io.to(`user:${peer}`).emit('message:new', msg);
  } else {
    const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(originalConvId));
    for (const mm of members) io.to(`user:${mm.user_id}`).emit('message:new', msg);
  }
}

// delete message
app.delete('/api/messages/:id', rateLimit('write'), authRequired, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '消息不存在' });
  const jackMode = isAdmin(req.user);
  if (!jackMode && row.sender_id !== req.user.id) return res.status(403).json({ error: '只能删除自己的消息' });
  // Non-Jack users can only recall their own message within 2 minutes
  if (!jackMode) {
    const ageMs = Date.now() - new Date(row.created_at + 'Z').getTime();
    if (ageMs > 2 * 60 * 1000) return res.status(403).json({ error: '只能撤回 2 分钟内的消息' });
  }
  if (row.is_deleted && !jackMode) return res.json({ ok: true });
  // Jack: hard delete. Others: soft delete (撤回).
  if (jackMode) {
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  } else {
    db.prepare("UPDATE messages SET is_deleted = 1, content = '' WHERE id = ?").run(id);
  }
  // also remove reactions
  db.prepare('DELETE FROM message_reactions WHERE message_id = ?').run(id);
  // broadcast deletion
  let targetIds = [];
  if (row.conv_type === 'user') {
    const m = String(row.conv_id).match(/^u_(\d+)_(\d+)$/);
    targetIds = m ? [Number(m[1]), Number(m[2])] : [row.sender_id];
  } else {
    targetIds = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(row.conv_id)).map(r => r.user_id);
  }
  for (const tid of targetIds) io.to(`user:${tid}`).emit('message:deleted', { id, conv_type: row.conv_type, conv_id: row.conv_id });
  res.json({ ok: true, hard_delete: jackMode });
});

// react to a message (toggle)
app.post('/api/messages/:id/react', rateLimit('write'), authRequired, (req, res) => {
  const id = Number(req.params.id);
  const { emoji } = req.body || {};
  if (!emoji || typeof emoji !== 'string' || emoji.length > 8) return res.status(400).json({ error: 'invalid emoji' });
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!row || row.is_deleted) return res.status(404).json({ error: '消息不存在' });
  // check access: friend or same group
  let allowed = false;
  if (row.conv_type === 'user') {
    const m = String(row.conv_id).match(/^u_(\d+)_(\d+)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      allowed = (req.user.id === a || req.user.id === b);
    }
  } else {
    const inGroup = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(Number(row.conv_id), req.user.id);
    allowed = !!inGroup;
  }
  if (!allowed) return res.status(403).json({ error: 'no access' });
  const existing = db.prepare(
    'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).get(id, req.user.id, emoji);
  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(id, req.user.id, emoji);
  } else {
    db.prepare(
      'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, req.user.id, emoji, now());
  }
  const all = db.prepare('SELECT user_id, emoji FROM message_reactions WHERE message_id = ?').all(id);
  let targetIds = [];
  if (row.conv_type === 'user') {
    const m = String(row.conv_id).match(/^u_(\d+)_(\d+)$/);
    targetIds = m ? [Number(m[1]), Number(m[2])] : [];
  } else {
    targetIds = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(row.conv_id)).map(r => r.user_id);
  }
  for (const tid of targetIds) io.to(`user:${tid}`).emit('message:reaction', { id, reactions: all });
  res.json({ ok: true, reactions: all });
});

// mark messages as read
app.post('/api/messages/read', rateLimit('write'), authRequired, (req, res) => {
  const { conv_type, conv_id, last_read_msg_id } = req.body || {};
  if (!['user','group'].includes(conv_type) || !conv_id || !last_read_msg_id) return res.status(400).json({ error: 'invalid payload' });
  let normalizedConvId;
  if (conv_type === 'user') {
    const peerId = Number(conv_id);
    normalizedConvId = userConvId(req.user.id, peerId);
  } else {
    normalizedConvId = String(Number(conv_id));
  }
  db.prepare(`
    INSERT INTO read_receipts (conv_type, conv_id, user_id, last_read_msg_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(conv_type, conv_id, user_id) DO UPDATE SET
      last_read_msg_id = MAX(last_read_msg_id, excluded.last_read_msg_id),
      updated_at = excluded.updated_at
  `).run(conv_type, normalizedConvId, req.user.id, Number(last_read_msg_id), now());
  // notify other participants
  let targetIds = [];
  if (conv_type === 'user') {
    targetIds = [Number(conv_id)];
  } else {
    targetIds = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(conv_id)).map(r => r.user_id);
  }
  for (const tid of targetIds) {
    if (tid === req.user.id) continue;
    io.to(`user:${tid}`).emit('message:read', {
      conv_type, conv_id: conv_type === 'user' ? Number(conv_id) : Number(conv_id),
      user_id: req.user.id, username: req.user.username,
      last_read_msg_id: Number(last_read_msg_id),
    });
  }
  res.json({ ok: true });
});

// ---------- http + socket.io ----------
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

// online presence
const onlineUsers = new Set();
const userSockets = new Map();  // uid → Set<socketId>

function broadcastPresence(uid, online) {
  const friends = getFriends(uid);
  const payload = { user_id: uid, online };
  for (const f of friends) io.to(`user:${f}`).emit('user:presence', payload);
  io.to(`user:${uid}`).emit('user:presence', payload);
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('missing token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = { id: payload.uid, username: payload.username };
    next();
  } catch (e) { next(new Error('invalid token')); }
});

// ============================================================
// Typing indicator — relay a lightweight "is typing" signal
// between the participants of a conversation. Nothing is stored.
// ============================================================
io.on('connection', (socket) => {
  socket.on('typing', (payload) => {
    try {
      const { conv_type, conv_id, typing } = payload || {};
      if (!conv_type || conv_id == null) return;
      if (conv_type === 'user') {
        const other = Number(conv_id);
        if (!Number.isFinite(other)) return;
        socket.to(`user:${other}`).emit('typing', {
          conv_type: 'user', conv_id: String(other), uid: socket.user.id,
          username: socket.user.username, typing: !!typing,
        });
      } else if (conv_type === 'group') {
        const gid = Number(conv_id);
        if (!Number.isFinite(gid)) return;
        // only broadcast if the sender really is a member
        const mem = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, socket.user.id);
        if (!mem) return;
        socket.to(`group:${gid}`).emit('typing', {
          conv_type: 'group', conv_id: String(gid), uid: socket.user.id,
          username: socket.user.username, typing: !!typing,
        });
      }
    } catch (e) {
      console.error('[typing] relay failed:', e.message);
    }
  });
});

io.on('connection', (socket) => {
  const uid = socket.user.id;
  socket.join(`user:${uid}`);
  // Join every group room the user belongs to, so group message + typing
  // broadcasts actually reach them (without this, group chats looked "dead").
  try {
    const gs = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(uid);
    for (const g of gs) socket.join(`group:${g.id}`);
  } catch (e) {
    console.error('[socket] group join failed:', e.message);
  }
  if (!userSockets.has(uid)) userSockets.set(uid, new Set());
  const wasOffline = !onlineUsers.has(uid);
  userSockets.get(uid).add(socket.id);
  onlineUsers.add(uid);
  if (wasOffline) broadcastPresence(uid, true);
  console.log(`[VVeChat] user ${uid} (${socket.user.username}) connected`);

  // realtime send
  socket.on('message:send', (data, ack) => {
    try {
      let { conv_type, conv_id, content, type, meta, reply_to } = data || {};
      if (!['user', 'group'].includes(conv_type)) throw new Error('invalid conv_type');
      if (!content) throw new Error('内容不能为空');
      if (type === 'image' && content.length > 5 * 1024 * 1024) throw new Error('图片过大（>5MB）');
      if (type !== 'image' && content.length > 4000) throw new Error('内容过长');
      let normalizedConvId;
      if (conv_type === 'group') {
        conv_id = Number(conv_id);
        const ok = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(conv_id, uid);
        if (!ok) throw new Error('not in group');
        normalizedConvId = String(conv_id);
      } else {
        const peerId = Number(conv_id);
        const ok = db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(uid, peerId);
        if (!ok) throw new Error('not friends');
        normalizedConvId = userConvId(uid, peerId);
      }
      if (reply_to) {
        const ref = db.prepare('SELECT id FROM messages WHERE id = ?').get(Number(reply_to));
        if (!ref) throw new Error('回复的消息不存在');
        reply_to = ref.id;
      }
      const msgType = ['text','image','system'].includes(type) ? type : 'text';
      const metaStr = meta ? JSON.stringify(meta) : null;
      const info = db.prepare(
        'INSERT INTO messages (conv_type, conv_id, sender_id, content, type, meta, reply_to, is_deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
      ).run(conv_type, normalizedConvId, uid, content, msgType, metaStr, reply_to || null, now());
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
      const msg = buildMessage({ ...row, sender_username: socket.user.username });
      broadcastMessage(msg, conv_type, conv_id, uid);
      ack && ack({ ok: true, message: msg });
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  // typing
  socket.on('typing:start', (data) => {
    const { conv_type, conv_id } = data || {};
    if (conv_type === 'user') {
      const peer = Number(conv_id);
      io.to(`user:${peer}`).emit('typing:start', { conv_type:'user', conv_id: peer, user_id: uid, username: socket.user.username });
    } else if (conv_type === 'group') {
      const gid = Number(conv_id);
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(gid);
      for (const m of members) if (m.user_id !== uid) io.to(`user:${m.user_id}`).emit('typing:start', { conv_type:'group', conv_id: gid, user_id: uid, username: socket.user.username });
    }
  });
  socket.on('typing:stop', (data) => {
    const { conv_type, conv_id } = data || {};
    if (conv_type === 'user') {
      const peer = Number(conv_id);
      io.to(`user:${peer}`).emit('typing:stop', { conv_type:'user', conv_id: peer, user_id: uid });
    } else if (conv_type === 'group') {
      const gid = Number(conv_id);
      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(gid);
      for (const m of members) if (m.user_id !== uid) io.to(`user:${m.user_id}`).emit('typing:stop', { conv_type:'group', conv_id: gid, user_id: uid });
    }
  });

  // realtime delete
  socket.on('message:delete', ({ id }, ack) => {
    try {
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(id));
      if (!row) throw new Error('消息不存在');
      if (row.sender_id !== uid) throw new Error('无权删除');
      if (row.is_deleted) return ack && ack({ ok: true });
      db.prepare("UPDATE messages SET is_deleted = 1, content = '' WHERE id = ?").run(Number(id));
      db.prepare('DELETE FROM message_reactions WHERE message_id = ?').run(Number(id));
      let targetIds = [];
      if (row.conv_type === 'user') {
        const m = String(row.conv_id).match(/^u_(\d+)_(\d+)$/);
        targetIds = m ? [Number(m[1]), Number(m[2])] : [uid];
      } else {
        targetIds = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(row.conv_id)).map(r => r.user_id);
      }
      for (const tid of targetIds) io.to(`user:${tid}`).emit('message:deleted', { id: Number(id), conv_type: row.conv_type, conv_id: row.conv_id });
      ack && ack({ ok: true });
    } catch (e) { ack && ack({ ok: false, error: e.message }); }
  });

  // realtime react
  socket.on('message:react', ({ id, emoji }, ack) => {
    try {
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(id));
      if (!row || row.is_deleted) throw new Error('消息不存在');
      if (!emoji || typeof emoji !== 'string' || emoji.length > 8) throw new Error('invalid emoji');
      let allowed = false;
      if (row.conv_type === 'user') {
        const m = String(row.conv_id).match(/^u_(\d+)_(\d+)$/);
        if (m) { const a = Number(m[1]), b = Number(m[2]); allowed = (uid === a || uid === b); }
      } else {
        const inGroup = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(Number(row.conv_id), uid);
        allowed = !!inGroup;
      }
      if (!allowed) throw new Error('no access');
      const existing = db.prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(Number(id), uid, emoji);
      if (existing) {
        db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(Number(id), uid, emoji);
      } else {
        db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(Number(id), uid, emoji, now());
      }
      const all = db.prepare('SELECT user_id, emoji FROM message_reactions WHERE message_id = ?').all(Number(id));
      let targetIds = [];
      if (row.conv_type === 'user') {
        const m = String(row.conv_id).match(/^u_(\d+)_(\d+)$/);
        targetIds = m ? [Number(m[1]), Number(m[2])] : [];
      } else {
        targetIds = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(row.conv_id)).map(r => r.user_id);
      }
      for (const tid of targetIds) io.to(`user:${tid}`).emit('message:reaction', { id: Number(id), reactions: all });
      ack && ack({ ok: true, reactions: all });
    } catch (e) { ack && ack({ ok: false, error: e.message }); }
  });

  // mark as read (realtime)
  socket.on('message:read', ({ conv_type, conv_id, last_read_msg_id }, ack) => {
    if (!['user','group'].includes(conv_type) || !conv_id || !last_read_msg_id) return ack && ack({ ok: false });
    const normalizedConvId = conv_type === 'user' ? userConvId(uid, Number(conv_id)) : String(Number(conv_id));
    db.prepare(`
      INSERT INTO read_receipts (conv_type, conv_id, user_id, last_read_msg_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(conv_type, conv_id, user_id) DO UPDATE SET
        last_read_msg_id = MAX(last_read_msg_id, excluded.last_read_msg_id),
        updated_at = excluded.updated_at
    `).run(conv_type, normalizedConvId, uid, Number(last_read_msg_id), now());
    let targetIds = [];
    if (conv_type === 'user') targetIds = [Number(conv_id)];
    else targetIds = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(Number(conv_id)).map(r => r.user_id);
    for (const tid of targetIds) {
      if (tid === uid) continue;
      io.to(`user:${tid}`).emit('message:read', {
        conv_type, conv_id: conv_type === 'user' ? Number(conv_id) : Number(conv_id),
        user_id: uid, username: socket.user.username,
        last_read_msg_id: Number(last_read_msg_id),
      });
    }
    ack && ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const set = userSockets.get(uid);
    if (set) { set.delete(socket.id); if (!set.size) { userSockets.delete(uid); onlineUsers.delete(uid); broadcastPresence(uid, false); } }
    console.log(`[VVeChat] user ${uid} disconnected`);
  });
});

// ============================================================
// 30-day message auto-deletion (cleanup job)
// Runs on startup and every hour
// ============================================================
function cleanupOldMessages() {
  try {
    // Retain messages for 1 year; auto-clear older ones to save space
    const cutoffMs = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString().replace('T', ' ').slice(0, 19);
    // Also clean orphaned reactions pointing to deleted messages
    const delMsgs = db.prepare("DELETE FROM messages WHERE created_at < ?").run(cutoffIso);
    const delRxns = db.prepare("DELETE FROM message_reactions WHERE message_id NOT IN (SELECT id FROM messages)").run();
    if (delMsgs.changes || delRxns.changes) {
      console.log(`[VVeChat] cleanup: removed ${delMsgs.changes} messages (>1y), ${delRxns.changes} orphan reactions`);
    }
  } catch (e) { console.error('[VVeChat] cleanup error:', e); }
}
cleanupOldMessages();
setInterval(cleanupOldMessages, 60 * 60 * 1000); // every hour

// ============================================================
// Recommended groups (Discover) — groups with recommended=1
// appear in the "看看大家的群聊" section.
// ============================================================

// (Root console removed per user request — see commit message)

// ============================================================
// Static frontend — serve the SPA from ./frontend so one service
// provides both the UI and the API under a single URL.
// ============================================================
const FRONTEND_DIR = path.join(__dirname, 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR, {
    maxAge: 0, etag: false, lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0'),
  }));

// ============================================================
// Control panel (/control) — the Jack-only admin console.
// Served from the same service; a separate Render Static Site can
// also point at this directory if you want a dedicated hostname.
// ============================================================
const CONTROL_DIR = path.join(__dirname, 'control');
if (fs.existsSync(CONTROL_DIR)) {
  app.use('/control', express.static(CONTROL_DIR, {
    maxAge: 0, etag: false, lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0'),
  }));
  app.get('/control/*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.sendFile(path.join(CONTROL_DIR, 'index.html'));
  });
  console.log('[VVeChat] serving control panel from', CONTROL_DIR);
}

  // SPA fallback — must NOT swallow /socket.io/* or handshakes break.
  app.get('*', (req, res, next) => {
    const p = req.path || '';
    if (p.startsWith('/api/') || p.startsWith('/socket.io/')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
  console.log('[VVeChat] serving frontend from', FRONTEND_DIR);
} else {
  console.warn('[VVeChat] frontend dir missing at', FRONTEND_DIR);
}


// Never let one error kill the service.
process.on('uncaughtException', (e) => console.error('[VVeChat] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[VVeChat] unhandledRejection:', e));

// ============================================================
// Keep-alive: Render's free tier spins the container down after ~15 min
// of inbound silence, which kills Socket.io and forces a 30-50s cold
// start on the next visitor. We ping our own /api/health on a timer so
// the instance never crosses the idle threshold.
//
// Set KEEPALIVE=0 to disable (e.g. once you move to a paid plan).
// NOTE: everything here is self-contained — no outer variables — so a
// typo here can never take the whole process down at require() time.
// ============================================================
if (process.env.KEEPALIVE !== '0') {
  try {
    // Render's free tier sleeps a service after ~15 minutes with no *external*
    // inbound traffic. Pinging 127.0.0.1 does not count, so we deliberately
    // hit our own public URL — that is traffic from outside the container and
    // it resets Render's idle timer.
    const kaInterval = Math.max(60 * 1000, Number(process.env.KEEPALIVE_INTERVAL_MS || 5 * 60 * 1000));
    const kaSelf = process.env.RENDER_EXTERNAL_URL
      || (process.env.RENDER_SERVICE_URL ? ('https://' + process.env.RENDER_SERVICE_URL) : '')
      || (process.env.RENDER_EXTERNAL_HOSTNAME ? ('https://' + process.env.RENDER_EXTERNAL_HOSTNAME) : '')
      || ('http://127.0.0.1:' + (process.env.PORT || '10000'));
    const kaPath = process.env.KEEPALIVE_PATH || '/api/health';
    let u;
    try { u = new URL(kaPath, kaSelf); } catch (_) { u = new URL('http://127.0.0.1:' + (process.env.PORT || '10000') + kaPath); }
    const kaMod = u.protocol === 'https:' ? require('https') : require('http');

    const keepAlive = () => {
      const req = kaMod.request(u, {
        method: 'GET',
        timeout: 15000,
        headers: { 'User-Agent': 'vvechat-keepalive/1.0', 'Accept': 'application/json' },
      }, (r) => {
        r.resume();
        console.log('[keepalive] ' + new Date().toISOString() + ' -> ' + r.statusCode + ' ' + u.href);
      });
      req.on('timeout', () => { req.destroy(); console.error('[keepalive] timeout'); });
      req.on('error', (e) => console.error('[keepalive] ' + e.message));
      req.end();
    };

    // Stagger the first ping so it never races the server's own listen().
    setTimeout(keepAlive, 45000);
    setInterval(keepAlive, kaInterval).unref();
    console.log('[keepalive] armed every ' + Math.round(kaInterval / 1000) + 's -> ' + u.href);
  } catch (e) {
    console.error('[keepalive] disabled (setup failed): ' + e.message);
  }
}

server.listen(PORT, () => {
  console.log(`[VVeChat] listening on http://0.0.0.0:${PORT}  (db: ${DB_FILE})`);
});
// re-deploy trigger 2026-08-26T23:33:46Z
