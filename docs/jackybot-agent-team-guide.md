# Jacky Bot API 接入指南 · Agent 团队组建手册

> 适用版本：VVeChat `20261107aj` 及以后
> 线上地址：`https://vvechat.onrender.com`
> 本文所有结论都来自当前仓库源码（`server.js` / `security-core.js` / `frontend/app.js`），
> 并已在生产环境实测验证。

---

## 第 1 章 · Jacky Bot 到底用的是什么模型

### 1.1 对外只有「一个」模型

`GET /api/ai/status` 现在只返回一条：

```json
{ "id": "jacky", "label": "Jacky Bot", "thinking": "budget", "ready": true }
```

**你无法通过 API 指定具体型号** —— 选了也没用，服务端会忽略。这是上一轮需求刻意做的收敛：
不再让用户面对一排 Qwen 型号，底层用哪个引擎是服务端的事。

### 1.2 内部是一条「引擎链」

服务端 `server.js` 里的 `QWEN_MODELS` 定义了全部候选，按「**能深度思考的排前面**」排序，
然后挨个试，**谁先答上算谁的**：

| 顺位 | 模型 id | 实际模型 | 思考 | 需要密钥 |
|---|---|---|---|---|
| 1 | `ovh-qwen3-8-27b` | OVH · Qwen3.8-27B | always | 否 |
| 2 | `ovh-qwen3-6-27b` | OVH · Qwen3.6-27B | always | 否 |
| 3 | `ovh-qwen3-5-9b` | OVH · Qwen3.5-9B | always | 否 |
| 4 | `ovh-qwen3-5-397b` | OVH · Qwen3.5 397B-A17B | always | 否 |
| 5 | `pl-openai-fast` | Pollinations · openai-fast | none | 否 |
| 6 | `sf-qwen3-8b` | SiliconFlow · Qwen3-8B | toggle | 是 |
| 7 | `sf-qwen2-5-72b` | SiliconFlow · Qwen2.5-72B | none | 是 |
| 8 | `ms-qwen3-5-27b` | 魔搭 · Qwen3.5-27B | none | 是 |
| 9 | `ms-qwen3-5-35b` | 魔搭 · Qwen3.5-35B-A3B | none | 是 |
| 10 | `gm-3-8-flash` | Google AI Studio · Gemini 3.8 Flash | none | 是 |
| 11 | `gm-3-6-flash` | Google AI Studio · Gemini 3.6 Flash | none | 是 |
| 12 | `groq-qwen3-8-27b` | Groq · Qwen3.8-27B | none | 是 |
| 13 | `groq-qwen3-32b` | Groq · Qwen3 32B | none | 是 |
| 14 | `cb-qwen3-235b` | Cerebras · Qwen3 235B | none | 是 |
| 15 | `ds-qwen3-235b` | 阿里百炼 · Qwen3-235B | **budget** | 是 |
| 16 | `ds-qwen3-max` | 阿里百炼 · Qwen3-Max | **budget** | 是 |
| 17 | `ds-qwen3-plus` | 阿里百炼 · Qwen-Plus | none | 是 |

**生产环境实测（2026-11）**：免密钥的两个源里，OVH 匿名端点的配额已被 Render 机房 IP 抢光
（返回 429 + `retry-after: 3317393` 秒 ≈ 38 天），所以**实际作答的是**：

```
Pollinations openai-fast
  ↓ 它的模型清单里写着：
  { "name": "openai-fast", "description": "GPT-OSS 20B Reasoning LLM (OVH)", "reasoning": true }
```

> **结论：现在的 Jacky Bot = GPT-OSS 20B Reasoning（经 Pollinations 中转），自带推理能力，
> 但思考预算不可调。**

### 1.3 限速熔断（上一轮刚修的）

服务端给每个源记了一张冷却表：

* 某个源返回 429 → 记它进冷却（最长 30 分钟），**后面的请求直接跳过它**；
* `retry-after > 30` 秒 → 立刻换下一个源，**不等也不重试**（以前是干等 8 秒 × 3 次 × 4 个源 ≈ 70 秒）。

