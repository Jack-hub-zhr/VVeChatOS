/* ============================================================
   LIQUID GLASS — 液态玻璃
   ------------------------------------------------------------
   视觉语言移植自:
     xiaofangstudio/liquid-glass-web  (MIT)
     折射引擎源自 shuding/liquid-glass (MIT, © Shu Ding)
     动效标准参考 Apple WWDC25《Meet Liquid Glass》
   本文件在原引擎之上加了一层「可复用到整个应用」的封装:
     · 果冻按压物理(springEase 弹簧回弹 + 定向拉伸)
     · 体积光(光晕贴着元素轮廓)
     · 光照互通(按下一块玻璃,附近���玻璃跟着亮)
     · 真折射(SVG 位移贴图)—— 只给关键面板用,成本高
   ============================================================ */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';
  var PARAMS = {
    ref: 0.22,     // 折射强度:面板边缘最多把背景往中心拉的比例
    blur: 0.25,
    band: 22,      // 折射环宽度(px)
    maxPull: 20,   // 位移上限(px) —— 再多就会把面板自己的内容卷进背景
    disp: 2        // 色散:R/B 通道各偏移多少 px(0 = 不色散)
  };

  /* ---------- 工具 ---------- */
  function smoothStep(a, b, t) {
    t = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function roundedRectSDF(x, y, w, h, r) {
    var qx = Math.abs(x) - w + r, qy = Math.abs(y) - h + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  }
  function shade(hex, p) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return hex;
    var c = [1, 2, 3].map(function (i) {
      var v = parseInt(m[i], 16);
      v = p < 0 ? Math.round(v * (1 + p / 100)) : Math.round(v + (255 - v) * (p / 100));
      return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    });
    return '#' + c.join('');
  }

  /* 真折射不是所有浏览器都支持 —— Chrome/Edge 有，Firefox/Safari 会退化成
     普通毛玻璃。先问一句，别白跑一遍像素循环。 */
  var SUPPORTS_REFRACTION = (function () {
    try {
      return !!(window.CSS && CSS.supports &&
        (CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)')));
    } catch (_) { return false; }
  })();

  /* ============================================================
     1. 折射引擎
     ============================================================ */
  var _uid = 0;
  var _svgHost = null;

  function ensureSvgHost() {
    if (_svgHost && _svgHost.isConnected) return _svgHost;
    _svgHost = document.createElementNS(SVGNS, 'svg');
    _svgHost.setAttribute('width', '0');
    _svgHost.setAttribute('height', '0');
    _svgHost.setAttribute('aria-hidden', 'true');
    _svgHost.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:1;';
    document.body.appendChild(_svgHost);
    return _svgHost;
  }

  /**
   * 给一个元素装上真折射。
   * 成本：一次 W×H 的像素循环 + 一次 canvas.toDataURL()。
   * 所以只给关键面板用，不要给列表里每一个元素都装。
   */
  function makeGlass(el, opts) {
    opts = opts || {};
    if (!SUPPORTS_REFRACTION) return null;
    var W = Math.max(2, el.offsetWidth || 100);
    var H = Math.max(2, el.offsetHeight || 100);
    // 位移贴图不必跟元素一样大：折射只发生在边缘一圈，
    // 贴图缩到一半尺寸既省 4 倍算力，肉眼看不出差别。
    var MAP = Math.min(220, Math.max(64, Math.round(Math.max(W, H) / 2)));
    var fid = 'lg-' + (++_uid);

    var svg = document.createElementNS(SVGNS, 'svg');
    var filter = document.createElementNS(SVGNS, 'filter');
    filter.setAttribute('id', fid + '_filter');
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('colorInterpolationFilters', 'sRGB');
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    filter.setAttribute('width', String(W)); filter.setAttribute('height', String(H));

    var feImage = document.createElementNS(SVGNS, 'feImage');
    feImage.setAttribute('id', fid + '_map');   // 位移贴图 —— in2 靠这个 id 引用
    feImage.setAttribute('preserveAspectRatio', 'none');
    feImage.setAttribute('width', String(W)); feImage.setAttribute('height', String(H));
    filter.appendChild(feImage);

    // 滤镜链（顺序是踩坑踩出来的，别改）：
    //   feImage(位移贴图) → 拆 R/G/B → 各偏移 → lighten 合成 → feDisplacementMap(折射)
    //
    // 1) 折射只有「一个」feDisplacementMap。之前用过三条支路（每支路一个位移图），
    //    Chrome 里第二、三条支路的采样会错位，面板右缘整条出现洋红脏影 ——
    //    纯灰背景下照样出现，说明不是背景内容的问题，是滤镜链自己坏了。
    // 2) 色散用「拆通道 + 各自偏移 + feBlend lighten 合成」做：
    //    lighten 对「只有一个通道有值」的图是精确的 max(R,0)=R，三张合起来就是原色。
    //    不能用 feComposite arithmetic —— alpha 会累加，颜色被预乘/反预乘搞坏。
    // 3) 位移图必须放在最后。放在拆通道之前，位移出来的半透明像素会被
    //    lighten 按 alpha 加权求和，整个面板发紫（实测）。
    var chans = ['R', 'G', 'B'].map(function (name, i) {
      var cm = document.createElementNS(SVGNS, 'feColorMatrix');
      cm.setAttribute('type', 'matrix');
      cm.setAttribute('in', 'SourceGraphic');
      var rows = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0', '0 0 0 1 0'];
      rows[i] = ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'][i];
      cm.setAttribute('values', rows.join(' '));
      cm.setAttribute('result', 'c' + name);
      filter.appendChild(cm);
      return 'c' + name;
    });
    // 红蓝各偏一点 → 边缘裂出彩边（真实色散，不是贴一条彩虹）
    var split = { R: 'cR', G: 'cG', B: 'cB' };
    ['R', 'B'].forEach(function (name, i) {
      if (!PARAMS.disp) return;
      var off = document.createElementNS(SVGNS, 'feOffset');
      off.setAttribute('in', 'c' + name);
      off.setAttribute('dx', String(i === 0 ? -PARAMS.disp : PARAMS.disp));
      off.setAttribute('dy', '0');
      off.setAttribute('result', 'o' + name);
      filter.appendChild(off);
      split[name] = 'o' + name;
    });
    // 合成回一张图
    var prevRes = split.R;
    [split.G, split.B].forEach(function (nm, i) {
      var bl = document.createElementNS(SVGNS, 'feBlend');
      bl.setAttribute('mode', 'lighten');
      bl.setAttribute('in', prevRes); bl.setAttribute('in2', nm);
      prevRes = 'x' + i;
      bl.setAttribute('result', prevRes);
      filter.appendChild(bl);
    });
    // 折射：一个位移图，把上面合成好的图整体掰弯
    var feDisp = document.createElementNS(SVGNS, 'feDisplacementMap');
    feDisp.setAttribute('in', prevRes);
    feDisp.setAttribute('in2', fid + '_map');
    feDisp.setAttribute('xChannelSelector', 'R');
    feDisp.setAttribute('yChannelSelector', 'G');
    filter.appendChild(feDisp);
    svg.appendChild(filter);
    ensureSvgHost().appendChild(svg);

    var canvas = document.createElement('canvas');
    canvas.width = MAP; canvas.height = MAP;
    var ctx = canvas.getContext('2d');
    var data = new Uint8ClampedArray(MAP * MAP * 4);
    var raw = new Float32Array(MAP * MAP * 2);
    var maxScale = 0, i, x, y, d, dx, dy;

    function buildMap() {
      W = Math.max(2, el.offsetWidth || W);
      H = Math.max(2, el.offsetHeight || H);
      filter.setAttribute('width', String(W)); filter.setAttribute('height', String(H));
      feImage.setAttribute('width', String(W)); feImage.setAttribute('height', String(H));
      // 折射环贴着面板自己的圆角矩形走 —— 用元素真实的圆角，
      // 长条面板的边缘才不会歪。
      var rad = 0;
      try { rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0; } catch (_) {}
      rad = Math.min(rad, Math.min(W, H) / 2);
      var bandPx = Math.min(PARAMS.band, Math.min(W, H) * 0.45);
      maxScale = 0;
      var idx = 0;
      for (i = 0; i < data.length; i += 4) {
        x = (i / 4) % MAP; y = Math.floor(i / 4 / MAP);
        // 元素像素坐标（中心为原点）。位移量必须是 CSS px ——
        // feDisplacementMap 的 scale 走的是 user space，
        // 用贴图像素算会差好几倍（贴图被拉伸过）。
        var ex = (x / MAP - 0.5) * W, ey = (y / MAP - 0.5) * H;
        // 到面板边框的距离：边上 0，往里为正。
        // SDF 必须按面板自己的形状算 —— 撑满写法会让位移场恒为 1，折射直接消失。
        d = -roundedRectSDF(ex, ey, W / 2, H / 2, rad);
        // 边上一圈最强，往里 bandPx 过渡回「不折射」，中间保持平坦（放大感）。
        var s2 = 1 - PARAMS.ref * (1 - smoothStep(0, bandPx, d));
        dx = ex * (s2 - 1); dy = ey * (s2 - 1);
        // 拉不动太远：面板自己的内容（头像、角标）会被卷进背景采样，
        // 在边缘拉出一条脏影。所以位移上限压在 maxPull。
        var mag = Math.hypot(dx, dy);
        if (mag > PARAMS.maxPull) {
          var k = PARAMS.maxPull / mag;
          dx *= k; dy *= k;
        }
        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
        raw[idx++] = dx; raw[idx++] = dy;
      }
      // 贴图用满 0..1，不裁剪：R=0.5 是「不位移」，
      // 位移量 = scale × (R-0.5)，所以 scale 取两倍最大值。
      var enc = maxScale > 0 ? 2 * maxScale : 1;
      idx = 0;
      for (i = 0; i < data.length; i += 4) {
        data[i] = (raw[idx++] / enc + 0.5) * 255;
        data[i + 1] = (raw[idx++] / enc + 0.5) * 255;
        data[i + 2] = 0; data[i + 3] = 255;
      }
      ctx.putImageData(new ImageData(data, MAP, MAP), 0, 0);
      feImage.setAttributeNS(XLINK, 'href', canvas.toDataURL());
      // 一个位移图就是全部折射：scale × (R-0.5) = 贴图里存的位移量。
      feDisp.setAttribute('scale', String(enc));
    }

    // 元素原本的模糊/饱和度要留着 —— 只加折射是不够的，
    // 没有模糊的折射看起来是「塑料片」，不是玻璃。
    var prevBackdrop = '';
    try {
      var cs = getComputedStyle(el);
      prevBackdrop = cs.backdropFilter || cs.webkitBackdropFilter || '';
      if (!prevBackdrop || prevBackdrop === 'none') prevBackdrop = '';
    } catch (_) {}

    function apply() {
      var bf = 'url(#' + fid + '_filter)';
      if (prevBackdrop) bf += ' ' + prevBackdrop;
      else bf += ' blur(' + PARAMS.blur + 'px) contrast(1.2) brightness(1.05) saturate(1.1)';
      el.style.backdropFilter = bf;
      el.style.webkitBackdropFilter = bf;
    }

    buildMap();
    apply();
    // 尺寸变了要重算贴图，但别一帧算一次。
    var pending = null;
    var ro = new ResizeObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; buildMap(); apply(); }, 160);
    });
    ro.observe(el);
    return { update: buildMap, destroy: function () { ro.disconnect(); svg.remove(); } };
  }

  /* ============================================================
     2. 光照系统 —— 体积光 + 光照互通
     ============================================================ */
  var litTargets = [];

  function setLit(el, cx, cy, it) {
    var g = el.__litGlow;
    if (!g) return;
    if (it <= 0.02) { g.style.opacity = '0'; return; }
    var r = el.getBoundingClientRect();
    g.style.setProperty('--lx', ((cx - r.left) / Math.max(1, r.width) * 100) + '%');
    g.style.setProperty('--ly', ((cy - r.top) / Math.max(1, r.height) * 100) + '%');
    g.style.opacity = it.toFixed(2);
  }
  function illuminate(src, cx, cy, radius, base) {
    for (var i = 0; i < litTargets.length; i++) {
      var o = litTargets[i];
      if (o.el === src) continue;
      var r = o.el.getBoundingClientRect();
      var dist = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      setLit(o.el, cx, cy, base * Math.max(0, 1 - dist / radius));
    }
  }
  function clearLit(src) {
    for (var i = 0; i < litTargets.length; i++) {
      if (litTargets[i].el !== src) setLit(litTargets[i].el, 0, 0, 0);
    }
  }

  /* ============================================================
     3. 果冻物理
     ============================================================ */
  function springEase(t) { return 1 - Math.exp(-5 * t) * Math.cos(9 * t); }

  function applyJelly(el, k, deg, tx, ty) {
    var base = el.__lgTransform || '';
    var t = base;
    if (tx || ty) t += ' translate3d(' + (tx || 0) + 'px,' + (ty || 0) + 'px,0)';
    if (k && k >= 0.001) {
      t += ' rotate(' + deg + 'deg) scale(' + (1 + k) + ',' + (1 - k * 0.45) + ') rotate(' + (-deg) + 'deg)';
    }
    el.style.transform = t;
  }
  function jellyBack(el, from, dur, onDone) {
    var t0 = performance.now();
    (function step(now) {
      var t = Math.min(1, (now - t0) / dur);
      applyJelly(el, from * (1 - springEase(t)), 0, 0, 0);
      if (t < 1) requestAnimationFrame(step);
      else {
        el.style.transform = el.__lgOwnTransform || '';
        if (onDone) onDone();
      }
    })(t0);
  }

  /* 按下去时的一圈光晕，贴着按钮轮廓。 */
  function volumeLight(cx, cy, r) {
    var v = document.createElement('div');
    v.className = 'lg-volume-light';
    v.style.cssText = 'position:fixed;pointer-events:none;z-index:2000;border-radius:50%;' +
      'left:' + (cx - r) + 'px;top:' + (cy - r) + 'px;width:' + r * 2 + 'px;height:' + r * 2 + 'px;' +
      'background:radial-gradient(circle,rgba(255,255,255,0.42) 0%,rgba(255,255,255,0.12) 40%,transparent 66%);' +
      'mix-blend-mode:screen;opacity:1;transition:opacity .9s ease-out,transform 1.4s cubic-bezier(0.16,1,0.3,1);transform:scale(0.4);';
    document.body.appendChild(v);
    requestAnimationFrame(function () {
      v.style.transform = 'scale(1.25)';
      v.style.opacity = '0';
      setTimeout(function () { v.remove(); }, 1500);
    });
  }

  /* ============================================================
     4. 注册与按压绑定
     ============================================================ */
  var registry = [];
  var pressed = null;

  function ensureGlow(el) {
    if (el.__litGlow) return el.__litGlow;
    var g = document.createElement('div');
    g.className = 'lg-lit-glow';
    el.appendChild(g);
    el.__litGlow = g;
    return g;
  }

  function register(el, opts) {
    opts = opts || {};
    if (!el || el.__lgRegistered) return;
    el.__lgRegistered = true;
    // 记下元素当前的几何变换（CSS 里的 translate/scale 也要保住，
    // 不然按下去的时候果冻形变会把布局顶歪）。
    var computed = '';
    try { computed = getComputedStyle(el).transform; } catch (_) {}
    el.__lgTransform = (computed && computed !== 'none') ? computed : '';
    el.__lgOwnTransform = el.style.transform || '';
    // 只给「本来没有定位」的元素加 position:relative —— 直接给所有元素
    // 加会把 position:fixed 的浮层（用户二级菜单、弹窗）拉回文档流，
    // 菜单会直接掉到屏幕外面去。
    var pos = '';
    try { pos = getComputedStyle(el).position; } catch (_) {}
    if (opts.glow || opts.refract) {
      if (!pos || pos === 'static') el.classList.add('lg-glass');
      else el.classList.add('lg-lit-host');   // 已经定位过了,只加隔离层
    }
    if (opts.press) el.classList.add('lg-pressable');
    if (opts.glow) {
      ensureGlow(el);
      litTargets.push({ el: el });
    }
    if (opts.press) bindPress(el);
    if (opts.refract) {
      el.__lgRefract = makeGlass(el, opts);
    }
  }

  function bindPress(el) {
    el.addEventListener('pointerdown', function (e) {
      if (pressed) return;
      pressed = el;
      el.classList.add('lg-pressed');
      var r = el.getBoundingClientRect();
      // 局部鼓包：按下的位置把「变形中心」推向指针的反侧。
      var dx = (e.clientX - (r.left + r.width / 2)) / Math.max(1, r.width / 2);
      var dy = (e.clientY - (r.top + r.height / 2)) / Math.max(1, r.height / 2);
      var deg = Math.atan2(dy, dx) * 180 / Math.PI;
      var k = 0.06 + Math.min(0.05, Math.hypot(dx, dy) * 0.04);
      applyJelly(el, k, deg, 0, 0);
      if (opts_glow(el)) {
        volumeLight(r.left + r.width / 2, r.top + r.height / 2, r.width * 1.15);
        illuminate(el, e.clientX, e.clientY, 460, 0.9);
      }
    });
    var release = function () {
      if (pressed !== el) return;
      pressed = null;
      el.classList.remove('lg-pressed');
      jellyBack(el, 0.08, 520);
      clearLit(el);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }
  // 体积光是纯装饰 —— 在低性能设备上关掉
  function opts_glow() {
    try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return true; }
  }

  /* ============================================================
     5. 对外接口
     ============================================================ */
  var API = {
    register: register,
    makeGlass: makeGlass,
    illuminate: illuminate,
    volumeLight: volumeLight,
    supportsRefraction: SUPPORTS_REFRACTION,
    /** 扫一遍容器里的玻璃元素并注册 */
    scan: function (root) {
      root = root || document;
      var nodes = root.querySelectorAll('[data-glass], [data-glass-press]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        register(el, {
          glow: el.hasAttribute('data-glass-glow'),
          press: el.hasAttribute('data-glass-press') || el.hasAttribute('data-glass'),
          refract: el.hasAttribute('data-glass-refract')
        });
      }
      return nodes.length;
      return nodes.length;
    },
    /**
     * 只有 550C 终端主题要关掉液态玻璃 —— 终端是硬边、等宽、
     * 琥珀色的另一种语言,跟玻璃混在一起会脏。
     * 浅色和深色都保留：深色背景上的玻璃反而更有质感。
     */
    setTheme: function (theme) {
      document.body.classList.toggle('lg-liquid', theme !== '550c');
    }
  };

  window.LiquidGlass = API;
})();
