# VVeChat OS 1.0.0

单服务实时聊天：Express + Socket.io + SQLite，前端与 API 同源。

```
server.js            Express + Socket.io + better-sqlite3 + JWT（API + 静态托管）
keepalive.js         独立保活程序（server.js 内也有一份）
frontend/            主界面
  index.html  style.css  app.js  assets/
control/             管理控制台（/control）
  index.html  style.css  app.js  config.js
```

## 部署（Render）

| 字段 | 值 |
|---|---|
| Root Directory | *(留空)* |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Instance Type | Free |

### 环境变量

| Key | Value | 说明 |
|---|---|---|
| `NODE_VERSION` | `18` | better-sqlite3 11.x 只有 Node 18 有预编译包 |
| `DB_FILE` | `/var/data/vvechat.db` | **挂持久磁盘后填**，否则每次重启数据清空 |
| `KEEPALIVE_INTERVAL_MS` | `300000` | 保活间隔（默认 5 分钟） |
| `KEEPALIVE` | `0` | 设为 0 可关闭保活 |
| `ALLOW_ORIGIN` | *(留空)* | 仅开发时放开跨域 |

### 持久磁盘（重要）

Render → Service → **Disk** → Create Disk
- Name: `vvechat-data`
- Mount Path: `/var/data`
- Size: `1 GB`

不挂磁盘 = 免费实例每次重启都丢数据。

## 控制台

同服务访问：`https://vvechat.onrender.com/control`

独立域名：在 Render 新建 Static Site，Root Directory 填 `control`，
Build Command 留空，Publish Directory 填 `.`，域名设为 `vvechat-control`。

登录 `Jack` / `Zhr121005`（仅管理员）。

- **所有用户** — 每个账号旁有红色「注销」，永久删除该账号及其全部消息
- **好友对话** — 列出每段单聊及其中全部消息内容
- **⚠️ 格式化一切信息** — 恢复到初始状态，除基本功能和管理员 Jack 外全部清空

## 权限模型

| 操作 | 谁可以 |
|---|---|
| 加入官方群 | 所有人（注册时自动加入）|
| 建群 / 解散 / 改名 / 拉人 | **已移除** —— 系统只存在一个官方群 |
| 发起好友申请 | 所有人 |
| 删除好友 | 好友本人 |
| 清空群消息 | 仅 Jack |
| 注销账号 / 格式化 | 仅 Jack |

## 功能

- 实时单聊（Socket.io）+ 官方群
- 好友申请 / 接受 / 拒绝
- 点任意头像查看资料并加好友
- 消息撤回（2 分钟内，Jack 不限）
- 图片消息（原比例，无气泡框）
- 「对方正在输入中…」
- 撤回/转发/引用/复制 消息操作栏
- 群内一键清空（Jack）
- 删除好友（连带清除双方私聊记录）
- 保活：每 5 分钟 ping 公网地址，避免免费实例休眠
- 防火墙：CSP 安全头 + 跨域收紧 + 按 IP 限流（仅统计失败登录）
