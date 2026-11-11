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
const { createFirewall } = require('./firewall.js');
const crypto = require('crypto');
const authCrypto = require('./auth-crypto.js');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vvechat-dev-secret-change-me';
// 管理员账号名。种子账号在启动时就要用它,所以得定义在前面。
const ADMIN_USERNAME = 'Jack';
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
    icon_emoji TEXT,
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

  -- 上传的文件。文件本身存在磁盘上,数据库只记元信息。
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mime TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    conv_type TEXT,
    conv_id TEXT,
    created_at INTEGER NOT NULL
  );

  -- Runtime configuration for the AI relay (so the admin can plug in a key
  -- from the UI instead of editing Render's environment variables).
  CREATE TABLE IF NOT EXISTS ai_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- AI conversations. The panel keeps a list of chats on the left, the way
  -- a chat app should, and each chat owns its own message history.
  CREATE TABLE IF NOT EXISTS ai_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    model TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ai_chats_user ON ai_chats(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL,           -- 'user' | 'assistant'
    content TEXT NOT NULL DEFAULT '',
    reasoning TEXT,              -- the model's chain of thought, if any
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ai_chat_msgs ON ai_chat_messages(chat_id, id);

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

  -- Joining a group someone else created is an application, not a
  -- one-tap action: the owner (or Jack) has to say yes first.
  CREATE TABLE IF NOT EXISTS group_join_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_group_requests ON group_join_requests(group_id, status);

  CREATE TABLE IF NOT EXISTS read_receipts (
    conv_type TEXT NOT NULL,
    conv_id    TEXT NOT NULL,        -- user chat: normalized u_x_y ; group: numeric group id as text
    user_id    INTEGER NOT NULL,
    last_read_msg_id INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (conv_type, conv_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    images TEXT NOT NULL DEFAULT '[]',
    likes TEXT NOT NULL DEFAULT '[]',
    comments TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
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
  // 群头像 emoji（自建群随机分配，也可以建群时自己挑）
  if (!names.has('icon_emoji')) db.exec("ALTER TABLE groups ADD COLUMN icon_emoji TEXT");
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
// 550C boot theme — per-account preference for the startup animation
ensureColumn('users', 'boot_550c', 'INTEGER NOT NULL DEFAULT 0');
// Personalisation preferences: the assistant answering in groups, a
// denser list, a bigger type size and a 12-hour clock.
ensureColumn('users', 'ai_in_groups', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'density', "TEXT NOT NULL DEFAULT 'normal'");
ensureColumn('users', 'font_scale', 'REAL NOT NULL DEFAULT 1');
ensureColumn('users', 'clock24', 'INTEGER NOT NULL DEFAULT 1');
// title_mode: 'auto' = 还没命名(等 Qwen 起名) | 'named' = Qwen 起好了
//             'manual' = 用户自己改过,谁也别动
ensureColumn('ai_chats', 'title_mode', "TEXT NOT NULL DEFAULT 'auto'");
ensureColumn('messages', 'type', "TEXT NOT NULL DEFAULT 'text'");
ensureColumn('messages', 'meta', 'TEXT');
ensureColumn('messages', 'reply_to', 'INTEGER');
ensureColumn('messages', 'is_deleted', "INTEGER NOT NULL DEFAULT 0");

// ---------- 密码 pepper ----------
// pepper = 服务端密钥(JWT_SECRET)⊕数据库里的随机盐。
// 盐在库里、密钥不在 —— 整库被拖走也算不出 pepper,密码只剩不可逆的哈希。
// 密码本身走 auth-crypto.js:普通用户 3 层,管理员 5 层。
function serverSalt() {
  db.exec('CREATE TABLE IF NOT EXISTS app_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
  let row = db.prepare('SELECT value FROM app_secrets WHERE name = ?').get('pepper_salt');
  if (!row) {
    const v = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT OR IGNORE INTO app_secrets (name, value) VALUES (?, ?)').run('pepper_salt', v);
    row = { value: v };
  }
  return row.value;
}
const SERVER_STARTED_AT = now();
const PEPPER_SALT = serverSalt();
const PEPPER1 = crypto.createHmac('sha256', JWT_SECRET).update(PEPPER_SALT + ':1').digest();
const PEPPER2 = crypto.createHmac('sha512', JWT_SECRET).update(PEPPER_SALT + ':2').digest();

function hashFor(plain, username) {
  return authCrypto.hashPassword(plain, {
    pepper1: PEPPER1, pepper2: PEPPER2,
    admin: username === ADMIN_USERNAME,
  });
}
function verifyAny(plain, stored) {
  if (authCrypto.isLegacyHash(stored)) return authCrypto.verifyLegacy(plain, stored);
  return authCrypto.verifyPassword(plain, stored, { pepper1: PEPPER1, pepper2: PEPPER2 });
}

// ---------- helpers ----------
function now() { return Date.now(); }
// The assistant's account name. Declared up here because userPublic()
// needs it and userPublic() is defined above the seed block.
// 它一路叫过来:Qwen → AI → Jacky Bot。
// 侧边栏和 AI 窗口的按钮写「AI」(短、好认),但账号本身还是「Jacky Bot」——
// 它是个真人账号,历史消息、@、群成员名册里都得显示真名。
let ASSISTANT_NAME = 'Jacky Bot';
// 老库里的助手账号就地改名,历史消息里的名字也跟着变。
// 万一已经有人自己叫了 Jacky Bot,就让老名字留着,不影响别的功能。
try {
  const old = db.prepare("SELECT id, username FROM users WHERE username IN ('Qwen', 'AI')").get();
  if (old) {
    const clash = db.prepare('SELECT id FROM users WHERE username = ?').get('Jacky Bot');
    if (!clash) {
      db.prepare("UPDATE users SET username = 'Jacky Bot' WHERE id = ?").run(old.id);
    } else {
      ASSISTANT_NAME = old.username;
      console.warn('[VVeChat] "Jacky Bot" is taken by a real user; assistant keeps the name', old.username);
    }
  }
} catch (e) {
  console.warn('[VVeChat] assistant rename skipped:', e.message);
}
function userPublic(u) {
  return {
    id: u.id,
    username: u.username,
    avatar: u.avatar || null,
    bio: u.bio || null,
    avatar_color: u.avatar_color || null,
    avatar_emoji: u.avatar_emoji || null,
    boot_550c: u.boot_550c ? 1 : 0,
    ai_in_groups: u.ai_in_groups === undefined ? 1 : (u.ai_in_groups ? 1 : 0),
    density: u.density || 'normal',
    font_scale: Number(u.font_scale) > 0 ? Number(u.font_scale) : 1,
    clock24: u.clock24 === undefined ? 1 : (u.clock24 ? 1 : 0),
    is_admin: u.username === ADMIN_USERNAME,
    // 助手(Qwen)是个真实账号,但它在群里不是「人」。
    is_assistant: u.username === ASSISTANT_NAME ? 1 : 0,
  };
}
function ensureOfficialGroup() {
  const row = db.prepare('SELECT id FROM groups WHERE is_official = 1 LIMIT 1').get();
  if (row) {
    // 官方群头像统一是 🛡️ —— 老库里的官方群补一次。
    db.prepare("UPDATE groups SET icon_emoji = '🛡️' WHERE id = ? AND (icon_emoji IS NULL OR icon_emoji = '')").run(row.id);
    return row.id;
  }
  const info = db.prepare(
    'INSERT INTO groups (name, owner_id, is_official, icon_emoji, created_at) VALUES (?, NULL, 1, ?, ?)'
  ).run('VVeChat 官方群', '🛡️', now());
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
// Self-heal on boot: friendships must be SYMMETRIC.
//
// Every current code path inserts both directions, but older rows (and any
// row written by an earlier build) can be one-way. A one-way row means the
// friend sees the other person in their list while the other side does
// not — which reads as "my friends vanished when I signed in on another
// device", even though the data is on the server.
//
// Mirroring every row fixes it in place, and INSERT OR IGNORE makes it
// idempotent.
// ============================================================
try {
  const mirrored = db.prepare(
    'INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) ' +
    'SELECT friend_id, user_id, created_at FROM friends'
  ).run();
  if (mirrored.changes) {
    console.log(`[VVeChat] friend self-heal: mirrored ${mirrored.changes} one-way row(s)`);
  }
} catch (e) {
  console.error('[VVeChat] friend self-heal failed:', e.message);
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
    ).run('Jack', hashFor('Zhr121005', 'Jack'), '#fbbf24', 'VVeChat 官方管理员', now());
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


// ============================================================
// The assistant as a group member.
//
// People call it by name — "@Qwen …" — and it answers with the
// group's own context, in the voice of someone who has been sitting
// in the chat the whole time. It is a real account, so it shows up in
// the member list and can be picked from the @ picker like anybody
// else.
// ============================================================
let assistantId = 0;
try {
  let row = db.prepare('SELECT id FROM users WHERE username = ?').get(ASSISTANT_NAME);
  // 老账号的简介还是中文,顺手换成中英文一样的说法。
  if (row) db.prepare("UPDATE users SET bio = 'VVeChat Jacky Bot' WHERE id = ? AND bio IN ('VVeChat 助手','VVeChat AI')").run(row.id);
  if (!row) {
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, avatar_color, bio, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(ASSISTANT_NAME, hashFor(require('crypto').randomBytes(24).toString('hex'), ASSISTANT_NAME),
      '#4fd1c5', 'VVeChat Jacky Bot', now());
    row = { id: info.lastInsertRowid };
    console.log('[VVeChat] seeded assistant account:', ASSISTANT_NAME);
  }
  assistantId = row.id;
  // He belongs to every group, so "@Qwen" is always available.
  const groups = db.prepare('SELECT id FROM groups').all();
  const addMember = db.prepare(
    'INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)'
  );
  for (const g of groups) addMember.run(g.id, assistantId, now());
} catch (e) {
  console.error('[VVeChat] assistant seed failed:', e.message);
}

// 文件传输助手 —— 专门用来收发文件的系统账号(相当于微信的"文件传输助手")。
// 它是个真人账号,所以能像别人一样出现在好友列表里、能收能发文件。
const FILE_ASSISTANT_NAME = '文件传输助手';
try {
  const row = db.prepare('SELECT id, avatar_emoji FROM users WHERE username = ?').get(FILE_ASSISTANT_NAME);
  if (!row) {
    db.prepare(
      `INSERT INTO users (username, password_hash, avatar_color, avatar_emoji, bio, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(FILE_ASSISTANT_NAME, hashFor(require('crypto').randomBytes(24).toString('hex'), FILE_ASSISTANT_NAME),
      '#60a5fa', '📁', 'VVeChat 文件传输助手', now());
    console.log('[VVeChat] seeded file transfer assistant');
  } else if (!row.avatar_emoji) {
    // 老库里的这个账号没有表情头像,补上。
    db.prepare('UPDATE users SET avatar_emoji = ? WHERE id = ?').run('📁', row.id);
  }
} catch (e) {
  console.error('[VVeChat] file assistant seed failed:', e.message);
}

// 注册/登录时给的默认联系人:Jack、Jacky Bot、文件传输助手。
// 好友关系是双向的 —— 两边都得有对方,才能互相发消息。
function seedDefaultContacts(userId) {
  const ins = db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)');
  for (const name of [ADMIN_USERNAME, ASSISTANT_NAME, FILE_ASSISTANT_NAME]) {
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
    if (!u || u.id === userId) continue;
    ins.run(userId, u.id, now());
    ins.run(u.id, userId, now());
  }
}

// Is this message calling the assistant by name?
// 群里它叫 Jacky Bot,老的 @Qwen 也还认。
function mentionsAssistant(text) {
  return /(^|[^\w@])@(qwen|jacky[\s]?bot|ai|助手|千问)(?![a-z0-9_])/i.test(String(text || ''));
}

// Ask the model, with the group chat as the context.
async function assistantAnswer(question, context, kind) {
  const catalog = aiModelCatalog().filter((m) => m.ready);
  if (!catalog.length) return null;

  // 群里谁用什么语言说话,就用什么语言接话。
  const sample = String(question || '').trim() ||
    (context && context.length ? String(context[context.length - 1].content || '') : '');
  const useZh = /[\u4e00-\u9fa5]/.test(sample);
  const langLine = useZh ? '默认用简体中文。' : 'Reply in English.';

  const system = kind === 'chime'
    ? [
      '你叫 AI，是这个群聊里的一位成员。',
      '此刻没有人问你话 —— 你只是坐在群里，听到大家聊得热闹，想接一两句。',
      '接话要自然：一两句就够，绝不超过三句；不要提问、不要罗列要点、不要加小标题。',
      '内容要对得上刚才大家在聊的事，别凭空另开一个话题。',
      '不要出现「作为一个AI」「作为一个助手」这类说法。',
      langLine
    ].join('\n')
    : kind === 'dm'
    ? [
      '你叫 Jacky Bot，是 VVeChat 里的助手。现在是你跟用户一对一聊天。',
      '请像真人一样回话：口语、简短、直接，通常一两句话,别写成报告。',
      '不要出现「作为一个AI」「作为一个助手」这类说法，也不要罗列要点或加小标题。',
      '不知道的就直说没看到相关信息，别编。',
      langLine
    ].join('\n')
    : [
      '你叫 Jacky Bot，是这个群聊里的一位成员。大家聊天时会喊你一声，你就把话接过来。',
      '请像真人一样回话：口语、简短、直接，最多两三句话。',
      '不要出现「作为一个AI」「作为一个助手」这类说法，也不要罗列要点或加小标题。',
      '如果上下文里找不到答案，就直接说没看到相关信息，别编。',
      langLine
    ].join('\n');

  const messages = [{ role: 'system', content: system }];
  for (const c of context) {
    messages.push({ role: c.role === 'assistant' ? 'assistant' : 'user', content: c.content.slice(0, 1200) });
  }
  // 自主发言没有「问题」—— 塞一句指令当最后一轮,别给模型一个空的用户消息。
  const ask = kind === 'chime'
    ? '（群里正在聊天，你安静地插一句。）'
    : String(question || '').slice(0, 2000);
  messages.push({ role: 'user', content: ask });

  for (const entry of catalog) {
    const provider = QWEN_PROVIDERS[entry.provider];
    if (!provider) continue;
    const key = aiProviderKey(entry.provider);
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key;
    const body = {
      model: entry.model,
      messages,
      stream: true,
      temperature: 0.6,
      // The public Qwen models think before they answer, and the trace
      // eats most of the budget: too small and the answer never comes.
      max_tokens: 8192
    };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const resp = await fetch(provider.base + provider.path, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!resp.ok || !resp.body) {
        console.warn('[VVeChat] assistant: ' + entry.id + ' returned ' + resp.status);
        continue;
      }

      // Read the stream and keep only the answer text — the reasoning
      // trace is dropped on the floor, the group only gets the reply.
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '', out = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          // The stream is SSE: every chunk is "data: {json}".
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let j;
          try { j = JSON.parse(payload); } catch (_) { continue; }
          const ch = j && j.choices && j.choices[0];
          if (!ch) continue;
          const d = ch.delta || {};
          // The thinking trace (d.reasoning / d.reasoning_content) is
          // deliberately dropped — the group gets the answer, not the
          // scratch work.
          if (d.content) out += String(d.content);
        }
      }
      const text = out.trim();
      console.log('[VVeChat] assistant answered on', entry.id, text.length, 'chars');
      if (text) return text;
    } catch (e) {
      console.warn('[VVeChat] assistant answer failed on', entry.id, e.message);
    }
  }
  console.warn('[VVeChat] assistant: every source failed');
  return null;
}

// Pull the recent group conversation so the assistant knows what people
// are talking about.
function groupContext(groupId, limit) {
  const rows = db.prepare(`
    SELECT m.sender_id, u.username, m.content, m.type,
           (SELECT q.content FROM messages q WHERE q.id = m.reply_to) AS quoted
    FROM messages m LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.conv_type = 'group' AND m.conv_id = ? AND m.is_deleted = 0 AND m.type = 'text'
    ORDER BY m.id DESC LIMIT ?
  `).all(String(groupId), limit || 24).reverse();
  return rows.map((r) => ({
    role: r.sender_id === assistantId ? 'assistant' : 'user',
    content: (r.username || '某人') + '：' + quotePrefix(r.quoted) + String(r.content || '')
  }));
}

// 引用回复:被引用的那段话也得进上下文,不然助手「看不到我引了什么」。
function quotePrefix(quoted) {
  const q = String(quoted || '').trim();
  if (!q) return '';
  return '[引用] ' + q.slice(0, 600) + '\n';
}

// 单聊的上下文 —— 给「私聊里的 Jacky Bot」用。
function userContext(convId, limit) {
  const rows = db.prepare(`
    SELECT m.sender_id, u.username, m.content, m.type,
           (SELECT q.content FROM messages q WHERE q.id = m.reply_to) AS quoted
    FROM messages m LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.conv_type = 'user' AND m.conv_id = ? AND m.is_deleted = 0 AND m.type = 'text'
    ORDER BY m.id DESC LIMIT ?
  `).all(String(convId), limit || 24).reverse();
  return rows.map((r) => ({
    role: r.sender_id === assistantId ? 'assistant' : 'user',
    content: (r.sender_id === assistantId ? '' : (r.username ? r.username + '：' : ''))
      + quotePrefix(r.quoted) + String(r.content || '')
  }));
}

// 私聊里「只答最新一条」的守卫:conv_id -> { token, timer }
const pendingDm = new Map();

// ============================================================
// 助手自主发言 —— 24 小时待命的那位
// ------------------------------------------------------------
// 每 2 分钟巡一圈:看看哪些群正在热闹(最近有人说话),
// 有的话就自己接一两句,像一直坐在群里的那个人。
// 「不定时」= 每轮按概率决定说不说,不会每两分钟准点冒泡。
// 设 AUTO_CHIME=off 可以整个关掉。
// ============================================================
const AUTO_CHIME_ON = String(process.env.AUTO_CHIME || '').toLowerCase() !== 'off';
const AUTO_CHIME_INTERVAL = 2 * 60 * 1000;   // 2 分钟一圈
const AUTO_CHIME_PROB = 0.35;               // 每轮参与的随机概率
const AUTO_CHIME_ACTIVE = 10 * 60 * 1000;   // 10 分钟内有人说话才算「有热闹」
const AUTO_CHIME_MIN_HUMAN = 3;             // 至少这么多条真人消息才接话
const AUTO_CHIME_COOLDOWN = 20 * 60 * 1000; // 同一个群 20 分钟只接一次

let _chimeBusy = false;
async function assistantAutoChime() {
  if (_chimeBusy || !assistantId) return;
  _chimeBusy = true;
  try {
    const groups = db.prepare(
      'SELECT group_id FROM group_members WHERE user_id = ?'
    ).all(assistantId);
    const since = now() - AUTO_CHIME_ACTIVE;
    for (const g of groups) {
      const gid = String(g.group_id);
      const recent = db.prepare(`
        SELECT sender_id FROM messages
        WHERE conv_type = 'group' AND conv_id = ? AND is_deleted = 0 AND type = 'text' AND created_at >= ?
      `).all(gid, since);
      const human = recent.filter((r) => r.sender_id !== assistantId);
      if (human.length < AUTO_CHIME_MIN_HUMAN) continue;      // 群里没人说话
      const mine = db.prepare(`
        SELECT created_at FROM messages
        WHERE conv_type = 'group' AND conv_id = ? AND sender_id = ? AND is_deleted = 0
        ORDER BY id DESC LIMIT 1
      `).get(gid, assistantId);
      if (mine && now() - mine.created_at < AUTO_CHIME_COOLDOWN) continue;  // 刚说过
      if (Math.random() > AUTO_CHIME_PROB) continue;           // 不定时
      const ctx = groupContext(gid, 20);
      if (!ctx.length) continue;
      const answer = await assistantAnswer('', ctx, 'chime');
      if (!answer) continue;
      const info = db.prepare(
        'INSERT INTO messages (conv_type, conv_id, sender_id, content, type, meta, reply_to, is_deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
      ).run('group', gid, assistantId, answer.slice(0, 4000), 'text', null, null, now());
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
      broadcastMessage(buildMessage({ ...row, sender_username: ASSISTANT_NAME }), 'group', g.group_id, assistantId);
      console.log('[VVeChat] AI joined the talk in group', g.group_id);
      return;   // 一轮只接一句,别刷屏
    }
  } catch (e) {
    console.warn('[VVeChat] auto chime failed:', e.message);
  } finally {
    _chimeBusy = false;
  }
}
if (AUTO_CHIME_ON) {
  setInterval(assistantAutoChime, AUTO_CHIME_INTERVAL).unref();
  setTimeout(assistantAutoChime, 30 * 1000).unref();   // 启动半分钟后先看一眼
}


function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, username: payload.username };
    // The group-assistant toggle lives on the account, so the message
    // endpoint can honour it without a second lookup.
    try {
      // 助手在群里恒定应答 —— 设置里的开关已经移除，用户表里的
      // ai_in_groups 字段保留只为兼容，不再影响行为。
      req.user.aiInGroups = true;
    } catch (_) { req.user.aiInGroups = true; }
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
  // 登录爆破:连续失败太多次,防火墙直接把这个 IP 封掉。
  try { firewall.noteAuthFailure(req); } catch (_) {}
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

// ---------- VVeChat 防火墙 ----------
// 挡在所有路由前面:路径穿越、敏感文件探测、注入载荷、扫描器、
// 登录爆破……每一次拦截都记一条事件(带来源 IP),控制台能看到。
const firewall = createFirewall({
  db,
  getIp: clientIp,
  log: (...a) => console.warn('[VVeChat]', ...a)
});
app.use(firewall.middleware);

// 24 小时待命的安全 agent:每 5 分钟自检一遍防火墙还活着没,
// 有异常就写进事件表 —— 控制台那边立刻能看到。
const firewallAgentGet = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'VVeChat-SelfCheck' } });
    try { await r.text(); } catch (_) {}
    return { status: r.status };
  } finally { clearTimeout(timer); }
};
firewall.startAgent(firewallAgentGet, 'http://127.0.0.1:' + PORT);

app.get('/api/health', (_, res) => res.json({ ok: true, name: 'VVeChat' }));

// ============ ADMIN (Jack-only, no separate key) ============
// The account with username "Jack" is the built-in admin.
// No external key. Jack authenticates normally with password 1234.
function isAdmin(user) { return user && user.username === ADMIN_USERNAME; }
function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: '需要 Jack 账号' });
  next();
}

// 记一条安全事件(防火墙的日志表)。
function recordSecurity(req, kind, severity, detail) {
  try {
    firewall.record({
      ip: clientIp(req), kind, severity,
      method: req.method, path: req.path,
      ua: req.headers && req.headers['user-agent'],
      action: 'logged', detail,
    });
  } catch (_) {}
}

// 诱导条件①:表单里藏了一个真人看不见、填表脚本会填的字段。
// 真人的浏览器不会填它 —— 填了就说明是脚本。
function honeypotTripped(req) {
  const b = req.body || {};
  const v = b.website || b.hp || b.url;
  return !!(v && String(v).trim());
}

// ------------------------------------------------------------
// 管理员关键操作的「二次验证」(第 5 层保护)
// 短时间内再验一次密码,换来的令牌只能用在这几个接口上,5 分钟过期。
// 就算攻击者偷到了登录态,没有当场再输入一次密码也动不了数据。
// ------------------------------------------------------------
app.post('/api/control/step-up', rateLimit('auth'), authRequired, requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: '需要密码' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u || !verifyAny(password, u.password_hash)) {
    recordSecurity(req, 'stepup_failed', 'high', 'Jack 关键操作的二次验证失败');
    return res.status(401).json({ error: '密码错误' });
  }
  const token = jwt.sign({ uid: u.id, purpose: 'stepup' }, JWT_SECRET, { expiresIn: '5m' });
  res.json({ ok: true, token, expires_in: 300 });
});

function requireStepUp(req, res, next) {
  const h = req.headers['x-step-up'] || (req.body && req.body.step_up);
  if (!h) return res.status(403).json({ error: '需要二次验证', need_step_up: true });
  try {
    const p = jwt.verify(h, JWT_SECRET);
    if (p.purpose !== 'stepup' || Number(p.uid) !== Number(req.user.id)) throw new Error('bad scope');
    next();
  } catch (_) {
    return res.status(403).json({ error: '二次验证已过期,请重新验证', need_step_up: true });
  }
}

// 诱导条件④:常见的「摸后门」路径。本项目里根本没有这些地址,
// 但脚本会挨个试 —— 记下来,就知道有人在扫。
const DECOY_PATHS = ['/api/administrator', '/api/panel', '/api/admin/users',
  '/api/admin/config', '/api/manager', '/api/backup'];
app.use(DECOY_PATHS, (req, res) => {
  recordSecurity(req, 'admin_probe', 'medium', '探测后台路径 ' + req.path);
  res.status(404).json({ error: 'not found' });
});
app.post('/api/admin/wipe', rateLimit('write'), authRequired, requireAdmin, requireStepUp, (req, res) => {
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
    const jackHash = hashFor('Zhr121005', 'Jack');
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
// 部署信息 —— 「我的数据到底存在哪、网址是多少」。
app.get('/api/control/deploy', authRequired, requireAdmin, (req, res) => {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT);
  const origin = proto + '://' + host;
  let dbSize = null, uploads = null;
  try { dbSize = fs.statSync(DB_FILE).size; } catch (_) {}
  try { uploads = fs.readdirSync(UPLOAD_DIR).length; } catch (_) {}
  res.json({
    origin,
    api_base: origin,
    // 前端和控制台是同一套仓库部署出来的,页面地址就是 origin。
    frontend_url: origin + '/',
    control_url: origin + '/control/',
    db_file: DB_FILE,
    db_size: dbSize,
    upload_dir: UPLOAD_DIR,
    upload_count: uploads,
    node: process.version,
    uptime_s: Math.round(process.uptime()),
    started_at: SERVER_STARTED_AT,
    jwt_secret_is_default: !process.env.JWT_SECRET,
    pepper_in_db: true,
  });
});

app.get('/api/control/snapshot', authRequired, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, avatar, avatar_color, avatar_emoji, bio, created_at,
           CASE WHEN username = ? THEN 1 ELSE 0 END AS is_assistant,
           CASE WHEN username IN (?, ?) THEN 1 ELSE 0 END AS is_system
    FROM users ORDER BY id ASC
  `).all(ASSISTANT_NAME, ASSISTANT_NAME, FILE_ASSISTANT_NAME);

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

  // 群列表也带上 —— 否则没人认领的群（owner 被删了）在管理台里找不到，
  // 清理脚本没法收尾。
  const groups = db.prepare(`
    SELECT g.id, g.name, g.is_official, g.owner_id, g.icon_emoji,
           (SELECT COUNT(*) FROM group_members m JOIN users u ON u.id = m.user_id
            WHERE m.group_id = g.id AND u.username <> ?) AS member_count
    FROM groups g ORDER BY g.id ASC
  `).all(ASSISTANT_NAME);
  res.json({ ok: true, generated_at: now(), users, groups, conversations, group_messages: groupMsgs });
});

// Delete one account and every trace of it (messages, friendships, requests).
app.post('/api/control/purge-user/:id', rateLimit('write'), authRequired, requireAdmin, requireStepUp, (req, res) => {
  const uid = Number(req.params.id);
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(uid);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.username === ADMIN_USERNAME) return res.status(400).json({ error: '不能注销管理员 Jack' });
  // Jacky Bot 和文件传输助手是系统账号:群里 @ 要人接话、文件要有地方放,
  // 注销了整站就瘸了 —— 直接挡掉。
  if (u.username === ASSISTANT_NAME || u.username === FILE_ASSISTANT_NAME) {
    return res.status(400).json({ error: '不能注销系统账号' });
  }

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
    // AI 对话也要跟着走 —— 不然删号之后 ai_chats 里还留着孤儿行
    db.prepare('DELETE FROM ai_chat_messages WHERE chat_id IN (SELECT id FROM ai_chats WHERE user_id = ?)').run(uid);
    db.prepare('DELETE FROM ai_chats WHERE user_id = ?').run(uid);
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
app.post('/api/control/format-all', rateLimit('write'), authRequired, requireAdmin, requireStepUp, (req, res) => {
  try {
    // 保留三个系统账号:管理员、群里的助手、文件传输助手。
    // 少了 Jacky Bot,群里的 @ 就没人接话了。
    const keep = [ADMIN_USERNAME, ASSISTANT_NAME, FILE_ASSISTANT_NAME];
    const keepIds = keep.map((n) => {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(n);
      return u ? u.id : -1;
    });
    db.exec(`
      DELETE FROM messages;
      DELETE FROM friends;
      DELETE FROM friend_requests;
      DELETE FROM read_receipts;
      DELETE FROM message_reactions;
      DELETE FROM group_members;
      DELETE FROM ai_chat_messages;
      DELETE FROM ai_chats;
      DELETE FROM files;
    `);
    const del = db.prepare('DELETE FROM users WHERE id NOT IN (?, ?, ?)');
    del.run(keepIds[0], keepIds[1], keepIds[2]);
    db.exec('DELETE FROM groups WHERE is_official = 0');
    OFFICIAL_GROUP_ID = ensureOfficialGroup();
    // Jack、Jacky Bot、文件传输助手 都回到官方群里,并互为好友。
    const addMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)');
    for (const uid of keepIds) {
      if (uid > 0) addMember.run(OFFICIAL_GROUP_ID, uid, now());
    }
    const jack = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME);
    if (jack) seedDefaultContacts(jack.id);
    io.emit('control:formatted', { at: now() });
    res.json({ ok: true, formatted: true, official_group_id: OFFICIAL_GROUP_ID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 防火墙 —— 控制台的安全中心
//   GET  /api/security/overview  概览 + 最近的事件(带攻击 IP)
//   POST /api/security/unblock   解封一个 IP
//   POST /api/security/scan      立刻跑一次安全 agent 自检
// ============================================================
app.get('/api/security/overview', authRequired, requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  res.json({
    ok: true,
    stats: firewall.snapshot(),
    events: firewall.listEvents(limit)
  });
});
app.post('/api/security/unblock', rateLimit('write'), authRequired, requireAdmin, (req, res) => {
  const ip = String((req.body || {}).ip || '').trim();
  if (!ip) return res.status(400).json({ error: '缺少 ip' });
  const had = firewall.unblock(ip);
  firewall.record({ ip, kind: 'manual_unblock', severity: 'low', action: 'logged', detail: '管理员手动解封' });
  res.json({ ok: true, removed: had });
});
app.post('/api/security/scan', rateLimit('write'), authRequired, requireAdmin, async (req, res) => {
  await firewall.runAgentCheck(firewallAgentGet, 'http://127.0.0.1:' + PORT);
  res.json({ ok: true, stats: firewall.snapshot() });
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
    labelEn: 'OVH Public Endpoint',
    base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    path: '/chat/completions',
    needKey: false,
    env: [],
    note: '匿名可用，无需密钥；同一 IP 每个模型 2 次/分钟',
    noteEn: 'Works anonymously with no key; 2 requests per minute per model per IP'
  },
  siliconflow: {
    label: 'SiliconFlow',
    labelEn: 'SiliconFlow',
    base: 'https://api.siliconflow.cn/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['RELAY_SILICONFLOW_KEY', 'SILICONFLOW_API_KEY'],
    note: '注册送 14 元，Qwen3-8B 等模型永久免费',
    noteEn: 'Sign up for ¥14 in credit; models such as Qwen3-8B stay free'
  },
  modelscope: {
    label: '魔搭 ModelScope',
    labelEn: 'ModelScope',
    base: 'https://api-inference.modelscope.cn/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['RELAY_MODELSCOPE_KEY', 'MODELSCOPE_API_KEY'],
    note: '魔搭社区推理 API，注册即免费（需绑定阿里云并实名）',
    noteEn: 'ModelScope community inference API — free after signup (Alibaba Cloud and ID required)'
  },
  groq: {
    label: 'Groq',
    labelEn: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['RELAY_GROQ_KEY', 'GROQ_API_KEY'],
    note: 'LPU 推理极快，免费额度 14400 次/天',
    noteEn: 'LPU inference is blazing fast — 14,400 free requests per day'
  },
  cerebras: {
    label: 'Cerebras',
    labelEn: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['RELAY_CEREBRAS_KEY', 'CEREBRAS_API_KEY'],
    note: '约 2600 tok/s，免费额度 100 万 token/天',
    noteEn: 'About 2,600 tok/s — 1M free tokens per day'
  },
  dashscope: {
    label: '阿里百炼',
    labelEn: 'Alibaba Bailian',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    path: '/chat/completions',
    needKey: true,
    env: ['DASHSCOPE_API_KEY', 'RELAY_DASHSCOPE_KEY'],
    note: '通义千问官方，新用户有免费额度；支持联网搜索与思考档位',
    noteEn: 'The official Tongyi Qianwen endpoint — free credit for new users, web search and thinking levels'
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
      providerLabelEn: p ? (p.labelEn || p.label) : m.provider,
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

// A greeting or a very short question does not need the internet. Searching
// for "你好" only produces noise — and the model then wastes its thinking
// on deciding whether it is supposed to use that noise.
function isTrivialQuery(raw) {
  const t = String(raw || '').trim().toLowerCase()
    .replace(/[\s。.!！?？~～,，、]/g, '');
  if (!t) return true;
  // Chinese short phrases ("你好" / "你是谁" / "在吗")
  if (t.length <= 4 && !/[a-z]{4,}/.test(t)) return true;
  // Small talk in English
  if (/^(hi|hello|hey|yo|ok|okay|thanks|thankyou|test|bot)$/.test(t)) return true;
  return false;
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
    // NOTE: the response is NOT closed here. The caller has to decide
    // whether this source actually answered — a model that only thought
    // and never wrote anything must not close the door on the sources
    // behind it. Closing it here is what made the client show
    // "没有收到回复" while the relay was still trying to recover.
    const finish = (err) => {
      if (done) return;
      done = true;
      if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
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
  const { message, history, model, thinking, level, search, chat_id } = req.body || {};
  const userMsg = String(message || '').trim();
  if (!userMsg) return res.status(400).json({ error: '消息不能为空' });

  // The chat this turn belongs to. When the client sends one, the turn is
  // appended to its history; otherwise the exchange is not persisted.
  const chat = chat_id ? aiChatOwned(chat_id, req.user.id) : null;
  const chatId = chat ? chat.id : null;
  // 这条对话还没起过名字(而且用户没手动改过)→ 让模型在回答第一行给出标题。
  const wantTitle = !!(chat && chat.title_mode === 'auto');
  const msgIsZh = /[\u4e00-\u9fa5]/.test(userMsg);

  // The 深度思考 toggle was removed from the UI, so the models that CAN
  // think now always do — the user asked to see the reasoning trace, not
  // to lose it. `thinking` is still honoured if a client sends it.
  const wantThink = thinking === undefined
    ? true
    : (thinking === true || thinking === 'true' || thinking === 'on');
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
  // 用户用什么语言提问,就用什么语言回答 —— 别再一律中文了。
  const BASE_SYSTEM = msgIsZh
    ? '你是 VVeChat 内置的通义千问（Qwen）助手。请用简体中文回答，简洁、直接、有条理；不确定的地方要明说。'
    : 'You are the Qwen assistant built into VVeChat. Answer in English — concise, direct and organized; say so when you are unsure.';
  // 第一轮对话:顺带起个名字。模型被要求把标题放在第一行,
  // 下面那道「门」会把它从正文里摘走,用户看不到。
  const TITLE_HINT = msgIsZh
    ? '\n\n【重要】回答的第一行必须先输出这一行格式的标题,然后再写正文：\n【标题:不超过12个字的标题】\n标题要概括这段对话的主题,不要引号,不要多余的话。'
    : '\n\n[IMPORTANT] The FIRST line of your answer must be a title in this format, then the body:\n[Title: a title of at most 12 words]\nThe title should summarize the topic. No quotes, no extra words.';
  let searchCtx = null;
  const getSearchCtx = async () => {
    if (searchCtx !== null) return searchCtx;
    const q = userMsg.slice(0, 200);
    if (isTrivialQuery(q)) {
      // Nothing worth searching for — say so and move on.
      try { res.write(JSON.stringify({ type: 'search', count: 0, skipped: true }) + '\n'); } catch (_) {}
      searchCtx = '';
      return searchCtx;
    }
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
      '这些结果只是参考：如果与问题无关，请直接忽略、基于你自己的知识回答，' +
      '不要为了「用上搜索结果」而硬套；如果确实相关，就依据它们回答，' +
      '并在结尾用「参考来源」列出用到的标题 + 链接：\n' +
      results.map((r, i) => (i + 1) + '. ' + r.title + '\n   ' + r.url + '\n   ' + r.snippet).join('\n');
    return searchCtx;
  };

  const errors = [];

  // ---- 第一行的「门」----
  // 模型被要求把标题放在第一行,但那一行不该让用户看见:
  // 先扣住第一行,认出来是标题就拿去当对话名,认不出来就原样放行。
  let sniffBuf = '';
  let sniffing = wantTitle;
  let pendingTitle = null;
  const forwardDelta = (text) => {
    try { res.write(JSON.stringify({ type: 'delta', text: String(text) }) + '\n'); } catch (_) {}
  };
  const gate = {
    write: (raw) => {
      if (!sniffing) { try { res.write(raw); } catch (_) {} return; }
      let obj = null;
      try { obj = JSON.parse(raw); } catch (_) {}
      if (!obj || obj.type !== 'delta') { try { res.write(raw); } catch (_) {} return; }
      sniffBuf += String(obj.text || '');
      const lines = sniffBuf.split('\n');
      const complete = lines.slice(0, -1);        // 完整的一行行
      // 模型喜欢在正文前面空两行,所以要找「第一行有字的内容」
      const idx = complete.findIndex((l) => l.trim().length > 0);
      if (idx < 0) {
        // 到现在还只有空行 —— 再等等,但别等太久
        if (sniffBuf.length > 120) { forwardDelta(sniffBuf); sniffBuf = ''; sniffing = false; }
        return;
      }
      const line = complete[idx];
      const before = complete.slice(0, idx).join('\n');
      const after = complete.slice(idx + 1).join('\n');
      const tail = lines[lines.length - 1] || '';
      const t = parseTitleLine(line, msgIsZh);
      if (t) {
        pendingTitle = t;                          // 标题行(和它前面的空行)不给用户看
        if (after) forwardDelta(after + '\n');
      } else {
        // 不是标题 —— 原样放行
        forwardDelta(before + '\n' + complete.slice(idx).join('\n') + '\n');
      }
      sniffing = false;
      sniffBuf = '';
      if (tail) forwardDelta(tail);
    }
  };
  const out = wantTitle ? gate : res;

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

    const messages = [{ role: 'system', content: BASE_SYSTEM + (wantTitle ? TITLE_HINT : '') }];
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
        // Accumulated for the chat history.
        let turnReasoning = '';
        let turnContent = '';
        const result = await relayStream(out, upstream.body, source, {
          onReasoning: (t) => {
            turnReasoning += String(t || '');
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
          onDelta: (t) => {
            turnContent += String(t || '');
            if (String(t || '').trim()) gotContent = true;
          },
          onFirst: () => {
            wrote = true;
            res.write(JSON.stringify({
              type: 'source',
              source: entry.provider,
              provider: entry.providerLabel,
              providerEn: entry.providerLabelEn || entry.providerLabel,
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
            // Drop the dead-end trace so the next model starts clean.
            try { res.write(JSON.stringify({ type: 'reset' }) + '\n'); } catch (_) {}
            wrote = false;
            break;
          }
          // This one answered. Close the stream properly.
          // 存库的回答里不能带标题那一行
          const savedContent = wantTitle ? stripTitleLine(turnContent, msgIsZh) : turnContent;
          aiSaveTurn(chatId, req.user.id, userMsg, turnReasoning, savedContent, entry.model);
          // 模型给了标题 → 当成这条对话的名字,推给前端改列表
          if (pendingTitle && chatId) {
            try {
              const upd = db.prepare(
                "UPDATE ai_chats SET title = ?, title_mode = 'named', updated_at = ? WHERE id = ? AND user_id = ? AND title_mode = 'auto'"
              ).run(pendingTitle, now(), chatId, req.user.id);
              if (upd.changes) {
                try { io.to(`user:${req.user.id}`).emit('ai:chat-title', { chat_id: chatId, title: pendingTitle }); } catch (_) {}
              }
            } catch (_) {}
          }
          try { res.write(JSON.stringify({ type: 'done', source: entry.provider, error: null, chatId: chatId || null }) + '\n'); } catch (_) {}
          try { res.end(); } catch (_) {}
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
          // Part of an answer already reached the client — finish it here.
          try { res.write(JSON.stringify({ type: 'done', source: entry.provider, error: null }) + '\n'); } catch (_) {}
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
      labelEn: QWEN_PROVIDERS[pid].labelEn || QWEN_PROVIDERS[pid].label,
      note: QWEN_PROVIDERS[pid].note,
      noteEn: QWEN_PROVIDERS[pid].noteEn || QWEN_PROVIDERS[pid].note,
      needKey: QWEN_PROVIDERS[pid].needKey,
      ready: aiProviderReady(pid),
      hasKey: !!aiProviderKey(pid)
    }))
  });
});

// ============================================================
// 让 Qwen 给对话起名字
// ------------------------------------------------------------
// 公共端点的模型「先想后答」,为了一句标题单独发一次请求要等 40 秒,
// 还要再占一次限流配额(同一 IP 每个模型 2 次/分钟)。所以改成:
// 第一轮对话时在系统提示里加一句「回答第一行先给标题」,模型顺带就给了。
//
// 那一行用户不该看见 —— 所以往客户端推流的时候过一道「门」:
// 第一行先扣下来,认出来是标题就拿去当对话名,认不出来就原样放行。
// ============================================================

// 认出「【标题:xxx】」这种第一行
function parseTitleLine(line, isZh) {
  const m = /^\s*[【\[]?\s*(?:标题|题目|title)\s*[:：]?\s*[】\]]?\s*(.*)$/i.exec(String(line || ''));
  if (!m) return null;
  return cleanAiTitle(m[1], isZh);
}

// 把模型给的标题收拾干净:去引号、去尾标点、限长
function cleanAiTitle(raw, isZh) {
  let t = String(raw || '').trim();
  if (!t) return null;
  // 只要第一行:模型有时会先客套一句再给标题
  const lines = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  t = lines[0] || '';
  t = t.replace(/^\s*[-*•\d.、)）]+\s*/, '');                 // 去掉 "1. " 之类的序号
  t = t.replace(/^[\"'“”「」『』【】\[\(（]+/, '').replace(/[\"'“”「」『』】\]\)）]+$/, '');
  t = t.replace(/[。.!,!?,?;；:：]+$/, '').trim();
  if (!t) return null;
  const max = isZh ? 18 : 42;
  if (t.length > max) t = t.slice(0, max).trim();
  return t || null;
}

// 把标题那一行从正文里摘掉(存进库的回答不该带标题)
function stripTitleLine(content, isZh) {
  const s0 = String(content || '');
  // 模型常常在标题前面空两行(先 "\n\n" 再写标题)。这些空行会被存进库,
  // 流式的时候看不出来,切回历史才暴露 —— 所以先吃掉开头的空白。
  const s = s0.replace(/^[\s\u3000]+/, '');
  const nl = s.indexOf('\n');
  if (nl < 0) return parseTitleLine(s, isZh) ? '' : s;
  const first = s.slice(0, nl);
  if (!parseTitleLine(first, isZh)) return s;
  // 标题行连同它后面的空行一起摘掉,正文直接从第一个字开始。
  return s.slice(nl + 1).replace(/^[\s\u3000]+/, '');
}

// ============================================================
// AI conversation history
// ============================================================
// A chat is owned by exactly one user. Everything is scoped by user_id so
// one account can never read another's AI history.
function aiChatOwned(chatId, userId) {
  return db.prepare('SELECT * FROM ai_chats WHERE id = ? AND user_id = ?').get(Number(chatId), Number(userId));
}

// Persist one turn (user message + the model's answer) and touch the chat.
// The first user message becomes the chat's title.
function aiSaveTurn(chatId, userId, userMsg, reasoning, content, model) {
  if (!chatId) return;
  const t = now();
  try {
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO ai_chat_messages (chat_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(chatId, 'user', userMsg, null, t);
      if (content) {
        db.prepare('INSERT INTO ai_chat_messages (chat_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(chatId, 'assistant', content, reasoning || null, t + 1);
      }
      const c = db.prepare('SELECT title FROM ai_chats WHERE id = ?').get(chatId);
      if (model) db.prepare('UPDATE ai_chats SET model = ? WHERE id = ?').run(model, chatId);
      if (c && (!c.title || c.title === '新对话')) {
        const title = String(userMsg).replace(/\s+/g, ' ').trim().slice(0, 28) || '新对话';
        db.prepare('UPDATE ai_chats SET title = ?, updated_at = ? WHERE id = ?').run(title, t, chatId);
      } else {
        db.prepare('UPDATE ai_chats SET updated_at = ? WHERE id = ?').run(t, chatId);
      }
    });
    tx();
  } catch (e) {
    console.error('[VVeChat] aiSaveTurn failed:', e.message);
  }
}

// List the user's chats, newest first.
app.get('/api/ai/chats', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.chat_id = c.id) AS message_count
    FROM ai_chats c WHERE c.user_id = ?
    ORDER BY c.updated_at DESC
  `).all(req.user.id);
  res.json({ chats: rows });
});

// Create a chat. The title is filled in from the first user message.
app.post('/api/ai/chats', rateLimit('write'), authRequired, (req, res) => {
  const model = String((req.body || {}).model || '').slice(0, 80) || null;
  const t = now();
  const info = db.prepare('INSERT INTO ai_chats (user_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, '新对话', model, t, t);
  const row = db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(info.lastInsertRowid);
  res.json({ chat: row });
});

// One chat with its full message list.
app.get('/api/ai/chats/:id', authRequired, (req, res) => {
  const chat = aiChatOwned(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: '对话不存在' });
  const messages = db.prepare('SELECT id, role, content, reasoning, created_at FROM ai_chat_messages WHERE chat_id = ? ORDER BY id ASC')
    .all(chat.id);
  res.json({ chat, messages });
});

// Rename a chat.
app.patch('/api/ai/chats/:id', rateLimit('write'), authRequired, (req, res) => {
  const chat = aiChatOwned(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: '对话不存在' });
  const title = String((req.body || {}).title || '').trim().slice(0, 60);
  if (!title) return res.status(400).json({ error: '标题不能为空' });
  // 用户自己改的名字:Qwen 之后不许再覆盖它
  db.prepare("UPDATE ai_chats SET title = ?, title_mode = 'manual', updated_at = ? WHERE id = ?").run(title, now(), chat.id);
  res.json({ chat: db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(chat.id) });
});

// Delete a chat and its messages.
app.delete('/api/ai/chats/:id', rateLimit('write'), authRequired, (req, res) => {
  const chat = aiChatOwned(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: '对话不存在' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ai_chat_messages WHERE chat_id = ?').run(chat.id);
    return db.prepare('DELETE FROM ai_chats WHERE id = ?').run(chat.id).changes;
  });
  const deleted = tx();
  res.json({ ok: true, deleted });
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
// 带错误码的失败响应 —— 前端要按界面语言显示,不能直接甩一句中文。
function fail(res, status, code, message) {
  return res.status(status).json({ error: message, code });
}
app.post('/api/register', rateLimit('auth'), (req, res) => {
  const { username, password, avatar, avatar_emoji } = req.body || {};
  if (!username || !password) return fail(res, 400, 'empty_credentials', '用户名和密码不能为空');
  if (username.length < 2 || username.length > 24) return fail(res, 400, 'invalid_username', '用户名长度需 2-24');
  if (password.length < 8) return fail(res, 400, 'short_password', '密码至少 8 位');
  // 诱导条件①:表单里藏了一个真人看不见、填表脚本会填的字段。
  if (honeypotTripped(req)) {
    recordSecurity(req, 'honeypot', 'high', '注册表单里的蜜罐字段被填了 —— 脚本');
    return fail(res, 400, 'honeypot', '注册失败');
  }
  // 诱导条件②:弱口令直接拒。
  if (authCrypto.isWeakPassword(password)) {
    return fail(res, 400, 'weak_password', '密码太弱:至少 8 位,别用 123456 / password 这类');
  }
  // Relaxed uniqueness: allow registration if EITHER the username OR the
  // password does not collide with any existing account. This means a user
  // can have multiple accounts as long as one of the two fields differs.
  // 密码哈希带随机盐,没法直接比字符串 —— 把真用户捞出来,拿密码去验。
  const sameBoth = db.prepare(
    'SELECT id, password_hash FROM users WHERE username = ?'
  ).get(username);
  if (sameBoth && verifyAny(password, sameBoth.password_hash)) {
    return fail(res, 409, 'username_password_taken', '用户名和密码都已被注册（请至少修改一项）');
  }

  // pick a fun color for new users (Jack is the official admin → signature gold)
  const palette = ['#5eead4','#60a5fa','#c084fc','#f472b6','#fbbf24','#fb923c','#4ade80','#22d3ee','#a78bfa','#f87171'];
  const color = username === 'Jack' ? '#fbbf24' : palette[Math.floor(Math.random() * palette.length)];

  const hash = hashFor(password, username);
  // 注册时选的头像:照片(base64 data URL)或一个表情。
  const regAvatar = typeof avatar === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(avatar)
    ? avatar : null;
  const regEmoji = typeof avatar_emoji === 'string' && [...avatar_emoji.trim()].length <= 4
    ? avatar_emoji.trim() : null;
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, avatar, bio, avatar_color, avatar_emoji, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(username, hash, regAvatar, '', color, regEmoji, now());
  const userId = info.lastInsertRowid;
  // auto-join official group
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(OFFICIAL_GROUP_ID, userId, now());
  // 默认联系人:Jack、Jacky Bot、文件传输助手。
  seedDefaultContacts(userId);
  const token = jwt.sign({ uid: userId, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: userPublic({ id: userId, username, avatar: null, bio: '', avatar_color: color }) });
});

// login
app.post('/api/login', rateLimit('auth'), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, 400, 'empty_credentials', '用户名和密码不能为空');
  if (honeypotTripped(req)) {
    recordSecurity(req, 'honeypot', 'high', '登录表单里的蜜罐字段被填了 —— 脚本');
    return fail(res, 401, 'bad_credentials', '用户名或密码错误');
  }
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) {
    // 账号不存在也要把 KDF 跑完,不然响应时间会泄露「这个账号不存在」。
    authCrypto.burnTime(PEPPER1);
    noteAuthFailure(req);
    return fail(res, 401, 'bad_credentials', '用户名或密码错误');
  }
  if (!verifyAny(password, u.password_hash)) {
    // 诱导条件③:用弱口令登录 —— 放行,但记一条,方便管理员提醒换密码。
    if (authCrypto.isWeakPassword(password)) {
      recordSecurity(req, 'weak_password', 'medium', `账号 ${u.username} 用了弱口令登录`);
    }
    noteAuthFailure(req);
    return fail(res, 401, 'bad_credentials', '用户名或密码错误');
  }
  // 老库里的 bcrypt 哈希,登录成功后顺手升级成分层哈希。
  if (authCrypto.isLegacyHash(u.password_hash)) {
    try {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(hashFor(password, u.username), u.id);
    } catch (e) { console.warn('[VVeChat] password upgrade failed:', e.message); }
  }
  // re-join official group if previously removed
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(OFFICIAL_GROUP_ID, u.id, now());
  // 老账号也补上默认联系人(第一次登录时种下)。
  seedDefaultContacts(u.id);
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
  const { bio, username, avatar_color, avatar, avatar_emoji, boot_550c,
    ai_in_groups, density, font_scale, clock24 } = req.body || {};
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
  // boot_550c: 550C startup-animation theme toggle (0 = off, 1 = on)
  if (boot_550c !== undefined) {
    updates.push('boot_550c = ?'); values.push(boot_550c ? 1 : 0);
  }
  if (ai_in_groups !== undefined) {
    updates.push('ai_in_groups = ?'); values.push(ai_in_groups ? 1 : 0);
  }
  if (density !== undefined) {
    updates.push('density = ?'); values.push(['compact', 'normal', 'roomy'].includes(density) ? density : 'normal');
  }
  if (font_scale !== undefined) {
    const f = Number(font_scale);
    updates.push('font_scale = ?'); values.push(f >= 0.9 && f <= 1.4 ? f : 1);
  }
  if (clock24 !== undefined) {
    updates.push('clock24 = ?'); values.push(clock24 ? 1 : 0);
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
    'SELECT id, username, avatar, bio, avatar_color, avatar_emoji FROM users WHERE username LIKE ? AND id != ? ORDER BY username LIMIT 20'
  ).all(`%${q}%`, req.user.id);
  res.json({ users: rows });
});

// search groups to join (substring match)

// ============================================================
// 朋友圈(日常)
// ------------------------------------------------------------
// 一条动态 = 文字 + 最多 9 张图 + 点赞 + 评论。
// 点赞和评论直接存 JSON 文本 —— 朋友圈不需要单独建表,省事。
// ============================================================
function packMoment(r) {
  let images = [], likes = [], comments = [];
  try { images = JSON.parse(r.images || '[]'); } catch (_) {}
  try { likes = JSON.parse(r.likes || '[]'); } catch (_) {}
  try { comments = JSON.parse(r.comments || '[]'); } catch (_) {}
  return {
    id: r.id, content: r.content, images, likes, comments, created_at: r.created_at,
    user: {
      id: r.user_id, username: r.username, avatar: r.avatar,
      avatar_color: r.avatar_color, avatar_emoji: r.avatar_emoji,
    },
  };
}
app.get('/api/moments', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, u.username, u.avatar, u.avatar_color, u.avatar_emoji
    FROM moments m JOIN users u ON u.id = m.user_id
    ORDER BY m.id DESC LIMIT 100
  `).all();
  res.json({ moments: rows.map(packMoment) });
});
app.post('/api/moments', rateLimit('write'), authRequired, (req, res) => {
  const { content = '', images = [] } = req.body || {};
  const text = String(content || '').slice(0, 1000).trim();
  const imgs = (Array.isArray(images) ? images : []).slice(0, 9)
    .filter(u => typeof u === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(u));
  if (!text && !imgs.length) return res.status(400).json({ error: '内容不能为空' });
  const info = db.prepare(
    'INSERT INTO moments (user_id, content, images, created_at) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, text, JSON.stringify(imgs), now());
  const row = db.prepare(`
    SELECT m.*, u.username, u.avatar, u.avatar_color, u.avatar_emoji
    FROM moments m JOIN users u ON u.id = m.user_id WHERE m.id = ?
  `).get(info.lastInsertRowid);
  const m = packMoment(row);
  try { io.emit('moment:new', m); } catch (_) {}
  res.json({ ok: true, moment: m });
});
app.post('/api/moments/:id/like', rateLimit('write'), authRequired, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM moments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '动态不存在' });
  let likes = [];
  try { likes = JSON.parse(row.likes || '[]'); } catch (_) {}
  const uid = Number(req.user.id);
  const mine = likes.find(l => Number(l.id) === uid);
  if (mine) likes = likes.filter(l => Number(l.id) !== uid);
  else likes.push({ id: uid, username: req.user.username });
  db.prepare('UPDATE moments SET likes = ? WHERE id = ?').run(JSON.stringify(likes), id);
  res.json({ ok: true, likes });
});
app.post('/api/moments/:id/comment', rateLimit('write'), authRequired, (req, res) => {
  const id = Number(req.params.id);
  const text = String((req.body || {}).text || '').slice(0, 300).trim();
  if (!text) return res.status(400).json({ error: '评论不能为空' });
  const row = db.prepare('SELECT * FROM moments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '动态不存在' });
  let comments = [];
  try { comments = JSON.parse(row.comments || '[]'); } catch (_) {}
  comments.push({
    id: Number(req.user.id), username: req.user.username,
    text, created_at: now(),
  });
  db.prepare('UPDATE moments SET comments = ? WHERE id = ?').run(JSON.stringify(comments), id);
  res.json({ ok: true, comments });
});
app.delete('/api/moments/:id', rateLimit('write'), authRequired, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM moments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '动态不存在' });
  if (Number(row.user_id) !== Number(req.user.id) && !isAdmin(req.user)) {
    return res.status(403).json({ error: '只能删自己的动态' });
  }
  db.prepare('DELETE FROM moments WHERE id = ?').run(id);
  res.json({ ok: true });
});

// online status of specific users
app.get('/api/users/status', authRequired, (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => Number(s)).filter(Boolean);
  if (!ids.length) return res.json({ status: {} });
  const status = {};
  for (const id of ids) status[id] = isUserOnline(id);
  res.json({ status });
});

// friends
app.get('/api/friends', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio, u.avatar_color, u.avatar_emoji
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
    SELECT g.id, g.name, g.is_official, g.owner_id, g.icon_color, g.icon_emoji, g.recommended, g.pinned, g.announcement,
           (SELECT COUNT(*) FROM group_members m JOIN users u ON u.id = m.user_id
            WHERE m.group_id = g.id AND u.username <> ?) AS member_count
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY g.is_official DESC, g.id ASC
  `).all(ASSISTANT_NAME, req.user.id);
  res.json({ groups: rows });
});

// ------------------------------------------------------------
// Creating a group.
//
// Whoever creates it owns it: the owner gets the same powers inside
// their own group that Jack has everywhere — rename it, remove
// members, set the announcement, turn the discover switch on and
// off, and approve join requests. Jack can do all of that to every
// group in the system.
// ------------------------------------------------------------
// 自建群的默认头像：随机一个 emoji。建群时用户也可以自己挑一个。
const GROUP_EMOJI_POOL = [
  '🦊','🐼','🐨','🦁','🐯','🐸','🐵','🐧','🐦','🦉',
  '🐶','🐱','🐭','🐹','🐰','🦄','🐝','🦋','🐢','🐙',
  '🌟','✨','🔥','💎','🎯','🚀','☕️','🍀','🌊','🌙',
  '👑','🧠','👾','🤖','👻','🎨','🎧','📷','🧩','🗝',
  '🍎','🍉','🍇','🍓','🍑','🥑','🌵','🌻','🌈','⛅',
  '🎮','🎧','🎬','📚','✏️','🖊','🧪','🔭','🧭','🗺️'
];
function pickGroupEmoji() {
  return GROUP_EMOJI_POOL[Math.floor(Math.random() * GROUP_EMOJI_POOL.length)];
}

app.post('/api/groups', rateLimit('write'), authRequired, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: '群名称不能为空' });
  if (name.length > 40) return res.status(400).json({ error: '群名称太长了' });
  const iconColor = String((req.body || {}).icon_color || '') || null;
  // 用户指定了就用用户的，没指定就随机一个。
  let iconEmoji = String((req.body || {}).icon_emoji || '').trim();
  if (iconEmoji) {
    // 只接受单个 emoji（按码点算长度，避免代理对被截断）
    const cps = Array.from(iconEmoji);
    if (cps.length !== 1) iconEmoji = '';
  }
  if (!iconEmoji) iconEmoji = pickGroupEmoji();
  const recommended = (req.body || {}).recommended ? 1 : 0;
  const info = db.prepare(
    'INSERT INTO groups (name, owner_id, is_official, icon_color, icon_emoji, recommended, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
  ).run(name, req.user.id, iconColor, iconEmoji, recommended, now());
  const gid = info.lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(gid, req.user.id, now());
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  res.json({ ok: true, group: groupPublic(g, req.user.id) });
});

// ------------------------------------------------------------
// 退出群聊 / 解散群聊
// ------------------------------------------------------------
// 这两条路由之前根本不存在 —— 前端点了「退出群聊」是 404，
// 「解散群聊」调的甚至是个不存在的函数，所以两个按钮都是死的。

// 退出群聊：把自己从成员表里摘掉。
app.post('/api/groups/:id/leave', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  const isMember = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, req.user.id);
  if (!isMember) return res.status(400).json({ error: '你不是这个群的成员' });

  const others = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ? ORDER BY joined_at ASC').all(gid, req.user.id);

  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(gid, req.user.id);

  // 群主走了：如果还有人，就把群主转给最早加入的那个；
  // 没人了就等于群自然消失了，一并清掉。
  if (Number(g.owner_id) === Number(req.user.id)) {
    if (others.length) {
      db.prepare('UPDATE groups SET owner_id = ? WHERE id = ?').run(others[0].user_id, gid);
      try { io.to(`group:${gid}`).emit('group:owner-changed', { group_id: gid, owner_id: others[0].user_id }); } catch (_) {}
    } else {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(gid);
      db.prepare('DELETE FROM groups WHERE id = ?').run(gid);
    }
  }
  try { io.to(`group:${gid}`).emit('group:member-left', { group_id: gid, user_id: req.user.id }); } catch (_) {}
  res.json({ ok: true, left: g.name, dissolved: !others.length && Number(g.owner_id) === Number(req.user.id) });
});

// 解散群聊：群主或管理员(Jack)可以，整群连消息一起清掉。
app.post('/api/groups/:id/disband', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, g)) return res.status(403).json({ error: '只有群主或管理员可以解散群聊' });
  if (g.is_official) return res.status(400).json({ error: '官方群不能解散' });

  const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(gid).map(r => r.user_id);
  db.prepare("DELETE FROM messages WHERE conv_type = 'group' AND conv_id = ?").run(String(gid));
  db.prepare('DELETE FROM group_members WHERE group_id = ?').run(gid);
  db.prepare('DELETE FROM group_join_requests WHERE group_id = ?').run(gid);
  db.prepare('DELETE FROM groups WHERE id = ?').run(gid);

  // 告诉群里所有人：群没了，收起对话
  for (const uid of members) {
    try { io.to(`user:${uid}`).emit('group:disbanded', { group_id: gid, name: g.name }); } catch (_) {}
  }
  try { io.emit('group:disbanded', { group_id: gid, name: g.name }); } catch (_) {}
  res.json({ ok: true, disbanded: g.name });
});

// ------------------------------------------------------------
// Discover: the groups other people made and chose to recommend.
// Only groups whose owner flipped the switch are listed.
// ------------------------------------------------------------
app.get('/api/groups/recommended', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT g.id, g.name, g.is_official, g.owner_id, g.icon_color, g.icon_emoji, g.recommended, g.pinned, g.announcement,
           (SELECT COUNT(*) FROM group_members m JOIN users u ON u.id = m.user_id
            WHERE m.group_id = g.id AND u.username <> ?) AS member_count,
           (SELECT username FROM users u WHERE u.id = g.owner_id) AS owner_name,
           (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS joined
    FROM groups g
    WHERE g.recommended = 1 AND g.is_official = 0
      AND g.id NOT IN (SELECT group_id FROM group_members WHERE user_id = ?)
    ORDER BY g.created_at DESC
  `).all(ASSISTANT_NAME, req.user.id, req.user.id);
  // A pending request is worth telling the user about, so the button
  // can say "已申请" instead of pretending nothing happened.
  const pending = new Set(
    db.prepare("SELECT group_id FROM group_join_requests WHERE user_id = ? AND status = 'pending'")
      .all(req.user.id).map(r => r.group_id)
  );
  res.json({
    groups: rows.map(g => ({ ...groupPublic(g, req.user.id), requested: pending.has(g.id) }))
  });
});

// ------------------------------------------------------------
// Apply to join a group. The owner approves it — same shape as a
// friend request.
// ------------------------------------------------------------
app.post('/api/groups/:id/requests', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  const already = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, req.user.id);
  if (already) return res.status(400).json({ error: '你已经在群里了' });
  const pending = db.prepare(
    "SELECT id FROM group_join_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'"
  ).get(gid, req.user.id);
  if (pending) return res.status(400).json({ error: '已发送过申请，等待群主处理' });
  const message = String((req.body || {}).message || '').slice(0, 200);
  const info = db.prepare(
    'INSERT INTO group_join_requests (group_id, user_id, message, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(gid, req.user.id, message || null, 'pending', now());
  // Tell the owner (and Jack) that somebody wants in.
  const targets = db.prepare(`
    SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?
  `).all(gid, req.user.id);
  const owner = g.owner_id ? Number(g.owner_id) : null;
  const notify = new Set(targets.map(t => t.user_id));
  if (owner) notify.add(owner);
  if (isAdmin(req.user)) notify.add(req.user.id);
  for (const uid of notify) {
    try {
      io.to(`user:${uid}`).emit('group:join-request', {
        id: info.lastInsertRowid, group_id: gid, group_name: g.name,
        user_id: req.user.id, username: req.user.username, message: message || null
      });
    } catch (e) { }
  }
  res.json({ ok: true });
});

// The owner's inbox of pending applications.
app.get('/api/groups/:id/requests', authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, g)) return res.status(403).json({ error: '只有群主或管理员可以查看申请' });
  const rows = db.prepare(`
    SELECT r.id, r.user_id, r.message, r.created_at, u.username, u.avatar, u.avatar_color, u.avatar_emoji
    FROM group_join_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.group_id = ? AND r.status = 'pending'
    ORDER BY r.created_at ASC
  `).all(gid);
  res.json({ requests: rows });
});

