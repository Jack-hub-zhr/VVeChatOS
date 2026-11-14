/* ============================================================
   LIQUID GLASS — 液态玻璃折射引擎
   ------------------------------------------------------------
   全站只建【一个】SVG 滤镜，所有 .glass 共用 url(#lg-refract)：

     feImage(位移贴图) → feDisplacementMap(按贴图把背景掰弯)

   位移贴图取自 rdev/liquid-glass-react 的 256×256 静态场（MIT）：
   中心几乎不动，越靠边位移越大 —— 天然就是「边缘掰弯」。
   静态贴图 ⇒ 面板改尺寸不用重算，也不会像逐像素 SDF 那样撕裂。

   之前是「每个面板各建一个滤镜」，元素一多就是几十个 filter，
   手机上很慢；现在整页只有一个。

   ⚠️ Safari 会把 backdrop-filter: url(#…) 渲染成一块灰斑
   （CSS.supports 却返回 true），所以 Safari 上不折射，只留磨砂。
   ============================================================ */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';

  // 折射强度（px）：面板边缘把背景掰弯的幅度。
  var REFRACT = 34;

  var IS_SAFARI = /Safari/.test(navigator.userAgent) &&
    !/(Chrome|Chromium|Edg|OPR|Android)/.test(navigator.userAgent);

  var SUPPORTS_REFRACTION = !IS_SAFARI && (function () {
    try {
      return !!(window.CSS && CSS.supports &&
        (CSS.supports('backdrop-filter', 'url(#x)') ||
         CSS.supports('-webkit-backdrop-filter', 'url(#x)')));
    } catch (_) { return false; }
  })();

  var FILTER_ID = 'lg-refract';

  function buildFilter() {
    var mapUrl = (window.__LG_MAPS || {}).standard;
    if (!mapUrl) return false;
    if (document.getElementById(FILTER_ID)) return true;

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:-1';
    document.body.appendChild(svg);

    var defs = document.createElementNS(SVGNS, 'defs');
    svg.appendChild(defs);

    var f = document.createElementNS(SVGNS, 'filter');
    f.setAttribute('id', FILTER_ID);
    f.setAttribute('x', '-25%'); f.setAttribute('y', '-25%');
    f.setAttribute('width', '150%'); f.setAttribute('height', '150%');
    f.setAttribute('colorInterpolationFilters', 'sRGB');
    defs.appendChild(f);

    // 位移贴图：随面板拉伸，中心 0 位移、边缘最大
    var img = document.createElementNS(SVGNS, 'feImage');
    img.setAttribute('x', '0'); img.setAttribute('y', '0');
    img.setAttribute('width', '100%'); img.setAttribute('height', '100%');
    img.setAttribute('preserveAspectRatio', 'none');
    img.setAttribute('result', 'MAP');
    img.setAttributeNS(XLINK, 'href', mapUrl);
    f.appendChild(img);

    // 按贴图把背景掰弯（负号 = 边缘往外掰，rdev 的方向约定）
    var d = document.createElementNS(SVGNS, 'feDisplacementMap');
    d.setAttribute('in', 'SourceGraphic');
    d.setAttribute('in2', 'MAP');
    d.setAttribute('scale', String(-REFRACT));
    d.setAttribute('xChannelSelector', 'R');
    d.setAttribute('yChannelSelector', 'B');
    f.appendChild(d);
    return true;
  }

  if (!SUPPORTS_REFRACTION || !buildFilter()) {
    document.body.classList.add('lg-norefract');
  }

  /* ---------- 挂载：给元素挂 .glass，剩下的交给 CSS ---------- */
  function register(el) {
    if (!el || el.__lgRegistered) return;
    el.__lgRegistered = true;
    el.classList.add('glass');
  }

  window.LiquidGlass = {
    register: register,
    supportsRefraction: SUPPORTS_REFRACTION && !document.body.classList.contains('lg-norefract')
  };
})();