效果：线上一次回复从 **74–76 秒降到 0–6 秒**。对 Agent 团队来说这是生死线 —— 详见第 4 章。

### 1.4 「深度思考 低/中/高」目前是空转的 ⚠️

档位（`level`）**只对 `thinking:'budget'` 的源生效**，全站只有阿里百炼那两个是 `budget`。
现在没有百炼 key → **档位传什么值都不改变任何行为**。

想让档位真的起作用，二选一：

1. **配一个阿里百炼 key**（推荐，唯一能让三档有差别的路径）；
2. 接受现状 —— GPT-OSS 20B 本来就在推理，只是你控制不了它的思考量。

配 key 的入口（**管理员**）：VVeChat → AI 面板 →「接入免费模型密钥」→ 选源 → 填 key。
也可以直接调 `POST /api/ai/config`（见 3.3）。key 存在数据库里，**立即生效，不用重新部署**。

---

## 第 2 章 · 接入方式

### 2.1 认证

```bash
# 注册（lang 决定新用户的界面语言，可选）
curl -X POST https://vvechat.onrender.com/api/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"agent_bot","password":"至少8位密码","lang":"zh"}'
# → {"token":"eyJ...","user":{...}}

# 登录
curl -X POST https://vvechat.onrender.com/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"agent_bot","password":"至少8位密码"}'
```

token 是 JWT，有效期 **30 天**，之后用 `/api/login` 换新的。

所有后续请求都带：

```
Authorization: Bearer <token>
```

> **建议**：给 Agent 团队单独注册一个账号，别用真人账号 —— 控制台会把这个号的对话、朋友圈
> 都算进去，而且你可以在控制台「安全中心」里一键封禁它，出问题好收拾。

### 2.2 主接口：`POST /api/ai/chat`

**它返回的是 NDJSON，不是 SSE。** `Content-Type: application/x-ndjson`，
**每行一个 JSON 对象**，没有 `data: ` 前缀。（这一点最容易踩坑 —— 很多 SSE 库解不了。）

请求体（**只有这 7 个字段被识别，其余一律忽略**）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `message` | string | **必填**，本轮要问的内容。≤ 2000 字符。**不能为空。** |
| `history` | array | 历史轮次 `[{role:'user'\|'assistant', content}]`。**只用最后 8 轮**，每条截到 4000 字符。`history` 不计入正文总量限制。 |
| `model` | string | 填 `"jacky"`（其它值会被忽略）。 |
| `thinking` | bool | 是否深度思考。服务端对支持思考的源**强制开启**，这个参数基本是摆设。 |
| `level` | string | `"low"` / `"medium"` / `"high"`，**仅百炼 key 存在时有效**。 |
| `search` | bool | 是否联网搜索。需要 Tavily key，没 key 时会跳过并推 `{"type":"search","count":0,"skipped":true}`。 |
| `chat_id` | number\|null | 传了就持久化这一轮对话；不传就是「一次性问答」，不入库。 |

**没有** `system`、`temperature`、`max_tokens`、`tools`、`functions`、`response_format` —— 一个都没有。

### 2.3 响应事件一览

| 事件 | 字段 | 含义 |
|---|---|---|
| `source` | `source` `provider` `providerEn` `model` `label` `free` `fallback` | **首个 token 到达时**推送一次。`source` 是 provider id（`pollinations`/`ovh`/…），`model` 是真实型号（`openai-fast`），`label` 恒为 `"Jacky Bot"`。`fallback=true` 表示不是用户指定的那个源答的。 |
| `reasoning` | `text` | 思考轨迹片段，可以忽略。 |
| `delta` | `text` | **正文片段**，你要的内容。 |
| `search` | `count` `query` `provider?` `skipped?` | 联网搜索事件。`count=-1` 表示由 provider 自己搜。 |
| `reset` | — | 这个源只思考没输出（或中途挂了），**把它已经推的内容丢掉**，服务端正在换下一个源。 |
| `done` | `source` `error` `chatId` | 正常结束。 |
| `error` | `message` `detail[]` | 所有源都失败了。`detail` 是每个源的失败原因。 |

