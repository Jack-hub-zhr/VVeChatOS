/* ============================================================
   LIQUID GLASS — 液态玻璃折射引擎
   ------------------------------------------------------------
   移植自 rdev/liquid-glass-react（MIT）
   https://github.com/rdev/liquid-glass-react
   原实现是 React 组件，这里是同构的原生 JS 版（VVeChat 不用框架）。

   它和之前那套自研位移贴图的根本区别：
     · 位移场不是自己算的，是 rdev 自带的 256×256 平滑贴图
       （standard / polar / prominent），随元素尺寸拉伸，永远不变形。
     · 滤镜链是 3 条 feDisplacementMap：R/G/B 用略微不同的 scale，
       于是边缘天然带色散 —— 这才是「真的色散」，不是贴一条彩虹。
     · 一张边缘遮罩（EDGE_MASK）把折射限制在边缘一圈，
       中间保持干净清晰，文字不受影响。
     · 贴图是静态的 ⇒ 元素改尺寸不需要重算，整页只建一次滤镜。

   ⚠️ 三条 feDisplacementMap 在 Chrome 里没问题：它们各自读
   SourceGraphic（不是串行接力），最后用 feBlend screen 合成。
   之前出洋红是因为三条支路各自带位移图再混合 —— 结构不一样。
   ============================================================ */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';

  var PARAMS = {
    displacementScale: 105, // 折射强度（像素）—— 边缘拉伸的强度
    aberration: 2,          // 色散：R/G/B 三条位移图的 scale 差
    blur: 2,                // 磨砂
    saturation: 140,        // 饱和度
    mode: 'standard',       // standard | polar | prominent
    ringWidth: 1.5          // 边缘高光线的粗细
  };

  /* ---------- 工具 ---------- */
  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  var SUPPORTS_REFRACTION = (function () {
    try {
      return !!(window.CSS && CSS.supports &&
        (CSS.supports('backdrop-filter', 'url(#x)') ||
         CSS.supports('-webkit-backdrop-filter', 'url(#x)')));
    } catch (_) { return false; }
  })();

  /* 所有滤镜放在同一个 <svg> 里 */
  var svgHost = null;
  function ensureSvgHost() {
    if (svgHost) return svgHost;
    svgHost = document.createElementNS(SVGNS, 'svg');
    svgHost.setAttribute('width', '0');
    svgHost.setAttribute('height', '0');
    svgHost.setAttribute('aria-hidden', 'true');
    svgHost.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:-1';
    document.body.appendChild(svgHost);
    return svgHost;
  }

  function maps() { return window.__LG_MAPS || {}; }

  /* ============================================================
     滤镜链 —— 和 rdev 一一对应
     ============================================================ */
  function buildFilter(fid, mapUrl) {
    var o = PARAMS;
    var svg = ensureSvgHost();
    var defs = el('defs', {}, svg);
    var filter = el('filter', {
      id: fid,
      x: '-35%', y: '-35%', width: '170%', height: '170%',
      colorInterpolationFilters: 'sRGB'
    }, defs);

    // 1) 位移贴图
    el('feImage', {
      id: fid + '_map', x: '0', y: '0', width: '100%', height: '100%',
      result: 'DISPLACEMENT_MAP',
      preserveAspectRatio: 'xMidYMid slice'
    }, filter).setAttributeNS(XLINK, 'href', mapUrl);

    // 2) 用贴图本身算出「边缘强度」→ 边缘遮罩
    el('feColorMatrix', {
      in: 'DISPLACEMENT_MAP', type: 'matrix',
      values: '0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0 0 0 1 0',
      result: 'EDGE_INTENSITY'
    }, filter);
    var ct = el('feComponentTransfer', { in: 'EDGE_INTENSITY', result: 'EDGE_MASK' }, filter);
    el('feFuncA', { type: 'discrete', tableValues: '0 ' + (o.aberration * 0.05) + ' 1' }, ct);

    // 3) 没被折射的原始图 —— 中心用它
    el('feOffset', { in: 'SourceGraphic', dx: '0', dy: '0', result: 'CENTER_ORIGINAL' }, filter);

    // 4) 三条位移图：scale 依次递减 → 边缘自然裂出彩边
    var dir = -1;  // 静态贴图方向和 shader 模式相反
    var chans = [['R', 'RED', 0], ['G', 'GREEN', o.aberration * 0.05], ['B', 'BLUE', o.aberration * 0.1]];
    chans.forEach(function (c) {
      var name = c[0], label = c[1], ab = c[2];
      el('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'DISPLACEMENT_MAP',
        scale: String(o.displacementScale * (dir - ab)),
        xChannelSelector: 'R', yChannelSelector: 'B',
        result: label + '_DISPLACED'
      }, filter);
      var rows = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0', '0 0 0 1 0'];
      rows[name === 'R' ? 0 : name === 'G' ? 1 : 2] = name === 'R' ? '1 0 0 0 0' : name === 'G' ? '0 1 0 0 0' : '0 0 1 0 0';
      el('feColorMatrix', { in: label + '_DISPLACED', type: 'matrix', values: rows.join(' '), result: label + '_CHANNEL' }, filter);
    });

    // 5) screen 合成三条通道（screen 对「只剩一个通道」的图是精确的）
    el('feBlend', { in: 'GREEN_CHANNEL', in2: 'BLUE_CHANNEL', mode: 'screen', result: 'GB_COMBINED' }, filter);
    el('feBlend', { in: 'RED_CHANNEL', in2: 'GB_COMBINED', mode: 'screen', result: 'RGB_COMBINED' }, filter);

    // 6) 轻微模糊，柔化色散
    el('feGaussianBlur', {
      in: 'RGB_COMBINED',
      stdDeviation: String(Math.max(0.1, 0.5 - o.aberration * 0.1)),
      result: 'ABERRATED_BLURRED'
    }, filter);

    // 7) 只保留边缘的折射
    el('feComposite', { in: 'ABERRATED_BLURRED', in2: 'EDGE_MASK', operator: 'in', result: 'EDGE_ABERRATION' }, filter);

    // 8) 中心用原图
    var ct2 = el('feComponentTransfer', { in: 'EDGE_MASK', result: 'INVERTED_MASK' }, filter);
    el('feFuncA', { type: 'table', tableValues: '1 0' }, ct2);
    el('feComposite', { in: 'CENTER_ORIGINAL', in2: 'INVERTED_MASK', operator: 'in', result: 'CENTER_CLEAN' }, filter);

    // 9) 合并
    el('feComposite', { in: 'EDGE_ABERRATION', in2: 'CENTER_CLEAN', operator: 'over' }, filter);
  }

  /* ============================================================
     高光层 —— rdev 的「边缘吃光」：跟着鼠标走的渐变描边
     ============================================================ */
  function makeRing(host) {
    var ring = document.createElement('span');
    ring.className = 'lg-ring';
    ring.style.cssText =
      'position:absolute;inset:0;border-radius:inherit;pointer-events:none;' +
      'padding:' + PARAMS.ringWidth + 'px;' +
      '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
      '-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);' +
      'mask-composite:exclude;' +
      'background:linear-gradient(135deg,rgba(255,255,255,0) 0%,' +
      'rgba(255,255,255,.34) 38%,rgba(255,255,255,.72) 66%,rgba(255,255,255,0) 100%);' +
      'box-shadow:0 0 0 .5px rgba(255,255,255,.5) inset,0 1px 3px rgba(255,255,255,.25) inset;' +
      'mix-blend-mode:screen;opacity:.55;transition:opacity .25s ease;z-index:2;';
    host.appendChild(ring);
    return ring;
  }

  /* 鼠标靠近时，边缘高光跟着转 —— 和 rdev 的方向光一致 */
  function bindLight(ring, host) {
    host.addEventListener('pointermove', function (e) {
      var r = host.getBoundingClientRect();
      var mx = ((e.clientX - r.left) / Math.max(1, r.width)) * 100 - 50;
      var my = ((e.clientY - r.top) / Math.max(1, r.height)) * 100 - 50;
      ring.style.background =
        'linear-gradient(' + (135 + mx * 1.2) + 'deg,' +
        'rgba(255,255,255,0) 0%,' +
        'rgba(255,255,255,' + (0.18 + Math.abs(mx) * 0.006).toFixed(3) + ') ' + Math.max(10, 38 + my * 0.3).toFixed(1) + '%,' +
        'rgba(255,255,255,' + (0.45 + Math.abs(mx) * 0.008).toFixed(3) + ') ' + Math.min(92, 68 + my * 0.4).toFixed(1) + '%,' +
        'rgba(255,255,255,0) 100%)';
    });
  }

  /* ============================================================
     挂载
     ============================================================ */
  var registry = [];

  function makeGlass(el, opts) {
    opts = opts || {};
    if (!SUPPORTS_REFRACTION) return null;
    var M = maps();
    var mapUrl = M[opts.mode || PARAMS.mode] || M.standard;
    if (!mapUrl) return null;

    var fid = 'lg-' + (++_uid);
    buildFilter(fid, mapUrl);

    var prevBackdrop = '';
    try {
      var cs = getComputedStyle(el);
      prevBackdrop = cs.backdropFilter || cs.webkitBackdropFilter || '';
      if (!prevBackdrop || prevBackdrop === 'none') prevBackdrop = '';
    } catch (_) {}

    var bf = 'url(#' + fid + '_filter)';
    bf += ' blur(' + PARAMS.blur + 'px) saturate(' + PARAMS.saturation + '%)';
    el.style.backdropFilter = bf;
    el.style.webkitBackdropFilter = bf;

    // 元素得是定位容器，高光层才贴得住
    var pos = '';
    try { pos = getComputedStyle(el).position; } catch (_) {}
    if (!pos || pos === 'static') el.classList.add('lg-glass');

    var ring = makeRing(el);
    bindLight(ring, el);
    var rec = { el: el, fid: fid, ring: ring, prev: prevBackdrop };
    registry.push(rec);
    return rec;
  }

  function register(el, opts) {
    opts = opts || {};
    if (!el) return;
    if (el.__lgRegistered) return;
    el.__lgRegistered = true;
    if (opts.refract) el.__lgGlass = makeGlass(el, opts);
    else if (opts.glow) {
      var pos = '';
      try { pos = getComputedStyle(el).position; } catch (_) {}
      if (!pos || pos === 'static') el.classList.add('lg-glass');
      el.__lgRing = makeRing(el);
      bindLight(el.__lgRing, el);
    }
  }

  var _uid = 0;

  function setTheme(theme) {
    var off = theme === '550c';
    document.body.classList.toggle('lg-liquid', !off);
    registry.forEach(function (rec) {
      if (off) {
        rec.el.style.backdropFilter = rec.prev || '';
        rec.el.style.webkitBackdropFilter = rec.prev || '';
        if (rec.ring) rec.ring.style.display = 'none';
      } else {
        var bf = 'url(#' + rec.fid + '_filter)';
        bf += ' blur(' + PARAMS.blur + 'px) saturate(' + PARAMS.saturation + '%)';
        rec.el.style.backdropFilter = bf;
        rec.el.style.webkitBackdropFilter = bf;
        if (rec.ring) rec.ring.style.display = '';
      }
    });
  }

  window.LiquidGlass = {
    register: register,
    setTheme: setTheme,
    supportsRefraction: SUPPORTS_REFRACTION,
    markDirty: function () { /* 贴图是静态的，改尺寸不用重算 */ },
    scan: function (root) {
      root = root || document;
      var nodes = root.querySelectorAll('[data-glass], [data-glass-press]');
      for (var i = 0; i < nodes.length; i++) {
        register(nodes[i], {
          glow: nodes[i].hasAttribute('data-glass-glow'),
          press: nodes[i].hasAttribute('data-glass-press') || nodes[i].hasAttribute('data-glass'),
          refract: nodes[i].hasAttribute('data-glass-refract')
        });
      }
      return nodes.length;
    }
  };
})();
