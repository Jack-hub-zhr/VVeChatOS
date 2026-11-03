// 删掉线上所有「一条消息都没有」的 AI 对话(截图工具打开助手面板时自动建的)
const https = require('https');
function call(method, p, body, token) {
  return new Promise((res) => {
    const d = body ? JSON.stringify(body) : null;
    const r = https.request('https://vvechat.onrender.com' + p, {
      method, headers: Object.assign({ 'Content-Type': 'application/json' },
        d ? { 'Content-Length': Buffer.byteLength(d) } : {}, token ? { Authorization: 'Bearer ' + token } : {})
    }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => { try { res(JSON.parse(s)); } catch (e) { res({ _raw: s.slice(0, 200) }); } }); });
    r.on('error', e => res({ _error: e.message }));
    if (d) r.write(d);
    r.end();
  });
}
(async () => {
  const tok = (await call('POST', '/api/login', { username: 'Jack', password: 'Zhr121005' })).token;
  const list = (await call('GET', '/api/ai/chats', null, tok)).chats || [];
  console.log('当前 AI 对话:', JSON.stringify(list.map(c => ({ id: c.id, title: c.title, n: c.message_count }))));
  for (const c of list) {
    if (!c.message_count) {
      const r = await call('DELETE', '/api/ai/chats/' + c.id, {}, tok);
      console.log('  ✓ 删掉空对话', c.id, c.title, r.ok ? '' : JSON.stringify(r).slice(0, 80));
    }
  }
  const after = (await call('GET', '/api/ai/chats', null, tok)).chats || [];
  console.log('清理后:', JSON.stringify(after.map(c => c.title)));
})();
