# Signs of slop

Go through every group and note each sign you find with where it lives. Each line pairs the sign with its fix.

## Surfaces and color

- Purple to blue or violet to pink gradients on backgrounds, cards, buttons or the active nav item → one neutral surface, accent only where it means something
- Gradient text in headings, numbers or the logo → solid primary text color
- Colored glows, like `shadow-[0_0_20px_rgba(139,92,246,0.5)]`, `drop-shadow` on emoji or glowing pills → remove, depth from surface steps and hairlines
- Radial color washes or blurred blobs behind content → remove
- Neon or high contrast colored borders → hairline at 6 to 10% opacity
- Many near identical tints of the same hue for text, like five lavenders → three text roles from one neutral ramp
- Every element highlighted, so nothing stands out → one accent used once or twice per screen
- Glass cards with a white inner highlight and a colored shadow → plain raised surface with a hairline

## Type

- Headings at weight 800 or 900 → 400 to 500 and size for hierarchy
- Uppercase labels with wide tracking, like `NAVIGATION` or `PAID THIS MONTH` → sentence case at normal or slightly open tracking
- Too many sizes and weights on one screen → a few sizes from the scale, weights 400 and 500
- Numbers in mixed formats, like `$48,210` next to `$124,860.40`, or `07` → one format, tabular figures
- Negative letter spacing on small text → zero or slightly positive
- Italic used for emphasis → color or weight instead

## Icons

- Emoji as nav icons, label decoration or status, like 🏠 📥 🚀 💰 ⚠️ 📈 🔥 😬 → one line icon set or nothing
- Emoji inside pills and counts, like `18 👤` → plain number
- Icons in many sizes and colors → one size, one stroke, text role color
- Icons nudged off the column → same icon box width in every row
- A sparkle ✨ for anything AI → remove or use a plain icon only where it explains something

## Spacing

- Arbitrary values, like `mt-[13px]`, `ml-[7px]`, `h-[31px]` → steps on the 4px scale
- Rows in one list with different heights or gaps → one height, one gap
- Groups that sit closer to their neighbours than to their own items → smaller gaps inside groups, bigger between them
- Uneven padding inside sibling cards → one padding
- Big empty gaps above a section and cramped space below it → balanced rhythm

## Copy

- Greeting headlines, like `Welcome back, Damir! 👋` → the page or period as the title
- Exclamation marks and `!!` → plain statement
- Changes without a reference, like `+12%!!` or `3 less!!` → `+12% vs last month`, `3 fewer vs last month`
- Wordy placeholders, like `Search anything...` → `Search`
- Hype words, like supercharge, seamless, unlock, magic, revolutionize → what the thing actually does
- Trailing periods on labels and buttons → none
- Fake looking data, like `$123,456` or `[X]` → plausible numbers

## Components

- Glowing pills for counts, plans, shortcuts or status → quiet mono text or a keycap
- `PRO`, `New ✨`, `Beta 🚀` badges everywhere → remove or one quiet text badge
- Every element a full pill, from search to buttons to cards → radius by size, nested radius math
- Charts with rainbow bars, glowing bars, pill shaped bars or uppercase day labels → one or two series, muted grid and mono labels, one highlight color
- Every chart or stack in several shades of the accent, so nothing leads → neutral steps with the accent only on the one thing that matters
- Sparklines, tallies or mini bars added to every stat card → the number, its label and its change
- Equal cards side by side, each with the same chart or layout → one main chart, compact stats, varied widths
- Logo as a gradient tile with a sparkle and a gradient wordmark → product name as text plus a simple flat mark
- Logo mark as a glossy orb, a gradient ball or a glowing dot → a flat glyph in one solid color, or the wordmark alone

## Landing pages and heroes

- A pill badge above the headline, like `✨ Introducing X 2.0` → remove, or a quiet text link if it is real news
- A headline that could fit any product, like `Supercharge your workflow with AI` → say what the product does for whom
- Gradient or shimmer on the headline → solid text
- Floating blobs, orbs, grids and glowing lines behind the hero → plain background or one real product visual
- Everything stacked and centered, headline, text, buttons and a picture below → an asymmetric split or text over a large product view, see the Layout pass
- Three or more buttons, or chips and avatars stacked under the buttons → one primary and at most one secondary action
- `Trusted by 10,000+ teams`, `Loved by 10,000+`, rows of avatar dots or five stars without a source → ask if it is real, then make it quiet and specific or remove it
- Parallax and elements floating on scroll → static layout, motion only with a purpose
- Feature cards with an emoji, a bold title and a vague line each → fewer features, concrete copy, line icons or none

## Visuals

- Glossy 3D blobs, orbs, liquid chrome shapes or a purple nebula as the hero visual → the product itself or one concrete metaphor for what it does
- Stock robots, glowing brains, circuit lines or holograms for anything AI → remove, or show what the AI actually produces
- Text, fake buttons or a fake logo baked into an image → real text in the page, a clean image without text
- An image that does not blend into the page, with a hard edge and a different black → background matched to the page and a soft mask at the edges
- A visual on every section → one visual where it helps, usually only the hero

## Motion

