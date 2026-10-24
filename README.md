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

### DeepSeek 中转（免费源）

#### 先说清楚现状（2026-10 实测）

**DeepSeek 官方 API 没有免费额度** —— 官方定价页只有按 token 计费。
所有提供 DeepSeek 的免费层（llm7.io / SiliconFlow / BazaarLink / ModelScope）
都**必须注册 + 邮箱验证**，无法自动开通。

但**完全不需要 key 的公共端点确实存在**，只是它们不提供 DeepSeek：
llm7.io 的免注册层、Pollinations。它们当前在线的模型是
`mistral-Nemo` / `codestral` / `minimax-m2.7` / `gpt-oss-20b`（Pollinations，带思维链）。

所以 `/api/ai/chat` 是一个**多源自动回退**的中转站：

| 优先级 | 源 | 需要密钥 | 提供 DeepSeek | 说明 |
|---|---|---|---|---|
| 1 | llm7.io | ✅ 免费 token | ✅ `deepseek-v4-flash-0731` | 注册后到 token.llm7.io 取 token |
| 2 | SiliconFlow | ✅ 免费 key | ✅ `deepseek-ai/DeepSeek-V3` | 国内延迟低 |
| 3 | BazaarLink | ✅ 免费 key | ⚠️ `auto:free` 可能路由到 | 每天 50 次，不绑卡 |
| 4 | DeepSeek 官方 | ✅ 付费 key | ✅ | 最稳定 |
| 5 | llm7.io 免注册层 | ❌ | ❌ | 兜底，永远可用 |
| 6 | Pollinations | ❌ | ❌ | 最终兜底，带思维链 |

**所以：装完就能用，一行配置都不需要。** 面板顶部会**如实显示当前回答问题的模型名**，
不会拿别的模型冒充 DeepSeek。

#### 想用真正的 DeepSeek？三步

1. **注册拿 key**（任选一家，都免费、不绑卡）：
   - **llm7.io** → 注册 → 打开 <https://token.llm7.io/> → 填邮箱 → 复制 token
   - **SiliconFlow** → <https://cloud.siliconflow.cn> 注册 → 「API Keys」新建
   - **BazaarLink** → <https://bazaarlink.ai> 注册 → 复制 API key
2. 登录 VVeChat，点侧边栏 **DeepSeek** → 点 **「接入 DeepSeek 密钥」**
3. 把 key 粘进去 → 保存 → **立即生效**（存在数据库里，不用改环境变量、不用重新部署）

浏览器端永远拿不到 key，所有请求都从服务端转发（`/api/ai/chat`，NDJSON 流式）。

- 前端回答按 **每字符 0.1 秒** 逐字输出
- 有 `reasoning_content` 时把思考过程单独放进「思考过程」卡片
- 等待首个 token 时显示三个灰点波动 + `Thinking…` 呼吸动画
- `GET /api/ai/status` 查询当前可用源（不泄露 key），`POST /api/ai/config` 保存（仅管理员）

环境变量方式也支持（优先级高于界面配置）：
`RELAY_LLM7_KEY` / `RELAY_SILICONFLOW_KEY` / `RELAY_BAZAAR_KEY` / `DEEPSEEK_API_KEY`。


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