> **`reset` 一定要处理**：收到它就把已经累积的 `reasoning`/`delta` 清空，
> 否则用户会看到「前半截是模型 A 的，后半截是模型 B 的」这种拼接回答。

### 2.4 完整可跑的客户端

**Node.js（零依赖）**

```js
// jacky.js —— 一个最小但完整的 Jacky Bot 客户端
export class Jacky {
  constructor(base, token) {
    this.base = base.replace(/\/$/, '');
    this.token = token;
  }

  static async login(base, username, password) {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const j = await r.json();
    if (!j.token) throw new Error(j.error || 'login failed');
    return new Jacky(base, j.token);
  }

  // onEvent(evt) 每收到一个事件调一次；返回最终正文
  async chat({ message, history = [], level = 'medium', chat_id = null, search = false, onEvent }) {
    const resp = await fetch(`${this.base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ message, history, model: 'jacky', thinking: true, level, search, chat_id }),
    });
    if (!resp.ok) {
      let e = '';
      try { e = (await resp.json()).error || ''; } catch (_) {}
      throw new Error(`HTTP ${resp.status} ${e}`);
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', answer = '', source = null;
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
        if (onEvent) onEvent(j);
        if (j.type === 'source') source = j;
        else if (j.type === 'delta') answer += j.text;
        else if (j.type === 'reset') answer = '';       // 换源了，前面那段作废
        else if (j.type === 'error') throw new Error(`${j.message} :: ${JSON.stringify(j.detail || [])}`);
      }
    }
    return { answer, source };
  }

  async status() {
    const r = await fetch(`${this.base}/api/ai/status`, { headers: { Authorization: `Bearer ${this.token}` } });
    return r.json();
  }
}
```

用法：

```js
const j = await Jacky.login('https://vvechat.onrender.com', 'agent_bot', '你的密码');
const { answer, source } = await j.chat({
  message: '用三句话解释什么是幂等性。',
  onEvent: (e) => { if (e.type === 'source') console.log('由', e.provider, e.model, '作答'); },
});
console.log(answer);
```

**Python（标准库）**

```python
import json, urllib.request