- `animate-pulse`, `animate-ping` or breathing glows on things that are not live → static
- `transition-all` and `hover:scale` on cards and buttons → color or surface step on hover, a tiny scale down on press
- Bouncy springs and overshoot on simple UI → one ease-out curve
- Everything flying in on load from different directions → one short fade and rise with a small stagger
- Parallax, floating loops and elements that move on scroll → static layout
- Animating width, height, top or left → transform and opacity

## Template look

These are not slop, but they are what a cleaned up screen falls back to when nobody made a decision. Watch for them after the passes.

- Pure grey #161616 page, Inter, white text and the old brand color on one button, on a product whose world is warm or bright → a ramp tinted toward the world and an accent from it
- A headline that would fit another product if you swapped the name → say what this product does, with its own nouns
- A hero visual that is an empty box or a generic picture → a product preview in code or an image from the world
- Every product getting the same layout, type and palette → let the direction choose

---

# VVeChat 专项:豁免与真线索

> 上面是上游的通用清单。下面两节是 VVeChat 专属的:**先看豁免,免得把品牌改坏;再看真线索,那才是要修的。**

## 一、豁免(在 VVeChat 里这些不是 slop)

| 通用清单里的条目 | 在 VVeChat 里的判定 |
|---|---|
| 玻璃卡片 + 白色内高光 + 彩色阴影 | ✅ **豁免**。这是 weightless glass 的签名,`--glass-highlight` 是玻璃感的关键 |
| 彩色发光 | ✅ **豁免**,但要窄:只给 Qwen 环、Jack 金环。给容器发光才是 slop |
| 紫→蓝渐变 | ✅ **豁免**。`--accent-grad` 是蓝→青,只出现在「我的」气泡/主按钮/头像 |
| 药丸形状 | ✅ **豁免**。VVeChat 已分好层级(控件 16 / 行 20 / 面板 28 / 卡片 32 / 药丸 999) |
| Emoji 当图标 | ⚠️ **部分豁免**:群 emoji 头像、官方群 🛡️ 是产品功能。别的位置出现 emoji 仍然是 slop |
| 全大写 + 宽字距 | ⚠️ **550C 终端主题豁免**(那是终端语言)。`style.css` 里的 2 处要查 |
| 动画循环 | ⚠️ **550C 豁免**(CRT 扫描线)。`style.css` 里的 12 处要逐条看 |
| 上游的 hero / 落地页那一整节 | ⛔ **整节不适用**。VVeChat 是应用,不是落地页 |
| 上游的「一张 hero 大图」 | ⛔ **不适用**。VVeChat 的视觉时刻是群头像那一格和 Qwen 的环 |

## 二、VVeChat 真线索(实测,2026-11)

跑 `node tools/slop-scan.js frontend/style.css frontend/liquid-glass.css frontend/boot550c.css` 得到。

### Type —— 最严重

- **28 种字号**(6.5 / 7.5 / 9 / 9.5 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 16 / 17 / 18 / 19 / 20 / 22 / 24 / 26 / 28 / 30 / 32 / 34 / 38)。
  → 收敛到 9 档,映射表见 [tokens.md](tokens.md)。
- **35 处文字小于 11px**(`style.css` 23 处 + `boot550c.css` 12 处)。6.5px 和 7.5px 多半是装饰,直接删。
  → 界面文字不得小于 11px。
- **9 处负 `letter-spacing`**,在小字上尤其要查。
  → 小字上不做负字距。

### Spacing —— 基本达标

- 间距基本在 4px 网格上,`:root` 里也有明确的圆角阶梯。**这一层基本不用动。**
- 但要量侧边栏:`#pane-chats` 的列表行高和间距是全站最容易崩的地方。

### Motion —— 要收

- **3 处动画 `width / height / top / left`**(style.css)+ 2 处(boot550c.css)。
  → 只过渡 `color / background / border / opacity / transform`,弱设备上会卡。
- **12 处 `animation: infinite`**(style.css)。
  → 逐条问:这东西是「活」的吗?不是就别循环。
- 弹跳曲线 `cubic-bezier(0.34, 1.56, 0.64, 1)` 只在真需要「弹一下」的地方留。
- ✅ 已经有 25 处用同一条 `cubic-bezier(0.22, 1, 0.36, 1)` —— **保持它,别再引入新曲线**。

### Icons

- 4 处 hover 里 `scale()`。
  → hover 改成快速的颜色/表面变化,press 才是一点点缩小。
- 图标颜色统一到所在文字角色,别给图标单独上色。

### Components

- **发光的计数药丸**:计数应该是安静的文字(常常等宽 + 弱色),不是发光药丸。
- **群成员数**:标题上的数字必须来自**刚拉回的名册**,不能信登录时缓存的 `member_count`(已修过一轮,改 UI 时别改回去)。
- **对话名**:Qwen 自己起名后,列表里的名字要即时更新(socket `ai:chat-title`)。

### Copy

- 中文界面里别混入英文营销词(「解锁」「无缝」「超级」);英文界面同理别直译成口号。
- 官方群的中英文名已经分开处理:默认名 `VVeChat 官方群` → `VVeChat Official Group`,**用户改过的群名照原样显示**,别再翻译。

### 三个主题

- 任何一个界面改动,**浅色 / 深色 / 550C 都要看**。
- 550C 会主动关掉液态玻璃(`LiquidGlass.setTheme('550c')`),别在 550C 里「补」玻璃。

---

Part of unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0. Keep this credit in copies and adaptations.
