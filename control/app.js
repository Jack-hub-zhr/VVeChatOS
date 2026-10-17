/* VVeChat 控制台 — client (vanilla, no deps) */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const state = { token: '', user: null, data: null };

  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return n;
  }
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function initials(name) {
    if (!name) return '?';
    return /[\u4e00-\u9fa5]/.test(name) ? name.slice(-1) : name.slice(0, 1).toUpperCase();
  }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function toast(msg, ms = 2400) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // If this panel is hosted on its own domain (vvechat-control.onrender.com),
  // talk to the main VVeChat service; if it is served from the main service
  // under /control, the relative path already resolves to the same origin.
  const API_BASE = window.VVECHAT_API_BASE
    || (location.pathname.startsWith('/control') ? '' : 'https://vvechat.onrender.com');

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    const r = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j || {};
  }

  // Confirm dialog (own class names so nothing else can tear it down).
  function askConfirm(title, message, okText) {
    return new Promise((resolve) => {
      const box = $('#confirm');
      $('#confirm-title').textContent = title;
      $('#confirm-msg').textContent = message;
      $('#confirm-yes').textContent = okText || '确定';
      box.classList.remove('hidden');
      let closed = false;
      const done = (v) => {
        if (closed) return;
        closed = true;
        box.classList.add('hidden');
        $('#confirm-yes').removeEventListener('click', onYes);
        $('#confirm-no').removeEventListener('click', onNo);
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      const onYes = () => done(true);
      const onNo = () => done(false);
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      $('#confirm-yes').addEventListener('click', onYes);
      $('#confirm-no').addEventListener('click', onNo);
      document.addEventListener('keydown', onKey);
      box.querySelector('.confirm-mask').onclick = () => done(false);
    });
  }

  // ---------------- login ----------------
  $('#gate-go').addEventListener('click', async () => {
    const u = $('#gate-user').value.trim();
    const p = $('#gate-pass').value;
    const msg = $('#gate-msg');
    msg.textContent = '';
    if (!u || !p) { msg.textContent = '请输入用户名和密码'; return; }
    const btn = $('#gate-go');
    btn.disabled = true;
    try {
      const r = await fetch(API_BASE + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '登录失败');
      if (!j.user || !j.user.is_admin) throw new Error('只有管理员 Jack 可以访问控制台');
      state.token = j.token;
      state.user = j.user;
      try {
        sessionStorage.setItem('vve-ctl-token', j.token);
      } catch (_) {}
      $('#gate').classList.add('hidden');
      $('#panel').classList.remove('hidden');
      await load();
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });
  $('#gate-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#gate-go').click();
  });

  // ---------------- data ----------------
  async function load() {
    try {
      const d = await api('/api/control/snapshot');
      state.data = d;
      render(d);
      $('#stamp').textContent = '更新于 ' + fmtTime(d.generated_at);
    } catch (e) {
      toast('加载失败：' + e.message);
    }
  }

  function render(d) {
    // users
    const uw = $('#users');
    uw.innerHTML = '';
    $('#user-count').textContent = d.users.length;
    for (const u of d.users) {
      const isJack = u.username === 'Jack';
      const row = el('div', { class: 'user-row' });
      const bg = u.avatar_color ? `background:linear-gradient(135deg, ${u.avatar_color}, ${shade(u.avatar_color, -25)});` : '';
      row.innerHTML = `
        <div class="avatar${isJack ? ' jack' : ''}" style="${isJack ? '' : bg}">${esc(initials(u.username))}</div>
        <div class="u-meta">
          <div class="u-name">${esc(u.username)}${isJack ? ' <span class="jack-tag">管理员</span>' : ''}</div>
          <div class="u-sub">ID ${u.id} · 注册于 ${fmtTime(u.created_at)}${u.bio ? ' · ' + esc(u.bio) : ''}</div>
        </div>`;
      if (!isJack) {
        const kill = el('button', { class: 'kill', 'data-id': u.id }, '注销');
        kill.addEventListener('click', async () => {
          const ok = await askConfirm(
            '注销账号',
            '确定永久删除「' + u.username + '」吗？该账号发出过的全部消息、好友关系和好友申请都会一并消失，无法恢复。',
            '永久删除'
          );
          if (!ok) return;
          kill.disabled = true;
          try {
            await api('/api/control/purge-user/' + u.id, { method: 'POST', body: {} });
            toast('已注销 ' + u.username);
            await load();
          } catch (e) {
            toast('注销失败：' + e.message);
            kill.disabled = false;
          }
        });
        row.appendChild(kill);
      }
      uw.appendChild(row);
    }

    // 1:1 conversations
    const cw = $('#convos');
    cw.innerHTML = '';
    $('#convo-count').textContent = d.conversations.length;
    if (!d.conversations.length) {
      cw.appendChild(el('div', { class: 'empty-note' }, '暂无好友对话'));
    }
    for (const c of d.conversations) {
      const box = el('div', { class: 'convo' });
      const head = el('div', { class: 'convo-head' });
      head.innerHTML = `<span style="color:#8b5cf6">${esc(c.user_a.username)}</span><span class="arrow">↔</span><span style="color:#3b82f6">${esc(c.user_b.username)}</span><span style="color:var(--muted);font-weight:400;font-size:12px">（${c.messages.length} 条）</span>`;
      box.appendChild(head);
      const ms = el('div', { class: 'msgs' });
      if (!c.messages.length) {
        ms.appendChild(el('div', { class: 'empty-note' }, '（无消息）'));
      }
      for (const m of c.messages) {
        const line = el('div', { class: 'msg-line' + (m.type === 'image' ? ' image' : '') });
        line.innerHTML = `<span class="who">${esc(m.sender)}</span>${m.type === 'image' ? '[图片]' : esc(m.content)}<span class="when">${fmtTime(m.created_at)}</span>`;
        ms.appendChild(line);
      }
      box.appendChild(ms);
      cw.appendChild(box);
    }

    // official group messages
    const gw = $('#groups');
    gw.innerHTML = '';
    $('#group-count').textContent = d.group_messages.length;
    if (!d.group_messages.length) {
      gw.appendChild(el('div', { class: 'empty-note' }, '官方群暂无消息'));
    } else {
      const box = el('div', { class: 'convo' });
      const ms = el('div', { class: 'msgs' });
      for (const m of d.group_messages) {
        const line = el('div', { class: 'msg-line' + (m.type === 'image' ? ' image' : '') });
        line.innerHTML = `<span class="who">${esc(m.sender)}</span>${m.type === 'image' ? '[图片]' : esc(m.content)}<span class="when">${fmtTime(m.created_at)}</span>`;
        ms.appendChild(line);
      }
      box.appendChild(ms);
      gw.appendChild(box);
    }
  }

  function shade(hex, percent) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    let [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    r = Math.max(0, Math.min(255, Math.round(r + r * percent / 100)));
    g = Math.max(0, Math.min(255, Math.round(g + g * percent / 100)));
    b = Math.max(0, Math.min(255, Math.round(b + b * percent / 100)));
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // ---------------- actions ----------------
  $('#btn-refresh').addEventListener('click', load);

  $('#btn-format').addEventListener('click', async () => {
    const ok = await askConfirm(
      '格式化一切信息',
      '这会把 VVeChat 恢复到最初状态：除基本功能和管理员 Jack 外，所有账号、照片和消息都会被永久删除，无法恢复。确定继续吗？',
      '全部删除'
    );
    if (!ok) return;
    const btn = $('#btn-format');
    btn.disabled = true;
    try {
      await api('/api/control/format-all', { method: 'POST', body: {} });
      toast('已格式化，一切恢复初始状态');
      await load();
    } catch (e) {
      toast('格式化失败：' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- boot ----------------
  (async function init() {
    // honour the stored theme
    try {
      const t = localStorage.getItem('vve:theme');
      if (t === 'dark') document.body.classList.add('dark');
    } catch (_) {}
    // restore an admin session if we have one
    try {
      const t = sessionStorage.getItem('vve-ctl-token');
      if (t) {
        state.token = t;
        const probe = await api('/api/control/snapshot');
        state.data = probe;
        $('#gate').classList.add('hidden');
        $('#panel').classList.remove('hidden');
        render(probe);
        $('#stamp').textContent = '更新于 ' + fmtTime(probe.generated_at);
      }
    } catch (_) {
      state.token = '';
    }
  })();

  window.addEventListener('error', (e) => console.error('[control]', e.error || e.message));
})();