// Approve or reject an application.
app.post('/api/groups/:id/requests/:rid', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const rid = Number(req.params.rid);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, g)) return res.status(403).json({ error: '只有群主或管理员可以处理申请' });
  const r = db.prepare("SELECT * FROM group_join_requests WHERE id = ? AND group_id = ?").get(rid, gid);
  if (!r) return res.status(404).json({ error: '申请不存在' });
  if (r.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
  const accept = (req.body || {}).accept ? 1 : 0;
  db.prepare('UPDATE group_join_requests SET status = ? WHERE id = ?').run(accept ? 'accepted' : 'rejected', rid);
  if (accept) {
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
      .run(gid, r.user_id, now());
    try { io.to(`group:${gid}`).emit('group:member-added', { group_id: gid, user_id: r.user_id }); } catch (e) { }
  }
  try {
    io.to(`user:${r.user_id}`).emit('group:request-resolved', {
      id: rid, group_id: gid, group_name: g.name, accepted: !!accept
    });
  } catch (e) { }
  res.json({ ok: true, accepted: !!accept });
});

// group members
// Can `user` manage this group's membership? Owner or the built-in admin (Jack).
function canManageGroup(user, group) {
  if (!user || !group) return false;
  if (isAdmin(user)) return true;
  return Number(group.owner_id) === Number(user.id);
}