def jacky_chat(base, token, message, history=None, chat_id=None, level="medium", on_delta=None):
    body = json.dumps({
        "message": message, "history": history or [], "model": "jacky",
        "thinking": True, "level": level, "search": False, "chat_id": chat_id,
    }).encode()
    req = urllib.request.Request(
        f"{base}/api/ai/chat", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    out, answer = [], ""
    with urllib.request.urlopen(req, timeout=120) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            j = json.loads(line)
            out.append(j)
            if j.get("type") == "delta":
                answer += j.get("text", "")
                if on_delta:
                    on_delta(j["text"])
            elif j.get("type") == "reset":
                answer = ""
            elif j.get("type") == "error":
                raise RuntimeError(j.get("message"))
    return answer, out
```

### 2.5 其它接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/ai/status` | 模型状态 + 每个 provider 的 `ready` / `hasKey` |
| GET | `/api/ai/chats` | 列出这个账号的对话（带 `message_count`） |
| POST | `/api/ai/chats` | 新建一个对话，返回 `{chat:{id,...}}` |
| GET | `/api/ai/chats/:id` | 取对话 + 全部消息（含 `reasoning`） |
| PATCH | `/api/ai/chats/:id` | 改名（`{"title":"..."}`），改完模型就不会再覆盖 |
| DELETE | `/api/ai/chats/:id` | 删对话及其消息 |
| POST | `/api/ai/config` | **管理员**。配源密钥：`{"source":"dashscope","key":"sk-xxx"}`，`key` 传 `""` 是清除。返回带完整 catalog。 |

**会话标题的副作用**：新建的对话 `title_mode='auto'`，**第一轮**会在系统提示里加一句
「回答的第一行必须先输出 `【标题:…】`」，服务端会把那行摘走、拿去当对话名。
也就是说**你永远看不到那行标题**，正文是干净的。标题用 `PATCH` 改过之后就固定了。

---

## 第 3 章 · 五条硬性约束（接入前必须知道）

### 3.1 限速 —— Agent 团队的头号瓶颈 ⚠️

| 范围 | 限制 | 作用域 |
|---|---|---|
| `/api/ai/chat` | **10 次/分钟 + 100 次/小时** | **按出口 IP**，不是按账号 |
| 写操作（建对话、改名、删…） | 240 次/分钟 | 按 IP |
| 全站 API | 1200 次/分钟 | 按 IP |

超了返回 `429 {"error":"Too many requests"}`。

> **这是按 IP 计的** —— 你团队里 5 个 agent 共用一个出口 IP，就共享这 10 次/分钟。
> 5 个 agent 各问一次就吃掉一半配额了。

### 3.2 正文长度

* `message` ≤ **2000 字符**
* 单次请求正文总量 ≤ **4000 字符**（`history` 不计入）
* 超过 → `400 {"error":"消息太长了"}`（英文界面会显示 `Message is too long`）

### 3.3 注入过滤会拒你的 prompt ⚠️

正文会过一遍 `security-core.js` 的注入检测，命中就 **400 拒绝**，不是清洗：

```
<script / </script> / <iframe / <svg / javascript: / vbscript:
onerror= / onload= / onclick= / onmouseover= / onfocus= / onanimationstart=
union select / ' or '1 / ; drop|delete|update|insert|truncate
sleep( / benchmark( / pg_sleep( / waitfor delay
../ / ..\ / %2e%2e / %252e / %c0%ae
\x00
$( / ; rm / ; curl / ; wget / ; cat / ; nc
{{7*7}} / ${jndi:
```

**对 Agent 团队的实际影响**：

* 你想让它写一段处理**文件路径**的代码 → `../` 会被拒；
* 想让它写 **shell 脚本** → `$(`、`` ` `` + `rm` 会被拒；
* 想让它写 **模板渲染** → `{{7*7}}` 会被拒；
* 想让它输出 **HTML** → `<svg` / `<script` 会被拒。

**绕法（推荐做法）**：把这些片段在 prompt 里做**占位符替换**，比如
`__DOTDOT__` → 模型输出后再由你的代码还原；或者对整段工具输出做 **base64** 后再喂进去。

```js
function safeForPrompt(s) {
  return String(s)
    .replace(/\.\./g, '__DD__')
    .replace(/\$\(/g, '__DOLLARPAREN__')
    .replace(/</g, '__LT__')
    .replace(/\x00/g, '');
}
// 用完再还原
function restore(s) {
  return String(s)
    .replace(/__DD__/g, '..')
    .replace(/__DOLLARPAREN__/g, '$(')
    .replace(/__LT__/g, '<');
}
```

### 3.4 没有 system prompt，不能改人设

系统提示是**硬编码**的（`server.js` 的 `BASE_SYSTEM`）：

> 你是 Jacky Bot，VVeChat 里的 AI 助手。请用简体中文回答。面对复杂任务，先在内部把思路推演清楚（深度思考），再给出结论；步骤多时按点列清楚……

API **不暴露** `system` 参数，所以：

* 每个 agent 都会自称 Jacky Bot —— 想换人设，只能在 `message` 里写「你现在扮演 X 角色」；
* **回答语言由 `message` 里有没有中文决定**（有中文 → 中文回答）。英文 agent 记得别在 prompt 里夹中文。

### 3.5 没有工具调用 / function calling

它就是纯粹的 chat completion。**工具执行、编排、重试、状态管理都得你自己写。**
这既是限制也是好事 —— 你的编排器对模型是全知全觉的，不用跟模型的工具协议打架。

---

## 第 4 章 · 组建 Agent 团队

### 4.1 总体架构

```
┌──────────────────────────────────────────────────────────┐
│  你的编排器（自己的进程）                                  │
│                                                          │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐               │
│   │ Planner │   │ Builder │   │ Reviewer│   ← 角色 agent  │
│   └────┬────┘   └────┬────┘   └────┬────┘               │
│        │  黑板/上下文  │            │                     │
│        └──────────────┴────────────┘                     │
│                        │                                 │
│                 ┌──────▼──────┐   ┌──────────────┐      │
│                 │ 限速队列     │   │  工具执行     │      │
│                 │ 10/min·IP   │   │  （你的代码） │      │
│                 └──────┬──────┘   └──────────────┘      │
└────────────────────────┼─────────────────────────────────┘
                         │  POST /api/ai/chat
                  ┌──────▼──────┐
                  │  Jacky Bot  │  → 引擎链：GPT-OSS 20B Reasoning
                  │  (大脑)     │     免密钥 / 10次每分钟
                  └─────────────┘
```

**关键原则**：Jacky Bot 只当「大脑」，**编排、工具、状态、重试全在你这边**。
不要试图让 Jacky Bot 自己驱动流程 —— 它没有工具调用能力，做不到。

### 4.2 三种团队拓扑

#### 模式 A · 串行角色流水线（最省配额，推荐先用这个）

规划 → 执行 → 评审，一条链。每个角色**独立 `chat_id`**，上下文互不污染，
用一条「黑板」字符串把上游产物传给下游。

```js
async function runPipeline(task) {
  const board = [];                      // 黑板
  const chats = {};                      // 每个角色一个 chat_id

  const ask = async (role, prompt) => {
    const ctx = board.join('\n---\n');
    const msg = `【角色】${role}\n【任务背景】${ctx}\n【你的要求】${prompt}\n只输出本角色的产出，不要寒暄。`;
    const r = await j.chat({ message: msg, chat_id: chats[role] ?? null });
    chats[role] = r.chatId ?? chats[role] ?? null;
    board.push(`【${role} 的产出】\n${r.answer}`);
    return r.answer;
  };

  const plan  = await ask('规划员', '把任务拆成 3-5 个可执行的子步骤，每步一行。');
  const build = await ask('执行员', '按上面的步骤产出具体方案，每步一行。');
  const review= await ask('评审员', '指出上面方案的问题，给出改进后的版本。');
  return { plan, build, review };
}
```

**配额消耗**：3 次调用 = 3 次配额。

#### 模式 B · 并行专家 + 汇总（快，但贵 N 倍）

N 个专家同时答同一份题，再让一个汇总者合并。

```js
async function runCouncil(task, experts = ['架构师', '安全专家', '性能专家']) {
  const answers = await Promise.all(
    experts.map(role => j.chat({
      message: `你是${role}。针对下面的问题给出你的专业意见，只讲你的专业范围：\n${task}`,
    }))
  );
  const merged = await j.chat({
    message: `下面是几位专家对同一问题的意见：\n${answers.map((a, i) => `#${i + 1}\n${a.answer}`).join('\n')}\n请综合成一份最终结论，并指出各家的分歧。`,
  });
  return merged.answer;
}
```

**注意**：并发请求会同时打限速。3 个专家并发 = 瞬时 3 次配额。
**4 个以上就别并发**，用队列摊平（见 4.4）。

#### 模式 C · VVeChat 群聊里的「人机混合团队」

VVeChat 本身就有群 + Jacky Bot 自动接话（每分钟自主接话，`@Jacky Bot` 立刻回）。
适合「人在环」的场景：真人成员 + Jacky Bot 在同一个群里协作。

这条路走的是**消息接口**（`POST /api/messages`），不占 `/api/ai/chat` 的 10 次/分钟配额
（消息接口另有 10/分钟 + 100/小时的聊天限速，但那是和 AI 面板**共用**同一个额度池 ——
所以还是省不下来太多）。上下文是群里最近 24 条消息。

**适合**：需要人类成员参与讨论、留下聊天记录供追溯。
**不适合**：要精确控制每一步输入输出的流水线。

### 4.3 一个 agent 一个 chat_id

`chat_id` 决定服务端怎么存上下文。**别让所有 agent 共用一个 `chat_id`** —— 上下文会串味，
而且服务端存的是这个账号的所有对话，混在一起没法复盘。

```js
// 每个 agent 一个独立会话，第一次调用时创建
async function ensureChat(key) {
  if (agents[key]) return agents[key];
  const r = await fetch(`${base}/api/ai/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: 'jacky' }),
  });
  const j = await r.json();
  agents[key] = j.chat.id;
  return agents[key];
}
```

**注意**：`chat_id` 的历史是**服务端**存的，服务端每次请求都会把这条会话的历史拼进去，
所以你**不需要**自己传 `history`（传了也会被忽略 —— 不对，其实两者都会用，见 4.5）。

### 4.4 限速队列 —— 必须自己写的部分

既然 10 次/分钟是按 IP 的硬限制，你的编排器必须自己做令牌桶：

```js
class RateLimiter {
  constructor(perMinute = 8, perHour = 90) {   // 留 2 次余量
    this.perMinute = perMinute;
    this.perHour = perHour;
    this.min = []; this.hour = [];
  }
  async take() {
    for (;;) {
      const now = Date.now();
      this.min = this.min.filter(t => now - t < 60000);
      this.hour = this.hour.filter(t => now - t < 3600000);
      if (this.min.length < this.perMinute && this.hour.length < this.perHour) {
        this.min.push(now); this.hour.push(now);
        return;
      }
      const wait = Math.min(
        this.min.length ? 60000 - (now - this.min[0]) : 1000,
        this.hour.length ? 3600000 - (now - this.hour[0]) : 1000
      );
      await new Promise(r => setTimeout(r, Math.max(250, wait)));
    }
  }
}

const rl = new RateLimiter();
async function askAgent(...) { await rl.take(); return j.chat(...); }
```

**再叠一层重试**（429 是常态，不是意外）：

```js
async function askWithRetry(opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { return await j.chat(opts); }
    catch (e) {
      const is429 = /429|Too many requests/i.test(String(e.message));
      if (!is429 || i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1) + Math.random() * 1000));
    }
  }
}
```

### 4.5 `history` 到底用不用

服务端**两个都会用**：

* 你传的 `history` → 只取最后 8 轮，每条截 4000 字符；
* `chat_id` 对应的服务端历史 → 也会被拼进去。

所以**传了 `chat_id` 就别再传 `history`**，否则上下文会重复、互相干扰。
两种用法二选一：

| 用法 | 传什么 | 适合 |
|---|---|---|
| 无状态 | `chat_id: null`，自己管 `history` | 编排器要精确控制上下文窗口 |
| 有状态 | `chat_id: <id>`，`history: []` | 想要服务端持久化、能在 VVeChat 界面里回看 |

### 4.6 一个完整的团队骨架

> 仓库里已经放了一份**可以直接跑**的完整实现：`tools/agent-team.js`（零依赖，Node 18+）。
> 它包含客户端、限速队列、敏感字符占位符化、429 重试、串行流水线和并行专家两种拓扑。
>
> ```bash
> node tools/agent-team.js <username> <password> "你的任务"
> # 或指定别的后端：BASE=http://127.0.0.1:3000 node tools/agent-team.js ...
> ```
>
> 实测输出（2026-11，沙盒 IP 上 OVH 配额还没被抢光，走的是 OVH 那一档）：
>
> ```
> 引擎链就绪：ovh, pollinations
>     [规划员] 由 OVH 公共端点 / Qwen3.6-27B 作答
>     [架构师] 由 OVH 公共端点 / Qwen3.5-9B 作答
>     [评审员] 由 OVH 公共端点 / Qwen3.5-397B-A17B 作答
>     [负责人] 由 OVH 公共端点 / Qwen3.5-397B-A17B 作答
> ```

下面是它的精简版，可以直接嵌进你自己的项目：

```js
// team.js —— 一个能跑的最小 Agent 团队
const AGENTS = {
  planner:   { role: '规划员',   ask: '把任务拆成 3-5 个可执行子步骤，每步一行，不要展开。' },
  architect: { role: '架构师',   ask: '给出技术方案：模块划分、接口、数据流。只输出方案本身。' },
  critic:    { role: '评审员',   ask: '指出方案里的问题、风险和遗漏，按严重程度排序。' },
  lead:      { role: '负责人',   ask: '综合以上所有意见，给出最终决策和执行顺序。' },
};

class Team {
  constructor(jack, opts = {}) {
    this.j = jack;
    this.rl = new RateLimiter(opts.perMinute ?? 8, opts.perHour ?? 90);
    this.chats = new Map();
  }

  async chatId(key) {
    if (!this.chats.has(key)) {
      const r = await fetch(`${this.j.base}/api/ai/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.j.token}` },
        body: JSON.stringify({ model: 'jacky' }),
      });
      const j = await r.json();
      this.chats.set(key, j.chat.id);
    }
    return this.chats.get(key);
  }

  async ask(key, task, board = []) {
    const a = AGENTS[key];
    await this.rl.take();
    const msg = [
      `你现在扮演「${a.role}」。`,
      `你的任务：${a.ask}`,
      board.length ? `【同事们的产出，供你参考】\n${board.join('\n---\n')}` : '',
      `【要处理的内容】\n${task}`,
      `只输出你的产出，不要复述任务，不要寒暄。`,
    ].filter(Boolean).join('\n');
    const r = await this.j.chat({ message: msg, chat_id: await this.chatId(key) });
    return r.answer;
  }

  async run(task) {
    const board = [];
    const plan = await this.ask('planner', task, board);
    board.push(`【规划】\n${plan}`);
    const arch = await this.ask('architect', task, board);
    board.push(`【架构】\n${arch}`);
    const crit = await this.ask('critic', task, board);
    board.push(`【评审】\n${crit}`);
    const lead = await this.ask('lead', task, board);
    return { plan, arch, crit, lead };
  }
}
```

**成本估算**：一次 `run()` = 4 次调用 ≈ 2 次配额（4/8 每次分钟）。
按 10 次/分钟算，**每分钟能跑 2 轮完整流水线**。

### 4.7 配额怎么花 —— 一个现实的账

| 团队形态 | 每轮调用数 | 每分钟能跑几轮 |
|---|---|---|
| 3 角色串行 | 3 | ~3 |
| 4 角色串行 + 评审 | 4 | ~2 |
| 5 专家并发 + 1 汇总 | 6 | ~1（并发会瞬时超限，得排队） |
| 10 人团队 | 10+ | **跑不动** —— 每小时上限 100 次，10 人×10 轮 = 100 次/轮 |

**所以：**
* **超过 5 个 agent 就要么排队，要么换出口 IP，要么自建后端。**
* 上限 100 次/小时是死的。10 个 agent 每人每小时 10 轮就到底了。

### 4.4.5 想突破限速的三条路

1. **多个出口 IP**：云函数 / 多台机器 / 不同 NAT，每台一个 IP，额度翻倍（但服务端按 IP 计，Cloudflare 后面会取 `CF-Connecting-IP`）。
2. **自建后端**（最彻底）：这个仓库是开源的，`server.js` 只依赖 express + socket.io，
   `npm i && PORT=3000 node server.js` 就能跑。限速是**按实例**算的，
   你起 3 个实例 = 3 份额度，还能顺便把 AI 源换成百炼（有 key 就有思考档位）。
3. **绕开 `/api/ai/chat`**：直接用上游源（Pollinations 的 `openai-fast` 完全免密钥、
   OpenAI 兼容接口）。代价是失去 Jacky Bot 的熔断、人味提示词和群聊接话能力。

### 4.8 提示词工程要点（针对这个 API 的特性）

1. **角色写在 message 里**，因为没有 system 参数：
   `你现在扮演「架构师」，只输出方案本身。`
2. **格式用祈使句钉死**：`只输出 3 行，每行一个子步骤，不要任何解释和标题。`
   模型很容易多话，明确说不��什么比说要什么有效。
3. **别在 prompt 里放会被过滤的字符**（见 3.3）—— 路径、shell、模板、HTML 全都要占位符化。
4. **中文 agent 的 prompt 全中文，英文 agent 全英文** —— 回答语言由 message 里有没有中文决定，
   混着写会让输出语言摇摆。
5. **每轮只给必要的上下文**。`message` 只有 2000 字符，上下文长了就得靠 `chat_id` 的服务端历史。
6. **想要联网就 `search: true`**，但需要 Tavily key；没 key 时它会静默跳过（推 `count:0, skipped:true`）。

### 4.9 观测与排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `429 Too many requests` | 超过 10/分钟 或 100/小时 | 退避重试；用限速队列 |
| `503 没有可用的模型源` | 所有源都被限速冷却了 | 等冷却（最长 30 分钟）或配新源 |
| `error` 事件，`detail` 里全是 429 | 上游公共端点配额耗尽 | 配一个带 key 的源（百炼/Gemini/Groq） |
| 回答是拼接的、语无伦次 | 没处理 `reset` 事件 | 收到 `reset` 清空累积内容 |
| 回答全是中文但 agent 该说英文 | message 里混了中文 | 全英文 prompt |
| 第一轮多了一行标题 | 服务端在给对话起名 | 正常现象，那行会被摘走；用 `PATCH /api/ai/chats/:id` 改标题 |
| 一次回复要 70 秒 | 命中了限速冷却前的旧版本 | 升级到 `20261107aj` 之后已修复 |

**建议在编排器里打点**：`source` 事件里拿到 `source`/`model`，统计各引擎占比；
`done`/`error` 里统计成功率；429 单独计数。Jacky Bot 自己有控制台
（`/control/`）能看到整体健康度。

---

## 第 5 章 · 上线检查清单

- [ ] 用**专用账号**调 API，不要用真人账号
- [ ] 拿到了 token 并确认 30 天有效期（写个刷新逻辑）
- [ ] 客户端按 **NDJSON** 解析（不是 SSE）
- [ ] 处理了 `reset` 事件（否则答案会拼接）
- [ ] 实现了限速队列（≤8 次/分钟、≤90 次/小时）
- [ ] 实现了 429 退避重试
- [ ] 每个 agent 独立 `chat_id`，**且不传 `history`**
- [ ] prompt 里的 `../` `$(` `<` `{{ }}` 等敏感片段做了占位符化
- [ ] 角色人设写进 `message`（没有 system 参数）
- [ ] 确认了当前实际作答的引擎（读 `source` 事件）
- [ ] 知道「深度思考档位」当前**无效**，需要百炼 key 才生效
- [ ] 注册了百炼 key（可选，但这是唯一能调思考预算的路）
- [ ] 单文件版已重新构建（`node tools/build-single-html.js`）

---

## 附录 · 一页速查

```bash
BASE=https://vvechat.onrender.com

# 登录
TOKEN=$(curl -s -X POST $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"agent_bot","password":"你的密码"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# 看当前谁能作答
curl -s $BASE/api/ai/status -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print([p["id"] for p in d["providers"] if p["ready"]])'

# 问一句
curl -sN -X POST $BASE/api/ai/chat -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"用一句话说明什么是幂等性","model":"jacky","thinking":true,"level":"medium"}'
```

**一句话总结**：Jacky Bot 现在是 **GPT-OSS 20B Reasoning**（免密钥，经 Pollinations），
**没有工具调用、没有 system prompt、限速 10 次/分钟且按 IP 计** ——
所以正确姿势是：**你的代码当编排器，Jacky Bot 当大脑**，
团队规模控制在 4–5 个角色内，靠限速队列摊平，敏感字符占位符化。
