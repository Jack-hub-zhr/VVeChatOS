/* ============================================================
   550C BOOT — startup animation + theme switch
   ------------------------------------------------------------
   Visual layer ported from:
     yannicksong0106/dsh-550c-boot
     MIT License — Copyright (c) 2026 Ziyang Song

   Only the look & feel is reused (palette, CRT texture, logo
   write-on animation, HUD window sequence).  No upstream
   runtime dependency.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'vve:boot550c';
  var LOGO_URL = 'boot550c-logo.svg';
  var OVERLAY_ID = 'boot550c-overlay';

  /* ---------------- content of the stage-2 sequence ---------------- */

  var TELEMETRY = [
    ['Radio', null],
    ['BAND', '100 MHz · SCS 30 kHz'],
    ['BW', '4×4 DL / 2×2 UL'],
    ['PCI', '207'],
    ['TAC', '4172'],
    ['CELL', '0x5A3F'],
    ['PROTOCOL', 'CONNECTED', 'ok'],
    ['CIPHER', 'AES-256-GCM'],
    ['INTEGRITY', 'NIA2 · CMAC'],
    ['KEY ROT', '289 ms'],
    ['Metrics', null],
    ['TSPR', '-87 dBm'],
    ['SINR', '19.6 dB'],
    ['BLER', '0.55 %']
  ];

  /* The "system auto-retrieval" pass: the VVeChat subsystems being
     indexed before the session is handed over. */
  var SCAN_STEPS = [
    ['LOCAL INDEX', 'ok'],
    ['SESSION CACHE', 'ok'],
    ['FRIEND GRAPH', 'ok'],
    ['MODEL ROUTER', 'ok'],
    ['ARCHIVE VAULT', 'ok'],
    ['CREDENTIAL SET', 'warn']
  ];

  var TERMINAL = [
    ['sys', '[550C-INFER] 完整性校验: NIA2 (AES-CMAC)。'],
    ['inf', '[550C-INFER] 心跳周期: 20ms, HARQ 16 processes。'],
    ['sys', '[550C-INFER] 任务队列同步异常, 检测到...'],
    ['sub', '  PWR_CMD_DO_FLIGHTENRATION: (185) 注入'],
    ['sub', '  MAY_CMD_NAV_LAND: 启动'],
    ['ok', '[550C] 建立备份核心闪道:'],
    ['sys', '[550C] 源: 550C-QUANTUM-0'],
    ['sys', '[550C] 目标: 550C-ROOT-KEYSTORE']
  ];

  var CODE = [
    '// --- end of PGM image --- ?',
    '#include <px4_platform_common/px4.h>',
    '#include <px4_platform_crypto/sha256.h>',
    '#include <mavlink/v2.0/common/mavlink.h>',
    '',
    'static const u32 fw_magic = 0x90583431;',
    'static const u8  root_cal = 0xCA550C03;',
    '',
    'void pxd_secure_boot(void) {',
    '    u32 sig = read_reg(BOOT_SIG);',
    '    if (sig != fw_magic) panic("FW_SIG_MISMATCH");',
    '    if (verify_signature(IMG_BASE, IMG_SIZE, root_cal))',
    '        jump_kernel();',
    '    else { set_rollback_slot(SLOT_A); reboot(); }',
    '}'
  ];

  var NODE_COUNT = 47;

  /* ---------------- state ---------------- */
  function enabled() {
    try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
  }
  function setEnabled(v) {
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (_) {}
    applyThemeClass();
  }
  function applyThemeClass() {
    if (!document.body) return;
    document.body.classList.toggle('theme-550c', enabled());
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function randomSession() {
    var s = '';
    var chars = '0123456789ABCDEF';
    for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * 16)];
    return s;
  }

  /* ---------------- overlay markup ---------------- */
  function buildOverlay() {
    var el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.innerHTML =
      /* ---- top HUD strip ---- */
      '<div class="boot550c-hud-top" id="bw-hud-top">' +
        '<span class="brand">◢ 550C // VVE-BS-07</span>' +
        '<span class="sep">│</span>' +
        '<span class="item">MODE <b>OVERRIDE</b></span>' +
        '<span class="sep">│</span>' +
        '<span class="item">JURISDICTION <b>CN-BJ-07</b></span>' +
        '<span class="sep">│</span>' +
        '<span class="item">SESSION <b id="bw-session">————</b></span>' +
        '<span class="spacer"></span>' +
        '<span class="item">TIME <b id="bw-time">00:00:00</b></span>' +
        '<span class="sep">│</span>' +
        '<span class="item live">● REC</span>' +
      '</div>' +

      /* ---- instrument windows ---- */
      '<div class="boot550c-workspace" id="bw-workspace">' +
        '<div class="boot550c-win bw-tele" id="bw-tele">' +
          '<div class="bw-head"><span class="led"></span>TELEMETRY / C-RAN<span class="tag">LIVE</span></div>' +
          '<div class="bw-body" id="bw-tele-body"></div>' +
        '</div>' +
        '<div class="boot550c-win bw-main" id="bw-scan">' +
          '<div class="bw-head"><span class="led cyan"></span>SYSTEM AUTO-SCAN<span class="tag" id="bw-scan-tag">IDLE</span></div>' +
          '<div class="bw-body" id="bw-scan-body"></div>' +
        '</div>' +
        '<div class="boot550c-win bw-code" id="bw-code">' +
          '<div class="bw-head"><span class="led red"></span>550C CORE TERMINAL<span class="tag">RT</span></div>' +
          '<div class="bw-body" id="bw-code-body"></div>' +
        '</div>' +
        '<div class="boot550c-win bw-node" id="bw-node">' +
          '<div class="bw-head"><span class="led"></span>SWARM NODE MATRIX<span class="tag">' + NODE_COUNT + ' NODES</span></div>' +
          '<div class="bw-body" id="bw-node-body"></div>' +
        '</div>' +
      '</div>' +

      /* ---- bottom HUD strip ---- */
      '<div class="boot550c-hud-bot" id="bw-hud-bot">' +
        '<span class="item">HANDLER <b>ACTIVE</b></span>' +
        '<span class="sep">│</span>' +
        '<span class="item">STAGE <b id="bw-stage">BOOT</b></span>' +
        '<span class="spacer"></span>' +
        '<span class="item">T-<b id="bw-elapsed">00:00</b></span>' +
        '<span class="prog"><span class="fill" id="bw-prog-fill"></span></span>' +
        '<span class="pct" id="bw-pct">0%</span>' +
      '</div>' +

      /* ---- overlay dialogs ---- */
      '<div class="boot550c-pop" id="bw-pop-summary">' +
        '<div class="boot550c-pop-title">◢ OVERRIDE SUMMARY<span style="margin-left:auto">— □ ×</span></div>' +
        '<div class="boot550c-pop-body">' +
          '<div class="pop-big" id="bw-pop-big">0</div>' +
          '<div class="dt" id="bw-pop-dt"></div>' +
          '<div class="pop-note" id="bw-pop-note"></div>' +
        '</div>' +
      '</div>' +
      '<div class="boot550c-pop danger" id="bw-pop-inject">' +
        '<div class="boot550c-pop-title">⚠ SESSION HANDOVER<span style="margin-left:auto">— □ ×</span></div>' +
        '<div class="boot550c-pop-body">' +
          '<div class="dt" id="bw-pop2-dt"></div>' +
          '<div class="pop-note" id="bw-pop2-note"></div>' +
          '<div class="pop-actions"><span class="pop-btn">VIEW LOG</span><span class="pop-btn primary">PROCEED</span></div>' +
        '</div>' +
      '</div>' +

      /* ---- logo stage ---- */
      '<div class="boot550c-stage" id="bw-stage-el">' +
        '<div class="boot550c-logo-host"></div>' +
        '<div class="boot550c-text" id="boot550c-text">550C SYSTEM BOOT<span class="cursor"></span></div>' +
      '</div>' +
      '<div class="boot550c-hint" id="boot550c-hint">CLICK / TAP TO SKIP</div>';
    return el;
  }

  var playing = false;
  // The promise of the run that is on screen right now. When play() is
  // called again while a boot is in flight we hand back THIS promise, so
  // the caller waits for the animation instead of walking straight into
  // the app while the overlay is still up.
  var currentPlay = null;

  /**
   * Play the 550C boot animation.
   * @param {object} opts  { text, skipHint }
   * @returns {Promise<void>} resolves when the overlay is gone
   */
  function play(opts) {
    opts = opts || {};
    if (playing) return currentPlay || Promise.resolve();
    playing = true;

    var overlay = buildOverlay();
    var bootT0 = Date.now();
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { overlay.classList.add('boot550c-in'); });
    });

    var textEl = overlay.querySelector('#boot550c-text');
    var hintEl = overlay.querySelector('#boot550c-hint');
    var hostEl = overlay.querySelector('.boot550c-logo-host');
    if (opts.text) textEl.innerHTML = opts.text + '<span class="cursor"></span>';
    if (opts.skipHint !== false) hintEl.classList.add('show');

    var finished = false;
    var timers = [];
    var intervals = [];
    var clockTimer = null;
    var resolveDone;
    var done = new Promise(function (r) { resolveDone = r; });
    currentPlay = done;

    function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
    // Beats are written as offsets from the start of the boot, so they
    // stay in sync no matter when the logo SVG finishes loading.
    function schedule(fn, absMs) {
      return later(fn, Math.max(0, absMs - (Date.now() - bootT0)));
    }
    function every(fn, ms) { var t = setInterval(fn, ms); intervals.push(t); return t; }
    function cleanup() {
      timers.forEach(clearTimeout);
      timers = [];
      intervals.forEach(clearInterval);
      intervals = [];
      if (clockTimer) clearInterval(clockTimer);
      overlay.removeEventListener('click', onSkip);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      overlay.remove();
      playing = false;
      currentPlay = null;
      resolveDone();
    }
    function onSkip() { if (!finished) finish(320); }
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        if (!finished) finish(320);
      }
    }
    function finish(fadeMs) {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      timers = [];
      overlay.classList.add('boot550c-out');
      setTimeout(cleanup, fadeMs == null ? 520 : fadeMs);
    }
    overlay.addEventListener('click', onSkip);
    document.addEventListener('keydown', onKey);

    /* ---------- stage 1: the logo write-on ---------- */
    var logoSvg = null;
    var logoReq = fetch(LOGO_URL, { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('logo http ' + r.status)); })
      .then(function (txt) {
        // Guard against a non-SVG response (a proxy error page, a JSON
        // body, …) — injecting that would dump garbage on screen.
        var t = String(txt || '').trim();
        if (t.charAt(0) !== '<' || t.indexOf('<svg') === -1) throw new Error('not an svg');
        logoSvg = t;
      })
      .catch(function () { logoSvg = null; });
    // Never let a slow CDN strand the boot on an empty screen.
    Promise.race([logoReq, sleep(4000)]).then(function () { return startAnimation(); });

    function startAnimation() {
      if (logoSvg) {
        hostEl.innerHTML = logoSvg;
        var svg = hostEl.querySelector('svg');
        if (svg) {
          svg.removeAttribute('width');
          svg.removeAttribute('height');
          var logo = svg.querySelector('#logo');
          if (logo) {
            logo.classList.add('boot550c-logo');
            animateLogo(logo, later);
          }
        }
      }
      schedule(function () { textEl.classList.add('show'); }, 2400);
      schedule(function () { stageTwo(); }, 2700);
    }

    function animateLogo(logo, laterFn) {
      var paths = Array.prototype.slice.call(logo.querySelectorAll('path'));
      paths.forEach(function (p) {
        p.style.opacity = '0.08';
        p.style.clipPath = 'inset(0 0 0 0)';
        p.style.webkitClipPath = 'inset(0 0 0 0)';
      });
      var sorted = paths.map(function (p) {
        var x = 0;
        try { x = p.getBBox().x; } catch (_) { x = 0; }
        return { el: p, x: x };
      }).sort(function (a, b) { return a.x - b.x; });

      sorted.forEach(function (item, i) {
        laterFn(function () {
          var p = item.el;
          p.style.clipPath = 'inset(0 100% 0 0)';
          p.style.webkitClipPath = 'inset(0 100% 0 0)';
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              p.style.transition = 'clip-path .6s cubic-bezier(.4,0,.2,1), opacity .35s ease';
              p.style.opacity = '1';
              p.style.clipPath = 'inset(0 0 0 0)';
              p.style.webkitClipPath = 'inset(0 0 0 0)';
            });
          });
        }, 250 + i * 300);
      });

      laterFn(function () { logo.classList.add('finished'); }, 250 + sorted.length * 300 + 400);
    }

    /* ---------- stage 2: HUD, windows, dialogs ---------- */
    function stageTwo() {
      var q = function (sel) { return overlay.querySelector(sel); };

      /* the logo hands over to the instrument wall */
      var stageEl = q('#bw-stage-el');
      if (stageEl) stageEl.classList.add('hide');
      schedule(function () { q('#bw-hud-top').classList.add('show'); }, 2740);
      schedule(function () { q('#bw-workspace').classList.add('show'); }, 2780);
      schedule(function () { q('#bw-hud-bot').classList.add('show'); }, 2820);

      /* live clock + elapsed counter */
      var t0 = Date.now();
      q('#bw-session').textContent = randomSession();
      clockTimer = every(function () {
        var s = Math.floor((Date.now() - t0) / 1000);
        var d = new Date();
        q('#bw-time').textContent = pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
        q('#bw-elapsed').textContent = pad(Math.floor(s / 60), 2) + ':' + pad(s % 60, 2);
      }, 1000);

      /* progress bar across the whole sequence */
      var progFill = q('#bw-prog-fill');
      var pct = q('#bw-pct');
      var stageLabel = q('#bw-stage');
      var PROG_START = 2700, PROG_END = 7600;
      every(function () {
        var p = Math.max(0, Math.min(1, (Date.now() - bootT0 - PROG_START) / (PROG_END - PROG_START)));
        progFill.style.width = (p * 100).toFixed(1) + '%';
        pct.textContent = Math.round(p * 100) + '%';
      }, 120);

      /* --- window 1: telemetry --- */
      var teleBody = q('#bw-tele-body');
      schedule(function () { q('#bw-tele').classList.add('show'); }, 2950);
      TELEMETRY.forEach(function (row, i) {
        schedule(function () {
          var html = '';
          if (row[1] === null) {
            html += '<div class="sect">' + esc(row[0]) + '</div>';
          } else {
            html += '<div class="dt"><span class="k">' + esc(row[0]) + '</span>' +
                    '<span class="v ' + (row[2] || '') + '">' + esc(row[1]) + '</span></div>';
          }
          teleBody.insertAdjacentHTML('beforeend', html);
        }, 3050 + i * 90);
      });
      /* a small signal histogram underneath the readouts */
      schedule(function () {
        var bars = '';
        for (var b = 0; b < 28; b++) {
          var h = 12 + Math.round((Math.sin(b * 0.9) * 0.5 + 0.5) * 34) + (b % 3) * 4;
          bars += '<span style="height:' + h + 'px"></span>';
        }
        teleBody.insertAdjacentHTML('beforeend',
          '<div class="sect">Signal</div><div class="sig-bars">' + bars + '</div>');
      }, 3050 + TELEMETRY.length * 90);

      /* --- window 2: SYSTEM AUTO-SCAN (the retrieval pass) --- */
      var scanBody = q('#bw-scan-body');
      var scanTag = q('#bw-scan-tag');
      schedule(function () { q('#bw-scan').classList.add('show'); }, 3250);
      schedule(function () {
        scanBody.insertAdjacentHTML('beforeend',
          '<div class="dt"><span class="k">TARGET</span><span class="v">VVE-MESH / CN-BJ-07</span></div>' +
          '<div class="dt"><span class="k">MODE</span><span class="v">AUTO RETRIEVAL</span></div>' +
          '<div class="sect">Scan</div>');
      }, 3350);
      SCAN_STEPS.forEach(function (step, i) {
        schedule(function () {
          scanBody.insertAdjacentHTML('beforeend',
            '<div class="scan-row busy" id="scan-row-' + i + '">' +
              '<span class="k">SCAN</span><span>' + esc(step[0]) + '</span>' +
              '<span class="st">···</span>' +
            '</div>');
        }, 3550 + i * 240);
        schedule(function () {
          var row = overlay.querySelector('#scan-row-' + i);
          if (!row) return;
          row.classList.remove('busy');
          row.querySelector('.st').textContent = step[1] === 'warn' ? '[!]' : '[ OK ]';
          row.querySelector('.st').style.color = step[1] === 'warn'
            ? 'var(--c550-amber-b)' : 'var(--c550-green)';
        }, 3550 + i * 240 + 190);
      });
      schedule(function () {
        scanBody.insertAdjacentHTML('beforeend',
          '<div class="scan-bar"><span class="fill" id="bw-scan-bar"></span></div>' +
          '<div class="scan-stat"><span>HITS 128</span><span>SCANNED ' + NODE_COUNT + '</span><span>ELAPSED 00:01:28</span></div>' +
          '<div class="ln ok" style="margin-top:6px">[SCAN] COMPLETE — ' + NODE_COUNT + ' SOURCES INDEXED</div>');
        var bar = overlay.querySelector('#bw-scan-bar');
        var w = 0;
        var barTimer = every(function () {
          w = Math.min(100, w + 7);
          if (bar) bar.style.width = w + '%';
          if (w >= 100) clearInterval(barTimer);
        }, 55);
      }, 3550 + SCAN_STEPS.length * 240 + 120);
      /* retrieved hits stream in behind the summary */
      var HITS = [
        ['SRC-0042', 'SESSION CACHE', '12 ENTRIES'],
        ['SRC-0117', 'FRIEND GRAPH', '03 ENTRIES'],
        ['SRC-0233', 'MODEL ROUTER', '08 ENTRIES'],
        ['SRC-0419', 'ARCHIVE VAULT', '27 ENTRIES']
      ];
      var hitsAt = 3550 + SCAN_STEPS.length * 240 + 260;
      schedule(function () {
        scanBody.insertAdjacentHTML('beforeend', '<div class="sect">Retrieved</div>');
      }, hitsAt);
      HITS.forEach(function (h, i) {
        schedule(function () {
          scanBody.insertAdjacentHTML('beforeend',
            '<div class="dt"><span class="k">' + esc(h[0]) + '</span>' +
            '<span class="v dim">' + esc(h[1]) + ' · ' + esc(h[2]) + '</span></div>');
        }, hitsAt + 120 + i * 150);
      });
      schedule(function () { scanTag.textContent = 'DONE'; }, 3550 + SCAN_STEPS.length * 240 + 120);

      /* --- window 3: core terminal --- */
      var codeBody = q('#bw-code-body');
      schedule(function () { q('#bw-code').classList.add('show'); }, 3550);
      TERMINAL.forEach(function (row, i) {
        schedule(function () {
          codeBody.insertAdjacentHTML('beforeend',
            '<div class="ln ' + row[0] + '">' + esc(row[1]) + '</div>');
        }, 3650 + i * 210);
      });

      /* --- window 4: swarm node matrix --- */
      var nodeBody = q('#bw-node-body');
      schedule(function () { q('#bw-node').classList.add('show'); }, 3850);
      schedule(function () {
        var g = '';
        for (var i = 0; i < NODE_COUNT; i++) {
          g += '<div class="uav" data-n="' + i + '">' +
               '<svg viewBox="0 0 24 24" fill="none" stroke="#e05030" stroke-width="1.6">' +
               '<path d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z"/><circle cx="12" cy="12" r="2.4" fill="#e05030" stroke="none"/>' +
               '</svg><span class="id">U-' + pad(i + 1, 3) + '</span><span class="st">STAGED</span></div>';
        }
        nodeBody.insertAdjacentHTML('beforeend', '<div class="node-grid">' + g + '</div>');
      }, 3950);
      schedule(function () {
        var nodes = nodeBody.querySelectorAll('.uav');
        var idx = 0;
        var nodeTimer = every(function () {
          if (idx >= nodes.length) { clearInterval(nodeTimer); return; }
          var cur = idx;               // capture — idx keeps moving
          nodes[cur].classList.add('on');
          later(function () {
            if (!nodes[cur]) return;
            nodes[cur].classList.add('done');
            var st = nodes[cur].querySelector('.st');
            if (st) st.textContent = 'READY';
          }, 260);
          idx++;
        }, 42);
      }, 4000);

      /* --- dialog 1: override summary --- */
      schedule(function () {
        var pop = q('#bw-pop-summary');
        pop.style.left = '52%';
        pop.style.top = '26%';
        pop.classList.add('show');
        q('#bw-pop-big').textContent = '0';
        q('#bw-pop-dt').innerHTML =
          '<div class="k">TOTAL</div><div class="v">' + NODE_COUNT + '</div>' +
          '<div class="k">SUCCESS</div><div class="v ok" id="bw-pop-succ">0</div>' +
          '<div class="k">ROLLBACK</div><div class="v warn">0</div>' +
          '<div class="k">ELAPSED</div><div class="v dim">T-00:01:28</div>';
        q('#bw-pop-note').textContent = '正在覆写节点固件，请稍候…';
        var succ = 0;
        var big = q('#bw-pop-big');
        var succEl = q('#bw-pop-succ');
        var cTimer = every(function () {
          succ++;
          if (succ > NODE_COUNT) {
            succ = NODE_COUNT;
            clearInterval(cTimer);
            q('#bw-pop-note').textContent = '所有节点固件写入完成，已切换至 550C 安全飞控。';
            return;
          }
          big.textContent = succ;
          succEl.textContent = succ;
        }, 26);
      }, 5300);

      /* --- dialog 2: session handover (danger) --- */
      schedule(function () {
        var pop = q('#bw-pop-inject');
        pop.style.left = '14%';
        pop.style.top = '52%';
        pop.classList.add('show');
        q('#bw-pop2-dt').innerHTML =
          '<div class="k">STATE</div><div class="v warn">STAGED</div>' +
          '<div class="k">ROOT</div><div class="v">550C-ROOT</div>' +
          '<div class="k">DISPATCH</div><div class="v">WRITE</div>';
        q('#bw-pop2-note').textContent = '写入 550C 临时根证书至调度核心…';
      }, 6300);

      /* --- wrap up --- */
      schedule(function () { stageLabel.textContent = 'HANDOVER'; }, 6600);
      schedule(function () {
        stageLabel.textContent = 'READY';
        q('#bw-pop-note').textContent = '所有节点固件写入完成，已切换至 550C 安全飞控。';
      }, 7400);
      schedule(function () { finish(620); }, 8200);
    }
  }

  /* ---------------- public API ---------------- */
  window.Boot550C = {
    enabled: enabled,
    setEnabled: setEnabled,
    applyThemeClass: applyThemeClass,
    play: play,
    KEY: KEY
  };

  // Apply the class as early as possible so there is no flash of the
  // default theme before app.js boots.
  applyThemeClass();

  // Warm the logo cache while the rest of the page is still loading —
  // by the time the boot screen appears the SVG is usually already in.
  try { fetch(LOGO_URL, { cache: 'force-cache' }).catch(function () {}); } catch (_) {}
})();
