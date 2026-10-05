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
  global: 300,   // 300 req/min per IP across the whole API
  auth: 12,      // 12 req/min for login/register
  write: 60,     // 60 req/min for mutating endpoints
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
      b = { start: now, count: 0, auth: 0, write: 0 };
      RATE_BUCKETS.set(ip, b);
    }
    b.count++;
    if (b.count > RATE_LIMIT.global) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    if (kind === 'auth' && ++b.auth > RATE_LIMIT.auth) {
      return res.status(429).json({ error: '尝试次数过多，请 1 分钟后再试' });
    }
    if (kind === 'write' && ++b.write > RATE_LIMIT.write) {
      return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
    }
    next();
  };
}
// Drop stale buckets so the Map cannot grow without bound.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT.windowMs * 2;
  for (const [ip, b] of RATE_BUCKETS) if (b.start < cutoff) RATE_BUCKETS.delete(ip);
}, 60 * 1000).unref();

// =====================================================================
// Lightweight firewall / rate limiter (in-memory, per IP)
// =====================================================================
const RATE_BUCKET = new Map();
function rateLimit(max = 120, windowMs = 60_000) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();
    const arr = RATE_BUCKET.get(ip) || [];
    while (arr.length && now - arr[0] > windowMs) arr.shift();
    if (arr.length >= max) {
      return res.status(429).json({ error: 'rate_limited', retry_after: Math.ceil(windowMs/1000) });
    }
    arr.push(now);
    RATE_BUCKET.set(ip, arr);
    next();
  };
}
// Global limit: 120 req/min per IP for any /api/* path
app.use('/api/', rateLimit(180, 60_000));
// Tighter limit for auth endpoints (10 / min)
app.use(['/api/login', '/api/register'], rateLimit(15, 60_000));

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
// Remove a member from a group. Allowed for the group owner and for Jack.
app.delete('/api/groups/:gid/members/:uid', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.gid);
  const uid = Number(req.params.uid);
  const g = db.prepare('SELECT id, name, is_official, owner_id FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, g)) return res.status(403).json({ error: '只有群主或 Jack 可以移出成员' });
  if (uid === Number(req.user.id)) return res.status(400).json({ error: '不能移出自己，请用"退出群聊"' });
  // don't allow removing Jack from the official group
  if (g.is_official) {
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);
    if (u && u.username === ADMIN_USERNAME) return res.status(400).json({ error: '不能移除 Jack' });
  }
  const r = db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(gid, uid);
  if (r.changes === 0) return res.status(404).json({ error: '用户不在该群' });
  try { if (io) io.to(`user:${uid}`).emit('group:removed', { group_id: gid, name: g.name }); } catch {}
  res.json({ ok: true, removed: r.changes });
});

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
  if (!u) return res.status(401).json({ error: '账号不存在' });
  if (!bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: '密码错误' });
  }
  // re-join official group if previously removed
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(OFFICIAL_GROUP_ID, u.id, now());
  const token = jwt.sign({ uid: u.id, username: u.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: userPublic(u) });
});

// me / profile
app.get('/api/me', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  res.json({ user: userPublic(u) });
});

app.put('/api/me', rateLimit('write'), authRequired, (req, res) => {
  const { bio, username, avatar_color, avatar } = req.body || {};
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
app.get('/api/groups/search', authRequired, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ groups: [] });
  // exclude official group and groups user already belongs to
  const rows = db.prepare(`
    SELECT g.id, g.name, g.is_official,
      (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
    FROM groups g
    WHERE g.name LIKE ?
      AND g.id NOT IN (SELECT group_id FROM group_members WHERE user_id = ?)
    ORDER BY g.id DESC LIMIT 30
  `).all(`%${q}%`, req.user.id);
  res.json({ groups: rows });
});

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
app.post('/api/groups', rateLimit('write'), authRequired, (req, res) => {
  const { name, memberIds } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '群名称不能为空' });
  const ids = Array.isArray(memberIds) ? [...new Set(memberIds.map(Number))].filter(Boolean) : [];
  if (ids.length < 1) return res.status(400).json({ error: '至少选择 1 位好友（含你自己共 2 人）' });

  const info = db.prepare(
    'INSERT INTO groups (name, owner_id, is_official, created_at) VALUES (?, ?, 0, ?)'
  ).run(name.trim(), req.user.id, now());
  const gid = info.lastInsertRowid;
  const memberSet = new Set([req.user.id, ...ids]);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (const uid of memberSet) insert.run(gid, uid, now());
  });
  tx();
  for (const uid of memberSet) io.to(`user:${uid}`).emit('group:added', { groupId: gid, name: name.trim() });
  res.json({ group: { id: gid, name: name.trim(), is_official: 0, owner_id: req.user.id } });
});

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

// Add a member to a group. Owner or Jack only.
app.post('/api/groups/:id/members', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT id, name, is_official, owner_id FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, g)) return res.status(403).json({ error: '只有群主或 Jack 可以添加成员' });
  const { memberId } = req.body || {};
  const mid = Number(memberId);
  if (!mid) return res.status(400).json({ error: '缺少成员 ID' });
  if (mid === Number(req.user.id)) return res.status(400).json({ error: '不能添加自己' });
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(mid);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const already = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, mid);
  if (already) return res.status(400).json({ error: '该用户已在群中' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(gid, mid, now());
  // Make sure the new member's socket joins the group room right away so they
  // receive messages without having to reconnect.
  try {
    for (const [, sock] of (userSockets.get(mid) || new Set())) {
      const s2 = io.sockets.sockets.get(sock);
      if (s2) s2.join(`group:${gid}`);
    }
  } catch (_) {}
  io.to(`user:${mid}`).emit('group:added', { groupId: gid, name: g.name });
  res.json({ ok: true, member: { id: u.id, username: u.username } });
});

