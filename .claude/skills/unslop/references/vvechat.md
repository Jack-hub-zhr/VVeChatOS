# VVeChat 项目地图与设计语言

> 这份文件是 unslop skill 的 VVeChat 适配底本。改 UI 之前先读它,免得把做对的地方改坏。

## 一、仓库结构

```
VVeChatOS/
├── server.js              Express + Socket.io 后端(3305 行),SQLite
├── frontend/
│   ├── index.html         单页外壳,852 行,所有视图都在这一个文件里
│   ├── app.js             全部前端逻辑,5623 行
│   ├── style.css          设计系统 + 组件,5158 行
│   ├── liquid-glass.js    液态玻璃引擎,358 行
│   ├── liquid-glass.css   玻璃的样式层,167 行
│   ├── boot550c.js        550C 开机动画,552 行
│   ├── boot550c.css       550C 终端主题,905 行
│   └── config.js
├── control/               管理台(独立一套前端)
│   ├── index.html  app.js  style.css  config.js
├── keepalive.js
└── vvechat.db             SQLite
```

**没有构建步骤。** 原生 HTML/CSS/JS,改完刷新就是最新的。CSS 没有预处理器,没有 Tailwind,没有 CSS-in-JS。

## 二、前端视图地图(index.html 里的 id)

| 区域 | 关键 id / 选择器 |
|---|---|
| 登录 | `#auth-view` `#auth-form` `#auth-username` `#auth-password` `#auth-submit` `#auth-msg` |
| 主壳 | `#app-view` `.app-shell` `.side-nav` `.side-nav-item[data-pane]` |
| 顶栏 | `#topbar-avatar` `#btn-bell` `#btn-lang` `#btn-theme-toggle` `#theme-menu` `#btn-plus` `#btn-profile` `#btn-logout` |
| 侧栏用户 | `#side-avatar` `#side-me` `#side-name` `#side-me` |
| 四个面板 | `#pane-chats` `#pane-ai` `#pane-discover` `#pane-more` |
| 会话列表 | `#search-input` `#unread-list` `#unread-count` `#unread-empty` `#bell-list` |
| 聊天区 | `#right-pane` `#send-btn` `#attach-btn` `#reply-preview` `#typing-indicator` |
| 助手 | `#ai-view` `#ai-chat-list` `#ai-head-title` `#ai-input` `#ai-send` `#ai-new-chat-btn` `#ai-sidebar-toggle` `#ai-model` `#ai-level` `#ai-status` |
| 发现 | `#plus-results` `#plus-search-input` `#btn-create-group` |
| 设置 | `#pref-lang` `#pref-font` `#pref-density` `#pref-clock` `#pref-discover-row` |
| 弹窗 | `#modal-plus` `#modal-add-friend` `#modal-bell` `#modal-group-info` `#modal-profile` `#modal-create-group` `#modal-confirm` |
| 新消息小窗 | `#msg-popup-scrim` `#msg-popup-card` `#msg-popup-from` `#msg-popup-input` `#msg-popup-reply` `#msg-popup-count` |
| 其他 | `#toast` `#offline-banner` `#group-info-list` `#cg-name` `#cg-emoji-row` |

## 三、设计语言:weightless glass

`style.css` 顶部的 `:root` 写死了三条规则,改 UI 之前必须理解:

1. **大而柔的圆角。** 面板是超椭圆(squircle),不是方盒子。卡片 32、面板 28、行 20、控件 16、药丸 999。
2. **真的半透明。** 面板是 62%~78% 白 + 34px~48px 背景模糊,壁纸能透过来。以前 0.30~0.45 的值看着像灰塑料。
3. **轻而宽的阴影,不要描边。** 分隔靠模糊 + 阴影,不靠线条。

> 这三条是**已经解决好的问题**。上游 unslop 说「少用阴影、少用描边」,VVeChat 恰恰是「阴影和模糊是唯一的分隔手段」——这里的「少」指的是「别在不该有的地方加」,不是「删掉」。

### 中性色与文字层级(浅色)

```
--bg     #EEF3FA    --bg2  #E4ECF7    --bg3  #DFE9F5
--ink    #16202f    --ink2 #33415a    --muted #6a7c96   --muted-2 #9aa8bd
```

深色主题同结构换值:`--bg #0a0d12`、`--ink #e6ecf5`、`--muted #8693a8`。

### 玻璃

```
--glass-bg         rgba(255,255,255,.62)   --glass-bg-strong  rgba(255,255,255,.78)
--glass-bg-soft    rgba(255,255,255,.42)   --glass-bg-frost   rgba(255,255,255,.20)
--glass-border     rgba(255,255,255,.72)   --glass-border-soft rgba(255,255,255,.48)
--glass-blur       34px                    --glass-blur-strong 48px
--glass-shadow     0 10px 34px rgba(38,62,100,.10)
--glass-shadow-lg  0 22px 68px rgba(38,62,100,.16)
--glass-highlight  inset 0 1px 0 rgba(255,255,255,.85)
```