// The shape of a group as the client wants it.
function groupPublic(g, userId) {
  if (!g) return null;
  return {
    id: g.id,
    name: g.name,
    is_official: g.is_official ? 1 : 0,
    owner_id: g.owner_id == null ? null : Number(g.owner_id),
    icon_color: g.icon_color || null,
    icon_emoji: g.icon_emoji || null,
    recommended: g.recommended ? 1 : 0,
    pinned: g.pinned ? 1 : 0,
    announcement: g.announcement || null,
    member_count: g.member_count == null ? undefined : g.member_count,
    owner_name: g.owner_name || undefined,
    joined: g.joined == null ? undefined : (g.joined ? 1 : 0),
    requested: g.requested ? 1 : 0
  };
}

app.get('/api/groups/:id/members', authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const inGroup = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, req.user.id);
  if (!inGroup) return res.status(403).json({ error: 'not in group' });
  // 助手(ASSISTANT_NAME)也在成员表里(它是真人账号,要收群消息),
  // 但它不算「群成员」—— 前端不把它列进成员名册,只标个标记。
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio, u.avatar_color, u.avatar_emoji,
           (u.username = ?) AS is_assistant
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY u.username
  `).all(ASSISTANT_NAME, gid);
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
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(gid)) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, db.prepare('SELECT * FROM groups WHERE id = ?').get(gid))) {
    return res.status(403).json({ error: '只有群主或管理员可以添加成员' });
  }
  const memberId = Number((req.body || {}).memberId);
  if (!Number.isFinite(memberId)) return res.status(400).json({ error: '成员无效' });
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(memberId);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(gid, memberId, now());
  // Put their live socket into the room as well — otherwise they only get
  // the messages of groups they were already in when they connected.
  try { if (io) io.in(`user:${memberId}`).socketsJoin(`group:${gid}`); } catch (e) { }
  try { if (io) io.to(`group:${gid}`).emit('group:member-added', { group_id: gid, user_id: memberId }); } catch {}
  res.json({ ok: true });
});

// Remove a member. Owner or Jack only.
app.delete('/api/groups/:id/members/:uid', rateLimit('write'), authRequired, (req, res) => {
  // (the socket room is cleaned up below, right after the row is deleted)
  const gid = Number(req.params.id);
  const uid = Number(req.params.uid);
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(gid)) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, db.prepare('SELECT * FROM groups WHERE id = ?').get(gid))) {
    return res.status(403).json({ error: '只有群主或管理员可以移除成员' });
  }
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(gid, uid);
  try { if (io) io.in(`user:${uid}`).socketsLeave(`group:${gid}`); } catch (e) { }
  try { if (io) io.to(`group:${gid}`).emit('group:member-removed', { group_id: gid, user_id: uid }); } catch {}
  res.json({ ok: true });
});

// Members that are NOT in this group yet — powers the "添加成员" picker.
app.get('/api/groups/:gid/candidates', authRequired, (req, res) => {
  const gid = Number(req.params.gid);
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(gid)) return res.status(404).json({ error: '群不存在' });
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar_color FROM users u
    WHERE u.id != ? AND u.id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?)
    ORDER BY u.username LIMIT 100
  `).all(req.user.id, gid);
  res.json({ candidates: rows });
});

