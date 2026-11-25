#!/usr/bin/env node
/* 把 frontend/ 打成一份自包含的 HTML：CSS、JS、壁纸、socket.io 客户端全内联。
   用法：node tools/build-single-html.js [输出路径]
   产物放在 frontend/vvechat-single.html —— 与后端同源，所以 API 和 websocket 都能直接用。 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const FRONT = path.join(__dirname, '..', 'frontend');
const OUT = process.argv[2] || path.join(FRONT, 'vvechat-single.html');

const read = (p) => fs.readFileSync(path.join(FRONT, p), 'utf8');
const dataUri = (p, mime) =>
  'data:' + mime + ';base64,' + fs.readFileSync(path.join(FRONT, p)).toString('base64');

function getSocketIo(cb) {
  const req = https.get('https://vvechat.onrender.com/socket.io/socket.io.js', (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => cb(d));
  });
  req.on('error', (e) => {
    console.error('拉 socket.io 失败：' + e.message);
    process.exit(1);
  });
}

getSocketIo((socketIo) => {
  let html = read('index.html');

  // CSS：两张壁纸转成 data URI，其余原样内联
  let css = read('style.css') + '\n' + read('glass.css') + '\n' + read('liquid-glass.css');
  for (const name of ['wall-dark.jpg', 'wall-light.jpg']) {
    const uri = dataUri('assets/' + name, 'image/jpeg');
    css = css.split("url('assets/" + name + "')").join("url('" + uri + "')");
    css = css.split('url("assets/' + name + '")').join('url("' + uri + '")');
  }
  if (css.indexOf('assets/') !== -1) {
    console.error('还有没内联的 assets 引用');
    process.exit(1);
  }

  // 朋友圈封面图也要内联 —— 单文件版可能被单独下载分发，
  // 绝对路径 /assets/covers/xxx.jpg 在别的域名下会 404。
  let appJs = read('app.js');
  const coverDir = path.join(FRONT, 'assets', 'covers');
  if (fs.existsSync(coverDir)) {
    for (const f of fs.readdirSync(coverDir)) {
      if (!/\.jpe?g$/i.test(f)) continue;
      const uri = dataUri('assets/covers/' + f, 'image/jpeg');
      appJs = appJs.split('/assets/covers/' + f).join(uri);
    }
  }

  // 替换 index.html 里的外部引用。用正则匹配，版本号怎么 bump 都不会把它搞挂。
  const swap = (re, replacement, label) => {
    if (!re.test(html)) {
      console.error('index.html 里找不到：' + label);
      process.exit(1);
    }
    // 必须用函数形式：socket.io 里有 `` $` `` 这类替换模式，
    // 直接传字符串会被当成「匹配位置之前的全部内容」插进来。
    html = html.replace(re, () => replacement);
  };
  swap(/<link rel="stylesheet" href="style\.css\?v=[^"]*"\s*\/>/, '<style>\n' + css + '\n  </style>', 'style.css');
  swap(/<link rel="stylesheet" href="glass\.css\?v=[^"]*"\s*\/>/, '', 'glass.css');
  swap(/<link rel="stylesheet" href="liquid-glass\.css\?v=[^"]*"\s*\/>/, '', 'liquid-glass.css');
  swap(/<script src="\/socket\.io\/socket\.io\.js"><\/script>/, '<script>' + socketIo + '</script>', 'socket.io');
  swap(/<script src="config\.js\?v=[^"]*"><\/script>/, '<script>' + read('config.js') + '</script>', 'config.js');
  swap(/<script src="app\.js\?v=[^"]*"><\/script>/, '<script>\n' + appJs + '\n  </script>', 'app.js');

  fs.writeFileSync(OUT, html);
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log('写好了：' + OUT);
  console.log('  总大小 ' + kb(Buffer.byteLength(html)));
  console.log('  css ' + kb(css.length) + ' / app.js ' + kb(appJs.length) + ' / socket.io ' + kb(socketIo.length));
});
