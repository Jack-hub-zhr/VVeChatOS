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
  // Jacky Bot 的头像:跟聊天界面一样的发光圆环
  function assistantRing() {
    return '<svg class="qwen-ring" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">'
      + '<circle class="qwen-halo" cx="16" cy="16" r="11" fill="none" stroke="#fff" stroke-width="5" opacity="0.9" filter="url(#qwenGlow)"/>'
      + '<circle cx="16" cy="16" r="11" fill="none" stroke="#fff" stroke-width="1.4" opacity="0.5"/>'
      + '<circle cx="16" cy="16" r="11" fill="none" stroke="#e2e8f0" stroke-width="3.2"/>'
      + '</svg>';
  }

  function initials(name) {
    if (!name) return '?';
    return /[\u4e00-\u9fa5]/.test(name) ? name.slice(-1) : name.slice(0, 1).toUpperCase();
  }
  // 时间一律按 Asia/Shanghai 显示 —— 和服务器上记的攻击时间一致。
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    return d.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }
  function fmtRemain(s) {
    s = Number(s) || 0;
    if (s <= 0) return '0 分钟';
    const m = Math.ceil(s / 60);
    if (m < 60) return m + ' 分钟';
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
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
    Object.assign(headers, opts.headers || {});
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

  // ---------- 二次验证(第 5 层保护) ----------
  // 关键操作前要再输一次密码,换来的令牌只能用 5 分钟。
  let stepUpToken = null, stepUpUntil = 0;
  function askStepUp() {
    return new Promise((resolve) => {
      const box = $('#stepup');
      const input = $('#stepup-pass');
      input.value = '';
      box.classList.remove('hidden');
      setTimeout(() => input.focus(), 30);
      let closed = false;
      const done = (v) => {
        if (closed) return;
        closed = true;
        box.classList.add('hidden');
        $('#stepup-yes').removeEventListener('click', onYes);
        $('#stepup-no').removeEventListener('click', onNo);
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      const onYes = async () => {
        const pw = input.value;
        if (!pw) { toast('请输入密码'); return; }
        try {
          const r = await api('/api/control/step-up', { method: 'POST', body: { password: pw } });
          stepUpToken = r.token;
          stepUpUntil = Date.now() + (r.expires_in || 300) * 1000;
          done(true);
        } catch (e) { toast('验证失败：' + e.message); }
      };
      const onNo = () => done(false);
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      $('#stepup-yes').addEventListener('click', onYes);
      $('#stepup-no').addEventListener('click', onNo);
      document.addEventListener('keydown', onKey);
    });
  }
  // 关键操作前调用:没令牌(或者过期了)就先弹密码框。
  async function ensureStepUp() {
    if (stepUpToken && Date.now() < stepUpUntil) return true;
    const ok = await askStepUp();
    return ok && !!stepUpToken;
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
      document.querySelectorAll('.topbar-right .pill').forEach(b => { b.disabled = false; });
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
  // 三个接口并行跑,别一个接一个等 —— 控制台打开慢主要是这个。
  async function load() {
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    const grab = (p) => api(p).then(d => ({ ok: true, d })).catch(e => ({ ok: false, e: e.message }));
    const [snap, sec, dep] = await Promise.all([
      grab('/api/control/snapshot'),
      grab('/api/security/overview?limit=60'),
      grab('/api/control/deploy'),
    ]);
    if (snap.ok) {
      state.data = snap.d;
      render(snap.d);
      $('#stamp').textContent = '更新于 ' + fmtTime(snap.d.generated_at);
    } else {
      toast('加载失败：' + snap.e);
    }
    if (sec.ok) {
      state.security = sec.d;
      renderSecurity(sec.d);
    } else if ($('#fw-stats')) {
      $('#fw-stats').innerHTML = '<div class="empty-note">安全数据读取失败：' + esc(sec.e) + '</div>';
    }
    if (dep.ok) renderDeploy(dep.d);
    else if ($('#deploy')) $('#deploy').innerHTML = '<div class="empty-note">读取失败：' + esc(dep.e) + '</div>';
    const ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    const stamp = $('#stamp');
    if (stamp) stamp.title = '加载耗时 ' + Math.round(ms) + ' ms';
    console.log('[control] loaded in', Math.round(ms), 'ms');
  }

  // ---------------- 部署信息 ----------------
  function renderDeploy(d) {
    const box = $('#deploy');
    if (!box) return;
    try {
      const mb = d.db_size ? (d.db_size / 1048576).toFixed(2) + ' MB' : '—';
      const up = d.uptime_s ? Math.round(d.uptime_s / 60) + ' 分钟' : '—';
      box.innerHTML = `
        <div class="event"><span class="k">网页地址</span>
          <span class="d"><a href="${esc(d.frontend_url)}" target="_blank" rel="noopener">${esc(d.frontend_url)}</a></span></div>
        <div class="event"><span class="k">接口地址</span>
          <span class="d"><code>${esc(d.api_base)}</code></span></div>
        <div class="event"><span class="k">数据库</span>
          <span class="d"><code>${esc(d.db_file)}</code> · ${mb}</span></div>
        <div class="event"><span class="k">上传文件</span>
          <span class="d"><code>${esc(d.upload_dir)}</code> · ${d.upload_count || 0} 个</span></div>
        <div class="event"><span class="k">运行</span>
          <span class="d">Node ${esc(d.node)} · 已运行 ${up}</span></div>
        ${d.jwt_secret_is_default ? '<div class="event"><span class="k warn">注意</span><span class="d warn">还没设 JWT_SECRET 环境变量 —— 在 Render 里加一个随机值更安全。</span></div>' : ''}
      `;
    } catch (e) {
      box.innerHTML = '<div class="empty-note">读取失败：' + esc(e.message) + '</div>';
    }
  }

  // ---------------- 防火墙 / 安全中心 ----------------
  async function loadSecurity() {
    const box = $('#fw-stats');
    try {
      const d = await api('/api/security/overview?limit=60');
      state.security = d;
      renderSecurity(d);
    } catch (e) {
      if (box) box.innerHTML = '<div class="empty-note">安全数据读取失败：' + esc(e.message) + '</div>';
    }
  }
  // 事件详情:完整 UA / 请求头 / 正文
  function eventDetail(e) {
    const L = [];
    L.push('时间: ' + fmtTime(e.ts));
    L.push('来源 IP: ' + e.ip);
    L.push('类型: ' + e.kind + '   级别: ' + e.severity);
    L.push('结果: ' + (e.action === 'blocked' ? '已拦截' : '已记录'));
    if (e.rule) L.push('命中规则: ' + e.rule);
    L.push('请求: ' + (e.method || '-') + ' ' + (e.path || '-'));
    L.push('说明: ' + (e.detail || '-'));
    L.push('User-Agent: ' + (e.ua || '-'));
    if (e.headers) {
      let h = {};
      try { h = JSON.parse(e.headers); } catch (_) {}
      const keys = Object.keys(h || {});
      if (keys.length) {
        L.push('请求头:');
        for (const k of keys) L.push('  ' + k + ': ' + h[k]);
      }
    }
    if (e.payload) L.push('请求正文: ' + e.payload);
    return L.join('\n');
  }

  function renderSecurity(d) {
    const s = d.stats || {};
    const agent = s.agent || {};
    const badge = $('#fw-badge');
    if (badge) {
      badge.textContent = s.enabled ? '运行中' : '已关闭';
      badge.style.color = s.enabled ? '' : 'var(--red)';
    }
    const st = $('#fw-state');
    const stt = $('#fw-state-text');
    if (st && stt) {
      const ok = s.enabled && agent.lastCheckOk !== false;
      st.classList.toggle('bad', !ok);
      stt.textContent = ok ? '防火墙运行中' : '防火墙异常';
    }
    const agentEl = $('#fw-agent');
    if (agentEl) {
      agentEl.textContent = 'agent · 自检 ' + agent.checks + ' 次 · 失败 ' + agent.failures +
        ' 次 · 自动补规则 ' + (agent.fixes || 0) + ' 条 · 上次 ' + (agent.lastCheckAt ? fmtTime(agent.lastCheckAt) : '—') +
        (agent.lastCheckOk === false ? ' · ⚠ 自检未通过' : ' · 正常');
    }

    const box = $('#fw-stats');
    if (!box) return;
    box.innerHTML = '';
    const stat = (k, v, cls) => {
      const n = el('div', { class: 'stat' });
      n.innerHTML = '<div class="k">' + esc(k) + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + esc(String(v)) + '</div>';
      return n;
    };
    box.appendChild(stat('已扫描请求', s.scanned || 0));
    box.appendChild(stat('已拦截', s.blocked || 0, (s.blocked || 0) > 0 ? 'warn' : ''));
    box.appendChild(stat('24 小时事件', s.events24h || 0, (s.events24h || 0) > 0 ? 'warn' : ''));
    box.appendChild(stat('当前封禁 IP', (s.blockedIps || []).length, (s.blockedIps || []).length ? 'bad' : ''));

    // 封禁名单
    const ips = s.blockedIps || [];
    if (ips.length) {
      const wrap = el('div', { class: 'events' });
      wrap.appendChild(el('h3', { class: 'sub-title' }, '当前封禁的 IP'));
      for (const b of ips) {
        const row = el('div', { class: 'event' });
        row.innerHTML =
          '<span class="t">' + (b.until ? fmtTime(b.until) : '—') + '</span>' +
          '<span class="ip">' + esc(b.ip) + '</span>' +
          '<span class="d">' + esc(b.reason || '') +
          (b.rule ? ' · 规则 ' + esc(b.rule) : '') +
          ' · ' + (b.count || 1) + ' 次 · 剩余 ' + fmtRemain(b.remaining_s) + '</span>' +
          '<span class="a blocked">封禁中</span>';
        const btn = el('button', { class: 'unblock' }, '解封');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await api('/api/security/unblock', { method: 'POST', body: { ip: b.ip } });
            toast('已解封 ' + b.ip);
            await loadSecurity();
          } catch (e) {
            toast('解封失败：' + e.message);
            btn.disabled = false;
          }
        });
        row.appendChild(btn);
        wrap.appendChild(row);
      }
      box.appendChild(wrap);
    }

    // 最近事件
    const ev = $('#fw-events');
    if (!ev) return;
    ev.innerHTML = '';
    const events = d.events || [];
    if (!events.length) {
      ev.appendChild(el('div', { class: 'empty-note' }, '暂无安全事件 —— 一切正常'));
      return;
    }
    const bannedNow = new Set(ips.map(b => b.ip));
    for (const e of events) {
      const row = el('div', { class: 'event event-row' });
      const top = el('div', { class: 'event-top' });
      top.innerHTML =
        '<span class="t">' + fmtTime(e.ts) + '</span>' +
        '<span class="ip">' + esc(e.ip) + '</span>' +
        '<span class="k">' + esc(e.kind) + '</span>' +
        '<span class="d">' + esc(e.detail || '') + '</span>' +
        '<span class="a ' + (e.action === 'blocked' ? 'blocked' : 'logged') + '">' +
        (e.action === 'blocked' ? '已拦截' : '已记录') + '</span>';
      row.appendChild(top);

      // 一键封禁 / 解封
      const isBanned = bannedNow.has(e.ip);
      const banBtn = el('button', { class: 'unblock' }, isBanned ? '解封' : '封禁');
      banBtn.addEventListener('click', async () => {
        banBtn.disabled = true;
        try {
          if (isBanned) {
            await api('/api/security/unblock', { method: 'POST', body: { ip: e.ip } });
            toast('已解封 ' + e.ip);
          } else {
            const ok = await askConfirm('封禁 IP', '把 ' + e.ip + ' 封 60 分钟?', '封禁');
            if (!ok) { banBtn.disabled = false; return; }
            await api('/api/security/block', {
              method: 'POST',
              body: { ip: e.ip, minutes: 60, reason: '控制台手动封禁:' + e.kind, rule: e.kind },
            });
            toast('已封禁 ' + e.ip);
          }
          await loadSecurity();
        } catch (err) {
          toast('操作失败：' + err.message);
          banBtn.disabled = false;
        }
      });
      top.appendChild(banBtn);

      // 详情(点开看完整 UA / 请求头 / 正文)
      const det = el('details', { class: 'event-detail' });
      det.innerHTML = '<summary>详情</summary><pre>' + esc(eventDetail(e)) + '</pre>';
      row.appendChild(det);
      ev.appendChild(row);
    }

    // agent 自己补的规则
    const rules = d.rules || [];
    if (rules.length) {
      const wrap = el('div', { class: 'events' });
      wrap.appendChild(el('h3', { class: 'sub-title' }, 'agent 自动补的规则'));
      for (const r of rules) {
        const row = el('div', { class: 'event' });
        row.innerHTML =
          '<span class="t">' + fmtTime(r.created_at) + '</span>' +
          '<span class="k">' + esc(r.kind) + '</span>' +
          '<span class="d">' + esc(r.scope) + ' · ' + esc(r.pattern) + ' · ' + esc(r.source) + '</span>';
        wrap.appendChild(row);
      }
      box.appendChild(wrap);
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
      const isAssistant = u.username === 'AI' || u.username === 'Jacky Bot' || u.username === 'Qwen';
      const hasEmoji = !!u.avatar_emoji;
      const hasPhoto = !!u.avatar;
      // 助手的头像底色是黑的(绿色是普通用户的),发光圆环压在上面。
      const bg = isAssistant ? 'background:var(--bg);'
        : (hasPhoto ? 'background:transparent;'
          : (hasEmoji ? 'background:rgba(255,255,255,0.55);'
            : (u.avatar_color ? `background:linear-gradient(135deg, ${u.avatar_color}, ${shade(u.avatar_color, -25)});` : '')));
      // 头像内容:上传的照片 > 表情 > 首字母 —— 跟聊天界面一个规矩。
      const face = isAssistant ? assistantRing()
        : (hasPhoto ? '<img class="avatar-img" src="' + esc(u.avatar) + '" alt=""/>'
          : (hasEmoji ? '<span class="avatar-emoji">' + esc(u.avatar_emoji) + '</span>' : esc(initials(u.username))));
      row.innerHTML = `
        <div class="avatar${isJack ? ' jack' : ''}" style="${isJack ? '' : bg}">${face}</div>
        <div class="u-meta">
          <div class="u-name">${esc(u.username)}${isJack ? ' <span class="jack-tag">管理员</span>' : ''}</div>
          <div class="u-sub">ID ${u.id} · 注册于 ${fmtTime(u.created_at)}${u.bio ? ' · ' + esc(u.bio) : ''}</div>
        </div>`;
      // 系统账号(Jacky Bot / 文件传输助手)不给注销按钮 ——
      // 删了群里的机器人就没了,文件也没地方放。
      if (!isJack && !u.is_system && !u.is_assistant) {
        const kill = el('button', { class: 'kill', 'data-id': u.id }, '注销');
        kill.addEventListener('click', async () => {
          const ok = await askConfirm(
            '注销账号',
            '确定永久删除「' + u.username + '」吗？该账号发出过的全部消息、好友关系和好友申请都会一并消失，无法恢复。',
            '永久删除'
          );
          if (!ok) return;
          if (!await ensureStepUp()) return;
          kill.disabled = true;
          try {
            await api('/api/control/purge-user/' + u.id, {
              method: 'POST', body: {},
              headers: { 'X-Step-Up': stepUpToken },
            });
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
      head.innerHTML = `<span style="color:#8b5cf6">${esc(c.user_a.username)}</span><span class="arrow">↔</span><span style="color:#3b82f6">${esc(c.user_b.username)}</span><span style="color:var(--muted);font-weight:400;font-size:12px">（${c.message_count || 0} 条）</span>`;
      box.appendChild(head);
      const ms = el('div', { class: 'msgs' });
      box.appendChild(ms);
      // 消息按需拉 —— 全量拉是控制台打开慢的主因。
      const more = el('button', { class: 'btn tiny' }, '查看消息');
      more.addEventListener('click', async () => {
        more.disabled = true;
        more.textContent = '加载中…';
        try {
          const r = await api('/api/control/conversation/' + encodeURIComponent(c.conv_id));
          ms.innerHTML = '';
          if (!r.messages || !r.messages.length) {
            ms.appendChild(el('div', { class: 'empty-note' }, '（无消息）'));
          } else {
            for (const m of r.messages) {
              const line = el('div', { class: 'msg-line' + (m.type === 'image' ? ' image' : '') });
              line.innerHTML = `<span class="who">${esc(m.sender)}</span>${m.type === 'image' ? '[图片]' : esc(m.content)}<span class="when">${fmtTime(m.created_at)}</span>`;
              ms.appendChild(line);
            }
          }
          more.remove();
        } catch (e) {
          more.disabled = false;
          more.textContent = '查看消息';
          toast('加载消息失败：' + e.message);
        }
      });
      box.appendChild(more);
      cw.appendChild(box);
    }

    // official group messages
    const gw = $('#groups');
    gw.innerHTML = '';
    $('#group-count').textContent = (d.group_messages || []).length;
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

  // 导出安全事件 CSV(要带 token,所以用 fetch 取回 blob 再存)。
  const exportBtn = $('#btn-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        const r = await fetch(API_BASE + '/api/security/events.csv?limit=1000', {
          headers: { 'Authorization': 'Bearer ' + state.token },
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'vvechat-security-events.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('已导出 CSV');
      } catch (e) {
        toast('导出失败：' + e.message);
      } finally {
        exportBtn.disabled = false;
      }
    });
  }

  $('#btn-scan').addEventListener('click', async () => {
    const btn = $('#btn-scan');
    btn.disabled = true;
    try {
      await api('/api/security/scan', { method: 'POST', body: {} });
      toast('自检完成');
      await loadSecurity();
    } catch (e) {
      toast('自检失败：' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

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
      if (!await ensureStepUp()) return;
      await api('/api/control/format-all', {
        method: 'POST', body: {},
        headers: { 'X-Step-Up': stepUpToken },
      });
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
    // 顶栏的按钮在登录前不可用 —— 否则点了会拿到 "missing token"
    const topbarBtns = Array.from(document.querySelectorAll('.topbar-right .pill'));
    const setTopbarEnabled = (on) => topbarBtns.forEach(b => { b.disabled = !on; });
    setTopbarEnabled(false);
    // restore an admin session if we have one
    try {
      const t = sessionStorage.getItem('vve-ctl-token');
      if (t) {
        state.token = t;
        const probe = await api('/api/control/snapshot');
        state.data = probe;
        $('#gate').classList.add('hidden');
        $('#panel').classList.remove('hidden');
        setTopbarEnabled(true);
        await load();
      }
    } catch (_) {
      state.token = '';
    }
  })();

  window.addEventListener('error', (e) => console.error('[control]', e.error || e.message));
})();
