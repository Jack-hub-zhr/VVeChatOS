/* ============================================================
   550C BOOT — startup animation + theme switch
   ------------------------------------------------------------
   Visual layer ported from:
     yannicksong0106/dsh-550c-boot
     MIT License — Copyright (c) 2026 Ziyang Song

   Only the look & feel is reused (palette, CRT texture, logo
   write-on animation).  No upstream runtime dependency.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'vve:boot550c';
  var LOGO_URL = 'boot550c-logo.svg';
  var OVERLAY_ID = 'boot550c-overlay';

  var LOG_LINES = [
    'MOUNT   /dev/core0 ............ <span class="ok">[ OK ]</span>',
    'PROBE   VVE-BRIDGE ........... <span class="ok">[ OK ]</span>',
    'LOAD    SESSION .............. <span class="ok">[ OK ]</span>',
    'SYNC    MESH  CN-BJ-07 ....... <span class="warn">[ 1 ]</span>',
    'READY.'
  ];

  /* ---------- state ---------- */
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

  /* ---------- boot overlay ---------- */
  function buildOverlay() {
    var el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.innerHTML =
      '<div class="boot550c-stage">' +
        '<div class="boot550c-logo-host"></div>' +
        '<div class="boot550c-log" id="boot550c-log"></div>' +
        '<div class="boot550c-text" id="boot550c-text">550C SYSTEM BOOT<span class="cursor"></span></div>' +
      '</div>' +
      '<div class="boot550c-hint" id="boot550c-hint">CLICK / TAP TO SKIP</div>';
    return el;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var playing = false;

  /**
   * Play the 550C boot animation.
   * @param {object} opts  { text, logLines, skipHint }
   * @returns {Promise<void>} resolves when the overlay is gone
   */
  function play(opts) {
    opts = opts || {};
    if (playing) return Promise.resolve();
    playing = true;

    var overlay = buildOverlay();
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // fade in
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { overlay.classList.add('boot550c-in'); });
    });

    var textEl = overlay.querySelector('#boot550c-text');
    var logEl = overlay.querySelector('#boot550c-log');
    var hintEl = overlay.querySelector('#boot550c-hint');
    var hostEl = overlay.querySelector('.boot550c-logo-host');
    var logLines = opts.logLines || LOG_LINES;
    if (opts.text) textEl.innerHTML = opts.text + '<span class="cursor"></span>';
    if (opts.skipHint !== false) hintEl.classList.add('show');

    var finished = false;
    var timers = [];
    var resolveDone;
    var done = new Promise(function (r) { resolveDone = r; });

    function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
    function cleanup() {
      timers.forEach(clearTimeout);
      timers = [];
      overlay.removeEventListener('click', onSkip);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      overlay.remove();
      playing = false;
      resolveDone();
    }
    function onSkip() { if (!finished) finish(0); }
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        if (!finished) finish(0);
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

    /* --- load the logo --- */
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

      /* --- terminal log lines type out one by one --- */
      logLines.forEach(function (line, i) {
        later(function () {
          logEl.innerHTML += (logEl.innerHTML ? '\n' : '') + line;
        }, 700 + i * 330);
      });
      later(function () { hintEl.classList.remove('show'); }, 700 + logLines.length * 330 + 1200);

      /* --- the "550C SYSTEM BOOT" caption --- */
      later(function () { textEl.classList.add('show'); }, 2400);

      /* --- overall timing (mirrors the upstream boot) --- */
      var pathCount = logoSvg ? 6 : 0;
      var totalMs = 250 + pathCount * 300 + 400;
      later(function () { finish(600); }, Math.max(totalMs + 600, 700 + logLines.length * 330 + 900));
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

    return done;
  }

  /* ---------- public API ---------- */
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
