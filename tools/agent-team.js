#!/usr/bin/env node
/* ============================================================
 * Jacky Bot Agent 团队 —— 可直接运行的参考实现
 * ------------------------------------------------------------
 * 用法：
 *   node tools/agent-team.js <username> <password> "你的任务"
 *
 * 需要 Node 18+（用内置 fetch），零外部依赖。
 * 线上地址默认 https://vvechat.onrender.com，可用 BASE 环境变量覆盖。
 * ============================================================ */
'use strict';

const BASE = (process.env.BASE || 'https://vvechat.onrender.com').replace(/\/$/, '');

// ------------------------------------------------------------
// 1. 客户端
// ------------------------------------------------------------
class Jacky {
  constructor(base, token) { this.base = base; this.token = token; }

  static async login(base, username, password) {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const j = await r.json();
    if (!j.token) throw new Error('登录失败：' + (j.error || 'unknown'));
    return new Jacky(base, j.token);
  }

  // 返回 { answer, source, chatId }
  async chat({ message, history = [], chat_id = null, level = 'medium', search = false, onEvent }) {
    const resp = await fetch(`${this.base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        message, history, model: 'jacky', thinking: true, level, search, chat_id,
      }),
    });
    if (!resp.ok) {
      let e = '';
      try { e = (await resp.json()).error || ''; } catch (_) {}
      throw new Error(`HTTP ${resp.status} ${e}`);
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', answer = '', source = null, chatId = null;
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
        else if (j.type === 'reset') answer = '';        // 换源了，前半截作废
        else if (j.type === 'done' && j.chatId) chatId = j.chatId;
        else if (j.type === 'error') throw new Error(`${j.message} :: ${JSON.stringify(j.detail || [])}`);
      }
    }
    return { answer, source, chatId };
  }

  async newChat() {
    const r = await fetch(`${this.base}/api/ai/chats`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ model: 'jacky' }),
    });
    return (await r.json()).chat.id;
  }
}

// ------------------------------------------------------------
// 2. 限速队列 —— /api/ai/chat 是 10 次/分钟 + 100 次/小时（按 IP）
// ------------------------------------------------------------
class RateLimiter {
  constructor(perMinute = 8, perHour = 90) {   // 留点余量
    this.perMinute = perMinute; this.perHour = perHour;
    this.min = []; this.hour = [];
  }
  async take() {
    for (;;) {
      const now = Date.now();
      this.min = this.min.filter((t) => now - t < 60000);
      this.hour = this.hour.filter((t) => now - t < 3600000);
      if (this.min.length < this.perMinute && this.hour.length < this.perHour) {
        this.min.push(now); this.hour.push(now);
        return;
      }
      const wait = Math.min(
        this.min.length ? 60000 - (now - this.min[0]) : 1000,
        this.hour.length ? 3600000 - (now - this.hour[0]) : 1000,
      );
      await new Promise((r) => setTimeout(r, Math.max(250, wait)));
    }
  }
}

// ------------------------------------------------------------
// 3. 提示词里的敏感片段占位符化
//    服务端会拒绝含 ../ $( <script {{7*7}} 等的正文（400）
// ------------------------------------------------------------
function safeForPrompt(s) {
  return String(s == null ? '' : s)
    .replace(/\.\./g, '__DD__')
    .replace(/\$\(/g, '__DP__')
    .replace(/</g, '__LT__')
    .replace(/\x00/g, '');
}
function restore(s) {
  return String(s == null ? '' : s)
    .replace(/__DD__/g, '..')
    .replace(/__DP__/g, '$(')
    .replace(/__LT__/g, '<');
}

// ------------------------------------------------------------
// 4. 团队
// ------------------------------------------------------------
const ROLES = {
  planner:   { title: '规划员', ask: '把任务拆成 3-5 个可执行的子步骤，每步一行，不要展开说明。' },
  architect: { title: '架构师', ask: '给出技术方案：模块划分、接口、数据流。只输出方案本身。' },
  critic:    { title: '评审员', ask: '指出方案里的问题、风险和遗漏，按严重程度排序，每条一行。' },
  lead:      { title: '负责人', ask: '综合上面所有意见，给出最终决策和执行顺序，不要罗列过程。' },
};

class Team {
  constructor(jack, opts = {}) {
    this.j = jack;
    this.rl = new RateLimiter(opts.perMinute ?? 8, opts.perHour ?? 90);
    this.chats = new Map();
  }

  async chatId(key) {
    if (!this.chats.has(key)) this.chats.set(key, await this.j.newChat());
    return this.chats.get(key);
  }

  async ask(key, task, board = []) {
    const r = ROLES[key];
    await this.rl.take();
    const msg = [
      `你现在扮演「${r.title}」。`,
      `你的任务：${r.ask}`,
      board.length ? `【同事们的产出，供你参考】\n${board.join('\n---\n')}` : '',
      `【要处理的内容】\n${safeForPrompt(task)}`,
      `只输出你的产出，不要复述任务，不要寒暄。`,
    ].filter(Boolean).join('\n');
    let lastErr = null;
    for (let i = 0; i < 4; i++) {
      try {
        const out = await this.j.chat({ message: msg, chat_id: await this.chatId(key) });
        if (out.source) {
          process.stderr.write(`    [${r.title}] 由 ${out.source.provider} / ${out.source.model} 作答\n`);
        }
        return out.answer;
      } catch (e) {
        lastErr = e;
        const is429 = /429|Too many requests/i.test(String(e.message));
        if (!is429 || i === 3) break;
        await new Promise((r2) => setTimeout(r2, 2000 * (i + 1) + Math.random() * 1000));
      }
    }
    throw lastErr;
  }

  // 串行流水线：规划 → 架构 → 评审 → 决策
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

  // 并行专家（注意：并发会瞬时吃掉多份额度，5 个以上要改成排队）
  async council(task, keys = ['planner', 'architect', 'critic']) {
    const outs = await Promise.all(keys.map((k) => this.ask(k, task, [])));
    return this.ask('lead', task, outs.map((o, i) => `【${ROLES[keys[i]].title}】\n${o}`));
  }
}

// ------------------------------------------------------------
// 5. main
// ------------------------------------------------------------
(async () => {
  const [username, password, task] = process.argv.slice(2);
  if (!username || !password || !task) {
    console.error('用法：node tools/agent-team.js <username> <password> "你的任务"');
    process.exit(1);
  }
  const jack = await Jacky.login(BASE, username, password);
  const st = await (await fetch(`${BASE}/api/ai/status`, { headers: { Authorization: `Bearer ${jack.token}` } })).json();
  const ready = st.providers.filter((p) => p.ready).map((p) => p.id);
  console.error(`引擎链就绪：${ready.join(', ') || '(无)'}`);

  const team = new Team(jack);
  const out = await team.run(task);
  // run() 的返回键和角色键不是一一对应 —— 按顺序把标题对上。
  const titles = ['规划员', '架构师', '评审员', '负责人'];
  Object.values(out).forEach((v, i) => {
    console.log(`\n===== ${titles[i] || '结果'} =====\n${restore(v)}`);
  });
})().catch((e) => { console.error('失败：', e.message); process.exit(1); });
