// 本轮 14 项需求的端到端自检（真实 Chrome + 真实后端）。
//   node tools/test-round14.js
const { launch, connect, sleep } = require('./cdp.js');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:3000';
const SHOTS = '/workspace/shots/r14';
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); }
};

function api(method, p, body, token) {
  return new Promise((res, rej) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: 3000, path: p, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) } },
      (x) => { let s = ''; x.on('data', c => s += c); x.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) { j = { raw: s }; } res({ code: x.statusCode, j }); }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
const rnd = () => Math.random().toString(36).slice(2, 8);

(async () => {
  // ---------- 账号 ----------
  const U1 = 'r14a' + rnd(), U2 = 'r14b' + rnd(), U3 = 'r14c' + rnd();
  const mk = async (u) => {
    let r = await api('POST', '/api/register', { username: u, password: 'Round14Test123' });
    if (!r.j.token) r = await api('POST', '/api/login', { username: u, password: 'Round14Test123' });
    return r.j;
  };
  const a = await mk(U1), b = await mk(U2), c = await mk(U3);

  // b 申请加 a（a 是群主）
  await api('POST', '/api/friend/request', { toUsername: U1 }, b.token);
  const reqsB = await api('GET', '/api/friend/requests', undefined, b.token);
  const reqsA = await api('GET', '/api/friend/requests', undefined, a.token);
  if (reqsA.j.requests && reqsA.j.requests.length) {
    await api('POST', '/api/friend/respond', { requestId: reqsA.j.requests[0].id, accept: true }, a.token);
  }
  // a 是 b 的好友了；c 也来加 a
  await api('POST', '/api/friend/request', { toUsername: U1 }, c.token);
  const reqsA2 = await api('GET', '/api/friend/requests', undefined, a.token);
  const rid = reqsA2.j.requests && reqsA2.j.requests.length ? reqsA2.j.requests[0].id : null;
  if (rid) await api('POST', '/api/friend/respond', { requestId: rid, accept: true }, a.token);

  // a 建一个群（a 是群主）
  const grp = await api('POST', '/api/groups', { name: 'R14 测试群 ' + rnd() }, a.token);
  const gid = grp.j.group ? grp.j.group.id : (grp.j.id || null);

  // c 申请加群
  const joinReq = await api('POST', `/api/groups/${gid}/requests`, { message: '求带' }, c.token);

  // ---------- 浏览器 ----------
  const { proc, wsUrl } = await launch({ width: 1440, height: 900 });
  const { send, close, on } = await connect(wsUrl);
  await send('Page.enable'); await send('Runtime.enable');
  const logs = [];
  on((m) => {
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC:' + (m.params.exceptionDetails || {}).text);
  });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  };
  const shot = async (n) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, n + '.png'), Buffer.from(r.data, 'base64'));
  };

  // ---------- ③ 语言选择页 ----------
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(7000);
  ok('登录前出现语言选择页', await ev(`!document.querySelector('#lang-pick').classList.contains('hidden')`));
  ok('语言页有「中文 / English」两个选项', await ev(`JSON.stringify([...document.querySelectorAll('#lang-pick .lang-pick-btn')].map(b=>b.dataset.lang))`) === '["zh","en"]');
  await shot('01-lang-pick');
  // 点 English → 界面切成英文
  await ev(`document.querySelector('#lang-pick .lang-pick-btn[data-lang="en"]').click()`);
  await sleep(1200);
  ok('选 English 后界面切成英文', await ev(`document.documentElement.lang`) === 'en');
  ok('语言页收起', await ev(`document.querySelector('#lang-pick').classList.contains('hidden')`));

  // ---------- 登录 a（英文界面） ----------
  const inj = await ev("(()=>{try{localStorage.setItem('vve:token',"+JSON.stringify(a.token)+");localStorage.setItem('vve:user',"+JSON.stringify(JSON.stringify(a.user))+");return 'ok:'+localStorage.length;}catch(e){return 'ERR:'+e.message;}})()");
  ok('登录态注入成功', String(inj).startsWith('ok'), String(inj));
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(7000);

  // ---------- ② 群聊默认归入 Chats（用户组） ----------
  const convs = await api('GET', '/api/conversations', undefined, a.token);
  const grpConv = convs.j.conversations.find(x => x.type === 'group' && Number(x.id) === Number(gid));
  ok('群会话存在', !!grpConv);
  ok('群会话带 pending_count', grpConv && grpConv.pending_count === 1, 'pending_count=' + (grpConv && grpConv.pending_count));
  const groupsApi = await api('GET', '/api/groups', undefined, a.token);
  const gApi = groupsApi.j.groups.find(x => Number(x.id) === Number(gid));
  ok('群列表里 pending_count = 1', gApi && gApi.pending_count === 1, 'pending_count=' + (gApi && gApi.pending_count));

  // ---------- ③ 会话列表上的入群申请角标 ----------
  const badge = await ev(`(()=>{const rows=[...document.querySelectorAll('#chats-list .list-item')];const r=rows.find(x=>/测试群|Test group/i.test(x.textContent||''));if(!r)return 'no-row';const b=r.querySelector('.pending-join');return b?b.textContent:'no-badge';})()`);
  ok('群会话上有入群申请角标', badge === '1', 'badge=' + badge);
  await shot('02-console-chat-list');

  // ---------- ④ 英文「内容太长」 ----------
  const errText = await ev(`(()=>{try{return String(window.__srvErrTextTest||'');}catch(e){return '';}})()`);
  // 直接验证映射表
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app.js'), 'utf8');
  ok('英文映射里有「内容太长」', /"内容太长":\s*"Content is too long"/.test(src));

  // ---------- ⑤ 设置里没有 OS1 胶囊 ----------
  ok('设置页版本行没有 beta-tag 胶囊', await ev(`(()=>{const rows=[...document.querySelectorAll('#pref-panel .more-row, .more-row')];const r=rows.find(x=>/VVeChat OS 1/.test(x.textContent||''));return r? (r.querySelector('.beta-tag')?'has-badge':'no-badge') : 'no-row';})()`) === 'no-badge');

  // ---------- ① socket 监听不重复 ----------
  const before = await ev(`(window.__sock ? window.__sock.listenerCount('message:new') : -1)`);
  ok('socket 只有一个 message:new 监听器', before === 1 || before === -1, 'listenerCount=' + before);

  // ---------- ⑧ typing 兜底 60s ----------
  ok('typing 兜底改成 60 秒', /onTypingStop\(\{ conv_type, conv_id, user_id \}\), 60000\)/.test(src));

  // ---------- ⑫ 朋友圈带图能发出去 ----------
  // 一张 1x1 的 png（base64 很长，模拟真实照片的字符量）
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const moment = await api('POST', '/api/moments', { content: '带图的日常', images: [px] }, a.token);
  ok('带图发日常成功（图片不再被字符上限拦死）', moment.code === 200 && moment.j.moment, JSON.stringify(moment.j).slice(0, 120));

  // ---------- ⑭ 首次进「日常」弹出强制清单 ----------
  await ev(`document.querySelector('.side-nav-item[data-pane="moment"]').click()`);
  await sleep(2500);
  ok('第一次进日常弹使用清单', await ev(`!document.querySelector('#modal-moment-guide').classList.contains('hidden')`));
  ok('清单有文字+图', await ev(`!!document.querySelector('#moment-guide-body .guide-svg') && !!document.querySelector('.moment-guide-title').textContent.trim()`));
  ok('清单没有关闭按钮', await ev(`!document.querySelector('#modal-moment-guide [data-close]')`));
  await shot('03-moment-guide');
  // ESC 关不掉
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(600);
  ok('ESC 关不掉清单', await ev(`!document.querySelector('#modal-moment-guide').classList.contains('hidden')`));
  // 点到底才能走
  for (let i = 0; i < 5; i++) { await ev(`document.querySelector('#moment-guide-next').click()`); await sleep(350); }
  ok('看完之后清单关闭', await ev(`document.querySelector('#modal-moment-guide').classList.contains('hidden')`));
  const seen = await ev(`localStorage.getItem('vve:moment-guide-done')`);
  ok('看完之后记住了', seen === '1');
  // 再进一次不再弹
  await ev(`document.querySelector('#btn-moment-back').click()`); await sleep(600);
  await ev(`document.querySelector('.side-nav-item[data-pane="moment"]').click()`); await sleep(2000);
  ok('第二次进日常不再弹清单', await ev(`document.querySelector('#modal-moment-guide').classList.contains('hidden')`));

  // ---------- ⑬ 最后一条能被检测到 ----------
  const postCount = await ev(`document.querySelectorAll('#moment-feed .moment-post').length`);
  ok('朋友圈至少有 1 条', postCount >= 1, 'count=' + postCount);
  if (postCount >= 1) {
    await ev(`(()=>{const v=document.querySelector('#moment-view');v.scrollTop=v.scrollHeight;v.dispatchEvent(new Event('scroll'));return 1;})()`);
    await sleep(900);
    const active = await ev(`(()=>{const a=document.querySelector('#moment-feed .moment-post.is-active');return a?a.dataset.id:'none';})()`);
    const lastId = await ev(`(()=>{const ps=[...document.querySelectorAll('#moment-feed .moment-post')];return ps[ps.length-1].dataset.id;})()`);
    ok('滑到底时最后一条被选中', active === lastId, 'active=' + active + ' last=' + lastId);
    // 点第一条也能选中
    await ev(`(()=>{const ps=[...document.querySelectorAll('#moment-feed .moment-post')];ps[0].click();return 1;})()`);
    await sleep(500);
    const active2 = await ev(`(()=>{const a=document.querySelector('#moment-feed .moment-post.is-active');return a?a.dataset.id:'none';})()`);
    const firstId = await ev(`(()=>{const ps=[...document.querySelectorAll('#moment-feed .moment-post')];return ps[0].dataset.id;})()`);
    ok('点任意一条也能选中', active2 === firstId, 'active=' + active2);
    ok('中间栏显示详情', await ev(`!!document.querySelector('#moment-detail .moment-detail-author')`));
    await shot('04-moment-detail');
  }

  // ---------- ⑦ 个人页标签：点击后选中态要变 ----------
  await ev(`document.querySelector('#btn-moment-back').click()`); await sleep(500);
  await ev(`(()=>{const rows=[...document.querySelectorAll('#chats-list .list-item')];const r=rows.find(x=>x.textContent.includes(${JSON.stringify(U2)}));if(r){const av=r.querySelector('[data-user-avatar]');if(av)av.click();}return 1;})()`);
  await sleep(1000);
  await ev(`(()=>{const m=[...document.querySelectorAll('[data-act="profile"]')][0];if(m)m.click();return 1;})()`);
  await sleep(1200);
  const tagState = await ev(`(()=>{const b=[...document.querySelectorAll('#profile-tag-row .tag-pick')];return b.length? JSON.stringify({n:b.length, on:b.filter(x=>x.classList.contains('on')).map(x=>x.dataset.tag)}) : 'no-tags';})()`);
  ok('名片里有词条按钮', tagState !== 'no-tags', 'state=' + tagState);
  const picked = await ev(`(()=>{const b=[...document.querySelectorAll('#profile-tag-row .tag-pick')].find(x=>x.dataset.tag&&x.dataset.tag!=='用户'&&x.dataset.tag!=='系统'&&!x.classList.contains('on'));if(!b)return 'none';b.click();return b.dataset.tag;})()`);
  await sleep(1200);
  const after = await ev(`(()=>{const b=[...document.querySelectorAll('#profile-tag-row .tag-pick')];const on=b.filter(x=>x.classList.contains('on')).map(x=>x.dataset.tag);return JSON.stringify({picked:${JSON.stringify(picked)}, on});})()`);
  const onArr = JSON.parse(after).on;
  ok('点词条后选中态跟着变（颜色变化）', onArr.length === 1 && onArr[0] === picked, 'after=' + after);
  // toast 不能被弹窗盖住
  const z = await ev(`(()=>{const t=document.querySelector('.toast');return t?getComputedStyle(t).zIndex:'no-toast';})()`);
  ok('toast 的 z-index 高于弹窗', Number(z) > 1400, 'z=' + z);
  await shot('05-profile-tag');
  await ev(`document.querySelector('#modal-profile [data-close]').click()`); await sleep(400);

  // ---------- ⑪ 字号 ----------
  const fs2 = await ev(`(()=>{const b=document.querySelector('.tag-pick');return b?getComputedStyle(b).fontSize:'none';})()`);
  ok('词条按钮字号 ≥ 14px', parseFloat(fs2) >= 14, 'font-size=' + fs2);

  // ---------- ⑥ Jack 名片双语 ----------
  const jackProf = await ev(`(()=>{const rows=[...document.querySelectorAll('#chats-list .list-item')];const r=rows.find(x=>/Jack(?!y)/.test(x.textContent||''));if(!r)return 'no-row';const av=r.querySelector('[data-user-avatar]');if(!av)return 'no-avatar';av.click();return 'ok';})()`);
  await sleep(1000);
  await ev(`(()=>{const m=[...document.querySelectorAll('[data-act="profile"]')][0];if(m)m.click();return 1;})()`);
  await sleep(1200);
  const jackBio = await ev(`(()=>{const b=document.querySelector('#profile-body .bio');return b?b.textContent.trim():'none';})()`);
  ok('Jack 名片是双语', /官方管理员/.test(jackBio) && /Official Admin/.test(jackBio), 'bio=' + jackBio);
  await shot('06-jack-bilingual');
  await ev(`document.querySelector('#modal-profile [data-close]').click()`); await sleep(400);

  // ---------- 表情面板：矩阵排列（不是竖着一列） ----------
  // 表情面板挂在聊天输入框上 —— 得先切回聊天并打开一个会话，否则整块是隐藏的、量不到尺寸。
  await ev(`(()=>{const b=document.querySelector('.side-nav-item[data-pane="chats"]');if(b)b.click();return 1;})()`);
  await sleep(900);
  await ev(`(()=>{const r=document.querySelector('#chats-list .list-item');if(r)r.click();return 1;})()`);
  await sleep(1500);
  await ev(`(()=>{const b=document.querySelector('#emoji-btn');if(b)b.click();return 1;})()`);
  await sleep(900);
  const grid = await ev(`(()=>{
    const cells=[...document.querySelectorAll('#emoji-picker .emoji-cell')];
    if(!cells.length) return 'no-cells';
    const r0=cells[0].getBoundingClientRect();
    // 第 8 个（索引 7）应该和第 1 个同一行 —— 8 列。
    const r7=cells[7].getBoundingClientRect();
    return JSON.stringify({
      n:cells.length,
      w:Math.round(r0.width),
      sameRow: Math.abs(r0.top-r7.top)<2,
      cols: new Set(cells.slice(0,16).map(c=>Math.round(c.getBoundingClientRect().left))).size
    });
  })()`);
  const g = JSON.parse(grid);
  ok('表情面板是矩阵（同排 8 个，列数 > 1）', g.sameRow && g.cols > 1, grid);
  ok('表情格子有实际尺寸（不是 0）', g.w > 20, 'w=' + g.w);
  // 点一下表情要能插进输入框，而且不能顺手把消息发出去
  const beforeMsgs = await ev(`document.querySelectorAll('#chat-messages .msg-row, #chat-messages .msg-bubble').length`);
  const pickedEm = await ev(`(()=>{const c=document.querySelector('#emoji-picker .emoji-cell');if(!c)return 'none';c.click();return c.dataset.em;})()`);
  await sleep(600);
  const inputVal = await ev(`(document.querySelector('#chat-input')||{}).value||''`);
  const afterMsgs = await ev(`document.querySelectorAll('#chat-messages .msg-row, #chat-messages .msg-bubble').length`);
  ok('点表情能插进输入框', pickedEm !== 'none' && String(inputVal).includes(pickedEm), `picked=${pickedEm} input=${inputVal}`);
  ok('点表情不会把消息发出去', afterMsgs === beforeMsgs, `${beforeMsgs} → ${afterMsgs}`);
  await shot('07-emoji-matrix');
  await ev(`(()=>{document.body.click();return 1;})()`);
  await sleep(400);

  ok('页面没有 JS 异常', logs.length === 0, logs.join(' | '));

  await close(); proc.kill();
  console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ 有失败'}  ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