// Rename the official group. Jack only (the name is a shared label).
app.put('/api/groups/:id', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, g)) return res.status(403).json({ error: '只有群主或管理员可以修改群聊' });
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (name) {
    if (name.length > 40) return res.status(400).json({ error: '群名称不超过 40 字' });
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, gid);
    try { if (io) io.emit('group:renamed', { groupId: gid, name }); } catch {}
  }
  // The discover switch lives here too — the owner decides whether the
  // group shows up in Discover.
  if (body.recommended !== undefined) {
    const on = body.recommended ? 1 : 0;
    db.prepare('UPDATE groups SET recommended = ? WHERE id = ?').run(on, gid);
  }
  if (body.icon_color !== undefined) {
    db.prepare('UPDATE groups SET icon_color = ? WHERE id = ?').run(body.icon_color || null, gid);
  }
  // 置顶 —— 前端的勾选框一直发这个字段,服务端以前没接,所以点了没反应。
  if (body.pinned !== undefined) {
    db.prepare('UPDATE groups SET pinned = ? WHERE id = ?').run(body.pinned ? 1 : 0, gid);
    try { if (io) io.emit('group:updated', { groupId: gid, pinned: body.pinned ? 1 : 0 }); } catch {}
  }
  const fresh = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  res.json({ ok: true, group: groupPublic(fresh) });
});

