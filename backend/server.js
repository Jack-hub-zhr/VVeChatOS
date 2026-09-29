/**
 * VVeChat v2 — backend
 * Express + Socket.io + better-sqlite3 + JWT
 * Single-file implementation, no legacy code.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server: SocketIOServer } = require('socket.io');

// ============================================================
// Config
// ============================================================
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'vvechat-os-1.0.0-dev-secret-change-in-production';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'vvechat.db');
const ADMIN_USERNAME = 'Jack';
const ADMIN_PASSWORD = 'Zhr121005';
const ADMIN_AVATAR_COLOR = '#fbbf24';

// ============================================================
// Database
// ============================================================
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#5eead4',
    bio          TEXT DEFAULT '',
    created_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS groups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    is_official  INTEGER DEFAULT 0,
    owner_id     INTEGER,
    icon_color   TEXT DEFAULT '#8b5cf6',
    created_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_id   INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    joined_at  INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS friends (
    user_id   INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    since     INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_uid   INTEGER NOT NULL,
    to_uid     INTEGER NOT NULL,
    status     TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_type  TEXT NOT NULL,        -- 'user' or 'group'
    conv_id    TEXT NOT NULL,        -- 'u_1_2' or '1' (group id)
    sender_id  INTEGER NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_type, conv_id, id);
  CREATE INDEX IF NOT EXISTS idx_msg_sender ON messages(sender_id, id);
`);

function now() { return Date.now(); }
function userConvId(a, b) { const [x, y] = a < b ? [a, b] : [b, a]; return `u_${x}_${y}`; }

// ============================================================
// Seed: official group + admin
// ============================================================
function ensureOfficialGroup() {
  let g = db.prepare('SELECT id FROM groups WHERE is_official = 1 LIMIT 1').get();
  if (!g) {
    const r = db.prepare(`INSERT INTO groups (name, is_official, owner_id, created_at) VALUES (?, 1, NULL, ?)`)
      .run('VVeChat 官方群', now());
    g = { id: r.lastInsertRowid };
  }
  return g.id;
}

function ensureAdmin() {
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME);
  if (exists) return exists.id;
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const r = db.prepare(
    `INSERT INTO users (username, password_hash, avatar_color, bio, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(ADMIN_USERNAME, hash, ADMIN_AVATAR_COLOR, 'VVeChat OS 官方管理员', now());
  const id = r.lastInsertRowid;
  // auto-join official group
  const og = ensureOfficialGroup();
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(og, id, now());
  console.log('[seed] admin account created:', ADMIN_USERNAME, 'id=' + id);
  return id;
}

const OFFICIAL_GROUP_ID = ensureOfficialGroup();
ensureAdmin();

const COLORS = ['#5eead4','#60a5fa','#c084fc','#f472b6','#fbbf24','#fb923c','#4ade80','#22d3ee','#a78bfa','#f87171'];
function pickColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }

function isAdmin(uid) {
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);
  return u && u.username === ADMIN_USERNAME;
}

// ============================================================
// Auth
// ============================================================
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    avatar_color: u.avatar_color,
    bio: u.bio || '',
    is_admin: u.username === ADMIN_USERNAME,
    created_at: u.created_at,
  };
}

function signToken(uid, username) {
  return jwt.sign({ uid, username }, JWT_SECRET, { expiresIn: '30d' });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (_) { return null; }
}
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: '未登录' });
  const p = verifyToken(t);
  if (!p) return res.status(401).json({ error: 'token 无效' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.uid);
  if (!u) return res.status(401).json({ error: '账号不存在' });
  req.user = u;
  next();
}

// ============================================================
// App + HTTP server + Socket.io
// ============================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---- health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'VVeChat OS', version: '1.0.0' });
});

// ---- register
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: '用户名长度 2-20' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: '用户名已被注册' });
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare(
    `INSERT INTO users (username, password_hash, avatar_color, bio, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(username, hash, pickColor(), '', now());
  const uid = r.lastInsertRowid;
  // auto-join official group
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(OFFICIAL_GROUP_ID, uid, now());
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  res.json({ token: signToken(uid, u.username), user: publicUser(u) });
});

// ---- login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  if (!bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: '密码错误' });
  res.json({ token: signToken(u.id, u.username), user: publicUser(u) });
});

// ---- me
app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---- groups
app.get('/api/groups', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT g.id, g.name, g.is_official, g.owner_id, g.icon_color,
           (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
    ORDER BY g.is_official DESC, g.id ASC
  `).all(req.user.id);
  res.json({ groups: rows });
});

// ---- friends
app.get('/api/friends', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar_color, u.bio
    FROM friends f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.username
  `).all(req.user.id);
  res.json({ friends: rows });
});

// ---- conversations
app.get('/api/conversations', authRequired, (req, res) => {
  const uid = req.user.id;
  // groups
  const groups = db.prepare(`
    SELECT g.id, g.name AS username, g.icon_color AS avatar_color, 'group' AS type, g.is_official,
           (SELECT content FROM messages WHERE conv_type='group' AND conv_id=CAST(g.id AS TEXT) AND is_deleted=0 ORDER BY id DESC LIMIT 1) AS last_message,
           (SELECT sender_id FROM messages WHERE conv_type='group' AND conv_id=CAST(g.id AS TEXT) AND is_deleted=0 ORDER BY id DESC LIMIT 1) AS last_sender_id,
           (SELECT created_at FROM messages WHERE conv_type='group' AND conv_id=CAST(g.id AS TEXT) AND is_deleted=0 ORDER BY id DESC LIMIT 1) AS last_at
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
    ORDER BY g.is_official DESC, g.id ASC
  `).all(uid);
  // friends (1v1)
  const friends = db.prepare(`
    SELECT u.id, u.username, u.avatar_color, 'user' AS type
    FROM friends f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.username
  `).all(uid);
  // 1v1 last message
  const lastUser = db.prepare(`
    SELECT content, sender_id, created_at FROM messages
    WHERE conv_type='user' AND conv_id = ? AND is_deleted = 0
    ORDER BY id DESC LIMIT 1
  `);
  const out = [];
  for (const g of groups) {
    out.push({ ...g, unread: 0, is_official: !!g.is_official, last_message: g.last_message || '', last_sender_id: g.last_sender_id, last_at: g.last_at || 0 });
  }
  for (const f of friends) {
    const m = lastUser.get(userConvId(uid, f.id));
    out.push({ ...f, unread: 0, is_official: 0, last_message: (m && m.content) || '', last_sender_id: m && m.sender_id, last_at: m && m.created_at || 0 });
  }
  // sort: official first, then by last_at desc
  out.sort((a, b) => (b.is_official | 0) - (a.is_official | 0) || (b.last_at || 0) - (a.last_at || 0));
  res.json({ conversations: out });
});

// ---- messages
app.get('/api/messages', authRequired, (req, res) => {
  const { conv_type, conv_id, limit } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  if (conv_type === 'user') {
    // authorize
    const other = Number(conv_id);
    if (!Number.isFinite(other)) return res.status(400).json({ error: 'conv_id 错误' });
    const isFriend = db.prepare('SELECT 1 FROM friends WHERE user_id=? AND friend_id=?').get(req.user.id, other);
    if (req.user.id !== other && !isFriend) return res.status(403).json({ error: '需要先加好友' });
    const rows = db.prepare(`
      SELECT m.*, u.username AS sender_username
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conv_type='user' AND m.conv_id = ? AND m.is_deleted = 0
      ORDER BY m.id DESC LIMIT ?
    `).all(userConvId(req.user.id, other), lim);
    res.json({ messages: rows.reverse() });
  } else if (conv_type === 'group') {
    const gid = Number(conv_id);
    if (!Number.isFinite(gid)) return res.status(400).json({ error: 'conv_id 错误' });
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id);
    if (!isMember) return res.status(403).json({ error: '不在群里' });
    const rows = db.prepare(`
      SELECT m.*, u.username AS sender_username, u.is_admin AS sender_is_admin
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conv_type='group' AND m.conv_id = ? AND m.is_deleted = 0
      ORDER BY m.id DESC LIMIT ?
    `).all(String(gid), lim);
    // patch is_admin
    for (const r of rows) r.is_admin = r.sender_is_admin;
    res.json({ messages: rows.reverse() });
  } else {
    res.status(400).json({ error: 'conv_type 错误' });
  }
});

// ---- send message
app.post('/api/messages', authRequired, (req, res) => {
  const { conv_type, conv_id, content } = req.body || {};
  if (!content || !String(content).trim()) return res.status(400).json({ error: '内容为空' });
  if (String(content).length > 2000) return res.status(400).json({ error: '内容过长' });
  if (conv_type === 'user') {
    const other = Number(conv_id);
    if (!Number.isFinite(other)) return res.status(400).json({ error: 'conv_id 错误' });
    const isFriend = db.prepare('SELECT 1 FROM friends WHERE user_id=? AND friend_id=?').get(req.user.id, other);
    if (req.user.id !== other && !isFriend) return res.status(403).json({ error: '需要先加好友' });
    const conv = userConvId(req.user.id, other);
    const r = db.prepare(`INSERT INTO messages (conv_type, conv_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('user', conv, req.user.id, String(content).trim(), now());
    const msg = db.prepare(`SELECT m.*, u.username AS sender_username FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(r.lastInsertRowid);
    msg.is_admin = req.user.username === ADMIN_USERNAME;
    io.to(`u:${req.user.id}`).to(`u:${other}`).emit('message:new', msg);
    res.json({ message: msg });
  } else if (conv_type === 'group') {
    const gid = Number(conv_id);
    if (!Number.isFinite(gid)) return res.status(400).json({ error: 'conv_id 错误' });
    const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.user.id);
    if (!isMember) return res.status(403).json({ error: '不在群里' });
    const r = db.prepare(`INSERT INTO messages (conv_type, conv_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('group', String(gid), req.user.id, String(content).trim(), now());
    const msg = db.prepare(`SELECT m.*, u.username AS sender_username FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(r.lastInsertRowid);
    msg.is_admin = req.user.username === ADMIN_USERNAME;
    io.to(`g:${gid}`).emit('message:new', msg);
    res.json({ message: msg });
  } else {
    res.status(400).json({ error: 'conv_type 错误' });
  }
});

// ---- friends management (optional helpers)
app.post('/api/friends/add', authRequired, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username 必填' });
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.id === req.user.id) return res.status(400).json({ error: '不能加自己' });
  // mutual add
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, since) VALUES (?, ?, ?)').run(req.user.id, target.id, now());
  db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, since) VALUES (?, ?, ?)').run(target.id, req.user.id, now());
  res.json({ ok: true });
});

app.get('/api/users/search', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 1) return res.json({ users: [] });
  const rows = db.prepare(`SELECT id, username, avatar_color FROM users WHERE username LIKE ? AND id != ? LIMIT 20`)
    .all('%' + q + '%', req.user.id);
  res.json({ users: rows });
});

// ============================================================
// Static frontend
// ============================================================
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR, {
    maxAge: 0,
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0'),
  }));
  app.get('*', (req, res, next) => {
    const p = req.path || '';
    if (p.startsWith('/api/') || p.startsWith('/socket.io/')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
  console.log('[VVeChat] serving frontend from', FRONTEND_DIR);
}

// ============================================================
// HTTP + Socket.io bootstrap
// ============================================================
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('no token'));
  const p = verifyToken(token);
  if (!p) return next(new Error('bad token'));
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.uid);
  if (!u) return next(new Error('no user'));
  socket.user = u;
  next();
});

io.on('connection', (socket) => {
  const u = socket.user;
  socket.join(`u:${u.id}`);
  // auto-join all group rooms
  const myGroups = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(u.id);
  for (const g of myGroups) socket.join(`g:${g.group_id}`);
  console.log('[VVeChat] socket connected', u.username);
  socket.on('disconnect', () => console.log('[VVeChat] socket disconnected', u.username));
});

// Global guards
process.on('uncaughtException', (e) => console.error('[VVeChat] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[VVeChat] unhandledRejection:', e));

server.listen(PORT, () => {
  console.log(`[VVeChat OS 1.0.0] listening on http://0.0.0.0:${PORT}`);
});
