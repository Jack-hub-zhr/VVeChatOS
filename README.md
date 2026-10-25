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

### Qwen 中转（免费源）

#### 现在跑的是什么

AI 面板接的**全部是通义千问（Qwen）模型**，走多家免费额度自动回退。
浏览器端永远拿不到 key，所有请求都从服务端转发（`/api/ai/chat`，NDJSON 流式）。

| 模型 | 源 | 需要密钥 | 思考 | 搜索 |
|---|---|---|---|---|
| `Qwen3.6 27B` | OVH 公共端点 | ❌ 匿名 | 自带 | 服务端检索 |
| `Qwen3.5 9B` | OVH 公共端点 | ❌ 匿名 | 自带 | 服务端检索 |
| `Qwen3.5 397B-A17B` | OVH 公共端点 | ❌ 匿名 | 自带 | 服务端检索 |
| `Qwen3 8B` | SiliconFlow | ✅ 免费 key | 可开关 | 服务端检索 |
| `Qwen2.5 72B` | SiliconFlow | ✅ 免费 key | — | 服务端检索 |
| `Qwen3.5 27B` / `35B-A3B` | 魔搭 ModelScope | ✅ 免费 token | — | 服务端检索 |
| `Qwen3 32B` | Groq | ✅ 免费 key | — | 服务端检索 |
| `Qwen3 235B` | Cerebras | ✅ 免费 key | — | 服务端检索 |
| `Qwen3 235B` / `Qwen3-Max` | 阿里百炼 | ✅ 免费 key | **分档** | **官方联网** |
| `Qwen-Plus` / `Qwen-Turbo` / `Qwen-Flash` | 阿里百炼 | ✅ 免费 key | — | **官方联网** |

**所以：装完就能用，一行配置都不需要** —— OVH 的公共端点匿名可答。
面板顶部会**如实显示当前回答问题的模型名**，不会拿别的模型冒充。

#### 面板里有什么

模型下拉只列 **OVH 公共端点**的三个 Qwen 模型（免密钥，开箱即用）：

| 模型 | 说明 |
|---|---|
| `Qwen3.6 27B` | 默认，通用均衡 |
| `Qwen3.5 9B` | 最快的一档 |
| `Qwen3.5 397B-A17B` | MoE 大模型 |

工具栏三个开关：

- **深度思考**：OVH 的模型自带思考、无法关闭，按钮常亮并说明原因
- **思考档位**：低 / 中 / 高 —— 只对接受 `thinking_budget` 的模型（百炼 Qwen3）有效
- **搜索**：先联网查资料再回答。百炼走官方 `enable_search`，其余由服务端检索（DDG / Bing 多引擎回退，可另配 Tavily 提升质量）

#### 想换更快的模型？

界面里不再提供密钥输入框，**用环境变量配置**（Render → Service → Environment）：

| Key | 说明 |
|---|---|
| `RELAY_SILICONFLOW_KEY` | SiliconFlow，`Qwen/Qwen3-8B` 永久免费 |
| `RELAY_MODELSCOPE_KEY` | 魔搭 ModelScope 免费推理 |
| `RELAY_GROQ_KEY` | Groq，`qwen3-32b` 极快 |
| `RELAY_CEREBRAS_KEY` | Cerebras，约 2600 tok/s |
| `DASHSCOPE_API_KEY` | 阿里百炼官方（联网搜索 + 思考档位） |
| `TAVILY_API_KEY` | 搜索质量增强（可选） |

拿到 key 的地方：<https://cloud.siliconflow.cn>、<https://modelscope.cn>、
<https://console.groq.com/keys>、<https://cloud.cerebras.ai>、<https://bailian.console.aliyun.com>

密钥也可以由管理员直接调 `POST /api/ai/config`（`{"source":"siliconflow","key":"..."}`）写进数据库，
同样**立即生效，不用重新部署**。

- 前端回答按 **每字符 0.1 秒** 逐字输出
- 上游回传 `reasoning` / `reasoning_content` 时把思考过程单独放进「思考过程」卡片
- 等待首个 token 时显示一行「正在思考…」
- `GET /api/ai/status` 查询模型清单与可用状态（不泄露 key），`POST /api/ai/config` 保存（仅管理员）

环境变量方式也支持（优先级高于界面配置）：
`RELAY_SILICONFLOW_KEY` / `RELAY_MODELSCOPE_KEY` / `RELAY_GROQ_KEY` /
`RELAY_CEREBRAS_KEY` / `DASHSCOPE_API_KEY` / `TAVILY_API_KEY`。


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