### 强调色

```
--accent     #4C6FFF   --accent2  #22B8CF
--accent-grad linear-gradient(135deg,#5B7CFF,#29C3D6)   ← 全站唯一允许的渐变
--accent-soft rgba(76,111,255,.13)    --accent-glow rgba(76,111,255,.30)
```

语义色:`--online #34C759` `--warn #FFB020` `--danger #FF3B30` `--success #10b981`。

### 气泡

```
--bubble-me       linear-gradient(135deg,#4C6FFF,#29C3D6)   --bubble-me-text #fff
--bubble-them-bg  rgba(255,255,255,.74)                     --bubble-them-text #16202f
```

### 字体

```
--font        -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", …
--font-display 同上 + "SF Pro Display"
```

**不要引入第三套字体。** 中文/英文混排靠系统栈扛,换字体会连带毁掉中文排版。

## 四、三套主题

| 主题 | 触发 | 特点 |
|---|---|---|
| 浅色 | 默认 | weightless glass,白玻璃 |
| 深色 | `body.dark` | 烟熏玻璃,同样的结构换深色表面 |
| 550C 终端 | `vve:boot550c === '1'` | 黑底 `#050403` + 琥珀 `#e8a020` + 等宽字体 + CRT 质感 |

**550C 是一套独立语言,不是要统一的风格。** 它硬边、等宽、没有玻璃。`applyTheme()` 里 `LiquidGlass.setTheme('550c')` 会主动关掉折射。

看任何一个界面,**三个主题都要看**。在 550C 里成立的间距/圆角判断,换个主题可能完全不成立。

## 五、液态玻璃引擎(`liquid-glass.js`)

- 入口:`applyLiquidGlass()`(在 app.js 里),主题切换后会在 `applyTheme()` 末尾补一次 `setTheme()`。
- 引擎 API:`LiquidGlass.setTheme(mode)`、`LiquidGlass.markDirty()`。
- **真折射只给 Chromium,而且开销高** → 只给小卡片用。
- 果冻物理、体积光是全局铺开的。
- CSS 类:`.lg-glass`(普通玻璃卡片)、`.lg-lit-host`(已经定位的元素)。
  - **陷阱**:`position: relative` 会把 `position: fixed` 的浮层拉回文档流 —— 只给 computed position 为 static 的元素加 `.lg-glass`,已定位的用 `.lg-lit-host`。

## 六、签名元素(别动,也别复制第二套)

| 元素 | 位置 | 说明 |
|---|---|---|
| **Qwen 发光环** | `.qwen-ring` | 侧边栏、气泡、@ 选择器复用同一套 `#qwenGlow` SVG 定义 |
| **Jack 头像金环** | `.avatar-jack-glow` | Jack 永远是金色,不信 localStorage 里的旧值 |
| **官方群徽章** | 🛡️ | `VVeChat Official Group`,英文界面显示 `VVeChat Official Group` |
| **群 emoji 头像** | 建群时选 | 产品功能,不是「emoji 当图标」 |
| **玻璃高光** | `--glass-highlight` | 顶部一条内阴影,玻璃感的关键 |

## 七、后端要点

- Express + Socket.io + SQLite(WAL 模式)。
- Socket 事件:`group:member-left`、`group:owner-changed`、`group:disbanded`、`ai:chat-title` 等。
- 管理端接口:`GET /api/control/snapshot`、`POST /api/control/purge-user/:id`、`POST /api/control/format-all`、`GET /api/admin/stats`、`GET /api/ai/status`。
- 助手走 OVH 公共端点(Qwen3.6),`GET /api/ai/status` 能看 provider/model 就绪状态。
- 上线方式:GitHub `main` → Render 自动部署。**每次上线必须 bump `frontend/index.html` 里的资源版本号**(现在是 `20261102c`),否则浏览器拿旧缓存。

## 八、怎么在本地看界面

```bash
# 起本地服务(用另一个数据库,别碰线上库)
PORT=3000 DB_FILE=/workspace/vvechat-test.db node server.js

# 截图(技能自带)
node .claude/skills/unslop/scripts/shot-vvechat.mjs \
  --out shots/xx.png --screen chats --theme light --width 1280
node .claude/skills/unslop/scripts/shot-vvechat.mjs \
  --out shots/xx.png --screen ai --theme 550c --mobile
```

线上:https://vvechat.onrender.com/ (Jack / Zhr121005)

## 九、给 unslop 的硬边界

1. 不删液态玻璃层,也不把玻璃从容器上拿下来。
2. 不把 `--accent-grad` 拆成纯色,它只有这一处用途。
3. 不动 550C 的硬边和等宽字体,也不在里面加玻璃。
4. 不把 Qwen 的发光环换成字母头像,也不在别处新造发光头像。
5. 不为了「统一」把群 emoji 头像换成字母。
6. 不改 `--r-*` 圆角阶梯的层级关系。
7. 改完记得 bump 版本号再推。
