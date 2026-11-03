# Tokens — VVeChat

> 上游 unslop 的 tokens.md 是通用模板;这份是 VVeChat 的**实际数值 + 收敛建议**。
> 数值全部来自 `frontend/style.css` 的 `:root` / `body.dark` / `frontend/boot550c.css`。

## 现在是什么样(实测,2026-11)

`node tools/slop-scan.js frontend/style.css frontend/liquid-glass.css frontend/boot550c.css`

| 指标 | style.css | liquid-glass.css | boot550c.css | 判断 |
|---|---|---|---|---|
| **字号种类** | **28 种**(全项目) | | | ❌ 最严重的问题 |
| font-size < 11px | 23 处 | 0 | 12 处 | ❌ 有 6.5px / 7.5px |
| `text-transform: uppercase` | 2 | 0 | 7 | ⚠️ 550C 是终端语言,合法;style.css 的 2 处要查 |
| 负 `letter-spacing` | 9 | 0 | 0 | ❌ 小字上负字距 |
| hover 里 `scale()` | 4 | 0 | 0 | ❌ |
| `transition: all` | 0 | 0 | 0 | ✅ |
| `animation: infinite` | 12 | 0 | 5 | ⚠️ 逐条看有没有理由 |
| 动画 `width/height/top/left` | 3 | 0 | 2 | ❌ 弱设备会卡 |
| 缓动曲线 | `cubic-bezier(0.22,1,0.36,1)` ×25 是主流 ✅ | | | |

**结论:VVeChat 的间距和颜色是设计过的(有 `:root` 文档、有阶梯),但字号和动效是随手写的。** 做 unslop 时,九层里的 **Type** 和 **Motion** 两层收益最大。

## Spacing scale

4px 网格。现状散落但基本在网格上;新建的东西从这张表里取:

```
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48
```

- 卡片内边距 20~24,面板 16~24,页面边距 24~32。
- 侧边栏行高 32~36,行间距 2~4(现有 `#pane-chats` 的列表已经接近这个密度)。
- 组内间距 < 组间间距。

## 中性色

**浅色**

```
--bg     #EEF3FA
--bg2    #E4ECF7
--bg3    #DFE9F5
--ink    #16202f     主文字
--ink-2  #33415a     次文字
--muted  #6a7c96     弱文字
--muted-2 #9aa8bd    最弱(时间戳、meta)
```

**深色**(`body.dark`)

```
--bg     #0a0d12
--bg2    #0d1117
--bg3    #11151c
--ink    #e6ecf5
--ink-2  #c5d0e0
--muted  #8693a8
--muted-2 #5a6577
```

**三个文字角色**:主(`--ink`)、次(`--ink-2`)、弱(`--muted`)。`--muted-2` 只给 meta。**不要再造第四个灰。**

## 玻璃

```
--glass-bg          rgba(255,255,255,.62)      常规面板
--glass-bg-strong   rgba(255,255,255,.78)      浮层、弹窗
--glass-bg-soft     rgba(255,255,255,.42)      次级容器
--glass-bg-frost    rgba(255,255,255,.20)      玻璃上的玻璃
--glass-border      rgba(255,255,255,.72)
--glass-border-soft rgba(255,255,255,.48)
--glass-blur        34px        常规
--glass-blur-strong 48px        强调容器
--glass-shadow      0 10px 34px rgba(38,62,100,.10)
--glass-shadow-lg   0 22px 68px rgba(38,62,100,.16)
--glass-highlight   inset 0 1px 0 rgba(255,255,255,.85)
```

深色主题里同结构换值(烟熏玻璃,不是黑板)。

## Accent

```
--accent      #4C6FFF    深色主题 #7C9CFF
--accent2     #22B8CF    深色主题 #45CFE0
--accent-grad linear-gradient(135deg,#5B7CFF,#29C3D6)   ← 全站唯一允许的渐变
--accent-soft rgba(76,111,255,.13)
--accent-glow rgba(76,111,255,.30)   ← 只给签名元素,不给容器
```

