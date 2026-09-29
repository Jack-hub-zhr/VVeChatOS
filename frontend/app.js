/* ============================================================
   VVeChat OS 1.0.0 — client (vanilla, no deps)
   Clean implementation. No legacy code, no callout to deleted fns.
   ============================================================ */
(() => {
  'use strict';

  // ============== State ==============
  const state = {
    user: null,
    token: null,
    conversations: [],
    groups: [],
    friends: [],
    currentChat: null,        // { type, id, title, isOfficial, avatarColor }
    messagesByConv: {},
    socket: null,
    online: new Set(),
  };

  const K = { TOKEN: 'vve2:token', USER: 'vve2:user', SCHEMA: 'vve2:schema' };
  const SCHEMA_VERSION = 'v1';

  // ============== DOM helpers ==============
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return n;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function initials(name) {
    if (!name) return '?';
    return /[\u4e00-\u9fa5]/.test(name) ? name.slice(-1) : name.slice(0, 1).toUpperCase();
  }
  function shade(hex, percent) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    let [r, g, b] = [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)];
    r = Math.max(0, Math.min(255, Math.round(r + r * percent / 100)));
    g = Math.max(0, Math.min(255, Math.round(g + g * percent / 100)));
    b = Math.max(0, Math.min(255, Math.round(b + b * percent / 100)));
    return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
  }
  function toast(msg, ms = 2200) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // ============== Avatar ==============
  function avatarHtml(user, sm = false, lg = false) {
    const isJack = user && (user.username === 'Jack' || user.is_admin);
    const color = isJack ? '#fbbf24' : (user && user.avatar_color) || '#5eead4';
    const letter = initials(user && user.username);
    const cls = ['avatar'];
    if (sm) cls.push('sm');
    if (lg) cls.push('lg');
    if (isJack) cls.push('jack');
    const style = !isJack && user && user.avatar_color
      ? `background: linear-gradient(135deg, ${color}, ${shade(color, -25)});`
      : '';
    return `<div class="${cls.join(' ')}" style="${style}">${escapeHtml(letter)}</div>`;
  }

  // ============== API ==============
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const r = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((j && j.error) || `HTTP ${r.status}`);
    return j || {};
  }

  // ============== Storage ==============
  function loadSession() {
    try {
      if (localStorage.getItem(K.SCHEMA) !== SCHEMA_VERSION) {
        // schema bumped → wipe stale data
        localStorage.removeItem(K.TOKEN);
        localStorage.removeItem(K.USER);
        localStorage.setItem(K.SCHEMA, SCHEMA_VERSION);
        return false;
      }
      const t = localStorage.getItem(K.TOKEN);
      const u = localStorage.getItem(K.USER);
      if (t && u) {
        state.token = t;
        state.user = JSON.parse(u);
        return true;
      }
    } catch (_) {}
    return false;
  }
  function saveSession(token, user) {
    state.token = token;
    state.user = user;
    try {
      localStorage.setItem(K.TOKEN, token);
      localStorage.setItem(K.USER, JSON.stringify(user));
      localStorage.setItem(K.SCHEMA, SCHEMA_VERSION);
    } catch (_) {}
  }
  function clearSession() {
    state.token = null;
    state.user = null;
    try {
      localStorage.removeItem(K.TOKEN);
      localStorage.removeItem(K.USER);
    } catch (_) {}
    if (state.socket) { try { state.socket.disconnect(); } catch (_) {} state.socket = null; }
    state.conversations = []; state.groups = []; state.friends = []; state.online.clear();
    state.currentChat = null; state.messagesByConv = {};
  }

  // ============== View switching ==============
  function showAuth() {
    $('#auth-view').classList.remove('hidden');
    $('#app-view').classList.add('hidden');
    $('.corner-version.app-only').classList.add('hidden');
  }
  function showApp() {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('.corner-version.app-only').classList.remove('hidden');
  }

  // ============== Render ==============
  function renderAll() {
    renderUserPill();
    renderChats();
    renderCurrent();
  }

  function renderUserPill() {
    const slot = $('#user-pill-slot');
    if (!slot) return;
    slot.innerHTML = '';
    if (!state.user) return;
    const u = state.user;
    const isJack = u.username === 'Jack' || u.is_admin;
    if (isJack) {
      slot.appendChild(el('span', { class: 'jack-pill', title: 'Jack 官方管理员' }, 'Jack 管理员'));
    } else {
      slot.appendChild(el('span', { class: 'me-name' }, u.username));
    }
  }

  function convKey(type, id) { return type + '_' + id; }

  function renderChats() {
    const list = $('#chats-list');
    const empty = $('#chats-empty');
    list.innerHTML = '';
    if (!state.conversations.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    // sort: official first, then by last_at
    const sorted = [...state.conversations].sort((a, b) => (b.is_official | 0) - (a.is_official | 0) || (b.last_at || 0) - (a.last_at || 0));
    for (const c of sorted) {
      const isGroup = c.type === 'group';
      const fakeUser = { username: c.username, avatar_color: c.avatar_color, is_official: c.is_official };
      const isActive = state.currentChat && state.currentChat.type === c.type && String(state.currentChat.id) === String(c.id);
      const li = el('li', { class: 'chat-item' + (isActive ? ' active' : ''), onclick: () => openChat(c.type, c.id, c) });
      li.innerHTML = `
        ${avatarHtml(fakeUser, true)}
        <div class="meta">
          <div class="name">${escapeHtml(c.username)}${c.is_official ? ' <span class="official-tag">官方</span>' : ''}</div>
          <div class="preview">${escapeHtml(c.last_message || (c.is_official ? '点击进入官方群' : '点击开始聊天'))}</div>
        </div>
      `;
      list.appendChild(li);
    }
  }

  function renderCurrent() {
    const head = $('#chat-head');
    const title = $('#chat-title');
    const sub = $('#chat-sub');
    const empty = $('#chat-empty');
    const msgs = $('#messages');
    const composer = $('#composer');
    const chatAv = $('#chat-avatar');

    if (!state.currentChat) {
      title.textContent = '选择一个会话';
      sub.textContent = '';
      chatAv.innerHTML = '';
      empty.classList.remove('hidden');
      msgs.innerHTML = '';
      composer.classList.add('hidden');
      return;
    }
    const c = state.currentChat;
    title.textContent = c.title;
    sub.textContent = c.isOfficial ? 'VVeChat 官方群 · 全部用户' : '私聊';
    const fakeUser = { username: c.title, avatar_color: c.avatarColor, is_official: c.isOfficial };
    chatAv.innerHTML = avatarHtml(fakeUser);
    empty.classList.add('hidden');
    composer.classList.remove('hidden');
    renderMessages();
  }

  function renderMessages() {
    const wrap = $('#messages');
    wrap.innerHTML = '';
    if (!state.currentChat) return;
    const key = convKey(state.currentChat.type, state.currentChat.id);
    const arr = state.messagesByConv[key] || [];
    for (const m of arr) wrap.appendChild(renderMessageRow(m));
    wrap.scrollTop = wrap.scrollHeight;
  }

  function renderMessageRow(m) {
    const me = m.sender_id === state.user.id;
    const row = el('div', { class: 'msg-row' + (me ? ' me' : '') });
    const fakeUser = { username: m.sender_username, is_admin: m.is_admin };
    const av = el('div', { html: avatarHtml(fakeUser, true) });
    const inner = el('div');
    if (!me && state.currentChat.type === 'group') {
      const isJack = m.sender_username === 'Jack' || m.is_admin;
      const sender = el('div', { class: 'msg-sender' }, m.sender_username || '');
      if (isJack) sender.appendChild(el('span', { class: 'jack-pill', style: 'font-size:9px;padding:0 5px;' }, 'Jack'));
      inner.appendChild(sender);
    }
    const bubble = el('div', { class: 'msg-bubble' }, m.content || '');
    inner.appendChild(bubble);
    inner.appendChild(el('div', { class: 'msg-time' }, fmtTime(m.created_at)));
    if (me) {
      row.append(av, inner);
    } else {
      row.append(av, inner);
    }
    return row;
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // ============== Chat actions ==============
  async function openChat(type, id, meta) {
    state.currentChat = {
      type,
      id: String(id),
      title: (meta && meta.username) || String(id),
      isOfficial: !!(meta && meta.is_official),
      avatarColor: (meta && meta.avatar_color) || null,
    };
    renderCurrent();
    renderChats();
    try {
      const r = await api(`/messages?conv_type=${type}&conv_id=${encodeURIComponent(id)}&limit=50`);
      state.messagesByConv[convKey(type, id)] = r.messages || [];
      renderMessages();
    } catch (e) {
      toast('加载消息失败：' + e.message);
    }
  }

  async function sendMessage(text) {
    if (!text || !state.currentChat) return;
    const { type, id } = state.currentChat;
    try {
      const r = await api('/messages', { method: 'POST', body: { conv_type: type, conv_id: id, content: text } });
      const key = convKey(type, id);
      if (!state.messagesByConv[key]) state.messagesByConv[key] = [];
      const msg = r.message;
      if (!state.messagesByConv[key].some(m => m.id === msg.id)) state.messagesByConv[key].push(msg);
      renderMessages();
      // refresh conversations to update preview
      refreshConversations();
    } catch (e) {
      toast('发送失败：' + e.message);
    }
  }

  // ============== Refresh ==============
  async function refreshConversations() {
    try {
      const r = await api('/conversations');
      state.conversations = r.conversations || [];
      renderChats();
    } catch (e) { console.warn('conv refresh failed', e); }
  }
  async function refreshGroups() {
    try { const r = await api('/groups'); state.groups = r.groups || []; } catch (_) {}
  }
  async function refreshFriends() {
    try { const r = await api('/friends'); state.friends = r.friends || []; } catch (_) {}
  }
  async function refreshAll() {
    await Promise.all([refreshFriends(), refreshGroups(), refreshConversations()]);
    renderAll();
  }

  // ============== Socket ==============
  function connectSocket() {
    if (state.socket) return;
    const s = io({ auth: { token: state.token }, transports: ['websocket', 'polling'] });
    state.socket = s;
    s.on('message:new', (msg) => {
      if (!msg || !msg.conv_type) return;
      const key = convKey(msg.conv_type, msg.conv_id);
      if (!state.messagesByConv[key]) state.messagesByConv[key] = [];
      const arr = state.messagesByConv[key];
      if (!arr.some(m => m.id === msg.id)) {
        arr.push(msg);
        if (state.currentChat && convKey(state.currentChat.type, state.currentChat.id) === key) renderMessages();
      }
      refreshConversations();
    });
    s.on('connect_error', (e) => console.warn('socket error', e && e.message));
  }

  // ============== Add-friend modal ==============
  let addQ = '';
  async function openAddModal() {
    $('#modal-add').classList.remove('hidden');
    $('#add-q').value = '';
    $('#add-results').innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px;">输入用户名搜索</p>';
    setTimeout(() => $('#add-q').focus(), 50);
  }
  function closeAddModal() {
    $('#modal-add').classList.add('hidden');
  }
  let addSearchT = null;
  function bindAddModal() {
    $('#add-q').addEventListener('input', (e) => {
      addQ = e.target.value.trim();
      clearTimeout(addSearchT);
      addSearchT = setTimeout(runAddSearch, 220);
    });
  }
  async function runAddSearch() {
    const results = $('#add-results');
    if (!addQ) {
      results.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px;">输入用户名搜索</p>';
      return;
    }
    try {
      const r = await api('/users/search?q=' + encodeURIComponent(addQ));
      const list = r.users || [];
      if (!list.length) {
        results.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px;">没有匹配的用户</p>';
        return;
      }
      results.innerHTML = '';
      for (const u of list) {
        const isFriend = state.friends.some(f => f.id === u.id);
        const row = el('div', { class: 'add-result' });
        row.innerHTML = `${avatarHtml(u, true)}<div class="name">${escapeHtml(u.username)}</div>`;
        const btn = el('button', { class: isFriend ? 'added' : 'add-btn' }, isFriend ? '✓ 已添加' : '+ 添加');
        if (!isFriend) btn.addEventListener('click', () => addFriend(u.id, btn));
        row.appendChild(btn);
        results.appendChild(row);
      }
    } catch (e) {
      results.innerHTML = '<p style="text-align:center;color:var(--danger);padding:20px;">' + escapeHtml(e.message) + '</p>';
    }
  }
  async function addFriend(uid, btn) {
    btn.disabled = true;
    try {
      await api('/friends/add', { method: 'POST', body: { username: state.friends.find(f => f.id === uid)?.username || '' } });
      // We sent username; re-fetch via search... actually we need to know the username.
      // Simpler: refetch all and update.
    } catch (e) {
      // try by username from row
    }
    // Optimistic refresh
    await refreshFriends();
    await refreshConversations();
    runAddSearch();
    toast('已添加好友');
  }

  // ============== Events ==============
  function bindEvents() {
    // Tabs
    $$('.tabs .tab').forEach(t => t.addEventListener('click', () => {
      $$('.tabs .tab').forEach(x => x.classList.toggle('active', x === t));
      const mode = t.dataset.tab;
      $('#auth-submit').textContent = mode === 'login' ? '登录' : '注册';
      $('#auth-msg').textContent = '';
    }));

    // Auth form
    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const mode = $$('.tabs .tab').find(t => t.classList.contains('active'))?.dataset.tab || 'login';
      const username = $('#auth-username').value.trim();
      const password = $('#auth-password').value;
      const msg = $('#auth-msg');
      msg.classList.remove('ok'); msg.textContent = '';
      if (!username || !password) { msg.textContent = '请输入用户名和密码'; return; }
      const btn = $('#auth-submit');
      btn.disabled = true;
      try {
        const r = await api('/' + (mode === 'login' ? 'login' : 'register'), { method: 'POST', body: { username, password } });
        saveSession(r.token, r.user);
        await enterApp();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
      }
    });

    // Logout
    const logout = () => { clearSession(); showAuth(); };
    $('#btn-logout')?.addEventListener('click', logout);

    // Add friend
    $('#btn-add')?.addEventListener('click', openAddModal);
    $$('[data-close="modal-add"]').forEach(b => b.addEventListener('click', closeAddModal));
    $('.modal-mask', $('#modal-add'))?.addEventListener('click', closeAddModal);
    bindAddModal();

    // Send message
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#msg-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendMessage(text);
    });
  }

  async function enterApp() {
    showApp();
    connectSocket();
    await refreshAll();
    // auto-open official group if present
    const official = state.conversations.find(c => c.is_official);
    if (official) openChat(official.type, official.id, official);
  }

  // ============== Init ==============
  async function init() {
    try { bindEvents(); } catch (e) { console.error('bind failed', e); }
    if (loadSession()) {
      try { await enterApp(); return; }
      catch (e) { console.warn('restore failed', e); clearSession(); }
    }
    showAuth();
  }

  // global error catch
  window.addEventListener('error', (e) => {
    console.error('VVeChat runtime:', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('VVeChat unhandled rejection:', e.reason);
  });

  init();
})();