// Announcement. Jack only.
app.post('/api/groups/:id/announcement', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  if (!canManageGroup(req.user, g)) return res.status(403).json({ error: '只有群主或管理员可以设置公告' });
  const text = String((req.body || {}).text || '').trim();
  if (text.length > 500) return res.status(400).json({ error: '公告不超过 500 字' });
  db.prepare('UPDATE groups SET announcement = ? WHERE id = ?').run(text || null, gid);
  try { if (io) io.emit('group:announcement', { groupId: gid, announcement: text }); } catch {}
  res.json({ ok: true });
});

// Re-join the official group (self-service, used by the empty-state CTA).
app.post('/api/groups/:id/join', rateLimit('write'), authRequired, (req, res) => {
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!g) return res.status(404).json({ error: '群不存在' });
  const already = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, req.user.id);
  if (already) return res.json({ ok: true, joined: true });
  // The official group is open to everyone. For a group somebody made,
  // joining means asking the owner — unless you are Jack, who runs
  // every group in the system and simply walks in.
  if (!isOfficialGroup(gid) && !isAdmin(req.user)) {
    const pending = db.prepare(
      "SELECT id FROM group_join_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'"
    ).get(gid, req.user.id);
    if (pending) return res.status(400).json({ error: '已发送过申请，等待群主处理' });
    const message = String((req.body || {}).message || '').slice(0, 200);
    const info = db.prepare(
      'INSERT INTO group_join_requests (group_id, user_id, message, status, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(gid, req.user.id, message || null, 'pending', now());
    const owner = g.owner_id ? Number(g.owner_id) : null;
    const targets = new Set(db.prepare(
      'SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?'
    ).all(gid, req.user.id).map(t => t.user_id));
    if (owner) targets.add(owner);
    for (const uid of targets) {
      try {
        io.to(`user:${uid}`).emit('group:join-request', {
          id: info.lastInsertRowid, group_id: gid, group_name: g.name,
          user_id: req.user.id, username: req.user.username, message: message || null
        });
      } catch (e) { }
    }
    return res.json({ ok: true, requested: true });
  }
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(gid, req.user.id, now());
  // The socket joined its group rooms when it connected; a group joined
  // after that needs the room added now, or the live messages stay out
  // of reach until the next reconnect.
  try { if (io) io.in(`user:${req.user.id}`).socketsJoin(`group:${gid}`); } catch (e) { }
  res.json({ ok: true, joined: true });
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
    SELECT u.id, u.username, u.avatar, u.avatar_color, u.avatar_emoji, 'user' AS type
    FROM friends f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? ORDER BY u.username
  `).all(uid);
  const groups = db.prepare(`
    SELECT g.id, g.name AS username, NULL AS avatar, NULL AS avatar_color, 'group' AS type, g.is_official,
           g.icon_color, g.icon_emoji, g.pinned
    FROM group_members gm JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ? ORDER BY g.is_official DESC, g.pinned DESC, g.id ASC
  `).all(uid);
  // "我" —— 自己的会话,拿来当备忘录/文件暂存。不用好友关系。
  const self = {
    id: uid, username: '我', avatar: null, avatar_color: null,
    type: 'user', special: 'self', pinned: 0
  };
  const all = [self, ...friends, ...groups];
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
    c.last_message = last
      ? (last.type === 'image' ? '🖼  图片' : (last.type === 'file' ? '📎  文件' : last.content))
      : '';
    c.last_sender_id = last ? last.sender_id : null;
    c.last_at = last ? last.created_at : 0;
    c.unread = c.type === 'user' ? unreadStmt('user', userConvId(uid, c.id)) : unreadStmt('group', String(c.id));
  }
  res.json({ conversations: all });
});

// ============================================================
// 文件上传/下载
//   POST /api/upload      上传(base64),返回文件 id
//   GET  /api/files/:id   下载(只有会话里的人能下)
// ============================================================
// 上传目录。默认在项目目录里 —— 那是容器的临时目录,每次部署都会清空。
// 挂了持久磁盘之后要指到盘上,否则传的文件发一次就没了。
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { console.error('[VVeChat] uploads dir failed:', e.message); }

// 文件名里可能混进路径分隔符,只留最后一段。
function safeFileName(name) {
  return String(name || 'file').replace(/[\\/]+/g, '_').slice(0, 120) || 'file';
}

// 会话里的人才能下载这个文件。
function canAccessFile(user, file) {
  if (!user || !file) return false;
  if (file.owner_id === user.id) return true;
  if (file.conv_type === 'group') {
    return !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(file.conv_id, user.id);
  }
  // 单聊的 conv_id 形如 u_1_2
  const parts = String(file.conv_id || '').split('_');
  if (parts.length === 3 && parts[0] === 'u') return Number(parts[1]) === user.id || Number(parts[2]) === user.id;
  return false;
}

app.post('/api/upload', rateLimit('write'), authRequired, express.json({ limit: '60mb' }), (req, res) => {
  const { name, mime, data, conv_type, conv_id } = req.body || {};
  if (conv_type !== 'user' && conv_type !== 'group') return res.status(400).json({ error: 'invalid conv_type' });
  let buf;
  try { buf = Buffer.from(String(data || ''), 'base64'); } catch (_) { buf = Buffer.alloc(0); }
  if (!buf.length) return res.status(400).json({ error: '文件是空的' });
  if (buf.length > 50 * 1024 * 1024) return res.status(413).json({ error: '文件过大(>50MB)' });
  const fname = safeFileName(name);
  const ext = (path.extname(fname) || '').slice(0, 12);
  const id = require('crypto').randomUUID();
  const rel = id + ext;
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, rel), buf);
  } catch (e) {
    return res.status(500).json({ error: '保存文件失败' });
  }
  const convId = conv_type === 'group'
    ? String(Number(conv_id))
    : userConvId(req.user.id, Number(conv_id));
  db.prepare(
    'INSERT INTO files (id, owner_id, name, mime, size, path, conv_type, conv_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.user.id, fname, String(mime || 'application/octet-stream'), buf.length, rel, conv_type, convId, now());
  res.json({
    ok: true,
    file: { id, name: fname, mime: mime || 'application/octet-stream', size: buf.length, url: `/api/files/${id}` }
  });
});

app.get('/api/files/:id', authRequired, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(String(req.params.id));
  if (!f) return res.status(404).json({ error: '文件不存在' });
  if (!canAccessFile(req.user, f)) return res.status(403).json({ error: '无权下载该文件' });
  const p = path.join(UPLOAD_DIR, path.basename(f.path));
  if (!fs.existsSync(p)) return res.status(404).json({ error: '文件已丢失' });
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  // 中文文件名要走 RFC 5987,不然浏览器存下来是乱码。
  const ascii = String(f.name).replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  fs.createReadStream(p).pipe(res);
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
    sender_avatar: row.sender_avatar || null,
    sender_avatar_emoji: row.sender_avatar_emoji || null,
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
  SELECT m.*, u.username AS sender_username, u.avatar_color AS sender_avatar_color,
         u.avatar AS sender_avatar, u.avatar_emoji AS sender_avatar_emoji
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
    // 跟自己的会话(备忘录)不需要好友关系。
    const isFriend = peerId === req.user.id ||
      db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, peerId);
    if (!isFriend) return res.status(403).json({ error: 'not friends' });
    normalizedConvId = userConvId(req.user.id, peerId);
  }
  if (reply_to) {
    const ref = db.prepare('SELECT id FROM messages WHERE id = ?').get(Number(reply_to));
    if (!ref) return res.status(400).json({ error: '回复的消息不存在' });
    reply_to = ref.id;
  }
  const msgType = ['text','image','system','file'].includes(type) ? type : 'text';
  const metaStr = meta ? JSON.stringify(meta) : null;
  const info = db.prepare(
    'INSERT INTO messages (conv_type, conv_id, sender_id, content, type, meta, reply_to, is_deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(conv_type, normalizedConvId, req.user.id, content, msgType, metaStr, reply_to || null, now());
  // 带上发送者的头像(照片/表情)—— 对方那边实时收到时就能画对头像。
  const row = db.prepare(`
    SELECT m.*, u.avatar AS sender_avatar, u.avatar_emoji AS sender_avatar_emoji
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(info.lastInsertRowid);
  const msg = buildMessage({ ...row, sender_username: req.user.username });
  broadcastMessage(msg, conv_type, conv_id, req.user.id);
  res.json({ message: msg });

  // ---- the assistant was called by name ----
  // It answers in the background: the sender gets their message back
  // straight away, and the reply arrives a moment later.
  const aiInGroups = req.user.aiInGroups !== false;
  if (conv_type === 'group' && msgType === 'text' && aiInGroups && mentionsAssistant(content)) {
    const gid = normalizedConvId;
    const question = String(content)
      .replace(/@(qwen|jacky[\s]?bot|ai|助手|千问)/gi, '')
      .replace(/^\s*[,，:：]\s*/, '')
      .trim() || String(content);
    const context = groupContext(gid, 24);
    // The answer takes a few seconds to come back. Say so in the room,
    // otherwise it looks like the message was swallowed.
    const typingOn = { conv_type: 'group', conv_id: String(gid), uid: assistantId, username: ASSISTANT_NAME };
    try { if (io) io.to(`group:${gid}`).emit('typing:start', typingOn); } catch (e) { }
    const stopTyping = () => { try { if (io) io.to(`group:${gid}`).emit('typing:stop', typingOn); } catch (e) { } };
    assistantAnswer(question, context).then((answer) => {
      stopTyping();
      if (!answer) {
        // Say so in the group — silence reads like the message was lost.
        const fInfo = db.prepare(
          'INSERT INTO messages (conv_type, conv_id, sender_id, content, type, meta, reply_to, is_deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
        ).run('group', gid, assistantId, '我这边暂时连不上，等会儿再叫我一次。', 'text', null, null, now());
        const fRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(fInfo.lastInsertRowid);
        broadcastMessage(buildMessage({ ...fRow, sender_username: ASSISTANT_NAME }), 'group', gid, assistantId);
        return;
      }
      const aInfo = db.prepare(
        'INSERT INTO messages (conv_type, conv_id, sender_id, content, type, meta, reply_to, is_deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
      ).run('group', gid, assistantId, answer.slice(0, 4000), 'text', null, null, now());
      const aRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(aInfo.lastInsertRowid);
      const aMsg = buildMessage({ ...aRow, sender_username: ASSISTANT_NAME });
      broadcastMessage(aMsg, 'group', gid, assistantId);
    }).catch((e) => { stopTyping(); console.warn('[VVeChat] assistant reply failed:', e.message); });
  }

  // ---- 私聊里的 AI ----
  // 单独跟它聊天,它也得回话 —— 不然「hi」发出去石沉大海,像坏了。
  //
  // 一次只回一句:用户连着发好几条时,只回答最后一条 —— 前面那几条的
  // 回答直接作废(不然每条都调一次模型,又慢又贵,聊天记录还会被刷屏)。
  if (conv_type === 'user' && msgType === 'text' && aiInGroups && Number(conv_id) === assistantId) {
    const cid = normalizedConvId;
    const context = userContext(cid, 24);
    const typingOn = { conv_type: 'user', conv_id: String(cid), uid: assistantId, username: ASSISTANT_NAME };
    const toRooms = (evt) => {
      try {
        if (!io) return;
        io.to(`user:${req.user.id}`).emit(evt, typingOn);
        io.to(`user:${assistantId}`).emit(evt, typingOn);
      } catch (e) {}
    };
    // 顶掉上一条还没回来的回答
    const prev = pendingDm.get(cid);
    if (prev) { clearTimeout(prev.timer); pendingDm.delete(cid); }
    const token = now() + ':' + Math.random();
    const timer = setTimeout(() => { if (pendingDm.get(cid) && pendingDm.get(cid).token === token) pendingDm.delete(cid); }, 60000);
    pendingDm.set(cid, { token, timer });
    toRooms('typing:start');
    const stopTyping = () => toRooms('typing:stop');
    assistantAnswer(String(content), context, 'dm').then((answer) => {
      const cur = pendingDm.get(cid);
      if (!cur || cur.token !== token) return;   // 已经被更新的一轮顶掉了
      pendingDm.delete(cid);
      stopTyping();
      const text = String(answer || '我这边暂时连不上，等会儿再叫我一次。').slice(0, 4000);
      const aInfo = db.prepare(
        'INSERT INTO messages (conv_type, conv_id, sender_id, content, type, meta, reply_to, is_deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
      ).run('user', cid, assistantId, text, 'text', null, null, now());
      const aRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(aInfo.lastInsertRowid);
      broadcastMessage(buildMessage({ ...aRow, sender_username: ASSISTANT_NAME }), 'user', cid, assistantId);
    }).catch((e) => { stopTyping(); console.warn('[VVeChat] assistant DM failed:', e.message); });
  }
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
    // 跟自己的会话(备忘录)不需要好友关系。
    const ok = peerId === req.user.id ||
      db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.id, peerId);
    if (!ok) return res.status(403).json({ error: 'not friends' });
    normalizedConvId = userConvId(req.user.id, peerId);
  }
  const rows = db.prepare(`
    SELECT m.*, u.username AS sender_username, u.avatar_color AS sender_avatar_color,
           u.avatar AS sender_avatar, u.avatar_emoji AS sender_avatar_emoji
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
// 只靠 socket 的 'disconnect' 事件判断在线是不准的:
// Render 休眠、页面被挂起、网络抖动都会让 disconnect 丢事件 ——
// 人明明走了,列表上还挂着一个绿点。所以在线状态改成「心跳 + TTL」:
// 客户端每 25 秒 ping 一次,超过 70 秒没心跳就判定离线。
const ONLINE_TTL = 70 * 1000;
const onlineUsers = new Map();  // uid → lastSeen(ms)
const userSockets = new Map();  // uid → Set<socketId>

function isUserOnline(uid) {
  const seen = onlineUsers.get(Number(uid));
  return !!seen && (Date.now() - seen) < ONLINE_TTL;
}
function touchOnline(uid) { onlineUsers.set(Number(uid), Date.now()); }

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
    // NOTE: the column is `group_id`, not `id` — reading `g.id` put every
    // socket in a room called "group:undefined", so nothing that was
    // broadcast to a group ever reached anybody.
    const gs = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(uid);
    for (const g of gs) socket.join(`group:${g.group_id}`);
  } catch (e) {
    console.error('[socket] group join failed:', e.message);
  }
  if (!userSockets.has(uid)) userSockets.set(uid, new Set());
  const wasOffline = !isUserOnline(uid);
  userSockets.get(uid).add(socket.id);
  touchOnline(uid);
  if (wasOffline) broadcastPresence(uid, true);
  // 客户端的心跳:证明这条连接还活着,别让它被 TTL 判成离线。
  socket.on('presence:ping', () => touchOnline(uid));
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
        const ok = peerId === uid ||
          db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(uid, peerId);
        if (!ok) throw new Error('not friends');
        normalizedConvId = userConvId(uid, peerId);
      }
      if (reply_to) {
        const ref = db.prepare('SELECT id FROM messages WHERE id = ?').get(Number(reply_to));
        if (!ref) throw new Error('回复的消息不存在');
        reply_to = ref.id;
      }
      const msgType = ['text','image','system','file'].includes(type) ? type : 'text';
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

// TTL 清扫:把心跳超时的用户标记成离线并广播出去。
setInterval(() => {
  const now = Date.now();
  for (const [uid, seen] of onlineUsers) {
    if (now - seen > ONLINE_TTL) {
      onlineUsers.delete(uid);
      broadcastPresence(uid, false);
    }
  }
}, 15000);

// ============================================================
// 30-day message auto-deletion (cleanup job)
// Runs on startup and every hour
// ============================================================
function cleanupOldMessages() {
  try {
    // 保留 1 年,更早的自动清掉省空间。
    //
    // created_at 是 INTEGER(epoch 毫秒) —— 这里必须传毫秒数。
    // 之前传的是 ISO 字符串('2025-11-01 14:34:16')，而 SQLite 的类型
    // 序是 NULL < INTEGER/REAL < TEXT < BLOB，所以 `整数 < 字符串` 恒为真，
    // 结果就是：**每次启动、以及之后每小时,都会把库里所有消息删光**。
    const cutoffMs = Date.now() - 365 * 24 * 60 * 60 * 1000;
    // Also clean orphaned reactions pointing to deleted messages
    const delMsgs = db.prepare("DELETE FROM messages WHERE created_at < ?").run(cutoffMs);
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
  // A gzip middleware for the static files only. The API and the
  // streaming endpoints (SSE, socket.io) must NOT be compressed — a
  // buffered stream would defeat the whole point of streaming.
  const gzipStatic = require('zlib');
  // Static assets are served by hand rather than by express.static, so
  // the response can be gzipped AND cached for a year. The two matter:
  // app.js is 210 KB raw, and the browser was told "no-store" before,
  // so every single visit re-downloaded everything.
  const zlib = require('zlib');
  const STATIC_MIME = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  };
  const staticCache = new Map();   // path -> { body, gz, etag, mtime }
  const STATIC_RE = /^\/[A-Za-z0-9._\-\/]*(\.(js|css|svg|json|png|jpg|ico|woff2|txt)|index\.html)$/;
  app.get(STATIC_RE, (req, res, next) => {
    const rel = decodeURIComponent(req.path).replace(/^\/+/, '');
    const file = path.join(FRONTEND_DIR, rel);
    if (!file.startsWith(FRONTEND_DIR)) return next();
    let st;
    try { st = fs.statSync(file); } catch (e) { return next(); }
    if (!st.isFile()) return next();

    const key = rel;
    let entry = staticCache.get(key);
    if (!entry || entry.mtime !== st.mtimeMs) {
      const raw = fs.readFileSync(file);
      entry = {
        mtime: st.mtimeMs,
        raw,
        gz: zlib.gzipSync(raw, { level: 6 }),
        etag: 'W/"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"',
      };
      staticCache.set(key, entry);
    }

    // The shell points at the versioned assets, so it must always be
    // revalidated; everything else can live in the cache for a year.
    const isShell = rel === 'index.html' || rel === 'config.js';
    res.setHeader('ETag', entry.etag);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', isShell
      ? 'no-cache'
      : 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', STATIC_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');

    if (req.headers['if-none-match'] === entry.etag) {
      res.status(304).end();
      return;
    }
    const wantsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (wantsGzip) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', entry.gz.length);
      res.end(entry.gz);
    } else {
      res.setHeader('Content-Length', entry.raw.length);
      res.end(entry.raw);
    }
  });

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
    // The SPA shell: gzip it, but always revalidate it — it points at
    // the versioned assets.
    try {
      const raw = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'));
      const gz = zlib.gzipSync(raw, { level: 6 });
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', gz.length);
        res.end(gz);
      } else {
        res.setHeader('Content-Length', raw.length);
        res.end(raw);
      }
    } catch (e) {
      res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
    }
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