语义色:`--online #34C759` `--warn #FFB020` `--danger #FF3B30` `--success #10b981` —— 只表达语义,收着用。

**550C 主题另算**:琥珀 `--c550-amber #e8a020` 是它自己的世界,别把蓝青带进去。

## Type families

```
--font         -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", system-ui, "Segoe UI", Roboto, sans-serif
--font-display -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", system-ui, sans-serif
--c550-mono    "SFMono-Regular", "JetBrains Mono", "Roboto Mono", Menlo, Consolas, monospace
```

**界面字体一族 + 等宽一族用于数字和 meta,到这两族为止。** 别再引入第三套。

## Type scale(收敛后)

现状 28 种字号,建议收敛成 9 档:

```
--fs-caption  11px    计数、徽标、时间戳(最小值,再小不行)
--fs-small    12px    辅助说明
--fs-body     13px    列表项正文、次要文案
--fs-base     14px    正文基准
--fs-lead     16px    标题、输入框文字
--fs-h3       18px
--fs-h2       20px
--fs-h1       24px
--fs-display  30px
```

映射建议(改的时候照这张表):

| 现状 | 归到 |
|---|---|
| 6.5 / 7.5 / 9 / 9.5 / 10 / 10.5px | **11px**,或直接删掉(多半是装饰) |
| 11 / 11.5 / 12 / 12.5px | 11px(纯 meta)/ 12px(辅助)/ **13px(列表正文,12.5px 是最常见的,直接改这里收益最大)** |
| 13 / 13.5 / 14 / 14.5px | 13px / **14px** |
| 15 / 16 / 17 / 18 / 19 / 20px | 16px / 18px / 20px |
| 22 / 24 / 26 / 28 / 30 / 32 / 34 / 38px | 24px / 30px(大标题,按需) |

字重:**400 / 500**,600 只在极少的强调处。层级靠字号和颜色,不要 700+。

## Radius

**直接用现成的阶梯,不要新造:**

```
--r-ctrl   16px    按钮、输入框
--r-row    20px    列表行
--r-panel  28px    面板
--r-card   32px    卡片(squircle 签名)
--r-pill   999px   药丸:头像、药丸标签、发送键
--r-input  999px   输入框
```

嵌套圆角 = 外圆角 − 内边距,且 ≥ 4。**不是所有东西都该是药丸** —— 计数和 meta 应该是安静文字。

## Icons

- 内联 SVG(line icon),一套尺寸(16/18)、一套线宽(1.5)。
- 图标取所在文字角色的颜色,通常次级或弱。
- 图标盒子宽度一致,到标签的间距固定 8 或 10。
- **群 emoji 头像、官方群 🛡️ 是产品功能,不算「emoji 当图标」。**

## Depth

- 分隔靠**模糊 + 阴影**,不靠描边(见 `style.css` 的设计语言注释)。
- 阴影只用 `--glass-shadow` / `--glass-shadow-lg` 两档。
- 深色主题里深度来自表面层级和发丝线,不是阴影。
- 发光只给签名元素:`--accent-glow`(Qwen 环、Jack 金环)。

## Motion

```
--ease      cubic-bezier(0.22, 1, 0.36, 1)   ← 主流曲线(25 处),保持它
--dur-fast  150ms    hover、颜色变化
--dur-base  200ms    面板、菜单
--dur-slow  280ms    进场、大位移
```

- 只过渡 `color / background / border / opacity / transform`,写明属性。
- **不要动画 `width / height / top / left / margin / 大 blur`** —— 现有 3 处要改。
- 保留 `cubic-bezier(0.34, 1.56, 0.64, 1)`(弹跳)只在真的需要「弹一下」的地方,一般该删。
- `animation: infinite` 的 12 处逐条看:不是活的东西就别循环。