// List users who are NOT yet in this group — powers the "add member" picker.
app.get('/api/groups/:id/candidates', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT id, name, is_official, owner_id FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, g)) return res.status(403).json({ error: '只有群主或 Jack 可以查看' });
  const q = String(req.query.q || '').trim();
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar_color
    FROM users u
    WHERE u.id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?)
      ${q ? 'AND u.username LIKE ?' : ''}
    ORDER BY u.username LIMIT 50
  `).all(...(q ? [gid, '%' + q + '%'] : [gid]));
  res.json({ candidates: rows });
});

// Update group name. Only the official group requires Jack; regular groups allow any member.
app.put('/api/groups/:id', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const { name, recommended, announcement, pinned, icon_color } = req.body || {};
  const g = db.prepare('SELECT id, name, is_official, owner_id FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  const inGroup = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, req.user.id);
  if (!inGroup) return res.status(403).json({ error: 'not in group' });
  const isOwner = g.owner_id === req.user.id;
  const isAdmin = req.user.username === 'Jack';
  const sets = []; const vals = [];
  if (typeof name === 'string' && name.trim()) {
    if (name.length > 40) return res.status(400).json({ error: '群名称不超过 40 字' });
    if (g.is_official && !isAdmin) return res.status(403).json({ error: '只有 Jack 才能修改官方群名称' });
    sets.push('name = ?'); vals.push(name.trim());
  }
  if (typeof recommended === 'boolean') {
    if (!isOwner && !isAdmin) return res.status(403).json({ error: '只有群主或管理员可设置推荐' });
    sets.push('recommended = ?'); vals.push(recommended ? 1 : 0);
  }
  if (typeof announcement === 'string') {
    if (!isOwner && !isAdmin) return res.status(403).json({ error: '只有群主或管理员可设置公告' });
    sets.push('announcement = ?'); vals.push(announcement.slice(0, 200));
  }
  if (typeof pinned === 'boolean') {
    sets.push('pinned = ?'); vals.push(pinned ? 1 : 0);
  }
  if (typeof icon_color === 'string' && icon_color) {
    sets.push('icon_color = ?'); vals.push(icon_color);
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(gid);
  db.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const fresh = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  // broadcast to all members
  const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(gid);
  for (const m of members) io.to(`user:${m.user_id}`).emit('group:updated', fresh);
  res.json({ ok: true, group: fresh });
});

// Leave a group
app.post('/api/groups/:id/leave', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT id, is_official FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (g.is_official) return res.status(400).json({ error: '不能退出官方群' });
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(gid, req.user.id);
  res.json({ ok: true });
});

// Disband a group (Jack / owner)
app.post('/api/groups/:id/disband', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT id, is_official, owner_id FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (g.is_official) return res.status(400).json({ error: '官方群不能解散' });
  const isOwner = g.owner_id === req.user.id;
  const isAdmin = req.user.username === 'Jack';
  if (!isOwner && !isAdmin) return res.status(403).json({ error: '只有群主或管理员可解散' });
  db.prepare('DELETE FROM group_members WHERE group_id = ?').run(gid);
  db.prepare('DELETE FROM messages WHERE conv_type = ? AND conv_id = ?').run('group', String(gid));
  db.prepare('DELETE FROM groups WHERE id = ?').run(gid);
  res.json({ ok: true });
});

// Discover: list recommended public groups (not joined yet)
app.get('/api/groups/recommended', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT g.id, g.name, g.description, g.icon_color, g.member_count, g.recommended,
           (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS joined
    FROM groups g
    WHERE g.recommended = 1
    ORDER BY g.id ASC
    LIMIT 50
  `).all(req.user.id);
  res.json({ groups: rows });
});

// self-join a public group (any logged-in user can join)
app.post('/api/groups/:id/join', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT id, name, is_official FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  const already = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, req.user.id);
  if (already) return res.status(400).json({ error: '已经在群里' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(gid, req.user.id, now());
  io.to(`user:${req.user.id}`).emit('group:added', { groupId: gid, name: g.name });
  // notify existing members
  const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?').all(gid, req.user.id);
  for (const m of members) io.to(`user:${m.user_id}`).emit('group:user_joined', { groupId: gid, name: g.name, user: { id: req.user.id, username: req.user.username } });
  res.json({ ok: true, group: g });
});

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
// Set KEEPALIVE=0 to disable (e.g. when you upgrade to a paid plan).
// ============================================================
if (process.env.KEEPALIVE !== '0') {
  const kaInterval = Number(process.env.KEEPALIVE_INTERVAL_MS || 10 * 60 * 1000);
  const kaClient = url.startsWith('https:') ? require('https') : require('http');
  const keepAlive = () => {
    try {
      const req = kaClient.request(url, { method: 'GET', timeout: 12000 }, (r) => {
        r.resume();
        console.log(`[keepalive] ${new Date().toISOString()} -> ${r.statusCode}`);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => console.error('[keepalive]', e.message));
      req.end();
    } catch (e) {
      console.error('[keepalive] request failed:', e.message);
    }
  };
  setTimeout(keepAlive, 20000);
  const kaTimer = setInterval(keepAlive, kaInterval);
  kaTimer.unref?.();
  console.log(`[keepalive] armed — every ${kaInterval / 1000}s`);
}

server.listen(PORT, () => {
  console.log(`[VVeChat] listening on http://0.0.0.0:${PORT}  (db: ${DB_FILE})`);
});
// re-deploy trigger 2026-08-26T23:33:46Z
