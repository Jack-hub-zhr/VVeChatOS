/* ============================================================
   LIQUID GLASS — 折射引擎（自研位移贴图）
   ------------------------------------------------------------
   自己生成位移贴图，不再依赖外部素材：

     feImage(位移贴图) → feDisplacementMap(按贴图把背景掰弯)

   位移贴图用 canvas 现画：一张 256×256 的平滑位移场。
   R 通道存 X 位移、B 通道存 Y 位移，中心是中性灰（不位移），
   越靠边位移越大 —— 天然就是「边缘掰弯」。

   整页只建【一个】SVG 滤镜，所有 .glass 共用 url(#lg-refract)。
   滤镜层越少，手机上越顺。

   ⚠️ Safari 把 backdrop-filter: url(#…) 渲染成一块灰斑（CSS.supports
   却返回 true），所以 Safari 上不折射，只留磨砂。

   ⚠️ 嵌套的 backdrop-filter 会互相采样，导致「层层叠叠」的重影。
   所以 register() 会检查祖先：已经有玻璃祖先的元素只拿高光轮廓，
   不再叠一层折射（.glass-nested）。
   ============================================================ */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';

  var SIZE = 256;        // 位移贴图边长
  var REFRACT = 26;      // 边缘最大位移（px）
  var FILTER_ID = 'lg-refract';

  var IS_SAFARI = /Safari/.test(navigator.userAgent) &&
    !/(Chrome|Chromium|Edg|OPR|Android)/.test(navigator.userAgent);

  var SUPPORTS_REFRACTION = !IS_SAFARI && (function () {
    try {
      return !!(window.CSS && CSS.supports &&
        (CSS.supports('backdrop-filter', 'url(#x)') ||
         CSS.supports('-webkit-backdrop-filter', 'url(#x)')));
    } catch (_) { return false; }
  })();

  /* ---------- 画位移贴图 ---------- */
  // 径向场：中心不动，四边向外推。边缘的角度变化平滑，不会撕裂。
  function buildDisplacementMap() {
    try {
      var cv = document.createElement('canvas');
      cv.width = SIZE; cv.height = SIZE;
      var ctx = cv.getContext('2d');
      if (!ctx) return null;
      var img = ctx.createImageData(SIZE, SIZE);
      var d = img.data;
      var mid = (SIZE - 1) / 2;
      for (var y = 0; y < SIZE; y++) {
        for (var x = 0; x < SIZE; x++) {
          var dx = (x - mid) / mid;         // -1 .. 1
          var dy = (y - mid) / mid;
          var r = Math.sqrt(dx * dx + dy * dy);
          if (r > 1) r = 1;
          // 幂次曲线：中心几乎不动（r 小），边缘快速增大
          var amt = Math.pow(r, 2.4) * REFRACT;
          var ux = r > 0 ? dx / r : 0;
          var uy = r > 0 ? dy / r : 0;
          var i = (y * SIZE + x) * 4;
          d[i]     = Math.max(0, Math.min(255, Math.round(128 + ux * amt)));
          d[i + 1] = 128;                    // G 不用
          d[i + 2] = Math.max(0, Math.min(255, Math.round(128 + uy * amt)));
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    } catch (_) {
      return null;
    }
  }

  function buildFilter() {
    if (document.getElementById(FILTER_ID)) return true;
    var mapUrl = buildDisplacementMap();
    if (!mapUrl) return false;

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

    var img = document.createElementNS(SVGNS, 'feImage');
    img.setAttribute('x', '0'); img.setAttribute('y', '0');
    img.setAttribute('width', '100%'); img.setAttribute('height', '100%');
    img.setAttribute('preserveAspectRatio', 'none');
    img.setAttribute('result', 'MAP');
    img.setAttributeNS(XLINK, 'href', mapUrl);
    f.appendChild(img);

    // 负号 = 边缘往外掰
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

  /* ---------- 挂载 ---------- */
  function register(el) {
    if (!el || el.__lgRegistered) return;
    el.__lgRegistered = true;
    // 祖先已经有玻璃 → 内层不再叠一层 backdrop-filter（否则 Chrome 会
    // 把相邻层一起采样，渲染成重影）。
    var nested = !!el.closest('.glass');
    el.classList.add('glass');
    if (nested) el.classList.add('glass-nested');
  }

  window.LiquidGlass = {
    register: register,
    supportsRefraction: SUPPORTS_REFRACTION && !document.body.classList.contains('lg-norefract')
  };
})();
