/* ==========================================================
   VVeChat — frontend app v3 (clean rebuild)
   ========================================================== */

(() => {
  // ---------- config ----------
  const DEFAULT_PROD_API = 'https://vvechat.onrender.com';
  const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://127.0.0.1:3000'
    : (window.VVECHAT_API || DEFAULT_PROD_API);
  const IS_MOCK = !API_BASE && !!window.__mockBackend;

  // ---------- i18n strings (no function calls — safe) ----------
  const STRINGS = {
    zh: {
      theme_auto: '跟随系统',
      theme_light: '浅色',
      theme_dark: '深色',
      ai_checking: '正在检查中转状态…',
      think_low: '思考 · 低',
      think_medium: '思考 · 中',
      think_high: '思考 · 高',
      plus_title: '搜索 / 添加',
      plus_add_user: '添加用户',
      plus_add_user_desc: '按用户名搜索并发送申请',
      their_username: '对方的用户名',
      requests_title: '好友申请',
      members_title: '群成员',
      profile_title: '个人资料',
      confirm_title: '确认',
      reconnecting: '正在重新连接…',
      cancel: '取消',
      cancel_at: '取消 @',
      tag_official: '官方',
      ok: '确定',
      send_request: '发送申请',
      auth_username: '用户名',
      auth_password: '密码',
      auth_err_fill: '请填写用户名和密码',
      auth_loading_login: '登录中…',
      auth_loading_register: '注册中…',
      auth_ok_login: '登录成功！',
      auth_ok_register: '注册成功，已加入官方群！',
      err_network: '无法连接服务器',
      err_timeout: '服务器响应超时（可能在冷启动）',
      err_username_required: '用户名和密码不能为空',
      err_self: '不能加自己',
      err_already_friend: '已经是好友了',
      err_pending: '已发送过申请，等待对方处理',
      err_user_not_found: '该用户不存在',
      err_username_taken: '该用户名已被使用',
      err_username_len: '用户名长度需 2-24',
      err_password_len: '密码至少 4 位',
      err_account: '账号不存在',
      err_password_wrong: '密码错误',
      err_load: '加载失败',
      err_send: '发送失败',
      err_action: '操作失败',
      err_group_create_min: '至少选择 1 位好友',
      err_group_create_name: '请输入群名称',
      ok_friend_added: '已添加好友',
      ok_rejected: '已拒绝',
      ok_auto_friend: '对方也发过申请，已自动互加好友！',
      ok_request_sent: '申请已发送，等待对方处理',
      ok_group_created: '群创建成功',
      ok_joined: '已加入群',
      toast_copied: '已复制',
      toast_img_too_big: '图片超过 5MB',
      toast_img_only: '只支持图片',
      msg_deleted: '消息已删除',
      msg_deleted_title: '撤回这条消息？',
      empty: '暂无',
      no_friends_yet: '还没有好友',
      tap_magnifier_to_search: '点击右上角放大镜搜索',
      splash_hint: '（点击任意一处开始使用）',
      no_groups_yet: '还没有群聊',
      today: '今天',
      sent: '已发送',
      read: '已读',
      img_alt: '图片',
      type_image: '🖼  图片',
      new_msg: '新消息',
      online: '在线',
      friend: '好友',
      member_sub: '成员',
      group_sub: '群聊',
      official_sub: '系统通知、新人欢迎',
      reply: '回复',
      add: '加入',
      cancel: '取消',
      ok: '确定',
      profile_title: '我的资料',
      profile_username: '用户名',
      profile_bio: '个人简介',
      profile_bio_ph: '说点什么吧…',
      profile_color: '头像颜色',
      profile_bio_empty: '这个人很懒，什么都没写',
      profile_saved: '已保存',
      bio_sub: '好友',
      bio_online: '在线',
      me: '我',
      member: '成员',
      btn_pm: '私聊',
      btn_edit: '编辑资料',
      btn_msg: '发消息',
      btn_save: '保存',
      btn_refresh: '刷新',
      btn_back: '返回',
      btn_logout: '退出',
      btn_login: '登录',
      btn_register: '注册',
      btn_logout: '退出登录',
      confirm_logout: '确定要退出登录？',
      btn_accept: '同意',
      btn_reject: '拒绝',
      btn_delete: '撤回',
      btn_copy: '复制',
      btn_reply: '回复',
      btn_retry: '↻ 点此重试',
      toast_friend_req: '{0} 想加你为好友',
      toast_req_accepted: '对方接受了你的好友申请 🎉',
      toast_req_rejected: '对方拒绝了你的好友申请',
      toast_new_friend: '{0} 成为你的好友啦',
      toast_new_group: '你被拉入群：{0}',
      req_want: '想加你为好友 · ',
      loading: '加载中',
      group_count: '已选',
      group_min_hint: '至少 1 位好友',
      admin_login_title: '管理员登录',
      admin_active: '管理员已激活',
      admin_key_placeholder: '输入管理员密钥',
      admin_panel: '管理面板',
      admin_users: '用户',
      admin_groups: '群',
      admin_messages: '消息',
      admin_official_msgs: '官方群消息',
      admin_wipe_official: '清空官方群消息',
      admin_wipe_official_hint: '删除官方群内的所有消息（不可恢复）',
      admin_wipe_official_btn: '一键清空官方群',
      admin_batch: '批量删除',
      admin_batch_hint: '按群 ID / 发送者 / 关键字 / 仅官方群筛选',
      admin_group_id: '群 ID（可选）',
      admin_sender_id: '发送者 ID（可选）',
      admin_keyword: '内容包含',
      admin_official_only: '仅官方群',
      admin_preview: '预览',
      admin_execute: '执行删除',
      admin_logout: '退出管理员',
      admin_logout_btn: '退出',
      admin_need_login: '需要先登录管理员',
      admin_key_wrong: '密钥错误',
      admin_logged_out: '已退出管理员',
      confirm_wipe_official: '确定清空官方群所有消息？此操作不可恢复！',
      confirm_batch: '确定删除匹配的消息？',
      matched: '匹配',
      deleted: '已删除',
      wiped: '已清空',
      admin_delete: '管理员删除',
      admin_badge: '管理员',
      jack_delete: 'Jack 删除',
      jack_remove: '移除',
      confirm_jack_delete: '确定要删除这条消息？',
      confirm_delete_msg: '确定要删除这条消息？',
      admin_dev: '管理员 / 开发者',
      forward: '转发',
      forward_to: '转发到',
      reply: '引用',
      copied: '已复制',
      copy_failed: '复制失败',
      forwarded: '已转发',
      groups: '群聊',
      confirm_kick: '确定把 {0} 从群里移除？',
      removed: '已移除',
      rename_group: '重命名',
      rename_group_prompt: '新的群名称',
      rename_ok: '已修改',
      members: '成员',
      only_jack_rename_official: '只有 Jack 才能修改官方群名称',
      nav_chats: '聊天',
      nav_assistant: '助手',
      nav_discover: '发现',
      discover_title: '发现',
      discover_sub: '看看大家在聊什么',
      discover_create: '建个群',
      discover_empty: '还没有人推荐群聊',
      discover_empty_sub: '你可以自己建一个',
      cg_title: '建个群聊',
      cg_name: '群名称',
      cg_name_ph: '给群起个名字',
      cg_recommend: '在 发现页 里推荐',
      cg_recommend_note: '此开关将在群聊的设置里显示',
      cg_create: '创建',
      pref_discover: '发现',
      pref_discover_desc: '看看别人建的群聊，申请加入就能一起聊',
      nav_personal: '个性化',
      pref_look: '外观',
      pref_550c: '550C 启动动画主题',
      pref_550c_desc: '重新进入账号时用 550C 开机动画替代欢迎页，并切换为琥珀色终端风格',
      pref_density: '界面密度',
      pref_density_desc: '列表和消息的疏密',
      pref_compact: '紧凑',
      pref_normal: '标准',
      pref_roomy: '宽松',
      pref_font: '字号大小',
      pref_font_desc: '整个界面的文字大小',
      pref_small: '小',
      pref_medium: '标准',
      pref_large: '大',
      pref_clock: '时间格式',
      pref_clock_desc: '消息旁边显示时间的样式',
      pref_24h: '24 小时',
      pref_12h: '12 小时',
      pref_assistant: '助手',
      pref_ai_groups: '群里可以叫助手',
      pref_ai_groups_desc: '在群聊里 @Qwen，它会读完上下文再回答',
      pref_lang: '语言',
      pref_lang_desc: '界面语言',
      pref_about: '关于',
      pref_about_desc: 'VVeChat OS 1',
      pref_about_credit: '550C 主题移植自 yannicksong0106/dsh-550c-boot（MIT）',
      list_unread: '未读消息',
      list_no_unread: '没有未读消息',
      list_sessions: '会话',
      list_empty: '还没有群聊或好友',
      list_search_ph: '搜索好友 / 群聊 / 用户',
      hint_assistant_call: '点击我 让Qwen也一起来聊！',
      ai_new_chat: '新对话',
      ai_welcome: '有什么可以帮你？',
      ai_input_ph: '给 Qwen 发消息…（Enter 发送，Shift+Enter 换行）',
      ai_today: '今天',
      chat_empty_title: '选择一个会话开始聊天',
      chat_empty_desc: '可以从左侧选一个，或点右上角放大镜添加好友/群聊',
      chat_input_ph: '输入消息…',
      send: '发送',
      attach: '图片',
    },
    en: {
      theme_auto: 'System',
      theme_light: 'Light',
      theme_dark: 'Dark',
      ai_checking: 'Checking the relay status…',
      think_low: 'Think · low',
      think_medium: 'Think · medium',
      think_high: 'Think · high',
      plus_title: 'Search / Add',
      plus_add_user: 'Add a person',
      plus_add_user_desc: 'Search by username and send a request',
      their_username: 'Their username',
      requests_title: 'Friend requests',
      members_title: 'Members',
      profile_title: 'Profile',
      confirm_title: 'Confirm',
      reconnecting: 'Reconnecting…',
      cancel: 'Cancel',
      cancel_at: 'Cancel @',
      tag_official: 'Official',
      ok: 'OK',
      send_request: 'Send request',
      auth_username: 'Username',
      auth_password: 'Password',
      auth_err_fill: 'Please fill in username and password',
      auth_loading_login: 'Signing in…',
      auth_loading_register: 'Signing up…',
      auth_ok_login: 'Signed in!',
      auth_ok_register: 'Account created, joined official group!',
      err_network: 'Cannot reach server',
      err_timeout: 'Server timed out (likely cold start)',
      err_username_required: 'Username and password required',
      err_self: 'You cannot add yourself',
      err_already_friend: 'Already friends',
      err_pending: 'Request already sent',
      err_user_not_found: 'User not found',
      err_username_taken: 'Username already taken',
      err_username_len: 'Username must be 2-24 chars',
      err_password_len: 'Password must be at least 4 chars',
      err_account: 'Account not found',
      err_password_wrong: 'Wrong password',
      err_load: 'Failed to load',
      err_send: 'Failed to send',
      err_action: 'Action failed',
      err_group_create_min: 'Select at least 1 friend',
      err_group_create_name: 'Group name is required',
      ok_friend_added: 'Friend added',
      ok_rejected: 'Declined',
      ok_auto_friend: 'They also requested you — auto-friended!',
      ok_request_sent: 'Request sent, waiting',
      ok_group_created: 'Group created',
      ok_joined: 'Joined',
      toast_copied: 'Copied',
      toast_img_too_big: 'Image larger than 5MB',
      toast_img_only: 'Images only',
      msg_deleted: 'Message deleted',
      msg_deleted_title: 'Delete this message?',
      empty: 'Empty',
      no_friends_yet: 'No friends yet',
      tap_magnifier_to_search: 'Tap magnifier to search',
      splash_hint: '(Tap anywhere to start)',
      no_groups_yet: 'No groups yet',
      today: 'Today',
      sent: 'Sent',
      read: 'Read',
      img_alt: 'Image',
      type_image: '🖼  Image',
      new_msg: 'New message',
      online: 'Online',
      friend: 'Friend',
      member_sub: 'member',
      group_sub: 'Group',
      official_sub: 'Announcements & new members',
      reply: 'Reply',
      add: 'Join',
      cancel: 'Cancel',
      ok: 'OK',
      profile_title: 'My profile',
      profile_username: 'Username',
      profile_bio: 'Bio',
      profile_bio_ph: 'Say something…',
      profile_color: 'Avatar color',
      profile_bio_empty: 'This user is too lazy to write a bio',
      profile_saved: 'Saved',
      bio_sub: 'Friend',
      bio_online: 'Online',
      me: 'Me',
      member: 'Member',
      btn_pm: 'Message',
      btn_edit: 'Edit',
      btn_msg: 'Message',
      btn_save: 'Save',
      btn_refresh: 'Refresh',
      btn_back: 'Back',
      btn_logout: 'Log out',
      btn_login: 'Sign in',
      btn_register: 'Sign up',
      btn_logout: 'Log out',
      confirm_logout: 'Log out now?',
      btn_accept: 'Accept',
      btn_reject: 'Decline',
      btn_delete: 'Delete',
      btn_copy: 'Copy',
      btn_reply: 'Reply',
      btn_retry: '↻ Tap to retry',
      toast_friend_req: '{0} wants to be your friend',
      toast_req_accepted: 'They accepted your friend request 🎉',
      toast_req_rejected: 'They declined your friend request',
      toast_new_friend: '{0} is now your friend',
      toast_new_group: 'Added to group: {0}',
      req_want: 'wants to be your friend · ',
      loading: 'Loading',
      group_count: 'Selected',
      group_min_hint: 'at least 1 friend',
      admin_login_title: 'Admin login',
      admin_active: 'Admin active',
      admin_key_placeholder: 'Enter admin key',
      admin_panel: 'Admin panel',
      admin_users: 'Users',
      admin_groups: 'Groups',
      admin_messages: 'Messages',
      admin_official_msgs: 'Official group messages',
      admin_wipe_official: 'Wipe official group',
      admin_wipe_official_hint: 'Delete all messages in the official group (irreversible)',
      admin_wipe_official_btn: 'Wipe official group',
      admin_batch: 'Batch delete',
      admin_batch_hint: 'Filter by group ID / sender / keyword / official only',
      admin_group_id: 'Group ID (optional)',
      admin_sender_id: 'Sender ID (optional)',
      admin_keyword: 'Content contains',
      admin_official_only: 'Official group only',
      admin_preview: 'Preview',
      admin_execute: 'Execute delete',
      admin_logout: 'Logout admin',
      admin_logout_btn: 'Logout',
      admin_need_login: 'Admin login required',
      admin_key_wrong: 'Wrong key',
      admin_logged_out: 'Logged out from admin',
      confirm_wipe_official: 'Wipe all official group messages? This cannot be undone!',
      confirm_batch: 'Delete matching messages?',
      matched: 'Matched',
      deleted: 'Deleted',
      wiped: 'Wiped',
      admin_delete: 'Admin delete',
      admin_badge: 'Admin',
      jack_delete: 'Jack delete',
      jack_remove: 'Remove',
      confirm_jack_delete: 'Delete this message?',
      confirm_delete_msg: 'Delete this message?',
      admin_dev: 'Admin / Developer',
      forward: 'Forward',
      forward_to: 'Forward to',
      reply: 'Reply',
      copied: 'Copied',
      copy_failed: 'Copy failed',
      forwarded: 'Forwarded',
      groups: 'Groups',
      confirm_kick: 'Remove {0} from this group?',
      removed: 'Removed',
      rename_group: 'Rename',
      rename_group_prompt: 'New group name',
      rename_ok: 'Renamed',
      members: 'Members',
      only_jack_rename_official: 'Only Jack can rename the official group',
      nav_chats: 'Chats',
      nav_assistant: 'Assistant',
      nav_discover: 'Discover',
      discover_title: 'Discover',
      discover_sub: 'See what people are talking about',
      discover_create: 'New group',
      discover_empty: 'No groups recommended yet',
      discover_empty_sub: 'You can make one yourself',
      cg_title: 'Create a group',
      cg_name: 'Group name',
      cg_name_ph: 'Give the group a name',
      cg_recommend: 'Recommend it in Discover',
      cg_recommend_note: 'This switch also shows in the group settings',
      cg_create: 'Create',
      pref_discover: 'Discover',
      pref_discover_desc: 'See the groups other people made and apply to join',
      nav_personal: 'Personal',
      pref_look: 'Look & feel',
      pref_550c: '550C boot animation',
      pref_550c_desc: 'Show the 550C boot sequence instead of the welcome screen, in amber terminal colours',
      pref_density: 'Density',
      pref_density_desc: 'How tight the lists and messages sit',
      pref_compact: 'Compact',
      pref_normal: 'Normal',
      pref_roomy: 'Roomy',
      pref_font: 'Text size',
      pref_font_desc: 'The size of the text across the app',
      pref_small: 'Small',
      pref_medium: 'Normal',
      pref_large: 'Large',
      pref_clock: 'Clock',
      pref_clock_desc: 'How the time next to a message is written',
      pref_24h: '24-hour',
      pref_12h: '12-hour',
      pref_assistant: 'Assistant',
      pref_ai_groups: 'Let the assistant join groups',
      pref_ai_groups_desc: '@Qwen in a group reads the conversation, then answers',
      pref_lang: 'Language',
      pref_lang_desc: 'Interface language',
      pref_about: 'About',
      pref_about_desc: 'VVeChat OS 1',
      pref_about_credit: 'The 550C theme is ported from yannicksong0106/dsh-550c-boot (MIT)',
      list_unread: 'Unread',
      list_no_unread: 'Nothing unread',
      list_sessions: 'Conversations',
      list_empty: 'No groups or friends yet',
      list_search_ph: 'Search friends / groups / people',
      hint_assistant_call: 'Tap me — let Qwen join the chat!',
      ai_new_chat: 'New chat',
      ai_welcome: 'What can I help with?',
      ai_input_ph: 'Message Qwen… (Enter to send, Shift+Enter for a newline)',
      ai_today: 'Today',
      chat_empty_title: 'Pick a conversation to start',
      chat_empty_desc: 'Choose one on the left, or use the magnifier to add someone',
      chat_input_ph: 'Type a message…',
      send: 'Send',
      attach: 'Image',
    },
  };

  // ---------- state ----------
  // The language is a real, switchable value again: 中文 / English.
  let lang = (() => {
    try { return localStorage.getItem('vve:lang') === 'en' ? 'en' : 'zh'; } catch (_) { return 'zh'; }
  })();
  let authMode = 'login';
  const state = {
    user: null, token: null, socket: null,
    friends: [], groups: [], conversations: [],
    requests: [], unreadRequests: 0,
    recommended: [],
    currentChat: null, messagesByConv: {},
    online: new Set(),
    typingUsers: new Map(),
    pendingReply: null, pendingImage: null,
    // @ mentions: the member list of every group we have opened, and
    // who the next message is about to call out.
    groupMembers: {}, mentionTarget: null,
  };

  // ---------- i18n helpers ----------
  function t(key, ...args) {
    const table = STRINGS[lang] || STRINGS.zh;
    const s = table[key] || STRINGS.zh[key] || key;
    if (!args.length) return s;
    return s.replace(/\{(\d+)\}/g, (m, i) => args[Number(i)] ?? m);
  }
  // Walk the markup and swap every translated text node. Elements
  // carry data-i18n="key"; data-i18n-ph fills a placeholder, and
  // data-i18n-title / data-i18n-aria set a tooltip or a label.
  function applyI18n(root) {
    const scope = root || document;
    $$('[data-i18n]', scope).forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const val = t(key);
      if (val !== key) el.textContent = val;
    });
    $$('[data-i18n-ph]', scope).forEach((el) => {
      const key = el.getAttribute('data-i18n-ph');
      if (key) { const val = t(key); if (val !== key) el.placeholder = val; }
    });
    $$('[data-i18n-title]', scope).forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) { const val = t(key); if (val !== key) el.title = val; }
    });
    $$('[data-i18n-aria]', scope).forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) { const val = t(key); if (val !== key) el.setAttribute('aria-label', val); }
    });
  }
  // Refresh every view after a profile change.
  function setLang(next) {
    if (next) {
      lang = next === 'en' ? 'en' : 'zh';
      try { localStorage.setItem('vve:lang', lang); } catch (_) {}
    }
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    applyI18n();
    const lg = $('#lang-glyph');
    if (lg) lg.textContent = lang === 'en' ? '中' : 'EN';
    if (state.user) {
      renderAll();
      if (state.currentChat) { renderChatHeader(); renderMessages(); }
      renderPrefPanel();
    } else {
      const btn = $('#auth-submit');
      if (btn) btn.textContent = authMode === 'login' ? t('btn_login') : t('btn_register');
    }
  }

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const clock = () => {
      if (prefs.clock24) return d.toTimeString().slice(0, 5);
      let h = d.getHours();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      return h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ampm;
    };
    if (d.toDateString() === now.toDateString()) return clock();
    return `${d.getMonth()+1}/${d.getDate()}`;
  }
  // Avatar letter for a group: the official group reads「官」, any other
  // group「群」. Falls back to initials() for non-Chinese names.
  function groupLetter(name, isOfficial) {
    if (isOfficial) return lang === 'en' ? 'O' : '官';
    if (/[\u4e00-\u9fa5]/.test(name || '')) return lang === 'en' ? 'G' : '群';
    return initials(name);
  }

  function initials(name) {
    if (!name) return '?';
    return /[\u4e00-\u9fa5]/.test(name) ? name.slice(-1) : name.slice(0,1).toUpperCase();
  }
  function shade(hex, percent) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    let [r, g, b] = [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)];
    r = Math.max(0, Math.min(255, r + (r * percent / 100)));
    g = Math.max(0, Math.min(255, g + (g * percent / 100)));
    b = Math.max(0, Math.min(255, b + (b * percent / 100)));
    return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
  }
  function currentPeerId(msg) {
    if (!state.user) return null;
    const m = String(msg.conv_id || '').match(/^u_(\d+)_(\d+)$/);
    if (!m) return null;
    return Number(m[1]) === state.user.id ? Number(m[2]) : Number(m[1]);
  }
  function userInfo(uid, m) {
    if (state.user && state.user.id === uid) return state.user;
    // If we have a message reference, use its sender info directly
    // (avoids stale friend cache showing wrong username like "息")
    if (m && m.sender_id === uid) {
      return { id: uid, username: m.sender_username, avatar_color: m.sender_avatar_color };
    }
    const f = state.friends.find(f => f.id === uid);
    if (f) return f;
    return { id: uid, username: t('new_msg') };
  }
  // Build an inline style for a user/chat avatar — uses avatar_color gradient.
  function avatarStyle(u) {
    if (!u) return '';
    if (u.avatar_color) return `background:linear-gradient(135deg, ${u.avatar_color}, ${shade(u.avatar_color, -25)});`;
    return '';
  }
  // An emoji avatar wins over the auto-generated initial.
  const EMOJI_AVATARS = [
    '🦊','🐼','🐨','🦁','🐯','🐸','🐵','🐧','🐦','🦉',
    '🐶','🐱','🐭','🐹','🐰','🦄','🐝','🦋','🐢','🐙',
    '🌟','✨','🔥','💎','🎯','🚀','☕️','🍀','🌊','🌙',
    '👑','🧠','👾','🤖','👻','🎨','🎧','📷','🧩','🗝'
  ];

  function emojiOf(c) {
    if (!c) return null;
    if (c.avatar_emoji) return c.avatar_emoji;
    if (state.user && c.id === state.user.id && state.user.avatar_emoji) return state.user.avatar_emoji;
    return null;
  }

  function avatarInner(u) {
    const e = emojiOf(u);
    if (e) return `<span class="avatar-emoji">${escapeHtml(e)}</span>`;
    return escapeHtml(initials(u && u.username || '?'));
  }
  function isOnline(uid) { return uid && state.online.has(uid); }
  function showOffline() { $('#offline-banner')?.classList.remove('hidden'); }
  function hideOffline() { $('#offline-banner')?.classList.add('hidden'); }

  // ---------- API client (with timeout + retry) ----------
  const API_TIMEOUT = 65000;
  async function apiRaw(path, opts = {}) {
    if (IS_MOCK) {
      const method = (opts.method || 'GET').toUpperCase();
      const qs = {};
      if (method === 'GET' && path.includes('?')) {
        const [p, q] = path.split('?');
        path = p;
        for (const part of q.split('&')) {
          const [k, v] = part.split('=');
          qs[decodeURIComponent(k)] = decodeURIComponent(v || '');
        }
      }
      const r = window.__mockBackend.handle(method, path, qs, opts.body || null, state.token);
      if (r.status >= 400) throw new Error((r.body && r.body.error) || `HTTP ${r.status}`);
      return r.body;
    }
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const url = `${API_BASE}/api${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT);
    let resp;
    try {
      resp = await fetch(url, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
    }
    clearTimeout(timer);
    let data = null;
    try { data = await resp.json(); } catch {}
    if (!resp.ok) throw new Error((data && data.error) || `HTTP ${resp.status}`);
    return data;
  }
  async function api(path, opts = {}) {
    try { return await apiRaw(path, opts); }
    catch (e) {
      const retryable = (opts.retryable ?? true);
      if (retryable && (e.message === 'TIMEOUT' || e.message === 'NETWORK')) {
        await new Promise(r => setTimeout(r, 800));
        try { return await apiRaw(path, opts); }
        catch (e2) {
          if (e2.message === 'TIMEOUT') throw new Error(t('err_timeout'));
          if (e2.message === 'NETWORK') throw new Error(t('err_network'));
          throw e2;
        }
      }
      throw e;
    }
  }

  // ---------- admin (Jack-only, automatic via state.user.is_admin) ----------
  // Jack detection must not depend on state.user.is_admin — a user object
  // restored from localStorage can be missing that field. The username is
  // authoritative because the backend treats it as the built-in admin.
  function isJack() {
    if (!state.user) return false;
    return state.user.username === 'Jack' || state.user.is_admin === true;
  }
  async function jackWipeGroup(groupId) {
    return api(`/admin/messages/wipe-group/${groupId}`, { method: 'POST' });
  }
  async function jackBatchDelete(body) {
    return api('/admin/messages/batch', { method: 'POST', body });
  }
  async function jackWipeAll() {
    return api('/admin/wipe', { method: 'POST' });
  }
  async function jackRemoveMember(groupId, userId) {
    return api(`/admin/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
  }
  async function jackDeleteMessage(id) {
    return api(`/messages/${id}`, { method: 'DELETE' });
  }

  // ---------- view switching ----------
  function showAuth() { $('#auth-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); document.body.classList.remove('app-active'); }
  function showApp()  { $('#auth-view').classList.add('hidden');  $('#app-view').classList.remove('hidden'); document.body.classList.add('app-active'); }

  // ----- Theme: auto / light / dark (driven by prefers-color-scheme + manual override) -----
  function currentThemeMode() {
    try { return localStorage.getItem('vve:theme') || 'auto'; } catch (_) { return 'auto'; }
  }
  function boot550cOn() { return !!(window.Boot550C && window.Boot550C.enabled()); }

  // The 550C theme is ~60 KB and only fetched when it is actually used.
  // This loads it on demand and resolves once it is ready.
  var _boot550cLoading = null;
  function ensureBoot550cLoaded() {
    if (window.Boot550C) return Promise.resolve();
    if (_boot550cLoading) return _boot550cLoading;
    _boot550cLoading = new Promise((resolve) => {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'boot550c.css?v=' + (window.__VV_ASSET_V || '');
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = 'boot550c.js?v=' + (window.__VV_ASSET_V || '');
      js.onload = () => resolve();
      js.onerror = () => resolve();   // a missing theme must not break the app
      document.head.appendChild(js);
    });
    return _boot550cLoading;
  }
  function applyTheme(mode) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const systemDark = mql.matches;
    // The 550C theme is a dark terminal look — it always wins over the
    // light/dark picker.
    const c550 = boot550cOn();
    const wantDark = c550 || mode === 'dark' || (mode === 'auto' && systemDark);
    document.body.classList.toggle('dark', wantDark);
    document.body.classList.remove('theme-light', 'theme-dark', 'theme-auto');
    document.body.classList.add('theme-' + mode);
    document.body.classList.toggle('theme-550c', c550);
    // Update checkmarks in the menu
    $$('.theme-menu-item').forEach(b => b.classList.toggle('active', b.dataset.theme === mode));
    if (window.LiquidGlass) { try { window.LiquidGlass.markDirty(); } catch (_) {} }
  }
  // ----- 550C boot theme: local (instant) + server (per-account) -----
  // The switch is stored in localStorage so the boot animation can be
  // decided before we know who is signed in, and mirrored to the
  // account so it follows the user to other devices.
  async function saveBoot550cToServer(on) {
    if (!state.token) return;
    try {
      const r = await api('/me', { method: 'PUT', body: { boot_550c: on ? 1 : 0 } });
      if (r && r.user) {
        state.user = r.user;
        try { localStorage.setItem('vve:user', JSON.stringify(state.user)); } catch (_) {}
      }
    } catch (e) { console.warn('[VVeChat] boot_550c save failed:', e); }
  }
  async function applyBoot550cFromUser(user) {
    if (!user || user.boot_550c === undefined || user.boot_550c === null) return false;
    // Once the user has made the choice on this device, the local
    // value wins — the server copy is a backup for other devices, not
    // an override that could yank the switch back mid-session.
    let touched = false;
    try { touched = localStorage.getItem('vve:boot550c') !== null; } catch (_) {}
    const wantOn = touched ? boot550cOn() : !!user.boot_550c;
    if (wantOn === boot550cOn()) return false;
    // The theme files may not be on this device yet — the account has
    // it on but this browser never downloaded it. Fetch them first.
    if (wantOn) await ensureBoot550cLoaded();
    if (!window.Boot550C) return false;
    window.Boot550C.setEnabled(wantOn);
    applyTheme(currentThemeMode());
    const t = $('#toggle-boot-550c');
    if (t) t.checked = wantOn;
    return true;
  }
  function initTheme() {
    let saved = 'auto';
    try { saved = localStorage.getItem('vve:theme') || 'auto'; } catch (_) {}
    applyTheme(saved);
    // Wire up the theme menu
    const wrap = $('#theme-menu-wrap');
    const toggle = $('#btn-theme-toggle');
    const menu = $('#theme-menu');
    if (toggle && menu && wrap) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !menu.classList.contains('hidden');
        menu.classList.toggle('hidden', isOpen);
        toggle.setAttribute('aria-expanded', String(!isOpen));
      });
      $$('.theme-menu-item').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = b.dataset.theme;
        try { localStorage.setItem('vve:theme', mode); } catch (_) {}
        applyTheme(mode);
        menu.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
      }));
      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) {
          menu.classList.add('hidden');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }
    // React to system theme change only when in 'auto' mode
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if ((localStorage.getItem('vve:theme') || 'auto') === 'auto') applyTheme('auto'); };
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else if (mql.addListener) mql.addListener(handler);
  }
  initTheme();
  function openModal(id) {
    const el = $('#'+id); if (!el) return;
    el.classList.remove('hidden');
    el.style.display = '';   // clear any inline display:none from previous close
  }
  function closeModal(id) {
    const el = $('#'+id); if (!el) return;
    el.classList.add('hidden');
    el.style.display = 'none';   // belt + suspenders — make sure it actually hides
    hideSuggestions();
  }
  function switchAuthTab(mode) {
    authMode = mode;
    $$('.auth-card .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
    $('#auth-submit').textContent = mode === 'login' ? t('btn_login') : t('btn_register');
    $('#auth-msg').textContent = '';
  }

  // ---------- avatar rendering ----------
  function avatarHtml(name, opts = {}) {
    const { size = '', online, color, group = false, official = false } = opts;
    const sz = size ? ' ' + size : '';
    const cls = ['avatar', sz, group ? 'group' : '', official ? 'official' : '', online ? 'online' : ''].filter(Boolean).join(' ');
    const dot = (group || official) ? '' : '<span class="online-dot"></span>';
    const bg = group ? '' : (color ? ` style="background:linear-gradient(135deg, ${color}, ${shade(color, -25)})"` : '');
    return `<div class="${cls}"${bg}>${escapeHtml(initials(name))}${dot}</div>`;
  }

  // ---------- rendering ----------
  function renderAll() { renderChats(); renderBell(); renderTopbarAvatar(); renderSideMe(); setListMode('chats'); }

  // The identity card at the top of the sidebar.
  function renderSideMe() {
    const av = $('#side-avatar');
    const nm = $('#side-name');
    const sb = $('#side-sub');
    if (!av || !state.user) return;
    const emoji = state.user.avatar_emoji || null;
    const color = state.user.avatar_color || '#5eead4';
    const face = emoji
      ? `<span class="avatar-emoji">${escapeHtml(emoji)}</span>`
      : escapeHtml(initials(state.user.username));
    const fill = emoji
      ? 'rgba(255,255,255,0.55)'
      : `linear-gradient(135deg, ${color}, ${shade(color, -25)})`;
    av.innerHTML = face;
    av.style.background = fill;
    av.classList.toggle('avatar-jack-glow', state.user.username === 'Jack');
    if (nm) nm.textContent = state.user.username;
    if (sb) sb.textContent = state.user.username === 'Jack' ? '管理员' : 'VVeChat';
    // The same face, at the top of the list column.
    const la = $('#list-avatar');
    if (la) {
      la.innerHTML = face;
      la.style.background = fill;
      la.classList.toggle('avatar-jack-glow', state.user.username === 'Jack');
    }
    const lnm = $('#list-me-name');
    if (lnm) lnm.textContent = state.user.username;
    const lsb = $('#list-me-sub');
    if (lsb) lsb.textContent = state.user.username === 'Jack' ? '管理员' : 'VVeChat';
  }

  function renderTopbarAvatar() {
    const el = $('#topbar-avatar');
    if (!el || !state.user) return;
    // Jack ALWAYS gets the signature gold — don't trust stale localStorage.
    const isJack = state.user.username === 'Jack' || !!state.user.is_admin;
    const color = isJack ? '#fbbf24' : (state.user.avatar_color || '#5eead4');
    const emoji = state.user.avatar_emoji || null;
    const letter = emoji ? null : initials(state.user.username);
    // Always show the user's first letter (or upload image if set)
    el.innerHTML = emoji
      ? `<span class="avatar-emoji">${escapeHtml(emoji)}</span>`
      : escapeHtml(letter || '');
    el.setAttribute('data-letter', letter || '');
    if (state.user.avatar) {
      el.style.backgroundImage = `url('${state.user.avatar}')`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundColor = 'transparent';
      el.style.background = '';
    } else {
      el.style.backgroundImage = '';
      el.style.background = `linear-gradient(135deg, ${color}, ${shade(color, -25)})`;
    }
    // Force white text + sizing inline so no CSS rule can hide the letter
    el.style.color = '#ffffff';
    el.style.fontSize = '13px';
    el.style.fontWeight = '700';
    el.style.lineHeight = '1';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    // Jack gets signature gold glow on topbar avatar
    el.classList.toggle('avatar-jack-glow', isJack);
    // show Jack pill if this user is Jack (use isJack, not is_admin —
    // is_admin can be missing from a stale localStorage user object)
    const existing = $('#topbar-jack-pill');
    if (existing) existing.remove();
    if (isJack) {
      const pill = document.createElement('span');
      pill.id = 'topbar-jack-pill';
      pill.className = 'admin-pill';
      pill.title = 'Jack 管理员';
      pill.textContent = '';  // ::before adds the shield, no text needed
      // insert before the profile button so layout flows: Jack | avatar | bell | plus | logout
      const profile = $('#btn-profile');
      if (profile && profile.parentElement) {
        profile.parentElement.insertBefore(pill, profile);
      } else {
        el.parentElement?.appendChild(pill);
      }
      // On mobile the sheet owns the topbar buttons — the pill must follow
      // them there instead of staying behind in the collapsed bar.
      syncMobileMenuLayout();
    }
  }

  // Build one sidebar row for a conversation.
  function buildConvRow(c, opts) {
    opts = opts || {};
    const li = document.createElement('li');
    li.className = 'list-item';
    if (state.currentChat && state.currentChat.type===c.type && String(state.currentChat.id)===String(c.id)) li.classList.add('active');
    const isGroup = c.type==='group';
    const isOfficial = !!c.is_official;
    const online = c.type==='user' && isOnline(c.id);
    const ac = isGroup ? `avatar group ${isOfficial?'official':''}` : 'avatar';
    const preview = c.last_message
      ? c.last_message
      : (isGroup
          ? (isOfficial ? t('official_sub') : t('group_sub'))
          : (c.is_new_friend ? (t('friend') || '好友') : t('new_msg')));
    const officialTag = isOfficial ? `<span class="tag-official">${escapeHtml(t('tag_official'))}</span>` : '';
    const avatarBg = isGroup ? '' : avatarStyle(c);
    const dot = (isGroup || isOfficial) ? '' : `<span class="online-dot"></span>`;
    const avatarCls = [ac, online?'online':''].filter(Boolean).join(' ');
    const senderPrefix = c.last_sender_id && c.last_sender_id !== state.user.id && isGroup
      ? `<span style="color:var(--accent);font-weight:600;">${escapeHtml(userInfo(c.last_sender_id).username)}:</span> ` : '';
    // A group message that calls the user out gets a loud prefix, so it
    // is visible even in the one-line preview.
    const atMePrefix = isGroup && mentionsMe(c.last_message)
      ? '<span style="color:var(--accent);font-weight:700;">[有人@我] </span>' : '';
    const unreadHtml = c.unread > 0 ? `<span class="unread">${c.unread>99?'99+':c.unread}</span>` : '';
    const inner = isGroup
      ? escapeHtml(groupLetter(c.username, isOfficial))
      : avatarInner(c);
    li.innerHTML = `<div class="${avatarCls}"${avatarBg} data-peer="${isGroup ? '' : c.id}">${inner}${dot}</div>
      <div class="meta"><div class="name">${escapeHtml(c.username)} ${officialTag}</div>
      <div class="preview">${atMePrefix}${senderPrefix}${escapeHtml(preview)}</div></div>
      <div class="time">${fmtTime(c.last_at)}</div>${unreadHtml}`;
    li.addEventListener('click', () => {
      openChat(c.type, c.id, c.username, isOfficial);
      // Opening the conversation IS the read receipt — the row must drop out
      // of the 未读消息 block immediately, not on the next refresh.
      if (c.unread > 0) {
        c.unread = 0;
        renderUnread();
      }
    });
    return li;
  }

  // The 未读消息 block: only conversations with unread messages. When the
  // user opens one, the server records the read receipt and the row
  // disappears from here.
  function renderUnread() {
    const list = $('#unread-list');
    const empty = $('#unread-empty');
    const badge = $('#unread-count');
    if (!list) return;
    list.innerHTML = '';
    const unread = state.conversations.filter(c => (c.unread || 0) > 0)
      .sort((a,b) => (b.unread||0)-(a.unread||0) || (b.last_at||0)-(a.last_at||0));
    const total = unread.reduce((n,c) => n + (c.unread||0), 0);
    if (badge) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.classList.toggle('hidden', total === 0);
    }
    if (empty) empty.classList.toggle('hidden', unread.length > 0);
    for (const c of unread) list.appendChild(buildConvRow(c, { unread: true }));
  }

  // The 会话 block: one list holding BOTH the group chats and the
  // private chats with friends. The separate 通讯录 pane is gone — this
  // is now the only place to reach your people.
  function renderChats() {
    const list = $('#chats-list'); const empty = $('#chats-empty');
    if (!list) return;
    list.innerHTML = '';
    const groups = state.conversations.filter(c => c.type === 'group');
    const privates = state.conversations.filter(c => c.type === 'user');
    // Friends you have never talked to still belong in the list —
    // otherwise removing the contacts pane would make them unreachable.
    const seen = new Set(privates.map(c => String(c.id)));
    const fresh = state.friends
      .filter(f => !seen.has(String(f.id)))
      .map(f => Object.assign({ type: 'user', unread: 0, last_at: 0, last_message: '', is_new_friend: true }, f));
    const all = [...groups, ...privates, ...fresh]
      .sort((a, b) => (b.is_official || 0) - (a.is_official || 0) || (b.last_at || 0) - (a.last_at || 0));
    if (empty) empty.classList.toggle('hidden', all.length > 0);
    for (const c of all) list.appendChild(buildConvRow(c));
    renderUnread();
  }

  function _renderChatsLegacy() {
    const list = $('#chats-list'); const empty = $('#chats-empty');
    list.innerHTML = '';
    if (!state.conversations.length) {
      empty.classList.remove('hidden');
      const cta = $('#chats-open-official');
      if (cta) {
        const official = state.groups.find(g => g.is_official);
        cta.classList.toggle('hidden', !official);
        cta.onclick = async () => {
          if (!official) return;
          try { await api(`/groups/${official.id}/join`, { method: 'POST' }); } catch (_) {}
          openChat('group', official.id, official.name, 1);
          refreshConversations();
        };
      }
      return;
    }
    empty.classList.add('hidden');
    const sorted = [...state.conversations].sort((a,b) => (b.is_official||0)-(a.is_official||0) || (b.last_at||0)-(a.last_at||0));
    for (const c of sorted) {
      const li = document.createElement('li');
      li.className = 'list-item';
      if (state.currentChat && state.currentChat.type===c.type && String(state.currentChat.id)===String(c.id)) li.classList.add('active');
      const isGroup = c.type==='group';
      const isOfficial = !!c.is_official;
      const online = c.type==='user' && isOnline(c.id);
      const ac = isGroup ? `avatar group ${isOfficial?'official':''}` : 'avatar';
      const preview = c.last_message
      ? c.last_message
      : (isGroup
          ? (isOfficial ? t('official_sub') : t('group_sub'))
          : (c.is_new_friend ? (t('friend') || '好友') : t('new_msg')));
      const officialTag = isOfficial ? `<span style="font-size:10px;background:rgba(245,158,11,0.14);color:#b45309;padding:2px 7px;border-radius:6px;border:1px solid rgba(245,158,11,0.30);font-weight:600;">${t('group_sub')==='群聊'?'官方':'Off'}</span>` : '';
      const avatarBg = isGroup ? '' : avatarStyle(c);
      const dot = (isGroup || isOfficial) ? '' : `<span class="online-dot"></span>`;
      const avatarCls = [ac, online?'online':''].filter(Boolean).join(' ');
      const senderPrefix = c.last_sender_id && c.last_sender_id !== state.user.id && isGroup
        ? `<span style="color:var(--accent);font-weight:600;">${escapeHtml(userInfo(c.last_sender_id).username)}:</span> ` : '';
      const unreadHtml = c.unread > 0 ? `<span class="unread">${c.unread>99?'99+':c.unread}</span>` : '';
      li.innerHTML = `<div class="${avatarCls}"${avatarBg} data-peer="${isGroup ? '' : c.id}">${escapeHtml(isGroup ? groupLetter(c.username, isOfficial) : initials(c.username))}${dot}</div>
        <div class="meta"><div class="name">${escapeHtml(c.username)} ${officialTag}</div>
        <div class="preview">${senderPrefix}${escapeHtml(preview)}</div></div>
        <div class="time">${fmtTime(c.last_at)}</div>${unreadHtml}`;
      li.addEventListener('click', () => openChat(c.type, c.id, c.username, isOfficial));
      list.appendChild(li);
    }
  }

  function renderBell() {
    const list = $('#bell-list'); const badge = $('#bell-badge');
    const pending = state.requests.filter(r => r.status==='pending');
    if (pending.length) { badge.classList.remove('hidden'); badge.textContent = pending.length>99?'99+':pending.length; }
    else badge.classList.add('hidden');
    if (!pending.length) { list.innerHTML = `<div class="empty-hint small"><p>${t('empty')}</p></div>`; return; }
    list.innerHTML = '';
    for (const r of pending) {
      const div = document.createElement('div'); div.className='req-item';
      div.innerHTML = `<div class="avatar sm">${escapeHtml(initials(r.from_username))}</div>
        <div class="meta"><div class="name">${escapeHtml(r.from_username)}</div>
        <div class="sub">${t('req_want')}${fmtTime(r.created_at)}</div></div>
        <div class="actions">
          <button class="btn btn-danger btn-sm" data-act="reject" data-id="${r.id}">${t('btn_reject')}</button>
          <button class="btn btn-ok btn-sm" data-act="accept" data-id="${r.id}">${t('btn_accept')}</button>
        </div>`;
      list.appendChild(div);
    }
  }

  // ---------- chat ----------
  async function refreshRecommended() {
    try {
      const r = await api('/groups/recommended');
      state.recommended = r.groups || [];
      renderRecommended();
    } catch (e) { console.error('refreshRecommended', e); }
  }
  function renderRecommended() {
    const list = $('#discover-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.recommended.length) {
      $('#discover-empty')?.classList.remove('hidden');
      return;
    }
    $('#discover-empty')?.classList.add('hidden');
    for (const g of state.recommended) {
      const card = document.createElement('div');
      card.className = 'discover-card';
      const color = g.icon_color || '#8b5cf6';
      const bg = `background:linear-gradient(135deg, ${color}, ${shade(color, -25)});`;
      const owner = g.owner_name ? (lang === 'en' ? 'by ' + g.owner_name : g.owner_name + ' 建的') : '';
      card.innerHTML = `<div class="avatar" style="${bg}">${escapeHtml((g.name || '?').slice(0, 1))}</div>
        <div class="discover-card-main">
          <div class="discover-card-name">${escapeHtml(g.name)}</div>
          <div class="discover-card-meta">${escapeHtml(owner)} · ${g.member_count || 0} ${lang === 'en' ? 'members' : '人'}</div>
        </div>
        <button class="discover-join${g.requested ? ' pending' : ''}" data-gid="${g.id}">${
          g.requested ? (lang === 'en' ? 'Applied' : '已申请') : (lang === 'en' ? 'Apply' : '申请加入')
        }</button>`;
      const btn = card.querySelector('.discover-join');
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (g.requested) { toast(lang === 'en' ? 'Waiting for the owner' : '已申请，等待群主处理'); return; }
        try {
          await api(`/groups/${g.id}/join`, { method: 'POST', body: {} });
          toast(lang === 'en' ? 'Request sent' : '已发送申请，等群主同意');
          refreshRecommended();
        } catch (e) { toast(e.message); }
      });
      list.appendChild(card);
    }
  }
  // ---- In-app confirm dialog ----
  // Native confirm() is unreliable inside a PWA / standalone Safari view, so
  // every destructive action goes through this instead.
  function askConfirm(opts) {
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      // NOTE: deliberately NOT .modal / .modal-mask — the global modal-close
      // delegate listens for those in the capture phase and would tear this
      // dialog down before the buttons ever get a click.
      mask.className = 'ask-confirm';
      mask.innerHTML = `
        <div class="ask-confirm-mask"></div>
        <div class="modal-card ask-confirm-card">
          <div class="modal-head"><h3>${escapeHtml(opts.title || '确认操作')}</h3></div>
          <div class="modal-body" style="font-size:14px;line-height:1.6;color:var(--ink-2);">
            ${escapeHtml(opts.message || '')}
          </div>
          <div class="modal-actions" style="display:flex;gap:10px;padding:0 20px 20px">
            <button class="btn btn-ghost" data-x="0" style="flex:1">${escapeHtml(opts.cancelText || '取消')}</button>
            <button class="btn ${opts.danger === false ? 'btn-primary' : 'btn-danger'}" data-x="1" style="flex:1">${escapeHtml(opts.okText || '确定')}</button>
          </div>
        </div>`;
      document.body.appendChild(mask);
      let closed = false;
      const onKey = (e) => {
        if (e.key === 'Escape') done(false);
      };
      const done = (v) => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        mask.remove();
        resolve(v);
      };
      mask.addEventListener('click', (e) => {
        const b = e.target.closest('[data-x]');
        if (b) { e.stopPropagation(); return done(b.dataset.x === '1'); }
        if (e.target.classList.contains('ask-confirm-mask')) done(false);
      });
      // Escape also cancels.
      document.addEventListener('keydown', onKey);
    });
  }

  async function openGroupInfoModal() {
    const gid = state.currentChat.id;
    const g = state.groups.find(g => g.id === gid) || {};
    const isOfficial = !!g.is_official;
    const isOwner = g.owner_id === state.user.id;
    const isAdmin = isJack();
    const canManage = isOwner || isAdmin;

    // Build iOS-Settings style rows
    const wrap = $('#group-info-list');
    wrap.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'group-info-head';
    const gBg = g.icon_color ? `background:linear-gradient(135deg, ${g.icon_color || '#8b5cf6'}, ${shade(g.icon_color || '#8b5cf6', -25)});` : '';
    head.innerHTML = `<div class="gi-avatar" style="${gBg}">${escapeHtml((g.name || '?').slice(0,1))}</div>
      <div class="gi-name" id="gi-name">${escapeHtml(g.name || '—')}</div>
      <div class="gi-meta">${g.member_count || 0} ${lang==='zh'?'人':'members'}</div>`;
    wrap.appendChild(head);

    // Editable name row (群主 / 管理员)
    if (canManage) {
      const renameRow = document.createElement('div');
      renameRow.className = 'settings-row';
      renameRow.innerHTML = `<span class="settings-label">${lang==='zh'?'群名称':'Group name'}</span>
        <span class="settings-value" id="gi-rename-value">${escapeHtml(g.name || '—')}</span>
        <span class="settings-chevron">›</span>`;
      renameRow.addEventListener('click', () => doRenameGroup(g, renameRow));
      wrap.appendChild(renameRow);
    }

    // Pin toggle
    const pinRow = document.createElement('div');
    pinRow.className = 'settings-row';
    const pin = !!g.pinned;
    pinRow.innerHTML = `<span class="settings-label">${lang==='zh'?'置顶聊天':'Pin to top'}</span>
      <label class="settings-switch"><input type="checkbox" id="gi-pin" ${pin?'checked':''}><span></span></label>`;
    wrap.appendChild(pinRow);

    // Group announcement
    const annRow = document.createElement('div');
    annRow.className = 'settings-row';
    annRow.innerHTML = `<span class="settings-label">${lang==='zh'?'群公告':'Group notice'}</span>
      <span class="settings-value" id="gi-ann-value">${escapeHtml(g.announcement || (lang==='zh'?'未设置':'Not set'))}</span>
      <span class="settings-chevron">›</span>`;
    if (canManage) annRow.addEventListener('click', () => doEditAnnouncement(gid, annRow));
    wrap.appendChild(annRow);

    // Set notice link row
    if (canManage) {
      const setAnnRow = document.createElement('div');
      setAnnRow.className = 'settings-row';
      setAnnRow.innerHTML = `<span class="settings-label" style="color:#3b82f6;">${lang==='zh'?'设置公告':'Set notice'}</span>
        <span class="settings-chevron" style="color:#3b82f6;">›</span>`;
      setAnnRow.addEventListener('click', () => doEditAnnouncement(gid, annRow));
      wrap.appendChild(setAnnRow);
    }

    // Recommend group toggle (群主可开启)
    if (canManage) {
      const recRow = document.createElement('div');
      recRow.className = 'settings-row';
      recRow.innerHTML = `<span class="settings-label">${lang==='zh'?'推荐群聊':'Recommend group'}</span>
        <span class="settings-value" style="font-size:12px;color:var(--muted);">${lang==='zh'?'开启后出现在"推荐"列表':'Show in Discover'}</span>
        <label class="settings-switch"><input type="checkbox" id="gi-recommend" ${g.recommended?'checked':''}><span></span></label>`;
      wrap.appendChild(recRow);
    }

    // Add-member row — group owner / Jack only
    if (canManage) {
      const addRow = document.createElement('div');
      addRow.className = 'settings-row';
      addRow.id = 'gi-add-member';
      addRow.innerHTML = `<div class="avatar sm" style="background:linear-gradient(135deg,#34d399,#10b981);color:#fff;">+</div>
        <div class="settings-label" style="color:#10b981;font-weight:600;">${lang==='zh'?'添加成员':'Add member'}</div>
        <div class="settings-trailing"><span class="settings-chevron">›</span></div>`;
      addRow.addEventListener('click', () => openAddMemberModal(g));
      wrap.appendChild(addRow);

      // Pending join requests — the owner approves them here.
      const reqRow = document.createElement('div');
      reqRow.className = 'settings-row';
      reqRow.id = 'gi-join-requests';
      const pendingCount = (state.pendingGroupRequests || {})[gid] || 0;
      reqRow.innerHTML = `<div class="avatar sm" style="background:linear-gradient(135deg,#f59e0b,#f97316);color:#fff;">?</div>
        <div class="settings-label" style="color:#f59e0b;font-weight:600;">${lang==='zh'?'入群申请':'Join requests'}</div>
        <div class="settings-trailing">${pendingCount
          ? `<span class="badge" style="background:#f59e0b;color:#fff;">${pendingCount}</span>`
          : `<span class="settings-chevron">›</span>`}</div>`;
      reqRow.addEventListener('click', () => openGroupRequestsModal(g));
      wrap.appendChild(reqRow);
    }

    // Members section header
    const mTitle = document.createElement('div');
    mTitle.className = 'section-title';
    mTitle.textContent = lang==='zh'?'群成员（' + (g.member_count||0) + '）':`Members (${g.member_count||0})`;
    wrap.appendChild(mTitle);

    // Members container
    const memberWrap = document.createElement('div');
    memberWrap.className = 'settings-group';
    memberWrap.id = 'group-info-members';
    wrap.appendChild(memberWrap);
    try {
      const r = await api(`/groups/${gid}/members`);
      memberWrap.innerHTML = '';
      for (const m of r.members) {
        const row = document.createElement('div'); row.className = 'settings-row';
        const bg = m.avatar_color ? `background:linear-gradient(135deg, ${m.avatar_color}, ${shade(m.avatar_color, -25)})` : '';
        const role = m.is_admin ? (lang==='zh'?'群主':'Owner') : (m.role === 1 ? (lang==='zh'?'群管':'Admin') : '');
        const right = [];
        if (m.id === state.user.id) right.push(`<span class="settings-value" style="font-size:12px;color:var(--muted);">${lang==='zh'?'我':'Me'}</span>`);
        if (role) right.push(`<span class="settings-value" style="font-size:12px;color:${m.is_admin?'#34d399':'#3b82f6'};">${role}</span>`);
        // action buttons for owner/admin managing others
        if (canManage && m.id !== state.user.id) {
          right.push(`<span class="settings-action danger" data-act="kick" data-uid="${m.id}">${lang==='zh'?'移除':'Remove'}</span>`);
        }
        row.innerHTML = `<div class="avatar sm" style="${bg}">${escapeHtml(initials(m.username))}</div>
          <div class="settings-label">${escapeHtml(m.username)}${m.is_admin?` <span class="admin-pill admin-pill-xs"></span>`:''}</div>
          <div class="settings-trailing">${right.join('')}</div>`;
        const kick = row.querySelector('[data-act="kick"]');
        if (kick) kick.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await askConfirm({
            title: '移出群聊',
            message: '确定把 ' + m.username + ' 从群里移出？',
            okText: '移出',
          });
          if (!ok) return;
          try {
            await api(`/groups/${gid}/members/${m.id}`, { method: 'DELETE' });
            row.remove();
            toast('已移出 ' + m.username);
            refreshGroups();
          } catch (e) { toast(e.message); }
        });
        memberWrap.appendChild(row);
      }
      // "Show more" link
      const more = document.createElement('div');
      more.className = 'settings-row settings-row-link';
      more.innerHTML = `<span class="settings-label" style="color:#3b82f6;">${lang==='zh'?'显示更多成员':'Show more members'}</span>`;
      more.addEventListener('click', () => toast(lang==='zh'?'已显示全部成员':'All members shown'));
      memberWrap.appendChild(more);
    } catch (e) { memberWrap.innerHTML = `<div class="empty-hint"><p>${escapeHtml(e.message)}</p></div>`; }

    // Bottom: dissolve / leave
    const bottom = document.createElement('div');
    bottom.className = 'group-info-bottom';
    if (isAdmin) {
      const dissolve = document.createElement('button');
      dissolve.className = 'settings-danger-btn';
      dissolve.textContent = lang==='zh'?'解散群聊':'Disband group';
      dissolve.addEventListener('click', () => doDisband(gid));
      bottom.appendChild(dissolve);
    }
    const leave = document.createElement('button');
    leave.className = 'settings-leave-btn';
    leave.textContent = lang==='zh'?'退出群聊':'Leave group';
    leave.addEventListener('click', () => doLeaveGroup(gid));
    bottom.appendChild(leave);
    wrap.appendChild(bottom);

    // Wire up pin + recommend
    pinRow.querySelector('#gi-pin')?.addEventListener('change', async (e) => {
      try {
        await api(`/groups/${gid}`, { method: 'PUT', body: { pinned: e.target.checked } });
        g.pinned = e.target.checked;
        toast(lang==='zh'?(e.target.checked?'已置顶':'已取消置顶'):(e.target.checked?'Pinned':'Unpinned'));
      } catch (e) { toast(e.message); e.target.checked = !e.target.checked; }
    });
    if (canManage) {
      wrap.querySelector('#gi-recommend')?.addEventListener('change', async (e) => {
        try {
          await api(`/groups/${gid}`, { method: 'PUT', body: { recommended: e.target.checked } });
          g.recommended = e.target.checked;
          toast(lang==='zh'?(e.target.checked?'已开启推荐':'已关闭推荐'):(e.target.checked?'Recommended':'Not recommended'));
        } catch (e) { toast(e.message); e.target.checked = !e.target.checked; }
      });
    }

    openModal('modal-group-info');
  }

  async function doRenameGroup(g, row) {
    const newName = prompt(lang==='zh'?'新的群名称':'New group name', g.name || '');
    if (!newName || !newName.trim() || newName.trim() === g.name) return;
    try {
      await api(`/groups/${g.id}`, { method: 'PUT', body: { name: newName.trim() } });
      g.name = newName.trim();
      $('#gi-name').textContent = g.name;
      row.querySelector('#gi-rename-value').textContent = g.name;
      renderChatHeader(); refreshGroups();
      toast(lang==='zh'?'已修改':'Saved');
    } catch (e) { toast(e.message); }
  }
  async function doEditAnnouncement(gid, row) {
    const cur = row.querySelector('#gi-ann-value')?.textContent || '';
    const v = prompt(lang==='zh'?'设置群公告':'Set group notice', cur === '未设置' ? '' : cur);
    if (v === null) return;
    try {
      await api(`/groups/${gid}`, { method: 'PUT', body: { announcement: v.slice(0, 200) } });
      row.querySelector('#gi-ann-value').textContent = v || (lang==='zh'?'未设置':'Not set');
      toast(lang==='zh'?'已设置':'Saved');
    } catch (e) { toast(e.message); }
  }
  async function doDisband(gid) {
    if (!confirm(lang==='zh'?'确定解散这个群聊？此操作不可撤销':'Disband this group? Cannot undo.')) return;
    try {
      await jackDisbandGroup(gid);
      closeModal('modal-group-info');
      refreshGroups(); refreshConversations();
      toast(lang==='zh'?'已解散':'Disbanded');
    } catch (e) { toast(e.message); }
  }
  async function doLeaveGroup(gid) {
    if (!confirm(lang==='zh'?'确定退出这个群聊？':'Leave this group?')) return;
    try {
      await api(`/groups/${gid}/leave`, { method: 'POST' });
      closeModal('modal-group-info');
      state.currentChat = null;
      $('#chat-window').classList.add('hidden');
      $('#chat-empty').classList.remove('hidden');
      refreshGroups(); refreshConversations();
      toast(lang==='zh'?'已退出':'Left');
    } catch (e) { toast(e.message); }
  }

  function setReplyTo(msg) {
    if (!msg) return;
    state.pendingReply = { id: msg.id, sender_username: msg.sender_username, content: msg.content, type: msg.type };
    $('#reply-preview-name').textContent = `${t('reply') || '引用'} ${msg.sender_username}`;
    $('#reply-preview-text').textContent = msg.type === 'image' ? (t('type_image') || '[图片]') : (msg.content || '').slice(0, 80);
    $('#reply-preview').classList.remove('hidden');
    $('#chat-input')?.focus();
  }
  async function openChat(type, id, title, isOfficial) {
    state.currentChat = {type, id, title, isOfficial};
    state.typingUsers.clear();
    renderTyping();
    state.pendingReply = null; state.pendingImage = null;
    clearMentionTarget();
    hideMentionMenu();
    updateMentionButton();
    // On a phone the list is a drawer over the content — picking a
    // conversation must close it again.
    $('.app-body')?.classList.remove('list-open');
    $('#chat-empty').classList.add('hidden');
    $('#chat-window').classList.remove('hidden');
    $('#reply-preview').classList.add('hidden');
    $('#img-preview').classList.add('hidden');
    renderChatHeader();
    // The @ picker needs the member list — fetch it in the background
    // so the chat itself opens instantly.
    if (type === 'group') loadGroupMembers(id).then(() => { if (state.currentChat && state.currentChat.id === id) renderMessages(); });
    if (window.innerWidth <= 820) {
      $('.app-body')?.classList.add('chat-open');
      $('#chat-back')?.classList.add('mobile-show');
      $('.right-pane')?.classList.add('mobile-show');
    }
    await loadMessages();
    renderMessages(); scrollBottom();
    const {type:t, id:i} = state.currentChat;
    const arr = state.messagesByConv[convKey(t,i)] || [];
    if (arr.length) sendReadReceipt(arr[arr.length-1]);
    refreshConversations();
  }
  function convKey(type, id) { return `${type}:${id}`; }

  function renderChatHeader() {
    if (!state.currentChat) return;
    const { type, id, title, isOfficial } = state.currentChat;
    const titleEl = $('#chat-title');
    // Official group: shield sits between the brand and the group type,
    // e.g. "VVeChat 🛡 官方群", rendered as a small inline badge.
    if (isOfficial) {
      const m = /^(.*?)(官方群|群)$/.exec(title);
      const head = m ? m[1].trim() : title;
      const tail = m ? m[2] : '';
      titleEl.innerHTML = tail
        ? `${escapeHtml(head)}<span class="title-shield">🛡</span>${escapeHtml(tail)}`
        : escapeHtml(title);
    } else {
      titleEl.textContent = title;
    }
    titleEl.dataset.tOrig = title;
    titleEl.dataset.tState = 'zh';
    const sub = $('#chat-sub'); const avatar = $('#chat-avatar');
    if (type === 'user') {
      const f = state.friends.find(f => f.id === id);
      const online = isOnline(id);
      sub.innerHTML = online ? `<span style="color:var(--online);">● ${t('online')}</span>` : escapeHtml(f?.bio || t('friend'));
      const bg = avatarStyle(f);
      avatar.style.cssText = `cursor:pointer;${bg}`;
      avatar.className = `avatar sm ${online?'online':''}`;
      avatar.style.display = 'flex';
      avatar.textContent = f && f.avatar ? '' : initials(title);
      avatar.onclick = () => f && openProfileModal(f);
    } else {
      sub.textContent = '';   // no subtitle — the group name is enough
      avatar.className = 'avatar sm group';
      // Set only the properties we need — assigning cssText would wipe the
      // class-driven width/height/font-size, which is what blew the single
      // character up into a giant emoji.
      avatar.style.background = isOfficial
        ? 'linear-gradient(135deg, #fde68a, #fb923c)'
        : '';
      avatar.style.display = 'flex';
      avatar.textContent = groupLetter(title, isOfficial);
      avatar.onclick = null;
    }
    // No admin badge in the chat header — the shield under the group name
    // was visual noise. (The topbar pill and the in-message badge stay.)
    // Jack can wipe any group's messages — show button when Jack and in a group
    const wipeBtn = $('#chat-admin-wipe');
    if (wipeBtn) {
      if (isJack() && type === 'group') wipeBtn.classList.remove('hidden');
      else wipeBtn.classList.add('hidden');
    }
  }

  async function loadMessages() {
    const {type,id} = state.currentChat;
    const key = convKey(type, id);
    const wrap = $('#chat-messages');
    const existing = state.messagesByConv[key] || [];
    if (existing.length === 0) wrap.innerHTML = `<div class="msg-system" style="opacity:0.7;">${t('loading')}…</div>`;
    try {
      const data = await api(`/messages?conv_type=${type}&conv_id=${id}&limit=100`);
      const fresh = data.messages || [];
      const maxFreshId = fresh.reduce((m, x) => Math.max(m, x.id || 0), 0);
      const newerFromCache = existing.filter(x => (x.id||0) > maxFreshId);
      state.messagesByConv[key] = [...fresh, ...newerFromCache];
    } catch (e) {
      if (existing.length === 0) {
        state.messagesByConv[key] = [];
        wrap.innerHTML = `<div class="msg-system" style="background:rgba(255,59,48,0.10);color:#b91c1c;">${escapeHtml(e.message)}</div>
          <div class="msg-system" style="cursor:pointer;" id="retry-load">${t('btn_retry')}</div>`;
        $('#retry-load')?.addEventListener('click', () => loadMessages());
      }
    }
  }
  // ============================================================
  // @ mentions — group chats
  // ============================================================
  // Usernames are UNIQUE in the database, so a plain "@name" inside the
  // message text identifies exactly one person. The text IS the mention:
  // no extra column, no server change.
  const MENTION_TOKEN = /@([^\s@,.;:!?，。；：！？、"'（）()\[\]]{1,32})/g;

  function mentionTokens(text) {
    const out = [];
    if (!text) return out;
    MENTION_TOKEN.lastIndex = 0;
    let m;
    while ((m = MENTION_TOKEN.exec(text))) out.push(m[1]);
    return out;
  }

  // Does this text call ME out? The token has to equal my username
  // exactly — "@jacky" must never light up Jack's flag.
  function mentionsMe(text) {
    const me = state.user && state.user.username;
    if (!me) return false;
    return mentionTokens(text).some(n => n === me);
  }

  function currentGroupMembers() {
    const c = state.currentChat;
    if (!c || c.type !== 'group') return [];
    return state.groupMembers[c.id] || [];
  }

  async function loadGroupMembers(gid) {
    if (!gid) return [];
    try {
      const r = await api(`/groups/${gid}/members`);
      const list = r.members || [];
      state.groupMembers[gid] = list;
      return list;
    } catch (e) { console.warn('[VVeChat] group members failed', e); return []; }
  }

  // Render message text, turning "@name" into a highlighted chip when
  // that name really is a member of this group. Everything else is
  // escaped, so the text can never inject markup.
  function renderMentionText(text) {
    const members = currentGroupMembers();
    if (!members.length) return escapeHtml(text);
    const byName = new Map();
    for (const m of members) byName.set(String(m.username), m.id);
    let out = '', last = 0, m;
    MENTION_TOKEN.lastIndex = 0;
    while ((m = MENTION_TOKEN.exec(text))) {
      const uid = byName.get(m[1]);
      if (uid === undefined) continue;   // not a member — leave it as plain text
      out += escapeHtml(text.slice(last, m.index));
      out += `<span class="mention" data-uid="${uid}">@${escapeHtml(m[1])}</span>`;
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
    return out;
  }

  // ---- the "@" picker ----
  const mentionState = { open: false, items: [], index: 0, start: -1, end: -1 };

  function detectMentionQuery() {
    const input = $('#chat-input');
    if (!input || !state.currentChat || state.currentChat.type !== 'group') return null;
    const caret = input.selectionStart;
    const upto = input.value.slice(0, caret);
    const m = /@([^\s@]*)$/.exec(upto);
    if (!m) return null;
    return { query: m[1], start: caret - m[0].length, end: caret };
  }

  function hideMentionMenu() {
    mentionState.open = false;
    mentionState.items = [];
    mentionState.index = 0;
    const menu = $('#mention-menu');
    if (menu) { menu.classList.add('hidden'); menu.innerHTML = ''; }
  }

  function showMentionMenu(q) {
    const menu = $('#mention-menu');
    if (!menu) return;
    const members = currentGroupMembers();
    if (!members.length) { hideMentionMenu(); return; }
    const needle = String(q.query || '').toLowerCase();
    const items = members.filter(m => !needle || String(m.username).toLowerCase().includes(needle));
    if (!items.length) { hideMentionMenu(); return; }
    mentionState.open = true;
    mentionState.items = items;
    mentionState.index = 0;
    mentionState.start = q.start;
    mentionState.end = q.end;
    // A hint line at the top of the picker: the "@" button is a new way
    // in, so say what the list is for.
    const head = '<div class="mention-hint">选择要 @ 的群成员</div>';
    menu.innerHTML = head + items.map((m, i) => {
      const bg = m.avatar_color ? `background:linear-gradient(135deg, ${m.avatar_color}, ${shade(m.avatar_color, -25)});` : '';
      const em = emojiOf(m);
      const who = m.id === state.user.id ? '<div class="tag">我</div>' : '';
      // The assistant is a person here, but a special one — mark it, so
      // it does not get lost among the ordinary members.
      const isBot = String(m.username || '').toLowerCase() === 'qwen';
      const bot = isBot ? '<div class="tag tag-bot">' + escapeHtml(lang === 'en' ? 'Assistant' : '助手') + '</div>' : '';
      return `<div class="mention-item${i === 0 ? ' active' : ''}" data-i="${i}">
        <div class="avatar sm" style="${bg}">${em ? `<span class="avatar-emoji">${escapeHtml(em)}</span>` : escapeHtml(initials(m.username))}</div>
        <div class="name">${escapeHtml(m.username)}</div>${who}${bot}
      </div>`;
    }).join('');
    menu.classList.remove('hidden');
    menu.onmousedown = (e) => {
      const it = e.target.closest('.mention-item');
      if (!it) return;
      e.preventDefault();   // don't let the input lose focus before we patch it
      applyMention(mentionState.items[Number(it.dataset.i)]);
    };
  }

  function moveMentionSelection(delta) {
    const menu = $('#mention-menu');
    if (!menu || !mentionState.items.length) return;
    mentionState.index = (mentionState.index + delta + mentionState.items.length) % mentionState.items.length;
    $$('.mention-item', menu).forEach((el, i) => el.classList.toggle('active', i === mentionState.index));
    const cur = menu.querySelector('.mention-item.active');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  function applyMention(member) {
    const input = $('#chat-input');
    if (!input || !member) return;
    const q = detectMentionQuery();
    const start = q ? q.start : input.selectionStart;
    const end = q ? q.end : input.selectionStart;
    const ins = '@' + member.username + ' ';
    input.value = input.value.slice(0, start) + ins + input.value.slice(end);
    const pos = start + ins.length;
    input.setSelectionRange(pos, pos);
    input.focus();
    state.mentionTarget = member;
    updateMentionPreview();
    hideMentionMenu();
  }

  function updateMentionPreview() {
    const box = $('#mention-preview');
    if (!box) return;
    const t = state.mentionTarget;
    if (!t) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const nameEl = $('#mention-preview-name');
    const textEl = $('#mention-preview-text');
    if (nameEl) nameEl.textContent = '@ ' + t.username;
    if (textEl) textEl.textContent = '这条消息会 @ 他';
  }

  function clearMentionTarget() {
    state.mentionTarget = null;
    updateMentionPreview();
  }

  // Pull the "@name" back out of the input box when the strip is cancelled.
  function removeMentionFromInput() {
    const input = $('#chat-input');
    const t = state.mentionTarget;
    if (input && t) {
      const token = '@' + t.username;
      const i = input.value.indexOf(token);
      if (i >= 0) {
        input.value = input.value.slice(0, i) + input.value.slice(i + token.length).replace(/^\s+/, '');
        input.setSelectionRange(i, i);
      }
    }
    clearMentionTarget();
  }

  function inputHasMention(username) {
    const input = $('#chat-input');
    if (!input) return false;
    return mentionTokens(input.value).includes(username);
  }

  // The @ button only makes sense in a group — dim it in a one-to-one
  // chat so nobody wonders why the list is empty.
  // ---------- personalisation ----------
  // Three things the account can change about how the app looks and
  // behaves: how dense it is, how big the text is, and whether the
  // clock is 12 or 24 hour. All three are applied as body classes /
  // CSS variables, so nothing has to be re-rendered.
  const prefs = { density: 'normal', font_scale: 1, clock24: true, ai_in_groups: true };

  function applyPrefs() {
    const b = document.body;
    if (!b) return;
    b.classList.remove('density-compact', 'density-normal', 'density-roomy');
    b.classList.add('density-' + (prefs.density || 'normal'));
    b.style.setProperty('--font-scale', String(prefs.font_scale || 1));
    b.classList.toggle('clock-12', !prefs.clock24);
  }

  function loadPrefs(user) {
    if (!user) return;
    if (user.density) prefs.density = user.density;
    if (user.font_scale) prefs.font_scale = Number(user.font_scale) || 1;
    if (user.clock24 !== undefined) prefs.clock24 = !!user.clock24;
    if (user.ai_in_groups !== undefined) prefs.ai_in_groups = !!user.ai_in_groups;
    applyPrefs();
  }

  function savePrefs(patch) {
    Object.assign(prefs, patch);
    applyPrefs();
    try { api('/me', { method: 'PUT', body: patch }).catch(() => {}); } catch (_) {}
  }

  // Paint the personalisation panel from the current values.
  function renderPrefPanel() {
    const sw = $('#toggle-boot-550c');
    if (sw) sw.checked = !!(window.Boot550C && window.Boot550C.enabled());
    const aiSw = $('#toggle-ai-in-groups');
    if (aiSw) aiSw.checked = !!prefs.ai_in_groups;
    const mark = (sel, val) => {
      $$(sel + ' button').forEach((b) => b.classList.toggle('on', String(b.dataset.v) === String(val)));
    };
    mark('#pref-density', prefs.density);
    mark('#pref-font', prefs.font_scale);
    mark('#pref-clock', prefs.clock24 ? 24 : 12);
    mark('#pref-lang', lang);
  }

  function updateMentionButton() {
    const b = $('#mention-btn');
    if (!b) return;
    const c = state.currentChat;
    const on = !!(c && c.type === 'group');
    b.classList.toggle('disabled', !on);
    b.title = on ? '@ 群成员' : '只有群聊才能 @ 人';
    // The hint that says the assistant can be called by name.
    const hint = $('#qwen-hint');
    if (hint) hint.classList.toggle('hidden', !on);
  }

  function renderMessages() {
    if (!state.currentChat) return;
    const {type,id} = state.currentChat;
    const key = convKey(type, id);
    const arr = state.messagesByConv[key] || [];
    const wrap = $('#chat-messages'); wrap.innerHTML = '';
    let lastDate = '';
    for (const m of arr) {
      const d = new Date(m.created_at);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (dateStr !== lastDate) {
        const sep = document.createElement('div'); sep.className='msg-system'; sep.textContent=dateStr; wrap.appendChild(sep); lastDate=dateStr;
      }
      wrap.appendChild(renderMessageRow(m));
    }
  }
  function renderMessageRow(m) {
    const row = document.createElement('div');
    const mine = m.sender_id === state.user.id;
    const ctype = state.currentChat.type;
    // WeChat style: my messages on the right, others' on the left.
    // The receiver sees my message on THEIR left (mirror view).
    row.className = `msg-row ${mine ? 'me' : ''}`;
    row.dataset.msgId = m.id;
    // avatar — always show. Jack's avatar (sent OR received) gets the gold glow.
    const u = mine ? state.user : userInfo(m.sender_id, m);
    const bgStyle = u.avatar_color
      ? `background:linear-gradient(135deg, ${u.avatar_color}, ${shade(u.avatar_color, -25)});`
      : '';
    const isJackAvatar = u.username === 'Jack';
    const glowCls = isJackAvatar ? ' avatar-jack-glow' : '';
    // Task: tap a group member's avatar to open their profile and add them.
    const msgEmoji = emojiOf(u);
    const avatarHtml = `<div class="msg-avatar avatar sm${glowCls}" style="${bgStyle}" data-uid="${m.sender_id}" role="button" title="查看资料">${msgEmoji ? `<span class="avatar-emoji">${escapeHtml(msgEmoji)}</span>` : escapeHtml(initials(u.username))}</div>`;
    // sender name — show for group chats when message is from someone else
    const senderName = ctype === 'group' && !mine
      ? `<div class="msg-meta"><span class="sender">${escapeHtml(m.sender_username)}</span></div>`
      : '';
    const quoteHtml = m.reply_to ? renderQuote(m.reply_to) : '';
    let bubbleContent = '';
    if (m.is_deleted) bubbleContent = `<div class="msg-bubble deleted">${t('msg_deleted')}</div>`;
    else if (m.type === 'image') bubbleContent = `<div class="msg-bubble image-bubble"><img class="chat-img" src="${escapeHtml(m.content)}" alt="${t('img_alt')}" data-img="${escapeHtml(m.content)}" loading="lazy" /></div>`;
    else bubbleContent = `<div class="msg-bubble">${renderMentionText(m.content)}</div>`;
    // "Someone called you out" — a flag above the bubble.
    const mentionFlag = (ctype === 'group' && !mine && !m.is_deleted && mentionsMe(m.content))
      ? '<div class="mention-flag">@ 我</div>' : '';
    const time = new Date(m.created_at).toTimeString().slice(0,5);
    let receipt = '';
    if (mine && ctype === 'user' && !m.is_deleted) {
      const read = m.read_by && m.read_by.length > 0;
      receipt = `<span class="receipt ${read?'read':''}" title="${read?t('read'):t('sent')}">${read
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12l5 5L17 6"/><path d="M8 12l5 5L23 7" opacity="0.6"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12l5 5L17 6"/></svg>`}</span>`;
    }
    const metaHtml = `<div class="msg-meta"><span>${time}</span>${receipt}</div>`;
    // Touch affordance: an explicit "..." button under the timestamp. On
    // desktop the right-click menu still works, but a touch device has no
    // right-click — without this the reply/forward/delete actions are
    // unreachable on iPad/iPhone.
    // The three dots are laid out HORIZONTALLY and live inside .msg-content
    // so they sit directly beneath the time, aligned with it.
    // A deleted message has nothing to act on, so it gets no dots at all
    // (a visible button that does nothing is worse than no button).
    const dotsHtml = m.is_deleted ? '' : `<button class="msg-dots" type="button" aria-label="更多操作" title="更多操作">
      <svg viewBox="0 0 34 6" width="34" height="6" fill="currentColor">
        <circle cx="4" cy="3" r="2.2"/><circle cx="17" cy="3" r="2.2"/><circle cx="30" cy="3" r="2.2"/>
      </svg>
    </button>`;
    // Layout order inside the column:
    //   sender name → bubble → quoted reply → timestamp → dots
    // The quoted reply sits BELOW the message it answers and ABOVE the
    // timestamp, as requested.
    row.innerHTML = `${avatarHtml}<div class="msg-content">${senderName}${mentionFlag}${bubbleContent}${quoteHtml}${metaHtml}${dotsHtml}</div>`;
    // The message action bar opens ONLY from the "..." button. Tapping the
    // bubble and right-clicking used to open it too, which made it easy to
    // trigger by accident and left two different menus for the same action.
    if (!m.is_deleted) {
      const dotsEl = row.querySelector('.msg-dots');
      if (dotsEl) {
        dotsEl.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          showMsgActionBar(row, m, e);
        });
      }
    }
    row.querySelectorAll('.chat-img').forEach(img => img.addEventListener('click', () => openLightbox(img.dataset.img)));
    // Tap an avatar to open that person's profile (works for non-friends too,
    // which is how you discover people inside a group).
    const avEl = row.querySelector('.msg-avatar[data-uid]');
    if (avEl) {
      avEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = Number(avEl.dataset.uid);
        if (!uid || uid === state.user.id) return;
        openUserProfileById(uid);
      });
    }
    return row;
  }

  // Floating action bar shown when ANY user short-taps a message
  // (forward / copy / delete / cancel). Delete is gated: Jack can delete
  // any message; regular users can only delete their own messages within 2 min.
  function showMsgActionBar(rowEl, m, evt) {
    document.querySelectorAll('.msg-action-bar').forEach(el => el.remove());
    // NOTE: use isJack() (username-aware) not state.user.is_admin, and compare
    // against m.sender_id — messages carry sender_id, never user_id.
    // NOTE: this used to read `const isJack = isJack();` — the local const
    // shadowed the outer `function isJack()` and, being in its temporal
    // dead zone at that point, threw
    //   ReferenceError: Cannot access 'isJack' before initialization
    // on EVERY call. The action bar was therefore never created, so tapping
    // the "..." button (or the bubble) did nothing at all.
    // Use a different local name.
    const jack = isJack();
    const isMine = !!(state.user && m.sender_id === state.user.id);
    const ageMs = Date.now() - new Date(m.created_at).getTime();
    const canDelete = jack || (isMine && ageMs < 2 * 60 * 1000);
    const canReply = !m.is_deleted;
    const bar = document.createElement('div');
    bar.className = 'msg-action-bar';
    // Each action button has a Chinese tooltip explaining what it does.
    // Tooltips are shown both via native title (hover) and a visible label
    // above each icon so they're always readable on touch devices.
    // A row of quick-reply emojis at the TOP of the bar. Tapping one sends
    // that emoji as a brand new message in the current conversation — the
    // whole point is a one-tap reply, so it must not require the composer.
    const QUICK_EMOJIS = ['👍','❤️','😂','🎉','😮','😢','🙏','🔥'];
    const quickRow = `<div class="msg-action-quick">${QUICK_EMOJIS.map(em =>
      `<button class="msg-quick-emoji" data-quick-emoji="${em}" title="发送 ${em}" aria-label="发送 ${em}">${em}</button>`
    ).join('')}</div>`;
    bar.innerHTML = `${quickRow}
      <button class="msg-action-btn msg-action-forward" data-tip="转发" title="转发 — 把这条消息发给其他好友或群聊" aria-label="转发">
        <span class="msg-action-label">转发</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
        </svg>
      </button>
      <button class="msg-action-btn msg-action-reply ${canReply ? '' : 'msg-action-disabled'}" data-tip="引用" title="引用 — 引用这条消息并回复（显示在发送的消息上方）" aria-label="引用" ${canReply ? '' : 'disabled'}>
        <span class="msg-action-label">引用</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
        </svg>
      </button>
      <button class="msg-action-btn msg-action-copy" data-tip="复制" title="复制 — 把消息内容复制到剪贴板" aria-label="复制">
        <span class="msg-action-label">复制</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
      <button class="msg-action-btn msg-action-delete ${canDelete ? '' : 'msg-action-disabled'}" data-tip="${jack ? '清除' : '撤回'}" title="${jack ? '清除 — 管理员可永久清除任何消息' : '撤回 — 2 分钟内可撤回自己发送的消息'}" aria-label="${jack ? '清除' : '撤回'}" ${canDelete ? '' : 'disabled'}>
        <span class="msg-action-label">${jack ? '清除' : '撤回'}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
      <button class="msg-action-btn msg-action-cancel" data-tip="取消" title="取消 — 关闭操作栏" aria-label="取消">
        <span class="msg-action-label">取消</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;
    document.body.appendChild(bar);
    const rect = rowEl.getBoundingClientRect();
    const barWidth = bar.offsetWidth || 320;
    const left = rect.left + rect.width / 2 - barWidth / 2;
    const top = rect.top - 6;
    bar.style.left = Math.max(8, Math.min(window.innerWidth - barWidth - 8, left)) + 'px';
    bar.style.top = Math.max(8, top - bar.offsetHeight - 8) + 'px';
    bar.querySelector('.msg-action-delete').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!canDelete) {
        toast(lang === 'zh' ? (jack ? '该消息不能清除' : '该消息不能撤回') : (jack ? 'Cannot clear this message' : 'Cannot recall this message'));
        bar.remove();
        return;
      }
      const confirmText = jack
        ? (lang === 'zh' ? '确定要清除这条消息？（永久删除）' : 'Clear this message permanently?')
        : (lang === 'zh' ? '确定要撤回这条消息？' : 'Recall this message?');
      if (!confirm(confirmText)) { bar.remove(); return; }
      try {
        if (jack) {
          await jackDeleteMessage(m.id);
        } else {
          await api(`/api/messages/${m.id}`, { method: 'DELETE' });
          s.emit('message:deleted', { id: m.id, scope: 'self' });
        }
        bar.remove();
        toast(jack ? (lang === 'zh' ? '已清除' : 'Cleared') : (lang === 'zh' ? '已撤回' : 'Recalled'));
      } catch (e) { toast(e.message); bar.remove(); }
    });
    bar.querySelector('.msg-action-forward').addEventListener('click', (ev) => {
      ev.stopPropagation();
      bar.remove();
      openForwardModal(m);
    });
    bar.querySelector('.msg-action-reply').addEventListener('click', (ev) => {
      ev.stopPropagation();
      bar.remove();
      setReplyTo(m);
    });
    bar.querySelector('.msg-action-copy').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try { await navigator.clipboard.writeText(m.content || ''); toast(t('copied') || '已复制'); } catch (_) { toast(t('copy_failed') || '复制失败'); }
      bar.remove();
    });
    bar.querySelector('.msg-action-cancel').addEventListener('click', (ev) => { ev.stopPropagation(); bar.remove(); });
    // Quick emoji → send it right away as a new message.
    bar.querySelectorAll('[data-quick-emoji]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const em = btn.dataset.quickEmoji;
        bar.remove();
        if (!em || !state.currentChat) return;
        try {
          await sendMessage(em);
        } catch (e) {
          console.error('[VVeChat] quick emoji failed:', e);
          toast(e.message || '发送失败');
        }
      });
    });
    // Dismiss on the NEXT tap elsewhere. On touch devices the click that
    // opened this bar is delivered ~50-300ms later, so a 50ms timeout made
    // the bar delete itself the instant it appeared. Wait for a full touch
    // cycle and ignore the event that is still bubbling from the opener.
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 400);
    const dismiss = (e) => {
      if (!armed) return;                       // still the opening tap
      if (bar.contains(e.target)) return;      // tapped inside the bar
      bar.remove();
      cleanup();
    };
    const cleanup = () => {
      clearTimeout(armTimer);
      document.removeEventListener('click', dismiss, true);
      document.removeEventListener('touchstart', dismiss, true);
    };
    document.addEventListener('click', dismiss, true);
    document.addEventListener('touchstart', dismiss, true);
  }

  // Forward message to another chat (friend or group)
  function openForwardModal(m) {
    // Tear down any existing forward modal first (idempotent)
    document.getElementById('modal-forward')?.remove();
    // Build a proper modal with mask + card so it overlays the whole app
    const html = `<div class="modal-mask" data-close="modal-forward"></div>
      <div class="modal-card" role="dialog" aria-label="${t('forward_to') || '转发到'}">
        <div class="modal-head">
          <h3>${t('forward_to') || '转发到'}</h3>
          <button class="icon-btn icon-btn-sm modal-close" data-close="modal-forward" aria-label="${t('cancel') || '取消'}">×</button>
        </div>
        <div class="modal-body" style="max-height:50vh;overflow-y:auto;padding:0 4px;">
          <div class="section-title">${t('contacts') || '联系人'}</div>
          <div id="forward-friends"></div>
          <div class="section-title">${t('groups') || '群聊'}</div>
          <div id="forward-groups"></div>
        </div>
      </div>`;
    const modal = document.createElement('div');
    modal.id = 'modal-forward';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.innerHTML = html;
    document.body.appendChild(modal);
    // Populate target lists
    const friendsHtml = (state.friends || []).map(f => {
      const bg = avatarStyle(f);
      return `<div class="req-item" data-fid="${f.id}">
        <div class="avatar sm"${bg ? ` style="${bg}"` : ''}>${avatarInner(f)}</div>
        <div class="meta"><div class="name">${escapeHtml(f.username)}</div></div>
      </div>`;
    }).join('') || `<div class="empty-hint small"><p>${t('no_friends_yet') || '还没有好友'}</p></div>`;
    const groupsHtml = (state.groups || []).map(g => `<div class="req-item" data-gid="${g.id}">
      <div class="avatar sm group">${escapeHtml(groupLetter(g.name, g.is_official))}</div>
      <div class="meta"><div class="name">${escapeHtml(g.name)}</div></div>
    </div>`).join('') || `<div class="empty-hint small"><p>${t('no_groups_yet') || '还没有群聊'}</p></div>`;
    modal.querySelector('#forward-friends').innerHTML = friendsHtml;
    modal.querySelector('#forward-groups').innerHTML = groupsHtml;
    // Click handlers
    modal.addEventListener('click', async (e) => {
      // close on mask click
      if (e.target.matches('[data-close="modal-forward"]')) {
        document.getElementById('modal-forward')?.remove();
        return;
      }
      const friendItem = e.target.closest('[data-fid]');
      const groupItem = e.target.closest('[data-gid]');
      if (friendItem) {
        const fid = friendItem.dataset.fid;
        await forwardToUser(fid, m);
        document.getElementById('modal-forward')?.remove();
      } else if (groupItem) {
        const gid = groupItem.dataset.gid;
        await forwardToGroup(gid, m);
        document.getElementById('modal-forward')?.remove();
      }
    });
  }
  async function forwardToUser(friendId, origMsg) {
    const me = state.user.id;
    const friend = state.friends.find(f => f.id === friendId);
    const prev = state.currentChat;
    state.currentChat = { type: 'user', id: friendId, title: friend?.username || '' };
    try {
      await sendMessage(origMsg.content, { type: origMsg.type || 'text', meta: origMsg.meta || null });
      toast(t('forwarded') || '已转发');
    } catch (e) { toast(e.message); }
    state.currentChat = prev;
  }
  async function forwardToGroup(gid, origMsg) {
    const prev = state.currentChat;
    const group = state.groups.find(g => g.id === gid);
    state.currentChat = { type: 'group', id: gid, title: group?.name || '' };
    try {
      await sendMessage(origMsg.content, { type: origMsg.type || 'text', meta: origMsg.meta || null });
      toast(t('forwarded') || '已转发');
    } catch (e) { toast(e.message); }
    state.currentChat = prev;
  }
  function renderQuote(q) {
    const text = q.type === 'image' ? t('type_image') : (q.content || '');
    const trunc = text.length > 40 ? text.slice(0,40) + '…' : text;
    return `<div class="msg-quote" data-reply-id="${q.id}"><span class="qname">${escapeHtml(q.sender_username)}</span><span class="qtext">${escapeHtml(trunc)}</span></div>`;
  }
  function scrollBottom() { const w = $('#chat-messages'); if (w) w.scrollTop = w.scrollHeight; }

  function sendReadReceipt(msg) {
    if (!state.currentChat || !msg || !state.user || msg.sender_id === state.user.id) return;
    const { type, id } = state.currentChat;
    if (state.socket && state.socket.emit) {
      state.socket.emit('message:read', { conv_type: type, conv_id: id, last_read_msg_id: msg.id });
    } else {
      api('/messages/read', { method:'POST', body: { conv_type: type, conv_id: id, last_read_msg_id: msg.id } }).catch(()=>{});
    }
  }

  async function sendMessage(content, opts = {}, inputEl) {
    if (!state.currentChat) { toast('请先选择一个会话'); return; }
    const { type, id } = state.currentChat;
    const payload = {
      conv_type: type, conv_id: id, content,
      type: opts.type || 'text',
      meta: opts.meta || null,
      reply_to: state.pendingReply ? state.pendingReply.id : null,
    };
    state.pendingReply = null; state.pendingImage = null;
    clearMentionTarget();
    hideMentionMenu();
    $('#reply-preview').classList.add('hidden');
    $('#img-preview').classList.add('hidden');
    const key = convKey(type, id);
    const acceptMessage = (msg) => {
      if (!msg) return;
      const arr = state.messagesByConv[key] || (state.messagesByConv[key] = []);
      if (!arr.find(x => x.id === msg.id)) arr.push(msg);
      renderMessages(); scrollBottom();
      refreshConversations();
    };

    // Always send over HTTP. The socket path was the source of messages
    // getting stuck on "发送中…" whenever the connection was flaky — the ack
    // simply never arrived and nothing was persisted. HTTP is a single
    // request/response, so it either succeeds or reports a real error.
    const btn = $('#send-btn');
    if (btn) btn.disabled = true;
    try {
      await sendViaHttp(payload, acceptMessage, inputEl);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // POST a message over HTTP. On success the input is cleared; on failure the
  // text is put back so nothing is ever silently lost.
  async function sendViaHttp(payload, acceptMessage, inputEl) {
    try {
      console.log('[VVeChat] sending', payload);
      const data = await api('/messages', { method: 'POST', body: payload });
      if (!data || !data.message) throw new Error('服务器没有返回消息');
      if (inputEl) inputEl.value = '';
      acceptMessage(data.message);
      console.log('[VVeChat] sent ok');
    } catch (e) {
      const msg = (e && e.message) || '发送失败';
      // Keep the text in the box so the user can retry, and say why.
      toast('发送失败：' + msg);
      console.error('[VVeChat] send failed:', e);
    }
  }

  // NOTE: openContextMenu() / closeContextMenu() / reactTo() were removed.
  // The right-click menu was a SECOND way to reach the message actions, and
  // the user asked for the "..." button to be the only entry point — having
  // two different menus for the same action was confusing on touch screens.

  async function deleteMessage(id) {
    if (state.socket && state.socket.emit) state.socket.emit('message:delete', { id }, ack => { if (!ack.ok) toast(ack.error || t('err_action')); });
    else try { await api(`/messages/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); }
  }
  function openLightbox(src) {
    const lb = $('#lightbox');
    lb.innerHTML = `<img src="${escapeHtml(src)}" alt="" />`;
    lb.classList.remove('hidden');
    lb.onclick = () => lb.classList.add('hidden');
  }

  // ---------- search ----------
  let searchT = null, searchIndex = -1, searchResults = [];
  function initSearch() {
    const input = $('#search-input');
    if (!input) return;
    let dropdown = $('#search-suggestions');
    if (!dropdown) {
      const s = input.closest('.search');
      dropdown = document.createElement('div');
      dropdown.id = 'search-suggestions';
      dropdown.className = 'search-suggestions hidden';
      s.appendChild(dropdown);
    }
    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchT);
      if (!q) { hideSuggestions(); return; }
      searchT = setTimeout(() => doSmartSearch(q), 200);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) hideSuggestions(); });
  }
  function hideSuggestions() {
    const d = $('#search-suggestions');
    if (d) d.classList.add('hidden');
    searchIndex = -1;
  }
  async function doSmartSearch(q) {
    const dropdown = $('#search-suggestions');
    dropdown.innerHTML = `<div class="suggestion-hint">${t('loading')}…</div>`;
    dropdown.classList.remove('hidden');
    try {
      const r = await api(`/users/search?q=${encodeURIComponent(q)}`);
      searchResults = r.users || [];
      showSuggestions(searchResults);
    } catch(e) {
      dropdown.innerHTML = `<div class="suggestion-hint">${escapeHtml(e.message)}</div>`;
    }
  }
  function showSuggestions(users) {
    const dropdown = $('#search-suggestions');
    if (!users.length) { dropdown.innerHTML = `<div class="suggestion-hint">${t('empty')}</div>`; return; }
    dropdown.innerHTML = '';
    for (const u of users) {
      const isFriend = state.friends.some(f=>f.id===u.id);
      const bg = avatarStyle(u);
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `<div class="avatar sm"${bg ? ` style="${bg}"` : ''}>${avatarInner(u)}</div>
        <div class="meta"><div class="name">${escapeHtml(u.username)}</div></div>
        <div class="action-tag ${isFriend?'friend':''}">${isFriend?t('btn_msg'):t('new_msg')}</div>`;
      item.addEventListener('click', () => {
        hideSuggestions(); $('#search-input').value = '';
        if (isFriend) openChat('user', u.id, u.username, 0);
        else { $('#add-friend-username').value = u.username; openModal('modal-add-friend'); setTimeout(()=>$('#add-friend-username').focus(),80); }
      });
      dropdown.appendChild(item);
    }
  }

  // ---------- profile ----------
  function openProfileModal(user, opts = {}) {
    const allowAdd = !!opts.allowAdd;
    const isMe = user.id === state.user.id;
    // Already a friend? then the primary action is "message", not "add".
    const isFriend = state.friends.some(f => Number(f.id) === Number(user.id));
    $('#profile-title').textContent = isMe ? t('profile_title') : user.username;
    const bg = user.avatar_color ? `background:linear-gradient(135deg, ${user.avatar_color}, ${shade(user.avatar_color, -25)})` : '';
    const online = isOnline(user.id);
    $('#profile-body').innerHTML = `<div class="profile-head">
      <div class="avatar lg" style="${bg}">${escapeHtml(initials(user.username))}</div>
      <div class="name">${escapeHtml(user.username)} ${online ? `<span style="font-size:11px;color:#15803d;background:rgba(52,199,89,0.14);padding:2px 7px;border-radius:6px;border:1px solid rgba(52,199,89,0.30);font-weight:600;">${t('online')}</span>` : ''}</div>
      <div class="bio">${escapeHtml(user.bio || t('profile_bio_empty'))}</div>
      <div class="profile-actions">
        ${isMe ? `<button class="btn btn-primary btn-sm" id="btn-edit-profile">${t('btn_edit')}</button>
                 <button class="btn btn-danger btn-sm" id="btn-profile-logout">${t('btn_logout')}</button>`
                : (allowAdd && !isFriend
                    ? `<button class="btn btn-primary btn-sm" id="btn-add-friend">+ 加好友</button>`
                    : `<button class="btn btn-primary btn-sm" id="btn-msg-friend">${t('btn_msg')}</button>`)}
        ${isFriend ? `<button class="btn btn-danger btn-sm" id="btn-remove-friend">删除好友</button>` : ''}
      </div></div>`;
    if (isMe) {
      $('#btn-edit-profile')?.addEventListener('click', openProfileEdit);
      $('#btn-profile-logout')?.addEventListener('click', () => {
        if (confirm(t('confirm_logout') || '确定要退出登录？')) { closeModal('modal-profile'); logout(); }
      });
    }
    else {
      $('#btn-msg-friend')?.addEventListener('click', () => { closeModal('modal-profile'); openChat('user', user.id, user.username, 0); });
      const addBtn = $('#btn-add-friend');
      if (addBtn) addBtn.addEventListener('click', async () => {
        addBtn.disabled = true;
        const orig = addBtn.textContent;
        addBtn.textContent = '发送中…';
        try {
          const r = await api('/friend/request/' + user.id, { method: 'POST', body: {} });
          addBtn.textContent = r.autoAccepted ? '已成为好友 ✓' : '申请已发送 ✓';
          await refreshFriends();
          await refreshConversations();
          if (r.autoAccepted) setTimeout(() => closeModal('modal-profile'), 900);
        } catch (e) {
          addBtn.disabled = false;
          addBtn.textContent = orig;
          toast(e.message || '添加失败');
        }
      });
      const rmBtn = $('#btn-remove-friend');
      if (rmBtn) rmBtn.addEventListener('click', async () => {
        const ok = await askConfirm({
          title: '删除好友',
          message: '确定不再和 ' + user.username + ' 做好友吗？你们的私聊记录也会一并清除。',
          okText: '删除好友',
        });
        if (!ok) return;
        rmBtn.disabled = true;
        try {
          await api('/friends/' + user.id, { method: 'DELETE' });
          closeModal('modal-profile');
          state.friends = state.friends.filter(f => Number(f.id) !== Number(user.id));
          state.conversations = state.conversations.filter(
            c => !(c.type === 'user' && (Number(c.id) === Number(user.id) || Number(c.id) === Number(state.user.id)))
          );
          if (state.currentChat && state.currentChat.type === 'user' && Number(state.currentChat.id) === Number(user.id)) {
            state.currentChat = null;
            delete state.messagesByConv[convKey('user', user.id)];
          }
          renderAll();
          toast('已删除好友 ' + user.username);
        } catch (e) {
          rmBtn.disabled = false;
          toast(e.message || '删除失败');
        }
      });
    }
    openModal('modal-profile');
  }
  // Open someone's profile by id — works for people who are not friends yet
  // (e.g. another member of a group). Shows a "加好友" button when appropriate.
  async function openUserProfileById(uid) {
    let u = state.friends.find(f => Number(f.id) === Number(uid))
         || state.groups.find(g => Number(g.id) === Number(uid));
    // Also try to resolve from the currently loaded message list.
    if (!u) {
      const key = state.currentChat && convKey(state.currentChat.type, state.currentChat.id);
      const arr = (key && state.messagesByConv[key]) || [];
      for (const m of arr) {
        if (Number(m.sender_id) === Number(uid)) {
          u = { id: uid, username: m.sender_username, avatar_color: null };
          break;
        }
      }
    }
    if (!u) {
      // Last resort: hit the API.
      try {
        const r = await api('/users/by-id/' + uid);
        u = r.user;
      } catch (_) {}
    }
    if (!u) { toast('找不到该用户'); return; }
    openProfileModal(u, { allowAdd: true });
  }

  // ---- Add member to a group (owner / Jack) ----
  // The owner's inbox: people who asked to join this group.
  async function openGroupRequestsModal(g) {
    const gid = g.id;
    const mask = document.createElement('div');
    mask.className = 'modal';
    mask.innerHTML = `
      <div class="modal-mask"></div>
      <div class="modal-card">
        <div class="modal-head">
          <h3>${lang === 'en' ? 'Join requests' : '入群申请'} · ${escapeHtml(g.name || '')}</h3>
          <button class="icon-btn icon-btn-sm" data-x="0">×</button>
        </div>
        <div class="modal-body">
          <div id="gr-list" style="max-height:320px;overflow-y:auto;">
            <div class="empty-hint"><p>${lang === 'en' ? 'Loading…' : '正在加载…'}</p></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]') || e.target.classList.contains('modal-mask')) close();
    });
    const list = mask.querySelector('#gr-list');
    const load = async () => {
      try {
        const r = await api(`/groups/${gid}/requests`);
        const reqs = r.requests || [];
        if (!reqs.length) {
          list.innerHTML = `<div class="empty-hint"><p>${lang === 'en' ? 'No requests yet' : '暂时没有申请'}</p></div>`;
          return;
        }
        list.innerHTML = '';
        for (const q of reqs) {
          const row = document.createElement('div');
          row.className = 'settings-row';
          const bg = q.avatar_color ? `background:linear-gradient(135deg, ${q.avatar_color}, ${shade(q.avatar_color, -25)})` : '';
          row.innerHTML = `<div class="avatar sm" style="${bg}">${escapeHtml(initials(q.username))}</div>
            <div class="settings-label">${escapeHtml(q.username)}${q.message ? `<div style="font-size:11px;color:var(--muted);font-weight:400;margin-top:2px;">${escapeHtml(q.message)}</div>` : ''}</div>
            <div class="settings-trailing">
              <span class="settings-action" data-ok="${q.id}" style="color:#10b981;">${lang === 'en' ? 'Accept' : '同意'}</span>
              <span class="settings-action" data-no="${q.id}" style="color:#ef4444;margin-left:10px;">${lang === 'en' ? 'Decline' : '拒绝'}</span>
            </div>`;
          const decide = async (id, accept) => {
            try {
              await api(`/groups/${gid}/requests/${id}`, { method: 'POST', body: { accept } });
              toast(accept ? (lang === 'en' ? 'Added' : '已加入群聊') : (lang === 'en' ? 'Declined' : '已拒绝'));
              if (state.pendingGroupRequests) delete state.pendingGroupRequests[gid];
              renderGroupRequestBadge();
              load();
              refreshGroups();
            } catch (e) { toast(e.message); }
          };
          row.querySelector('[data-ok]').addEventListener('click', () => decide(q.id, true));
          row.querySelector('[data-no]').addEventListener('click', () => decide(q.id, false));
          list.appendChild(row);
        }
      } catch (e) {
        list.innerHTML = `<div class="empty-hint"><p>${escapeHtml(e.message || '')}</p></div>`;
      }
    };
    load();
  }

  async function openAddMemberModal(g) {
    const gid = g.id;
    const mask = document.createElement('div');
    mask.className = 'modal';
    mask.innerHTML = `
      <div class="modal-mask"></div>
      <div class="modal-card">
        <div class="modal-head">
          <h3>添加成员到「${escapeHtml(g.name || '')}」</h3>
          <button class="icon-btn icon-btn-sm" data-x="0">×</button>
        </div>
        <div class="modal-body">
          <input id="am-q" class="input" type="text" placeholder="输入用户名搜索…" autocomplete="off" />
          <div id="am-results" style="margin-top:12px;max-height:300px;overflow-y:auto;">
            <div class="empty-hint"><p>正在加载…</p></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]') || e.target.classList.contains('modal-mask')) close();
    });

    const results = mask.querySelector('#am-results');
    const load = async (q) => {
      try {
        const r = await api(`/groups/${gid}/candidates` + (q ? `?q=${encodeURIComponent(q)}` : ''));
        const list = r.candidates || [];
        if (!list.length) {
          results.innerHTML = `<div class="empty-hint"><p>${q ? '没有匹配的用户' : '所有用户都已在群里'}</p></div>`;
          return;
        }
        results.innerHTML = '';
        for (const u of list) {
          const row = document.createElement('div');
          row.className = 'settings-row';
          const bg = u.avatar_color ? `background:linear-gradient(135deg, ${u.avatar_color}, ${shade(u.avatar_color, -25)})` : '';
          row.innerHTML = `<div class="avatar sm" style="${bg}">${escapeHtml(initials(u.username))}</div>
            <div class="settings-label">${escapeHtml(u.username)}</div>
            <div class="settings-trailing"><span class="settings-action" data-add="${u.id}">添加</span></div>`;
          const btn = row.querySelector('[data-add]');
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '…';
            try {
              await api(`/groups/${gid}/members`, { method: 'POST', body: { memberId: u.id } });
              btn.textContent = '✓ 已添加';
              btn.style.color = '#10b981';
              toast('已添加 ' + u.username);
              refreshGroups();
              setTimeout(close, 700);
            } catch (e) {
              btn.disabled = false;
              btn.textContent = '添加';
              toast(e.message || '添加失败');
            }
          });
          results.appendChild(row);
        }
      } catch (e) {
        results.innerHTML = `<div class="empty-hint"><p>${escapeHtml(e.message || '加载失败')}</p></div>`;
      }
    };
    load('');
    let t = null;
    mask.querySelector('#am-q').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => load(e.target.value.trim()), 220);
    });
  }

  function openProfileEdit() {
    const current = state.user.avatar_color || '#5eead4';
    const initial = state.user.username.charAt(0).toUpperCase();
    // Avatar color is set at registration and is not user-editable.
    const previewStyle = `background:linear-gradient(135deg, ${current}, ${shade(current, -25)});`;
    const curEmoji = state.user.avatar_emoji || '';
    const previewInner = curEmoji
      ? `<span class="avatar-emoji">${escapeHtml(curEmoji)}</span>`
      : escapeHtml(initials(state.user.username));
    const emojiGrid = EMOJI_AVATARS.map(em =>
      `<button type="button" class="emoji-pick ${em === curEmoji ? 'selected' : ''}" data-emoji="${em}" title="${em}">${em}</button>`
    ).join('');
    $('#profile-body').innerHTML = `<form id="form-edit-profile">
      <div class="profile-head"><div class="avatar lg" id="edit-avatar-preview" style="${previewStyle}">${previewInner}</div></div>

      <div class="field">
        <span class="field-label">选择头像表情</span>
        <div class="emoji-picker-grid" id="emoji-picker-grid">
          ${emojiGrid}
          <button type="button" class="emoji-pick-clear" id="emoji-clear">${lang==='zh' ? '恢复默认头像（用用户名首字母）' : 'Reset to the default (first letter)'}</button>
        </div>
      </div>

      <label class="field"><span class="field-label">${t('profile_username')}</span><input id="edit-username" type="text" value="${escapeHtml(state.user.username)}" maxlength="24" /></label>
      <label class="field"><span class="field-label">${t('profile_bio')}</span><textarea id="edit-bio" rows="3" maxlength="200" placeholder="${t('profile_bio_ph')}">${escapeHtml(state.user.bio || '')}</textarea></label>
      <div class="modal-msg" id="edit-profile-msg"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close="modal-profile">${t('cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('btn_save')}</button>
      </div></form>`;

    // Emoji picker: pick one, or clear it to go back to the initial.
    let pickedEmoji = curEmoji;
    const preview = $('#edit-avatar-preview');
    const grid = $('#emoji-picker-grid');
    const paint = () => {
      if (!preview) return;
      preview.innerHTML = pickedEmoji
        ? `<span class="avatar-emoji">${escapeHtml(pickedEmoji)}</span>`
        : escapeHtml(initials(state.user.username));
      if (grid) {
        grid.querySelectorAll('.emoji-pick').forEach(b => {
          b.classList.toggle('selected', b.dataset.emoji === pickedEmoji);
        });
      }
    };
    if (grid) {
      grid.addEventListener('click', (e) => {
        const pick = e.target.closest('.emoji-pick');
        if (pick) {
          pickedEmoji = pick.dataset.emoji || null;
          paint();
          return;
        }
        if (e.target.closest('#emoji-clear')) {
          pickedEmoji = '';
          paint();
        }
      });
    }

    $('#form-edit-profile').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#edit-profile-msg'); msg.classList.remove('ok'); msg.textContent = '';
      const username = $('#edit-username').value.trim();
      const bio = $('#edit-bio').value.trim();
      try {
        const r = await api('/me', { method: 'PUT', body: { username, bio, avatar_emoji: pickedEmoji } });
        Object.assign(state.user, r.user);
        localStorage.setItem('vve:user', JSON.stringify(state.user));
        renderTopbarAvatar();
        renderSideMe();
        // The emoji shows up in every message row and in the friend list,
        // so those need repainting too.
        renderChats();
        renderMessages();
        msg.classList.add('ok'); msg.textContent = t('profile_saved');
        setTimeout(() => { closeModal('modal-profile'); openProfileModal(state.user); }, 600);
      } catch (err) { msg.textContent = err.message; }
    });
  }

  // NOTE: openCreateGroup() / openJoinGroup() used to live here. They were
  // dead code after the user-created-group feature was removed — the modals
  // they opened (modal-create-group, modal-join-group) no longer exist in
  // the HTML, so calling either one would have thrown on a null element.
  // Both are now deleted.
  // NOTE: searchGroups() / renderJoinGroupResults() were dead code after
  // the user-created-group feature was removed. They wrote into
  // #join-group-results and called /groups/search + /groups/:id/join —
  // none of which exist any more.

  // ---------- image handling ----------
  function handleImageFile(file) {
    if (!file.type.startsWith('image/')) { toast(t('toast_img_only')); return; }
    if (file.size > 5 * 1024 * 1024) { toast(t('toast_img_too_big')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingImage = reader.result;
      $('#img-preview-img').src = reader.result;
      $('#img-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }

  // ---------- socket ----------
  function connectSocket() {
    if (!state.token) return;
    if (IS_MOCK) {
      const s = window.__mockBackend.socketConnect(state.token);
      state.socket = s;
      bindSocketEvents(s);
      return;
    }
    const s = io(API_BASE, { auth:{token: state.token}, transports:['websocket','polling'] });
    state.socket = s;
    bindSocketEvents(s);
  }
  function bindSocketEvents(s) {
    s.on('connect', () => { hideOffline(); if (state.currentChat) loadMessages().then(renderMessages); refreshConversations(); });
    s.on('disconnect', () => showOffline());
    s.on('message:new', onSocketMessage);
    s.on('message:deleted', onMessageDeleted);
    s.on('message:read', onMessageRead);
    s.on('typing:start', onTypingStart);
    s.on('typing:stop', onTypingStop);
    s.on('user:presence', onUserPresence);
    s.on('user:updated', onUserUpdated);
    s.on('friend:request', onFriendRequest);
    s.on('friend:request:resolved', onRequestResolved);
    s.on('friend:added', onFriendAdded);
    s.on('group:added', onGroupAdded);
    s.on('group:join-request', onGroupJoinRequest);
    s.on('group:request-resolved', onGroupRequestResolved);
    // Jack wiped every message in a group. The server broadcasts this, but
    // nobody was listening — so the other users' clients kept showing the
    // old messages until they refreshed. Clear the local cache and repaint.
    s.on('group:wiped', ({ group_id } = {}) => {
      const gid = Number(group_id);
      if (!Number.isFinite(gid)) return;
      const key = convKey('group', gid);
      if (state.messagesByConv[key]) state.messagesByConv[key] = [];
      // Any other cached conversation that belonged to that group too.
      for (const k of Object.keys(state.messagesByConv)) {
        if (k.startsWith('group:')) state.messagesByConv[k] = [];
      }
      if (state.currentChat && state.currentChat.type === 'group') {
        renderMessages();
      }
      refreshConversations();
      toast('群消息已被管理员清除');
    });
    s.on('group:renamed', ({ groupId, name }) => {
      const g = state.groups.find(x => x.id === groupId);
      if (g) g.name = name;
      if (state.currentChat && state.currentChat.type === 'group' && state.currentChat.id === groupId) {
        renderChatHeader();
      }
      refreshGroups(); refreshConversations();
    });
  }
  function onSocketMessage(msg) {
    const isMine = msg.sender_id === state.user.id;
    const peerId = currentPeerId(msg);
    const key = convKey(msg.conv_type, msg.conv_type==='user' ? peerId : msg.conv_id);
    const arr = state.messagesByConv[key] || [];
    if (!arr.find(x => x.id === msg.id)) arr.push(msg);
    state.messagesByConv[key] = arr;
    if (!isMine) {
      // They just spoke — clear their typing bubble.
      if (state.typingUsers.has(msg.sender_id)) {
        const t = state.typingUsers.get(msg.sender_id);
        if (t) clearTimeout(t.timer);
        state.typingUsers.delete(msg.sender_id);
        renderTyping();
      }
      const inChat = state.currentChat && state.currentChat.type===msg.conv_type &&
        ((msg.conv_type==='user' && state.currentChat.id===peerId) ||
         (msg.conv_type==='group' && state.currentChat.id===msg.conv_id));
      if (inChat) { renderMessages(); scrollBottom(); sendReadReceipt(msg); }
      else refreshConversations();
    } else {
      refreshConversations();
    }
  }
  // Somebody wants into one of my groups. Show it — the owner (and Jack)
  // approve it from the group's settings.
  function onGroupJoinRequest(req) {
    if (!req || !req.group_id) return;
    const who = req.username || (lang === 'en' ? 'Somebody' : '有人');
    toast(lang === 'en'
      ? `${who} wants to join “${req.group_name}”`
      : `${who} 申请加入「${req.group_name}」`);
    state.pendingGroupRequests = state.pendingGroupRequests || {};
    state.pendingGroupRequests[req.group_id] = (state.pendingGroupRequests[req.group_id] || 0) + 1;
    renderGroupRequestBadge();
    refreshGroups();
  }
  function onGroupRequestResolved(r) {
    if (!r) return;
    toast(r.accepted
      ? (lang === 'en' ? `You joined “${r.group_name}”` : `你加入了「${r.group_name}」`)
      : (lang === 'en' ? `The request for “${r.group_name}” was declined` : `「${r.group_name}」的申请被拒绝`));
    refreshGroups();
    refreshRecommended();
  }
  function renderGroupRequestBadge() {
    const badge = $('#group-request-badge');
    if (!badge) return;
    const n = Object.values(state.pendingGroupRequests || {}).reduce((a, b) => a + b, 0);
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.toggle('hidden', !n);
  }

  function onMessageDeleted({ id, conv_type, conv_id }) {
    const peerId = currentPeerId({conv_id});
    const key = convKey(conv_type, conv_type==='user' ? peerId : conv_id);
    const arr = state.messagesByConv[key] || [];
    const m = arr.find(x => x.id === id);
    if (m) { m.is_deleted = true; m.content = ''; }
    if (state.currentChat && convKey(state.currentChat.type, state.currentChat.id) === key) renderMessages();
    refreshConversations();
  }
  function onMessageRead({ conv_type, conv_id, user_id, last_read_msg_id }) {
    if (user_id === state.user.id) return;
    const peerId = currentPeerId({conv_id});
    const key = convKey(conv_type, conv_type==='user' ? peerId : conv_id);
    const arr = state.messagesByConv[key] || [];
    for (const m of arr) {
      if (m.sender_id === state.user.id && m.id <= last_read_msg_id) {
        if (!m.read_by) m.read_by = [];
        if (!m.read_by.includes(user_id)) m.read_by.push(user_id);
      }
    }
    if (state.currentChat && convKey(state.currentChat.type, state.currentChat.id) === key) renderMessages();
  }
  function onUserPresence({ user_id, online }) {
    if (online) state.online.add(user_id); else state.online.delete(user_id);
    renderChats();
    if (state.currentChat && state.currentChat.type==='user' && state.currentChat.id===user_id) renderChatHeader();
  }
  function onUserUpdated(u) {
    const f = state.friends.find(f => f.id === u.id);
    if (f) Object.assign(f, u);
    if (state.user && state.user.id === u.id) Object.assign(state.user, u);
    renderChats();
  }
  function onFriendRequest(req) {
    state.requests.unshift({id:req.id, from_id:req.from.id, from_username:req.from.username, from_avatar:req.from.avatar, created_at:req.created_at});
    state.unreadRequests++; renderBell();
    toast(t('toast_friend_req', req.from.username));
  }
  function onRequestResolved(payload) {
    const r = state.requests.find(x => x.id===payload.id);
    if (r) {
      r.status = payload.accept ? 'accepted' : 'rejected';
      toast(payload.accept ? t('toast_req_accepted') : t('toast_req_rejected'));
      if (payload.accept) refreshFriends().then(refreshConversations);
    }
  }
  function onFriendAdded(u) {
    if (!state.friends.some(f => f.id===u.id)) {
      state.friends.push({id:u.id, username:u.username, avatar:u.avatar, bio:u.bio, avatar_color:u.avatar_color});
      renderChats(); refreshConversations(); toast(t('toast_new_friend', u.username));
    }
  }
  function onGroupAdded(g) {
    if (!state.groups.some(x => x.id===g.groupId)) {
      state.groups.push({id:g.groupId, name:g.name, is_official:0, owner_id:null});
      renderChats(); refreshConversations(); toast(t('toast_new_group', g.name));
    }
  }
  function onTypingStart({ conv_type, conv_id, user_id, username }) {
    if (user_id === state.user.id) return;
    const peerId = currentPeerId({conv_id});
    const key = convKey(conv_type, conv_type==='user' ? peerId : conv_id);
    if (state.currentChat && convKey(state.currentChat.type, state.currentChat.id) === key) {
      const existing = state.typingUsers.get(user_id);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => onTypingStop({ conv_type, conv_id, user_id }), 8000);
      state.typingUsers.set(user_id, { username, timer });
      renderTyping();
    }
  }
  function onTypingStop({ conv_type, conv_id, user_id }) {
    const t2 = state.typingUsers.get(user_id);
    if (t2) { clearTimeout(t2.timer); state.typingUsers.delete(user_id); }
    renderTyping();
  }

  // The line that says who is typing. It lives under the messages, so
  // it reads as part of the conversation rather than as a banner.
  function renderTyping() {
    const box = $('#typing-indicator');
    if (!box) return;
    const names = [];
    for (const [uid, v] of state.typingUsers) {
      if (v && v.username) names.push(v.username);
    }
    const hint = $('#qwen-hint');
    if (!names.length) {
      box.classList.add('hidden'); box.innerHTML = '';
      // Let the hint bar decide for itself whether it belongs here —
      // it only shows inside a group.
      updateMentionButton();
      return;
    }
    const who = names.length === 1 ? names[0] : (lang === 'en' ? 'Someone' : '有人');
    const verb = lang === 'en' ? 'is typing…' : '正在输入…';
    box.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span><span>' +
      escapeHtml(who + ' ' + verb) + '</span>';
    box.classList.remove('hidden');
    // The hint bar and the typing bubble share one slot.
    if (hint) hint.classList.add('hidden');
  }

  // ---------- refresh ----------
  async function refreshFriends() { try { state.friends = (await api('/friends')).friends || []; } catch { state.friends = []; } }
  async function refreshGroups()  { try { state.groups  = (await api('/groups')).groups   || []; } catch { state.groups  = []; } }
  async function refreshRequests() { try { state.requests = (await api('/friend/requests')).requests || []; } catch { state.requests = []; } }
  async function refreshConversations() {
    try {
      const r = await api('/conversations');
      state.conversations = r.conversations || [];
      renderChats();
    } catch (e) {
      // Surface the failure instead of silently rendering an empty list.
      console.error('[VVeChat] conversations failed:', e && e.message);
      const list = $('#chats-list');
      if (list && !state.conversations.length) {
        list.innerHTML = `<li style="padding:14px;color:var(--danger);font-size:12px;line-height:1.5">
          会话加载失败<br><span style="opacity:.7;font-size:11px">${escapeHtml(e && e.message || 'unknown')}</span>
        </li>`;
      }
      toast('加载会话失败：' + (e && e.message || ''));
    }
  }
  async function refreshOnlineStatus() {
    const ids = [...state.friends.map(f => f.id), ...state.groups.map(g => g.id), state.user.id];
    if (!ids.length) return;
    try { const r = await api(`/users/status?ids=${ids.join(',')}`); state.online.clear(); for (const [uid, on] of Object.entries(r.status)) if (on) state.online.add(Number(uid)); } catch {}
  }
  async function refreshAll() {
    // Each refresher already swallows its own error, but Promise.all would
    // still reject if one of them throws synchronously — never let that stop
    // renderAll() from running.
    try {
      await Promise.all([
        refreshFriends().catch(e => console.error('friends', e)),
        refreshGroups().catch(e => console.error('groups', e)),
        refreshRequests().catch(e => console.error('requests', e)),
        refreshConversations().catch(e => console.error('conversations', e)),
      ]);
      await refreshOnlineStatus();
    } catch (e) {
      console.error('[VVeChat] refreshAll failed:', e);
    }
    renderAll();
  }

  // ============================================================
  // Mobile main menu — the FAB morphs into a vertical sheet.
  //
  // The desktop topbar keeps its original DOM and layout. On narrow
  // screens we PHYSICALLY MOVE the topbar buttons into the sheet and
  // move them back on resize, so the desktop markup is never altered.
  //
  // Interaction depth:
  //   1) circular FAB with three lines  (this button)
  //   2) vertical sheet holding the original topbar buttons
  //   3) tapping a sheet item opens the app's existing modal
  //      (profile / friend requests / search / theme) — the "third level"
  // ============================================================
  const MOBILE_BP = 820;           // must match the CSS breakpoint
  const MOBILE_MENU_KEYS = [
    'btn-profile', 'btn-bell', 'btn-plus', 'btn-lang', 'btn-logout',
    'theme-menu-wrap', 'topbar-jack-pill'
  ];
  let _mobileMenuBound = false;
  let _mobileMenuOpen = false;
  let _mobileMenuMoved = false;

  function isMobileLayout() {
    return window.innerWidth <= MOBILE_BP;
  }

  // Labels for the sheet entries. The icons alone (avatar / bell / search /
  // logout / theme) are cryptic on a phone, so each gets a text label that
  // only exists inside the sheet.
  const MOBILE_MENU_LABELS = {
    'btn-profile': '我的资料',
    'btn-bell': '好友申请',
    'btn-plus': '搜索 / 添加',
    'btn-lang': '切换语言',
    'btn-logout': '退出登录',
    'theme-menu-wrap': '切换主题'
  };

  function labelMobileMenuItems(sheet) {
    for (const [id, text] of Object.entries(MOBILE_MENU_LABELS)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const host = (el.classList.contains('theme-toggle')) ? el.parentElement : el;
      let tag = host.querySelector('.mm-label');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'mm-label';
        host.appendChild(tag);
      }
      tag.textContent = text;
    }
    // The Jack shield pill is decorative — label it too.
    const pill = document.getElementById('topbar-jack-pill');
    if (pill) {
      let tag = pill.querySelector('.mm-label');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'mm-label';
        pill.appendChild(tag);
      }
      tag.textContent = '管理员';
    }
  }

  // Move the real topbar buttons into the sheet (mobile) or back out (desktop).
  function syncMobileMenuLayout() {
    const sheet = $('#mobile-menu-sheet');
    const right = $('.topbar-right');
    if (!sheet || !right) return;
    const mobile = isMobileLayout();
    if (mobile && !_mobileMenuMoved) {
      // The sheet must live at BODY level, not inside .topbar-right.
      // .topbar carries z-index:5, which creates a stacking context, so a
      // child with z-index:1500 still sits BELOW a body-level scrim at
      // z-index:1400 — the scrim covered the sheet and ate every tap.
      if (sheet.parentElement !== document.body) {
        document.body.appendChild(sheet);
      }
      for (const id of MOBILE_MENU_KEYS) {
        const el = document.getElementById(id);
        if (!el) continue;
        // Remember where it came from so we can restore it exactly.
        if (!el.dataset.mmHome) el.dataset.mmHome = el.parentElement ? el.parentElement.id || '' : '';
        sheet.appendChild(el);
      }
      _mobileMenuMoved = true;
      labelMobileMenuItems(sheet);
      closeMobileMenu(true);
    } else if (!mobile && _mobileMenuMoved) {
      // Put the sheet back where it came from.
      if (sheet.parentElement !== right) right.appendChild(sheet);
      for (const id of MOBILE_MENU_KEYS) {
        const el = document.getElementById(id);
        if (!el) continue;
        // Put it back in .topbar-right, before the FAB so the order matches
        // the original desktop markup.
        right.insertBefore(el, right.firstChild);
      }
      _mobileMenuMoved = false;
      closeMobileMenu(true);
    } else if (mobile && _mobileMenuMoved) {
      // Already in mobile mode — but a button may have been re-created
      // (the Jack pill is rebuilt on every avatar render). Pull any
      // stragglers that are sitting in the bar back into the sheet.
      for (const id of MOBILE_MENU_KEYS) {
        const el = document.getElementById(id);
        if (el && el.parentElement !== sheet) sheet.appendChild(el);
      }
    }
  }

  // A scrim dims the page behind the open menu so the sheet reads as its
  // own layer. Tapping it closes the menu.
  function mobileMenuScrim() {
    let scrim = document.getElementById('mobile-menu-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = 'mobile-menu-scrim';
      scrim.className = 'mobile-menu-scrim';
      scrim.addEventListener('click', () => closeMobileMenu());
      document.body.appendChild(scrim);
    }
    return scrim;
  }

  function openMobileMenu() {
    if (_mobileMenuOpen) return;
    const sheet = $('#mobile-menu-sheet');
    const fab = $('#btn-mobile-menu');
    if (!sheet || !fab) return;
    _mobileMenuOpen = true;
    sheet.hidden = false;
    // Force a reflow so the transition actually runs.
    void sheet.offsetWidth;
    sheet.classList.add('open');
    fab.classList.add('active');
    fab.setAttribute('aria-expanded', 'true');
    mobileMenuScrim().classList.add('open');
  }

  function closeMobileMenu(instant) {
    const sheet = $('#mobile-menu-sheet');
    const fab = $('#btn-mobile-menu');
    if (!sheet || !fab) return;
    _mobileMenuOpen = false;
    fab.classList.remove('active');
    fab.setAttribute('aria-expanded', 'false');
    document.getElementById('mobile-menu-scrim')?.classList.remove('open');
    if (instant) {
      sheet.classList.remove('open');
      sheet.hidden = true;
    } else {
      sheet.classList.remove('open');
      // Wait out the collapse animation before hiding from the a11y tree.
      setTimeout(() => { if (!_mobileMenuOpen) sheet.hidden = true; }, 260);
    }
  }

  function toggleMobileMenu() {
    if (_mobileMenuOpen) closeMobileMenu();
    else openMobileMenu();
  }

  function ensureMobileMenuBound() {
    if (_mobileMenuBound) return;
    _mobileMenuBound = true;

    document.addEventListener('click', (e) => {
      const fab = e.target.closest('#btn-mobile-menu');
      if (fab) {
        e.preventDefault();
        e.stopPropagation();
        toggleMobileMenu();
        return;
      }
      // Clicking a sheet item = the third level: run the original action and
      // let the sheet collapse behind the modal.
      if (_mobileMenuOpen) {
        const item = e.target.closest('#mobile-menu-sheet .icon-btn, #mobile-menu-sheet .theme-toggle, #mobile-menu-sheet .admin-pill');
        if (item) {
          // Let the button's own handler run first, then collapse the sheet.
          setTimeout(() => closeMobileMenu(), 60);
          return;
        }
        // Tap anywhere else → collapse.
        if (!e.target.closest('#mobile-menu-sheet')) closeMobileMenu();
      }
    }, true);

    // The theme menu is a dropdown inside the sheet; keep it from closing
    // the sheet when the user picks a theme.
    document.addEventListener('click', (e) => {
      if (!_mobileMenuOpen) return;
      if (e.target.closest('#theme-menu')) e.stopPropagation();
    }, true);

    let rzTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => {
        syncMobileMenuLayout();
      }, 120);
    });

    syncMobileMenuLayout();
  }

  // The identity card opens the profile modal.
  let _sideMeBound = false;
  function ensureSideMeBound() {
    if (_sideMeBound) return;
    _sideMeBound = true;
    document.addEventListener('click', (e) => {
      const card = e.target.closest('#side-me, #list-me');
      if (!card) return;
      e.preventDefault(); e.stopPropagation();
      if (state.user) openProfileModal(state.user);
    }, true);
  }

  // ============================================================
  // Qwen panel
  // ------------------------------------------------------------
  // The user's message goes to the server relay, the relay streams back
  // the reasoning trace and the answer, and we render them here:
  //   • the reasoning trace is written as it arrives, in its own card
  //   • the answer is typed out, one character every 100ms (as requested)
  // While waiting for the first token we show a "Thinking…" indicator
  // with three breathing dots.
  // ============================================================
  const AI_TYPE_MS = 10;           // 0.01s per character
  let _aiBusy = false;

  // ------------------------------------------------------------
  // Preferences: which model, 深度思考 on/off, 思考档位, 搜索 on/off.
  // They survive a reload — a chat app that forgets your model every
  // time you open it is annoying to use.
  // ------------------------------------------------------------
  const AI_PREF_KEY = 'vve:ai-prefs';
  function aiPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(AI_PREF_KEY) || '{}') || {}; } catch (_) { p = {}; }
    return {
      model: typeof p.model === 'string' ? p.model : '',
      thinking: p.thinking === true,
      level: ['low', 'medium', 'high'].includes(p.level) ? p.level : 'medium',
      search: p.search === true
    };
  }
  function aiSetPrefs(patch) {
    const next = Object.assign(aiPrefs(), patch || {});
    try { localStorage.setItem(AI_PREF_KEY, JSON.stringify(next)); } catch (_) {}
  }

  // The catalogue the server reports. Each entry carries the model's
  // capabilities, so the UI only offers what the model can really do.
  let _aiModels = [];
  function aiModelById(id) { return _aiModels.find((m) => m.id === id) || null; }
  // The model that is selected right now (the DOM is the source of truth).
  function aiCurrentModel() {
    const sel = $('#ai-model');
    const id = (sel && sel.value) || aiPrefs().model;
    return aiModelById(id);
  }

  function aiLogEl() { return $('#ai-log'); }

  // ---------- auto-scroll that yields to the reader ----------
  // While the model streams, the transcript grows. Forcing the view to the
  // bottom on every character made it impossible to scroll UP and read an
  // earlier answer while the model was still working — the view yanked
  // itself back down.
  //
  // The rule: follow the output ONLY while the reader is parked at the
  // bottom. The moment they scroll up, stop moving. Content growing does
  // not fire a scroll event (scrollTop does not change), so the flag
  // reliably distinguishes "the reader scrolled up" from "more text
  // arrived".
  let _aiSticky = true;

  function aiInitSticky() {
    const log = aiLogEl();
    if (!log || log.__stickyBound) return;
    log.__stickyBound = true;
    log.addEventListener('scroll', () => {
      const gap = log.scrollHeight - log.scrollTop - log.clientHeight;
      _aiSticky = gap < 60;
    }, { passive: true });
  }

  function aiAutoScroll(force) {
    const log = aiLogEl();
    if (!log) return;
    if (force || _aiSticky) log.scrollTop = log.scrollHeight;
  }

  function aiAppendBlock(kind) {
    const log = aiLogEl();
    if (!log) return null;
    const welcome = log.querySelector('.ai-welcome');
    if (welcome) welcome.remove();
    const row = document.createElement('div');
    row.className = 'ai-row ' + kind;
    if (kind === 'think') {
      row.innerHTML = `<div class="ai-think-head">
          <span class="ai-think-dots"><i></i><i></i><i></i></span>
          <span class="ai-think-title">思考过程</span>
        </div>
        <div class="ai-think-body"></div>`;
    } else if (kind === 'user') {
      row.innerHTML = `<div class="ai-bubble user"></div>`;
    } else {
      row.innerHTML = `<div class="ai-bubble bot"></div>`;
    }
    log.appendChild(row);
    aiAutoScroll();
    return row;
  }

  // The thinking is over: the title becomes 「思考过程」 and the three
  // dots stop pulsing — they were a "still working" signal, and it is
  // noise once the answer is on screen.
  function aiFinishThinking() {
    const row = $('.ai-row.think');
    if (!row || row.classList.contains('think-done')) return;
    row.classList.add('think-done');
    const title = row.querySelector('.ai-think-title');
    if (title) title.textContent = '思考过程';
  }

  // Type text into an element one character at a time.
  // The element is CLEARED first: the reasoning card has already been
  // filled with the raw trace while it streamed in, and appending on top
  // of that duplicated the whole paragraph.
  function aiType(el, text, speed) {
    return new Promise((resolve) => {
      if (!el) return resolve();
      el.textContent = '';
      if (!text) return resolve();
      // One text node, appended to — `el.textContent += ch` re-parses the
      // whole element on every character, which is O(n²) and visibly
      // stutters once the answer gets long.
      const node = document.createTextNode('');
      el.appendChild(node);
      const scroll = () => aiAutoScroll();
      let i = 0;
      // The upstream likes to open with a newline or two. Writing them
      // one by one would show a blank first line that grows as the
      // answer types — skip them before the first character lands.
      while (i < text.length && /\s/.test(text.charAt(i)) && text.charAt(i) !== '\n') i++;
      while (i < text.length && text.charAt(i) === '\n') i++;
      const step = () => {
        if (i >= text.length) return resolve();
        node.appendData(text.charAt(i));
        i++;
        // Scrolling on every character forces a reflow each tick; every
        // eighth one is smooth enough to look identical.
        if ((i & 7) === 0) scroll();
        if (i >= text.length) { scroll(); return resolve(); }
        setTimeout(step, speed);
      };
      step();
    });
  }

  function aiSetStatus(text, cls) {
    const el = $('#ai-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'ai-head-sub' + (cls ? ' ' + cls : '');
  }

  // Fill the model dropdown. Every entry is one concrete Qwen model, so
  // the name the user picks is exactly the model that answers.
  function aiFillModels(models, defaultId) {
    const sel = $('#ai-model');
    if (!sel) return;
    // The picker only offers the OVH public endpoint: it needs no key, so
    // every user gets a working model without any setup.
    const pool = models.filter((m) => m.provider === 'ovh');
    const list = pool.length ? pool : models;
    const prefs = aiPrefs();
    const wanted = prefs.model && list.some((m) => m.id === prefs.model)
      ? prefs.model
      : (defaultId && list.some((m) => m.id === defaultId)
          ? defaultId
          : (list.find((m) => m.ready) || list[0] || {}).id || '');
    sel.innerHTML = '';
    // Group by provider so the dropdown reads like a menu, not a dump.
    const groups = [];
    for (const m of list) {
      let g = groups.find((x) => x.label === m.providerLabel);
      if (!g) { g = { label: m.providerLabel, items: [] }; groups.push(g); }
      g.items.push(m);
    }
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const m of g.items) {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = m.label + (m.ready ? '' : '（需密钥）');
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    if (wanted) sel.value = wanted;
    // A stale preference (the model was removed) must not leave the
    // dropdown empty — fall back to the first usable entry.
    if (!sel.value) {
      const firstReady = list.find((m) => m.ready) || list[0];
      if (firstReady) sel.value = firstReady.id;
    }
    if (sel.value) aiSetPrefs({ model: sel.value });
  }

  // Match the toolbar to what the selected model can actually do:
  //   深度思考 → on / off / "自带思考，不可关"
  //   思考档位 → only for models that accept a thinking budget
  //   搜索     → on / off
  // The 深度思考 and 搜索 buttons were removed from the toolbar, so the
  // only thing left to sync is the model dropdown itself. The models that
  // can think now always do (the server decides), and search is off unless
  // the model performs it on its own.
  function aiSyncTools() {
    const cur = aiCurrentModel();
    const prefs = aiPrefs();
    const sel = $('#ai-model');
    if (sel && cur && sel.value !== cur.id) sel.value = cur.id;
    // Keep the stored preferences consistent with the new behaviour so a
    // stale "thinking: off" from an earlier session cannot silence the
    // reasoning trace.
    if (prefs.thinking !== true) {
      prefs.thinking = true;
      try { localStorage.setItem('vve:ai-prefs', JSON.stringify(prefs)); } catch (_) {}
    }
  }

  // ============================================================
  // AI conversation list (the DeepSeek-style sidebar)
  // ============================================================
  let _aiChats = [];
  let _aiChatId = null;

  async function aiLoadChats() {
    try {
      const r = await api('/ai/chats');
      _aiChats = r.chats || [];
    } catch (e) {
      _aiChats = [];
    }
    aiRenderChats();
  }

  // Group the chats the way a chat app does: 今天 / 昨天 / 更早.
  function aiGroupLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfToday) return '今天';
    if (ts >= startOfToday - 86400000) return '昨天';
    if (ts >= startOfToday - 7 * 86400000) return '本周';
    if (ts >= startOfToday - 30 * 86400000) return '本月';
    return '更早';
  }

  function aiRenderChats() {
    const list = $('#ai-chat-list');
    if (!list) return;
    list.innerHTML = '';
    if (!_aiChats.length) {
      const empty = document.createElement('div');
      empty.className = 'ai-chat-empty';
      empty.textContent = '还没有对话记录';
      list.appendChild(empty);
      return;
    }
    let lastGroup = null;
    for (const c of _aiChats) {
      const g = aiGroupLabel(c.updated_at || c.created_at);
      if (g !== lastGroup) {
        lastGroup = g;
        const h = document.createElement('div');
        h.className = 'ai-chat-group';
        h.textContent = g;
        list.appendChild(h);
      }
      const item = document.createElement('div');
      item.className = 'ai-chat-item' + (String(c.id) === String(_aiChatId) ? ' active' : '');
      const title = document.createElement('span');
      title.className = 'ai-chat-title';
      title.textContent = c.title || '新对话';
      title.title = c.title || '新对话';
      const del = document.createElement('button');
      del.className = 'ai-chat-del';
      del.type = 'button';
      del.title = '删除对话';
      del.setAttribute('aria-label', '删除对话');
      del.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await aiDeleteChat(c.id);
      });
      item.appendChild(title);
      item.appendChild(del);
      item.addEventListener('click', () => aiOpenChat(c.id));
      list.appendChild(item);
    }
  }

  async function aiOpenChat(chatId) {
    _aiChatId = chatId;
    aiRenderChats();
    const log = aiLogEl();
    if (log) log.innerHTML = '';
    try {
      const r = await api(`/ai/chats/${chatId}`);
      const msgs = r.messages || [];
      for (const m of msgs) {
        if (m.role === 'user') {
          const row = aiAppendBlock('user');
          const b = row && row.querySelector('.ai-bubble');
          if (b) b.textContent = m.content;
        } else {
          // The assistant's turn: reasoning card first (if any), then answer.
          if (m.reasoning) {
            const row = aiAppendBlock('think');
            const body = row && row.querySelector('.ai-think-body');
            const title = row && row.querySelector('.ai-think-title');
            if (title) title.textContent = '思考过程';
            // A trace that is already finished must not look like it is
            // still going: freeze the three dots.
            if (row) row.classList.add('think-done');
            if (body) body.textContent = m.reasoning;
          }
          const row = aiAppendBlock('bot');
          const b = row && row.querySelector('.ai-bubble');
          if (b) b.textContent = m.content;
        }
      }
      if (!msgs.length) {
        const w = document.createElement('div');
        w.className = 'ai-welcome';
        w.innerHTML = '<p class="ai-welcome-title">' + escapeHtml(t('ai_welcome')) + '</p>';
        if (log) { const old = log.querySelector('.ai-welcome'); if (old) old.remove(); log.appendChild(w); }
      }
      if (log) aiAutoScroll(true);
    } catch (e) {
      toast(e.message || '加载对话失败');
    }
  }

  async function aiNewChat() {
    if (_aiBusy) return;
    try {
      const r = await api('/ai/chats', { method: 'POST', body: { model: (aiCurrentModel() || {}).id || '' } });
      _aiChatId = r.chat ? r.chat.id : null;
      await aiLoadChats();
      const log = aiLogEl();
      if (log) {
        log.innerHTML = '<div class="ai-welcome"><p class="ai-welcome-title">' + escapeHtml(t('ai_welcome')) + '</p></div>';
      }
    } catch (e) {
      toast(e.message || '新建对话失败');
    }
  }

  async function aiDeleteChat(chatId) {
    try {
      await api(`/ai/chats/${chatId}`, { method: 'DELETE' });
      if (String(chatId) === String(_aiChatId)) {
        _aiChatId = null;
        const log = aiLogEl();
        if (log) log.innerHTML = '<div class="ai-welcome"><p class="ai-welcome-title">' + escapeHtml(t('ai_welcome')) + '</p></div>';
      }
      await aiLoadChats();
    } catch (e) {
      toast(e.message || '删除失败');
    }
  }

  async function aiCheckStatus() {
    try {
      const r = await api('/ai/status');
      const models = r.models || [];
      _aiModels = models;
      state.aiSources = models;
      state.aiModels = models;
      state.aiProviders = r.providers || [];

      aiFillModels(models, r.defaultModel);
      aiSyncTools();

      const cur = aiCurrentModel();
      const readyCount = models.filter((m) => m.ready).length;
      if (cur) {
        aiSetStatus(
          `${cur.label} · ${cur.providerLabel}${cur.ready ? '' : '（未配置密钥）'}`,
          cur.ready ? 'ok' : 'warn'
        );
      } else if (readyCount) {
        aiSetStatus(`${readyCount} 个模型可用`, 'ok');
      } else {
        aiSetStatus('没有可用的 Qwen 源', 'warn');
      }

      // The setup button appears when a key would unlock more models.
      // Only the admin can actually save one, so for everyone else the
      // button becomes a "ask the admin" hint instead of a dead end.
      const setup = $('#ai-setup-btn');
      if (setup) {
        const admin = isJack();
        const missing = models.some((m) => !m.ready);
        setup.classList.toggle('hidden', !missing);
        setup.textContent = admin ? '接入免费 Qwen 密钥' : '尚未接入密钥（请联系管理员）';
        setup.disabled = !admin;
        setup.title = admin ? '粘贴一个免费中转的密钥，立即生效' : '只有管理员可以配置';
      }
      state.aiReady = readyCount > 0;
    } catch (e) {
      aiSetStatus('中转暂不可用', 'warn');
    }
  }

  // Admin-only: paste a relay key in the UI. Stored server-side, so it takes
  // effect immediately with no redeploy.
  function aiOpenSetup() {
    const providers = state.aiProviders || [];
    const rows = providers.map((p) => `
      <label class="ai-provider">
        <span class="ai-provider-name">${escapeHtml(p.label)}${p.hasKey ? ' · 已配置' : ''}</span>
        <span class="ai-provider-note">${escapeHtml(p.note || '')}</span>
        <input type="text" id="ai-key-${escapeHtml(p.id)}" placeholder="${p.needKey ? '粘贴 API Key（留空＝不启用）' : '无需密钥'}" autocomplete="off" ${p.needKey ? '' : 'disabled'} />
      </label>`).join('');
    const dlg = document.createElement('div');
    dlg.className = 'modal';
    dlg.id = 'modal-ai-setup';
    dlg.innerHTML = `
      <div class="modal-mask"></div>
      <div class="modal-card modal-card-sm" style="aspect-ratio:auto; width:min(92vw, 460px);">
        <div class="modal-head">
          <h3>接入免费 Qwen 密钥</h3>
          <button class="icon-btn icon-btn-sm modal-close" data-close="modal-ai-setup">×</button>
        </div>
        <div class="modal-body">
          <p style="margin:0 0 12px;font-size:13px;color:var(--muted);line-height:1.6;">
            免密钥的公共端点已经可以直接用。想换更快的模型、用上「思考档位」或「官方联网搜索」，
            在下面任选一家免费注册后把密钥贴进来（留空＝不启用该家）：
          </p>
          <div class="ai-provider-list">
            ${rows}
            <label class="ai-provider">
              <span class="ai-provider-name">Tavily 搜索（可选）</span>
              <span class="ai-provider-note">不填也能搜索，只是结果质量差一些</span>
              <input type="text" id="ai-key-tavily" placeholder="粘贴 Tavily API Key（留空＝不启用）" autocomplete="off" />
            </label>
          </div>
          <div class="modal-msg" id="ai-setup-msg"></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-close="modal-ai-setup">取消</button>
            <button type="button" class="btn btn-primary" id="ai-setup-save">保存</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    const close = () => dlg.remove();
    dlg.querySelectorAll('[data-close="modal-ai-setup"]').forEach(b => b.addEventListener('click', close));
    dlg.querySelector('.modal-mask').addEventListener('click', close);
    dlg.querySelector('#ai-setup-save').addEventListener('click', async () => {
      const msg = dlg.querySelector('#ai-setup-msg');
      msg.textContent = '';
      let saved = 0;
      const ids = providers.map((p) => p.id).concat(['tavily']);
      for (const src of ids) {
        const input = dlg.querySelector('#ai-key-' + src);
        const val = input ? input.value.trim() : '';
        if (!val) continue;
        try {
          await api('/ai/config', { method: 'POST', body: { source: src, key: val } });
          saved++;
        } catch (e) {
          msg.textContent = e.message;
          return;
        }
      }
      if (!saved) { msg.textContent = '请至少填写一个密钥'; return; }
      toast('已保存，正在重新检查中转源…');
      close();
      aiCheckStatus();
    });
  }

  async function aiSend(text) {
    if (_aiBusy) return;
    const msg = String(text || '').trim();
    if (!msg) return;
    _aiBusy = true;
    const sendBtn = $('#ai-send');
    // While the model works the send button becomes a STOP button: the same
    // blue disc, with a white rounded square inside it. Tapping it aborts
    // the request.
    if (sendBtn) {
      sendBtn.classList.add('stopping');
      sendBtn.title = '停止生成';
      sendBtn.setAttribute('aria-label', '停止生成');
    }

    const prefs = aiPrefs();

    const userRow = aiAppendBlock('user');
    const userBubble = userRow && userRow.querySelector('.ai-bubble');
    if (userBubble) userBubble.textContent = msg;

    // Order on screen:
    //   user message
    //   思考过程 (only if the model actually sends a reasoning trace)
    //   answer bubble  ← created only when the first token arrives
    //
    // The answer bubble is NOT pre-created with a "Thinking…" animation any
    // more: the reasoning trace IS the thinking indicator, so an animation
    // floating above an empty answer box was both redundant and confusing.
    // While we wait for the very first token we only show one quiet line
    // of text — no dots, no bubble.
    const waiting = document.createElement('div');
    waiting.className = 'ai-waiting';
    waiting.textContent = prefs.search ? '正在联网搜索…' : '正在思考…';
    (aiLogEl() || document.body).appendChild(waiting);

    let answer = '';
    let reasoning = '';
    let reasoningStarted = false;
    let thinkRow = null;
    let thinkBody = null;
    let botRow = null;
    let botBubble = null;
    let answeredBy = '';

    try {
      _aiAbort = new AbortController();
      const resp = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
        body: JSON.stringify({
          message: msg,
          history: state.aiHistory || [],
          chat_id: _aiChatId || null,
          model: prefs.model,
          thinking: prefs.thinking,
          level: prefs.level,
          search: prefs.search
        }),
        signal: _aiAbort.signal
      });
      if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.json()).error || ''; } catch (_) {}
        throw new Error(detail || `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let j;
          try { j = JSON.parse(t); } catch (_) { continue; }
          if (j.type === 'source') {
            // The server tells us which model really answered — it may be
            // a different one than the one that was picked.
            answeredBy = `${j.label || j.model} · ${j.provider || j.source}`;
            if (j.fallback) answeredBy += '（已切换）';
            aiSetStatus(answeredBy, 'ok');
          } else if (j.type === 'reset') {
            // The server gave up on this model. Drop the dead-end trace so
            // the next model's answer starts on a clean slate.
            const deadThink = $('.ai-row.think');
            if (deadThink) deadThink.remove();
            const deadBot = $('.ai-bubble.bot');
            if (deadBot) {
              const deadRow = deadBot.closest('.ai-row');
              if (deadRow) deadRow.remove();
            }
            if (!waiting.parentElement) {
              waiting.textContent = '正在换用其他模型…';
              (aiLogEl() || document.body).appendChild(waiting);
            }
            thinkRow = null;
            thinkBody = null;
            botRow = null;
            botBubble = null;
            reasoning = '';
            reasoningStarted = false;
            answer = '';
          } else if (j.type === 'search') {
            // The server tells us what the search actually produced, so the
            // answer never looks like it came from nowhere.
            // A skipped search (a greeting, say) has nothing to report.
            if (j.skipped) return;
            const note = document.createElement('div');
            note.className = 'ai-search-note';
            note.textContent = j.provider
              ? '已开启联网搜索（由模型自己搜索）'
              : (j.count > 0 ? `已联网搜索 · ${j.count} 条来源` : '联网搜索没有找到结果');
            const log = aiLogEl();
            if (log) {
              log.appendChild(note);
              aiAutoScroll();
            }
          } else if (j.type === 'reasoning') {
            // The upstream likes to open with a newline or two; those would
            // show up as a blank first line inside the reasoning card.
            let t = j.text || '';
            if (!reasoningStarted) {
              t = t.replace(/^\s+/, '');
              if (t) reasoningStarted = true;
            }
            reasoning += t;
            if (!thinkRow) {
              thinkRow = aiAppendBlock('think');
              thinkBody = thinkRow && thinkRow.querySelector('.ai-think-body');
              // The title says 「思考过程」 from the start — and the
              // three dots keep pulsing — until the model starts
              // writing the answer.
              waiting.remove();
            }
            // The trace is written as it arrives. It must NOT be typed out
            // again when the stream ends — that printed the whole trace
            // twice.
            if (thinkBody) thinkBody.textContent = reasoning.replace(/\s+$/, '');
            aiAutoScroll();
          } else if (j.type === 'delta') {
            answer += j.text || '';
            if (!botBubble) {
              // First token arrived → now the answer bubble appears.
              waiting.remove();
              aiFinishThinking();
              botRow = aiAppendBlock('bot');
              botBubble = botRow && botRow.querySelector('.ai-bubble');
              // Make sure the answer bubble sits BELOW the reasoning card.
              if (botRow && thinkRow && thinkRow.parentElement === botRow.parentElement) {
                botRow.parentElement.insertBefore(botRow, thinkRow.nextSibling);
              }
            }
          } else if (j.type === 'error') {
            // The server already tried every source. Surface a short,
            // readable message instead of a wall of upstream JSON.
            throw new Error(j.message || '中转失败');
          }
        }
      }
    } catch (e) {
      waiting.remove();
      aiFinishThinking();
      // A user-initiated stop is not an error — the abort surfaces as a
      // DOMException with a message like "BodyStreamBuffer was aborted".
      const aborted = e && (e.name === 'AbortError' ||
        /abort/i.test(String(e.message || '')));
      if (aborted) {
        aiSetStatus('已停止', 'warn');
        aiEndBusy();
        await aiLoadChats();
        return;
      }
      const msgText = String(e.message || '请求失败');
      const showErr = (row) => {
        const b = row && row.querySelector('.ai-bubble');
        if (b) b.innerHTML = `<span class="ai-error">${escapeHtml(msgText)}</span>`;
      };
      if (botBubble) {
        showErr(botRow);
      } else if (!thinkRow) {
        // Nothing streamed at all — show the error where the bubble would be.
        showErr(aiAppendBlock('bot'));
      }
      // Keep the header status short too.
      aiSetStatus(msgText.length > 60 ? msgText.slice(0, 60) + '…' : msgText, 'warn');
      aiEndBusy();
      return;
    }

    waiting.remove();
    aiFinishThinking();

    // The reasoning trace was already written while it streamed in, so
    // there is nothing to type out here. The answer is typed out now,
    // one character every 100ms, with the leading blank lines the
    // upstream likes to add stripped off.
    if (!botBubble && answer) {
      botRow = aiAppendBlock('bot');
      botBubble = botRow && botRow.querySelector('.ai-bubble');
      if (botRow && thinkRow && thinkRow.parentElement === botRow.parentElement) {
        botRow.parentElement.insertBefore(botRow, thinkRow.nextSibling);
      }
    }
    const cleanAnswer = answer.replace(/^\s+/, '').replace(/\s+$/, '');
    if (botBubble) {
      botBubble.innerHTML = '';
      await aiType(botBubble, cleanAnswer, AI_TYPE_MS);
    }
    if (!cleanAnswer) {
      if (botBubble) botBubble.innerHTML = `<span class="ai-error">没有收到回复</span>`;
      else {
        const errRow = aiAppendBlock('bot');
        const errBubble = errRow && errRow.querySelector('.ai-bubble');
        if (errBubble) errBubble.innerHTML = `<span class="ai-error">没有收到回复</span>`;
      }
    }

    state.aiHistory = state.aiHistory || [];
    state.aiHistory.push({ role: 'user', content: msg });
    state.aiHistory.push({ role: 'assistant', content: cleanAnswer.slice(0, 2000) });
    if (state.aiHistory.length > 8) state.aiHistory = state.aiHistory.slice(-8);

    aiSetStatus(answeredBy || '就绪', 'ok');
    aiEndBusy();
  }

  // Put the send button back into its arrow state and release the request
  // handle. Called on every exit path: success, failure and STOP.
  function aiEndBusy() {
    _aiBusy = false;
    _aiAbort = null;
    const btn = $('#ai-send');
    if (btn) {
      btn.classList.remove('stopping');
      btn.title = '发送';
      btn.setAttribute('aria-label', '发送');
      btn.disabled = false;
    }
  }

  // The user tapped the STOP square: abort the request and keep whatever
  // already arrived on screen.
  function aiStop() {
    if (!_aiBusy) return;
    try { if (_aiAbort) _aiAbort.abort(); } catch (_) {}
    const waiting = document.querySelector('.ai-waiting');
    if (waiting) waiting.remove();
    aiEndBusy();
    aiSetStatus('已停止', 'warn');
    toast('已停止生成');
  }

  // The Qwen panel lives in the SAME big right-hand panel as the chat.
  // Opening it hides the chat view and shows the AI view (and vice versa).
  function openAiView() {
    const ai = $('#ai-view');
    if (!ai) return;
    ai.classList.remove('hidden');
    ai.classList.add('open');
    $('#chat-window')?.classList.add('hidden');
    $('#chat-empty')?.classList.add('hidden');
    // On mobile the chat pane is an overlay that covers the sidebar.
    // Remember whether a conversation was open so the back arrow can
    // restore exactly what was on screen before.
    state.aiHadChat = !!state.currentChat;
    if (window.innerWidth <= 820) {
      $('.right-pane')?.classList.add('mobile-show');
      // NOT `chat-open` here: that class hides the floating tab bar, and
      // on a phone the tab bar is the only way to leave this view.
      // `ai-active` folds the conversation list away instead.
      $('.app-body')?.classList.add('ai-active');
      $('#chat-back')?.classList.add('mobile-show');
    }
    ensureAiPanelBound();
    aiCheckStatus();
    aiLoadChats();
    // If no chat is open yet, open (or create) the first one so a message
    // always lands somewhere the user can find again.
    if (!_aiChatId) {
      const first = _aiChats && _aiChats[0];
      if (first) aiOpenChat(first.id);
      else aiNewChat();
    }
    // Sidebar user chip at the bottom of the conversation list.
    const sideName = $('#ai-side-name');
    if (sideName && state.user) sideName.textContent = state.user.username;
    const sideAv = $('#ai-side-avatar');
    if (sideAv && state.user) {
      const em = state.user.avatar_emoji;
      const color = state.user.avatar_color || '#5eead4';
      sideAv.innerHTML = em
        ? `<span class="avatar-emoji">${escapeHtml(em)}</span>`
        : escapeHtml(initials(state.user.username));
      sideAv.style.background = em
        ? 'rgba(255,255,255,0.55)'
        : `linear-gradient(135deg, ${color}, ${shade(color, -25)})`;
    }
  }

  function closeAiView() {
    const ai = $('#ai-view');
    if (!ai) return;
    ai.classList.remove('open');
    ai.classList.add('hidden');
    // Restore the chat: either the open conversation, or the empty state.
    if (state.currentChat) {
      $('#chat-window')?.classList.remove('hidden');
      $('#chat-empty')?.classList.add('hidden');
    } else {
      $('#chat-window')?.classList.add('hidden');
      $('#chat-empty')?.classList.remove('hidden');
    }
    // On mobile, if no conversation was open when Qwen was entered,
    // the back arrow must return to the SIDEBAR — not to the empty chat
    // screen. Leaving `chat-open` on kept the sidebar hidden and the user
    // landed on "选择一个会话开始聊天" instead of the conversation list.
    if (window.innerWidth <= 820) {
      $('.app-body')?.classList.remove('ai-active');
      $('.app-body')?.classList.remove('list-open');
    }
    if (window.innerWidth <= 820 && !state.aiHadChat) {
      $('.right-pane')?.classList.remove('mobile-show');
      $('.app-body')?.classList.remove('chat-open');
      $('#chat-back')?.classList.remove('mobile-show');
    }
  }

  // Fold the middle list pane away, and bring it back. Both headers
  // carry a switch — the chat header and the AI header — so there is
  // always a way to undo it. The switch lives in the CONTENT pane, never
  // inside the list it hides.
  function toggleListPane() {
    const body = $('.app-body');
    if (!body) return;
    // On a phone the content pane covers the list, so the list slides in
    // as a drawer instead of collapsing to nothing.
    const phone = window.innerWidth <= 820;
    let folded;
    if (phone) {
      const open = body.classList.toggle('list-open');
      folded = !open;
    } else {
      folded = body.classList.toggle('list-collapsed');
    }
    const title = folded ? '展开会话列表' : '收起会话列表';
    for (const b of [$('#ai-sidebar-toggle'), $('#list-toggle'), $('#list-toggle-empty')]) {
      if (b) { b.title = title; b.setAttribute('aria-label', title); }
    }
  }

  // The keyboard: while a text field has focus the bottom tab bar would
  // sit right on top of it, so the bar steps aside. Only text fields
  // count — a tapped button takes focus too, and the bar must not slide
  // out from under the finger that just pressed it.
  function isTextField(t) {
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
  document.addEventListener('focusin', (e) => {
    if (!isTextField(e.target)) return;
    $('.app-body')?.classList.add('kb-open');
  });
  document.addEventListener('focusout', () => {
    // The next focused element is only known after the browser has moved
    // on, so wait a tick before deciding the keyboard is gone.
    setTimeout(() => {
      if (!isTextField(document.activeElement)) $('.app-body')?.classList.remove('kb-open');
    }, 80);
  });

  // Close the phone drawer — used by the scrim and whenever the list
  // stops being the thing the user is looking at.
  function closeListPane() {
    const body = $('.app-body');
    if (!body) return;
    body.classList.remove('list-open');
    for (const b of [$('#ai-sidebar-toggle'), $('#list-toggle'), $('#list-toggle-empty')]) {
      if (b) { b.title = '展开会话列表'; b.setAttribute('aria-label', b.title); }
    }
  }

  // Which list is on screen — the rail decides, and the list pane's
  // title and search box follow along.
  function setListMode(mode) {
    const lp = $('#list-pane');
    if (lp) lp.dataset.mode = mode;
    const titleEl = $('#list-title');
    if (titleEl) {
      titleEl.textContent = mode === 'ai'
        ? (lang === 'en' ? 'Assistant' : '助手')
        : mode === 'discover' ? t('nav_discover')
        : (mode === 'more' ? t('nav_personal') : t('nav_chats'));
    }
  }

  function ensureAiPanelBound() {
    const form = $('#ai-form');
    const input = $('#ai-input');
    if (!form || !input) return;
    aiInitSticky();
    if (form.__aiBound) {
      aiSyncTools();
      return;
    }
    form.__aiBound = true;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      input.style.height = 'auto';
      aiSend(v);
    });
    // Enter sends, Shift+Enter makes a new line.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
    // Auto-grow the textarea.
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
    aiCheckStatus();

    // --- model picker ---
    const modelSel = $('#ai-model');
    if (modelSel && !modelSel.__bound) {
      modelSel.__bound = true;
      modelSel.addEventListener('change', () => {
        aiSetPrefs({ model: modelSel.value });
        aiSyncTools();
        const cur = aiCurrentModel();
        if (cur) aiSetStatus(`${cur.label} · ${cur.providerLabel}${cur.ready ? '' : '（未配置密钥）'}`, cur.ready ? 'ok' : 'warn');
      });
    }

    // NOTE: the 思考档位 / 深度思考 / 搜索 controls were removed from the
    // toolbar, so their listeners went with them. The models that support
    // reasoning now always reason (the server side decides), and the panel
    // shows the trace when one arrives.

    const setupBtn = $('#ai-setup-btn');
    if (setupBtn && !setupBtn.__bound) {
      setupBtn.__bound = true;
      setupBtn.addEventListener('click', () => aiOpenSetup());
    }

    // The send button doubles as the STOP button while the model works.
    // It is a submit button, so the click has to be intercepted in the
    // capture phase — otherwise it would submit the form again.
    const sendBtn = $('#ai-send');
    if (sendBtn && !sendBtn.__stopBound) {
      sendBtn.__stopBound = true;
      sendBtn.addEventListener('click', (e) => {
        if (!sendBtn.classList.contains('stopping')) return;   // normal send
        e.preventDefault();
        e.stopPropagation();
        aiStop();
      }, true);
    }

    // New chat + sidebar toggle
    const newBtn = $('#ai-new-chat');
    if (newBtn && !newBtn.__bound) {
      newBtn.__bound = true;
      newBtn.addEventListener('click', () => aiNewChat());
    }
    const toggleBtn = $('#ai-sidebar-toggle');
    if (toggleBtn && !toggleBtn.__bound) {
      toggleBtn.__bound = true;
      toggleBtn.addEventListener('click', (e) => {
        // The button lives in the AI header, i.e. inside `.ai-main`,
        // whose click handler closes the mobile drawer.  Without this the
        // drawer would open and close again in the same tap.
        e.stopPropagation();
        toggleListPane();
      });
    }

    const closeBtn = $('#ai-close');
    if (closeBtn && !closeBtn.__bound) {
      closeBtn.__bound = true;
      closeBtn.addEventListener('click', () => {
        $$('.side-nav-item').forEach(b => b.classList.toggle('active', b.dataset.pane === 'chats'));
        $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-chats'));
        setListMode('chats');
        closeAiView();
      });
    }
  }

  // ---------- bootstrap ----------
  function enterApp() {
    showApp();
    applyI18n();
    loadPrefs(state.user);
    setLang();
    // ALWAYS hide the splash overlay on enter — it covers everything
    // (z-index 9999) and otherwise swallows all clicks/visibility.
    const _splash = $('#hello-splash');
    if (_splash) {
      _splash.classList.add('hidden');
      _splash.style.display = 'none';
      _splash.style.pointerEvents = 'none';
    }
    splashDismissed = true;
    // Bind each event group defensively — one throw must not prevent the
    // remaining handlers (modal close, composer, logout) from attaching.
    try { bindAppEvents(); } catch (e) { console.error('[VVeChat] bindAppEvents failed:', e); }
    // Safety net: ensure the modal close fallback is always attached, even if
    // bindAppEvents() bailed out part-way through.
    ensureModalCloseBound();
    ensurePlusActionsBound();
    ensureWipeBound();
    ensureBellBound();
    ensureMobileMenuBound();
    ensureAiPanelBound();
    ensureSideMeBound();
    renderTopbarAvatar();
    renderSideMe();
    connectSocket();
    refreshAll();
    // Always re-fetch the canonical user object from the server so that
    // any fields stale in localStorage (avatar_color, is_admin, etc.)
    // get refreshed without forcing the user to log out + back in.
    fetchMe().then(() => renderTopbarAvatar());
  }
  // Pull the latest /me record and merge it into state.user + localStorage.
  async function fetchMe() {
    try {
      const r = await api('/me');
      if (r && r.user) {
        Object.assign(state.user, r.user);
        try { localStorage.setItem('vve:user', JSON.stringify(state.user)); } catch (_) {}
      }
    } catch (_) { /* not logged in or transient error — ignore */ }
  }
  // Idempotently attach the document-level modal close delegation.
  let _modalCloseBound = false;
  function ensureModalCloseBound() {
    if (_modalCloseBound) return;
    _modalCloseBound = true;
    document.addEventListener('click', (e) => {
      const closeEl = e.target.closest('[data-close]');
      if (closeEl && closeEl.dataset.close) {
        e.preventDefault(); e.stopPropagation();
        closeModal(closeEl.dataset.close);
        return;
      }
      if (e.target && e.target.classList && e.target.classList.contains('modal-mask')) {
        const m = e.target.closest('.modal');
        if (m) closeModal(m.id);
      }
    }, true);
  }

  // Delegated handler for the "搜索 / 添加" panel. Bound once, at the
  // document level, so re-entering the app can never break it.
  //
  // The group cards (创建群聊 / 添加群聊) were removed together with the
  // user-created-group feature; their handlers are gone too, so those
  // branches are no longer referenced here — calling the deleted functions
  // would have thrown.
  let _plusBound = false;
  function ensurePlusActionsBound() {
    if (_plusBound) return;
    _plusBound = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#modal-plus .plus-action');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      const act = btn.dataset.action;
      closeModal('modal-plus');
      if (act === 'friend') {
        const u = $('#add-friend-username');
        if (u) u.value = '';
        const m = $('#add-friend-msg');
        if (m) m.textContent = '';
        openModal('modal-add-friend');
        setTimeout(() => $('#add-friend-username')?.focus(), 80);
      }
    }, true);

    // Inline user search inside the panel. Typing filters the user list;
    // each result can be added as a friend or opened in a private chat.
    const input = $('#plus-search-input');
    const results = $('#plus-results');
    if (input && results) {
      let timer = null;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (!q) { results.innerHTML = ''; return; }
        timer = setTimeout(() => renderPlusResults(q), 220);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const first = results.querySelector('[data-uid]');
          if (first) first.click();
        }
      });
      // Clicking a result row: 加好友 or 发消息.
      results.addEventListener('click', async (e) => {
        const actBtn = e.target.closest('button[data-act]');
        if (!actBtn) return;
        e.preventDefault(); e.stopPropagation();
        const uid = Number(actBtn.dataset.uid);
        const name = actBtn.dataset.name || '';
        if (!Number.isFinite(uid)) return;
        if (actBtn.dataset.act === 'add') {
          try {
            await api(`/api/friend/request/${uid}`, { method: 'POST' });
            toast('已向 ' + name + ' 发送好友申请');
            actBtn.textContent = '已申请';
            actBtn.disabled = true;
          } catch (err) {
            toast(err.message || '发送失败');
          }
        } else if (actBtn.dataset.act === 'chat') {
          closeModal('modal-plus');
          // Open (or create) the 1:1 conversation with that user.
          try {
            await openDirectChat(uid, name);
          } catch (err) {
            toast(err.message || '无法打开会话');
          }
        }
      });
    }
  }

  // Render the search hits inside the "搜索 / 添加" panel.
  async function renderPlusResults(q) {
    const results = $('#plus-results');
    if (!results) return;
    try {
      const r = await api(`/users/search?q=${encodeURIComponent(q)}`);
      const users = r.users || [];
      if (!users.length) {
        results.innerHTML = '<div class="plus-empty">没有找到用户</div>';
        return;
      }
      results.innerHTML = users.map(u => {
        const bg = u.avatar_color
          ? `background:linear-gradient(135deg, ${u.avatar_color}, ${shade(u.avatar_color, -25)});`
          : '';
        const letter = escapeHtml((u.username || '?').slice(0, 1).toUpperCase());
        return `<div class="plus-result">
          <div class="avatar sm" style="${bg}">${letter}</div>
          <div class="plus-result-name">${escapeHtml(u.username)}</div>
          <button class="plus-result-btn" data-act="add" data-uid="${u.id}" data-name="${escapeHtml(u.username)}">加好友</button>
          <button class="plus-result-btn" data-act="chat" data-uid="${u.id}" data-name="${escapeHtml(u.username)}">发消息</button>
        </div>`;
      }).join('');
    } catch (err) {
      results.innerHTML = `<div class="plus-empty">搜索失败：${escapeHtml(err.message || '')}</div>`;
    }
  }

  // Open a 1:1 chat with a user. openChat() already switches the current
  // conversation, expands the chat pane on mobile, loads the messages and
  // refreshes the sidebar — exactly what this needs.
  async function openDirectChat(userId, name) {
    await openChat('user', userId, name || '', false);
  }

  // ---- Wipe every message in the current group (Jack only) ----
  // Bound once at document level. It used to live inside bindAppEvents(),
  // so any earlier throw in that long function left the trash button dead.
  let _wipeBound = false;
  function ensureWipeBound() {
    if (_wipeBound) return;
    _wipeBound = true;
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('#chat-admin-wipe');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      console.log('[VVeChat] wipe clicked');
      if (!state.currentChat || state.currentChat.type !== 'group') {
        toast('请先打开一个群聊');
        return;
      }
      if (!isJack()) { toast('只有 Jack 可以使用该功能'); return; }
      const chatName = state.currentChat.title || '当前群聊';
      const ok = await askConfirm({
        title: '清空群内所有消息',
        message: '确定要删除「' + chatName + '」内的全部消息吗？此操作不可恢复。',
        okText: '全部删除',
      });
      if (!ok) return;
      const gid = state.currentChat.id;
      try {
        btn.disabled = true;
        const r = await jackWipeGroup(gid);
        state.messagesByConv[convKey('group', gid)] = [];
        renderMessages();
        refreshConversations();
        toast('已删除 ' + (r.deleted != null ? r.deleted : (r.matched || 0)) + ' 条消息');
      } catch (e) {
        toast(e.message || '删除失败');
      } finally {
        btn.disabled = false;
      }
    }, true);
  }

  // ---- Friend request accept / reject (delegated) ----
  let _bellBound = false;
  function ensureBellBound() {
    if (_bellBound) return;
    _bellBound = true;
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('#bell-list button[data-act]');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      const id = Number(btn.dataset.id);
      const accept = btn.dataset.act === 'accept';
      if (!id) return;
      btn.disabled = true;
      try {
        await api('/friend/respond', { method: 'POST', body: { requestId: id, accept } });
        state.requests = state.requests.filter(r => r.id !== id);
        renderBell();
        if (accept) { await refreshFriends(); await refreshConversations(); renderAll(); toast('已添加好友'); }
        else toast('已拒绝');
      } catch (err) {
        toast(err.message || '操作失败');
        btn.disabled = false;
      }
    }, true);
  }

  // ---- Tap any user avatar -> profile (with + 加好友 when not friends) ----
  // One delegated listener so it works in the sidebar, the contacts list and
  // the chat header, and cannot be lost to an unrelated bind error.
  let _avatarBound = false;
  function ensureAvatarBound() {
    if (_avatarBound) return;
    _avatarBound = true;
    document.addEventListener('click', (e) => {
      const av = e.target.closest('[data-peer]');
      if (!av) return;
      // Already handled by a more specific handler (message rows etc).
      if (e.defaultPrevented) return;
      const raw = av.dataset.peer;
      if (!raw) return;                       // group avatar: nothing to add
      const uid = Number(raw);
      if (!Number.isFinite(uid) || uid === state.user?.id) return;
      e.preventDefault(); e.stopPropagation();
      openUserProfileById(uid);
    }, true);
  }

  function logout() {
    state.user=null; state.token=null; state.conversations=[]; state.friends=[]; state.groups=[]; state.requests=[];
    state.currentChat=null; state.messagesByConv={}; state.online.clear();
    localStorage.removeItem('vve:token'); localStorage.removeItem('vve:user');
    if (state.socket) { try { state.socket.disconnect(); } catch (_) {} }
    showAuth();
    showSplashAgain();   // bring back the big-Hello splash on logout
  }
  function tryRestore() {
    const t = localStorage.getItem('vve:token');
    const u = localStorage.getItem('vve:user');
    if (t && u) {
      try {
        state.token = t; state.user = JSON.parse(u);
        applyBoot550cFromUser(state.user).catch(() => {});
        enterApp();
        // Pull the account-level flag so the setting follows the user
        // to other devices.  Failure here is harmless — the local
        // value already decided this session's boot animation.
        api('/me').then(r => {
          if (r && r.user) {
            applyBoot550cFromUser(r.user).catch(() => {});
            state.user = r.user;
            try { localStorage.setItem('vve:user', JSON.stringify(state.user)); } catch (_) {}
          }
        }).catch(() => {});
      } catch (e) { showAuth(); }
    }
    else showAuth();
  }

  // ---------- bind events ----------
  // ---------- idempotent event binding ----------
  // enterApp() can run more than once (sign in → sign out → sign in
  // again), and every plain addEventListener() stacked another copy of
  // the handler onto the same element.  For the composer that was
  // fatal: one press of 发送 ran the submit handler once per stacked
  // copy, so the same message went out two, then four times.
  //
  // `bindOnce()` keeps exactly one handler per (element, type) and replaces
  // the previous one instead of stacking.  Elements that are created
  // later still get bound the next time bindAppEvents() runs, because
  // the bookkeeping is per element — not a global "already bound" flag.
  const _boundHandlers = new WeakMap();
  function bindOnce(el, type, handler, opts, key) {
    if (!el || typeof el.addEventListener !== 'function') return;
    let map = _boundHandlers.get(el);
    if (!map) { map = Object.create(null); _boundHandlers.set(el, map); }
    // `key` separates several unrelated handlers that share one element and
    // one event type — document carries three click delegations that all
    // have to live side by side, each one still bound exactly once.
    const k = key ? type + ':' + key : type;
    const prev = map[k];
    if (prev) {
      try { el.removeEventListener(type, prev.handler, prev.opts); } catch (_) {}
    }
    el.addEventListener(type, handler, opts);
    map[k] = { handler, opts };
  }

  function bindAppEvents() {
    // theme toggle (light / dark / system)
    const tt = $('#btn-theme-toggle');
    if (tt) bindOnce(tt, 'click', () => {
      const current = localStorage.getItem('vve:theme') || 'auto';
      const next = current === 'light' ? 'dark' : current === 'dark' ? 'auto' : 'light';
      applyTheme(next);
      try { localStorage.setItem('vve:theme', next); } catch (_) {}
      if (window.toast) toast(next === 'auto' ? '跟随系统' : next === 'dark' ? '已切换到深色' : '已切换到浅色');
    });

    // language toggle button in main app topbar
    $$('#lang-btn-top').forEach(b => bindOnce(b, 'click', (e) => { e.stopPropagation(); setLang(lang === 'zh' ? 'en' : 'zh'); }));

    // 「更多」面板：550C 启动动画主题开关
    const t550 = $('#toggle-boot-550c');
    if (t550) {
      t550.checked = boot550cOn();
      bindOnce(t550, 'change', async () => {
        const isOn = t550.checked;
        window.Boot550C.setEnabled(isOn);
        applyTheme(currentThemeMode());
        if (window.toast) toast(isOn ? '已开启 550C 启动动画主题' : '已关闭 550C 启动动画主题');
        saveBoot550cToServer(isOn);
        // Turning it on is a demo — play the boot right here so the
        // user sees what they just turned on.
        if (isOn && window.Boot550C) {
          setTimeout(() => { try { window.Boot550C.play(); } catch (_) {} }, 260);
        }
      });
    }
    // 助手在群里应答的开关
    const tAi = $('#toggle-ai-in-groups');
    if (tAi) {
      tAi.checked = !!prefs.ai_in_groups;
      bindOnce(tAi, 'change', () => {
        savePrefs({ ai_in_groups: tAi.checked ? 1 : 0 });
        toast(tAi.checked ? '群里 @Qwen 会有人应答' : '群里不会再呼叫助手');
      });
    }
    // 分段选择器：密度 / 字号 / 时钟 / 语言
    const segs = [
      ['#pref-density', (v) => savePrefs({ density: v })],
      ['#pref-font', (v) => savePrefs({ font_scale: Number(v) })],
      ['#pref-clock', (v) => savePrefs({ clock24: v === '24' ? 1 : 0 })],
      ['#pref-lang', (v) => setLang(v)]
    ];
    for (const [sel, fn] of segs) {
      const box = $(sel);
      if (!box) continue;
      $$('button', box).forEach((b) => bindOnce(b, 'click', () => {
        fn(b.dataset.v);
        renderPrefPanel();
      }));
    }
    renderPrefPanel();

    // The rail: 聊天 / Qwen / 更多. It picks the list in the middle
    // pane AND the detail in the content pane.
    $$('.side-nav-item').forEach(btn => bindOnce(btn, 'click', () => {
      $$('.side-nav-item').forEach(b => b.classList.toggle('active', b === btn));
      const target = btn.dataset.pane;
      $$('.pane').forEach(p => p.classList.toggle('active', p.id === `pane-${target}`));
      setListMode(target);
      // Discover is a list of groups other people made — pull it fresh.
      if (target === 'discover') refreshRecommended();
      // Switching blocks means "go back to a list". On a phone the
      // chat view had hidden both the list and the tab bar, so without
      // clearing `chat-open` the user would land on an empty screen
      // with no way out.
      $('.app-body')?.classList.remove('chat-open');
      closeListPane();
      if (target === 'ai') openAiView();
      else closeAiView();
    }));
    // The Personalisation panel also carries a Discover entry.
    const prefDiscover = $('#pref-discover-row');
    if (prefDiscover) {
      const go = () => {
        $$('.side-nav-item').forEach(b => b.classList.toggle('active', b.dataset.pane === 'discover'));
        $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-discover'));
        setListMode('discover');
        $('.app-body')?.classList.remove('chat-open');
        closeListPane();
        refreshRecommended();
      };
      bindOnce(prefDiscover, 'click', go);
      bindOnce(prefDiscover, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    }

    // Discover: create a group. The switch in the dialog decides whether
    // the group is listed in Discover — the owner can flip it later.
    bindOnce($('#btn-create-group'), 'click', (e) => {
      e.stopPropagation();
      const name = $('#cg-name');
      if (name) { name.value = ''; name.focus(); }
      openModal('modal-create-group');
    });
    bindOnce($('#create-group-form'), 'submit', async (e) => {
      e.preventDefault();
      const name = ($('#cg-name')?.value || '').trim();
      if (!name) { toast(lang === 'en' ? 'Give the group a name' : '给群起个名字'); return; }
      const recommended = !!$('#cg-recommend')?.checked;
      try {
        const r = await api('/groups', { method: 'POST', body: { name, recommended } });
        closeModal('modal-create-group');
        toast(lang === 'en' ? 'Group created' : '群建好了');
        await refreshGroups();
        refreshRecommended();
        if (r && r.group) {
          state.currentChat = { type: 'group', id: r.group.id, title: r.group.name, isOfficial: 0 };
          openChat('group', r.group.id, r.group.name, 0);
        }
      } catch (err) { toast(err.message); }
    });

    // The hint above the composer: tapping it calls the assistant by
    // name. It only makes sense inside a group.
    bindOnce($('#qwen-hint'), 'click', () => {
      const input = $('#chat-input');
      if (!input) return;
      input.focus();
      const pos = input.value.length;
      input.value = input.value.slice(0, pos) + '@Qwen ';
      input.setSelectionRange(pos + 6, pos + 6);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // The chat header carries the same list switch as the AI header —
    // and so does the empty state, which has no header at all.
    bindOnce($('#list-toggle'), 'click', (e) => { e.stopPropagation(); toggleListPane(); });
    bindOnce($('#list-toggle-empty'), 'click', (e) => { e.stopPropagation(); toggleListPane(); });
    // Tapping the empty area closes the list drawer — on a phone that is
    // the only way back that does not involve the little arrow.
    bindOnce($('#list-scrim'), 'click', () => closeListPane());
    // NOTE: the handler is wrapped in a thunk on purpose. `#btn-create-board`
    // is not in the markup and `openCreateBoard` is not defined any more, so
    // passing the bare identifier would evaluate it (and throw) even when
    // the button is absent — which is exactly how a stray ReferenceError
    // once aborted the rest of this function and silently killed every
    // later binding, the composer included.
    const createBoardBtn = $('#btn-create-board');
    if (createBoardBtn) bindOnce(createBoardBtn, 'click', () => openCreateBoard());

    initSearch();

    // lang toggle
    $$('.lang-toggle').forEach(b => bindOnce(b, 'click', () => setLang(lang === 'zh' ? 'en' : 'zh')));

    // safety net: event delegation on topbar-right for all icon-btns
    // (handles the case where direct addEventListener somehow misses — e.g. on older WebKit)
    bindOnce($('.topbar-right'), 'click', (e) => {
      const btn = e.target.closest('button.icon-btn');
      if (!btn) return;
      if (btn._handled) return;     // already handled by direct listener
      // dispatch fallback
      if (btn.id === 'btn-profile') openProfileModal(state.user);
      else if (btn.id === 'btn-bell') { renderBell(); openModal('modal-bell'); }
      else if (btn.id === 'btn-plus') openModal('modal-plus');
      else if (btn.id === 'btn-lang') { /* has its own listener — do not toggle twice */ }
      else if (btn.id === 'btn-logout') logout();
      else if (btn.id === 'btn-admin') {};  // (deprecated) Jack-only mode: no topbar admin button
    }, true);

    // chat header
    bindOnce($('#chat-back'), 'click', () => {
      state.currentChat = null;
      $('#chat-window').classList.add('hidden');
      $('#chat-empty').classList.remove('hidden');
      if (window.innerWidth <= 820) {
        $('.app-body')?.classList.remove('chat-open');
        $('#chat-back')?.classList.remove('mobile-show');
        $('.right-pane')?.classList.remove('mobile-show');
      }
      renderChats();
    });
    bindOnce($('#chat-refresh'), 'click', async () => {
      if (!state.currentChat) return;
      const btn = $('#chat-refresh');
      btn.style.transform = 'rotate(360deg)';
      btn.style.transition = 'transform 0.5s';
      await loadMessages(); renderMessages(); scrollBottom();
      setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
    });
    bindOnce($('#chat-info'), 'click', async () => {
      if (!state.currentChat) return;
      if (state.currentChat.type !== 'group') {
        const f = state.friends.find(f => f.id === state.currentChat.id);
        if (f) openProfileModal(f);
        return;
      }
      openGroupInfoModal();
    });

    // composer
    bindOnce($('#chat-composer'), 'submit', (e) => {
      e.preventDefault();
      // The composer keeps the text in the box until the server confirms
      // it, so a second submit while the first is still in flight would
      // post the very same text again.  The send button is disabled for
      // exactly that window — honour it here too, otherwise a double tap
      // (or an Enter keypress) still slips a duplicate through.
      const sendBtn = $('#send-btn');
      if (sendBtn && sendBtn.disabled) return;
      if (state.pendingImage) {
        const img = state.pendingImage;
        state.pendingImage = null;
        $('#chat-input').value = '';
        sendMessage(img, { type: 'image' });
        return;
      }
      const input = $('#chat-input');
      const v = input.value.trim();
      if (!v) return;
      // Keep the text in the box until the server confirms it, so a failed
      // send never loses the user's message.
      sendMessage(v, {}, input);
    });

    // The send button is type=submit, but iOS Safari sometimes swallows the
    // implicit form submission when the keyboard's return key is used. Wire an
    // explicit click handler as a belt-and-braces fallback.
    bindOnce($('#send-btn'), 'click', (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      $('#chat-composer')?.requestSubmit
        ? $('#chat-composer').requestSubmit()
        : $('#chat-composer')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    // Enter sends, Shift+Enter inserts a newline.
    bindOnce($('#chat-input'), 'keydown', (e) => {
      // While the @ picker is open the arrow keys drive it and Enter
      // picks a member instead of sending the message.
      if (mentionState.open) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveMentionSelection(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveMentionSelection(-1); return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          applyMention(mentionState.items[mentionState.index]);
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); hideMentionMenu(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $('#chat-composer')?.requestSubmit
          ? $('#chat-composer').requestSubmit()
          : $('#chat-composer')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
    // Typing "@" in a group chat pulls up the member list.
    bindOnce($('#chat-input'), 'input', () => {
      const el = $('#chat-input');
      const q = detectMentionQuery();
      if (q) { showMentionMenu(q); return; }
      hideMentionMenu();
      // A hand-typed "@name" lights the strip up as well — the strip must
      // tell the truth no matter how the mention got into the box.
      const members = currentGroupMembers();
      const tokens = mentionTokens(el ? el.value : '');
      let found = null;
      for (const tk of tokens) {
        const hit = members.find(x => String(x.username) === tk);
        if (hit) { found = hit; break; }
      }
      if (found) { state.mentionTarget = found; updateMentionPreview(); }
      else if (state.mentionTarget && !inputHasMention(state.mentionTarget.username)) clearMentionTarget();
    });
    // Clicking away from the picker closes it — but NOT when the click
    // was on the @ button: that click is what OPENED the picker.
    bindOnce(document, 'click', (e) => {
      if (!e.target.closest('#mention-menu') && !e.target.closest('#mention-btn')) hideMentionMenu();
    }, undefined, 'mention-close');
    bindOnce($('#mention-preview-cancel'), 'click', () => { removeMentionFromInput(); $('#chat-input')?.focus(); });
    // The @ button next to the picture button: opens the same picker.
    bindOnce($('#mention-btn'), 'click', (e) => {
      e.stopPropagation();
      const c = state.currentChat;
      if (!c || c.type !== 'group') { toast('只有群聊才能 @ 人'); return; }
      const input = $('#chat-input');
      if (!input) return;
      input.focus();
      // If the caret is already sitting in an "@something", the picker is
      // what the user wants — don't type a second "@".
      const q = detectMentionQuery();
      if (q) { showMentionMenu(q); return; }
      // Drop an "@" at the caret and let the normal input handler pick it
      // up — one code path for typing "@" and for pressing the button.
      const pos = input.selectionStart == null ? input.value.length : input.selectionStart;
      input.value = input.value.slice(0, pos) + '@' + input.value.slice(pos);
      input.setSelectionRange(pos + 1, pos + 1);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
    bindOnce($('#reply-preview-cancel'), 'click', () => { state.pendingReply = null; $('#reply-preview').classList.add('hidden'); });
    bindOnce($('#img-preview-cancel'), 'click', () => { state.pendingImage = null; $('#img-preview').classList.add('hidden'); });
    bindOnce($('#chat-input'), 'paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const blob = it.getAsFile();
          if (blob) { e.preventDefault(); handleImageFile(blob); return; }
        }
      }
    });
    bindOnce($('#attach-btn'), 'click', () => $('#img-input').click());
    bindOnce($('#img-input'), 'change', (e) => { const f = e.target.files[0]; if (f) handleImageFile(f); e.target.value = ''; });

    // emoji picker (simplified)
    const EMOJIS = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗','😙','😚','🙂','🤗','🤩','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇','🥳','🥺','🤠','🤡','🤥','🤫','🤭','🧐','🤓','👍','👎','👌','✌️','🤞','🤟','🤘','👏','🙌','🙏','💪','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','🔥','✨','🎉','🎊','💯','💢','💥','💫','💦','💨'];
    bindOnce($('#emoji-btn'), 'click', (e) => {
      e.stopPropagation();
      const p = $('#emoji-picker');
      if (p.classList.contains('hidden')) {
        p.innerHTML = `<div class="emoji-grid" style="grid-template-columns:repeat(8,1fr);">${EMOJIS.map(em => `<button class="emoji-cell" data-em="${em}">${em}</button>`).join('')}</div>`;
        p.classList.remove('hidden');
        p.onclick = (ev) => {
          const c = ev.target.closest('.emoji-cell');
          if (c) { const i = $('#chat-input'); i.value += c.dataset.em; i.focus(); }
        };
      } else { p.classList.add('hidden'); }
    });
    bindOnce(document, 'click', (e) => { if (!e.target.closest('#emoji-picker') && !e.target.closest('#emoji-btn')) $('#emoji-picker')?.classList.add('hidden'); }, undefined, 'emoji-close');

    // profile
    bindOnce($('#btn-profile'), 'click', (e) => { e.currentTarget._handled = true; openProfileModal(state.user); });

    // logout
    bindOnce($('#btn-logout'), 'click', (e) => { e.currentTarget._handled = true; logout(); });

    // NOTE: the old `initRootConsole()` call was removed here. The root
    // console feature was deleted from the UI, but the call stayed behind
    // and threw `ReferenceError: initRootConsole is not defined` at runtime.
    // Because it sat in the MIDDLE of bindAppEvents(), the throw aborted
    // every binding that came after it — including the document-level
    // fallbacks below. That is why topbar buttons and message actions
    // stopped responding.

    // admin (deprecated old key system) — Jack-only mode uses regular auth
    // admin wipe button in chat header (Jack only)
    // (wipe-group is bound separately via ensureWipeBound — see below)

    // ULTIMATE FALLBACK: document-level click delegation by data-action.
    // If anything above somehow missed, this still works.
    bindOnce(document, 'click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const act = t.dataset.action;
      if (act === 'open-admin') { /* deprecated */ e.preventDefault(); }
    }, undefined, 'data-action');

    // plus menu (magnifier)
    bindOnce($('#btn-plus'), 'click', (e) => { e.currentTarget._handled = true; openModal('modal-plus'); });
    // NOTE: handled by a single delegated listener (see ensurePlusActionsBound)
    // instead of per-element binding — enterApp() can run more than once and
    // duplicated handlers made these buttons fire twice / get swallowed.

    // bell
    bindOnce($('#btn-bell'), 'click', (e) => { e.currentTarget._handled = true; renderBell(); openModal('modal-bell'); });
    // The language toggle. It shows the language you would switch TO,
    // so the label reads as an action rather than as a state.
    bindOnce($('#btn-lang'), 'click', (e) => {
      e.currentTarget._handled = true;
      setLang(lang === 'en' ? 'zh' : 'en');
      toast(lang === 'en' ? '已切换到 English' : '已切换到中文');
    });

    // add friend form
    bindOnce($('#form-add-friend'), 'submit', async (e) => {
      e.preventDefault();
      const username = $('#add-friend-username').value.trim();
      const msg = $('#add-friend-msg'); msg.classList.remove('ok'); msg.textContent = '';
      if (!username) { msg.textContent = t('err_username_required'); return; }
      try {
        const r = await api('/friend/request', { method: 'POST', body: { toUsername: username } });
        msg.classList.add('ok');
        msg.textContent = r.autoAccepted ? t('ok_auto_friend') : t('ok_request_sent');
        if (r.autoAccepted) { await refreshFriends(); await refreshConversations(); renderAll(); setTimeout(() => closeModal('modal-add-friend'), 900); }
        else setTimeout(() => closeModal('modal-add-friend'), 1500);
      } catch (err) { msg.textContent = err.message; }
    });

    // modal close
    $$('[data-close]').forEach(el => bindOnce(el, 'click', (e) => { e.stopPropagation(); closeModal(el.dataset.close); }));
    $$('.modal-mask').forEach(el => bindOnce(el, 'click', (e) => { if (e.target === el) closeModal(el.parentElement?.id || el.closest('.modal')?.id); }));
    bindOnce(document, 'keydown', (e) => { if (e.key === 'Escape') { $$('.modal:not(.hidden)').forEach(m => closeModal(m.id)); $('#emoji-picker')?.classList.add('hidden'); } });
    // ULTIMATE FALLBACK: document-level delegation. If anything above
    // somehow missed (timing, duplicate listeners, etc.), this still works.
    bindOnce(document, 'click', (e) => {
      const closeEl = e.target.closest('[data-close]');
      if (closeEl && closeEl.dataset.close) {
        e.stopPropagation();
        closeModal(closeEl.dataset.close);
        return;
      }
      // Also close on backdrop tap (target is exactly the .modal-mask)
      if (e.target.classList && e.target.classList.contains('modal-mask')) {
        const modal = e.target.closest('.modal');
        if (modal) closeModal(modal.id);
      }
    }, true /* capture so we run before any other handler can swallow it */, 'modal-close');
  }

  // ---------- init ----------
  function init() {
    try {
      setLang(lang);
      switchAuthTab('login');
      initSplash();         // show full-screen Hello before auth (skipped if logged in)
      startHelloCycler();   // animate the auth tagline across languages
      $$('.lang-toggle, .lang-btn').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); setLang(lang === 'zh' ? 'en' : 'zh'); }));
      $$('.auth-card .tab').forEach(t => t.addEventListener('click', () => switchAuthTab(t.dataset.tab)));
      $('#auth-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = $('#auth-username').value.trim();
        const password = $('#auth-password').value;
        const msgEl = $('#auth-msg');
        msgEl.classList.remove('ok'); msgEl.textContent = '';
        if (!username || !password) { msgEl.textContent = t('auth_err_fill'); return; }
        const btn = $('#auth-submit');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = authMode === 'login' ? t('auth_loading_login') : t('auth_loading_register');
        try {
          const data = await api(authMode === 'login' ? '/login' : '/register', { method: 'POST', body: { username, password } });
          state.user = data.user; state.token = data.token;
          localStorage.setItem('vve:token', state.token);
          localStorage.setItem('vve:user', JSON.stringify(state.user));
          // The account owns the 550C flag — adopt it on sign-in so the
          // next visit boots the animation the way this account wants.
          await applyBoot550cFromUser(data.user);
          loadPrefs(data.user);
          msgEl.classList.add('ok');
          msgEl.textContent = authMode === 'login' ? t('auth_ok_login') : t('auth_ok_register');
          btn.textContent = '✓';
          // 550C — signing in IS "entering the account" again, and the
          // whole point of the theme is the boot sequence. Play it once
          // more on the way in, then drop the user into the app.
          setTimeout(async () => {
            if (boot550cOn() && window.Boot550C) {
              try { await window.Boot550C.play(); } catch (_) {}
            }
            enterApp();
          }, 300);
        } catch (err) {
          msgEl.textContent = err.message;
          btn.textContent = orig;
        } finally { btn.disabled = false; }
      });
      tryRestore();
    } catch (e) {
      console.error('VVeChat init error:', e);
      document.body.innerHTML = `<pre style="color:red;padding:20px;white-space:pre-wrap;">Init error:\n${e.stack || e.message}</pre>`;
    }
  }

  // ============================================================
  // Hello cycler — cycles "Hello" in different languages
  // like Apple's "Hello" boot screen
  // ============================================================
  const HELLOS = [
    { lang: 'zh', text: '你好' },
    { lang: 'en', text: 'Hello' },
    { lang: 'ja', text: 'こんにちは' },
    { lang: 'ko', text: '안녕하세요' },
    { lang: 'fr', text: 'Bonjour' },
    { lang: 'es', text: 'Hola' },
    { lang: 'de', text: 'Hallo' },
    { lang: 'it', text: 'Ciao' },
    { lang: 'pt', text: 'Olá' },
    { lang: 'ru', text: 'Привет' },
    { lang: 'ar', text: 'مرحبا' },
    { lang: 'hi', text: 'नमस्ते' },
    { lang: 'th', text: 'สวัสดี' },
    { lang: 'vi', text: 'Xin chào' },
  ];
  function startHelloCycler() {
    const el = $('#hello-cycler');
    if (el) { runCycler(el, 2200); }
    const big = $('#hello-splash-cycler');
    if (big) { runCycler(big, 2200); }
  }
  function runCycler(el, interval) {
    let idx = 0;
    const show = () => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      setTimeout(() => {
        el.textContent = HELLOS[idx % HELLOS.length].text;
        el.style.transition = 'opacity 0.6s, transform 0.6s';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        idx++;
      }, 250);
    };
    show();
    setInterval(show, interval);
  }

  // ============================================================
  // Hello splash — full-screen greeting shown on first visit /
  // after logout. Click anywhere to dismiss and reveal auth.
  // ============================================================
  let splashDismissed = false;
  function initSplash() {
    const splash = $('#hello-splash');
    if (!splash) return;
    let hasSession = false;
    try {
      hasSession = !!(localStorage.getItem('vve:token') && localStorage.getItem('vve:user'));
    } catch (_) {}

    // 550C theme — the boot animation replaces the Hello splash entirely.
    // It plays on top of the login screen / restored session and fades
    // out on its own, so the user lands straight in the app.
    if (boot550cOn() && window.Boot550C) {
      splash.classList.add('hidden');
      splash.style.display = 'none';
      splash.style.pointerEvents = 'none';
      splashDismissed = true;
      window.Boot550C.play();
      return;
    }

    // If user is already restored (has token), skip the splash.
    if (hasSession) { splash.classList.add('hidden'); splashDismissed = true; return; }
    const dismiss = () => {
      if (splashDismissed) return;
      splashDismissed = true;
      splash.classList.add('hello-splash-out');
      setTimeout(() => splash.remove(), 500);
    };
    splash.addEventListener('click', dismiss);
    splash.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') dismiss(); });
    splash.focus();
  }
  function showSplashAgain() {
    // Called on logout — re-create the splash overlay
    splashDismissed = false;
    // 550C theme — play the boot animation instead of the Hello splash.
    if (boot550cOn() && window.Boot550C) {
      const old = $('#hello-splash');
      if (old) old.remove();
      window.Boot550C.play();
      return;
    }
    let splash = $('#hello-splash');
    if (splash) return; // already there
    splash = document.createElement('div');
    splash.id = 'hello-splash';
    splash.className = 'hello-splash';
    splash.setAttribute('role', 'button');
    splash.setAttribute('tabindex', '0');
    splash.innerHTML = `<div class="hello-splash-inner">
      <p id="hello-splash-cycler" class="hello-splash-text">${HELLOS[0].text}</p>
      <p class="hello-splash-hint">${lang === 'zh' ? '（点击任意一处开始使用）' : '(Tap anywhere to start)'}</p>
    </div>`;
    document.body.insertBefore(splash, document.body.firstChild);
    initSplash();
    if (!$('#hello-splash-cycler').dataset.cycling) {
      $('#hello-splash-cycler').dataset.cycling = '1';
      runCycler($('#hello-splash-cycler'), 2200);
    }
  }

  // ============================================================
  // start
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
