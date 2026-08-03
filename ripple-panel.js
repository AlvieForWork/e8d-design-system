/* ============================================================
   登入前版型左側面板 — 水波效果（2026-08-03 定案）
   ------------------------------------------------------------
   五個登入前頁面共用同一份，各頁不要自己複製一份實作。

   定案參數（Alvie 2026-08-03，設計師同事也選這個方向）：
     觸發方式 = 只有滑鼠劃過（不自動呼吸）
     波紋大小 = 32　折射強度 = 0.04　光暈 = 浮在水面上（不被折射）

   ⚠️ 依賴：jQuery + jquery.ripples（WebGL）。
   引用順序必須是 jquery → jquery.ripples → 本檔，缺一個就不會動。

   ⚠️ 這是「會動的設計稿」用的實作。正式產品若不想為了一個裝飾性效果
   背 jQuery（約 87KB），工程師可換成無依賴的 WebGL 版本，
   視覺參數照下面 OPTS 走即可。

   降級行為：瀏覽器不支援 WebGL 浮點紋理、或使用者開了「減少動態效果」時，
   直接維持原本的 CSS 漸層，不報錯、畫面不缺角。
   ============================================================ */
(function () {
  var panel = document.querySelector('.visual-panel');
  if (!panel) return;

  // 沒載到 library 就安靜退出，維持原本的 CSS 漸層
  if (typeof window.jQuery !== 'function' || typeof window.jQuery.fn.ripples !== 'function') return;

  // 使用者要求減少動態效果：不啟動（與左側光暈的既有處理一致）
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var $panel = window.jQuery(panel);

  var OPTS = {
    resolution:  512,
    dropRadius:  32,     // 2026-08-03 定案：16 太小像雜點、45 太誇張，32 在 745px 寬面板上約佔 9%
    perturbance: 0.04
  };

  /* ============================================================
     底圖生成
     jquery.ripples 只折射 background-image 的 url()，CSS 漸層它讀不到，
     所以要把左側那面漸層「畫成一張圖」再餵給它。

     ⚠️ 關鍵：登入頁用的是 linear-gradient(135deg in oklab, ...)。
     canvas 的 createLinearGradient 只做 sRGB 線性插值，中段會偏濁偏暗，
     顏色跟現行登入頁對不上（設計師一眼看得出來）。
     所以下面自己實作 oklab 插值，算出多個色標再交給 canvas。
     ============================================================ */

  // --- sRGB ↔ oklab（公式取自 Björn Ottosson 的 oklab 定義）---
  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    var v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  function hexToOklab(hex) {
    var r = srgbToLinear(parseInt(hex.slice(1, 3), 16));
    var g = srgbToLinear(parseInt(hex.slice(3, 5), 16));
    var b = srgbToLinear(parseInt(hex.slice(5, 7), 16));
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }
  function oklabToRgbString(L, a, bb) {
    var l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * bb;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return 'rgb(' +
      linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) + ',' +
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) + ',' +
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) + ')';
  }

  // 登入頁的漸層：#FF6416 0% → #1A1512 34%（34% 之後維持深色）
  // 對應 auth-tokens.css 的 --primary-700 與 --neutral-black
  var C0 = hexToOklab('#FF6416');
  var C1 = hexToOklab('#1A1512');

  function addOklabStops(grad, from, to) {
    var STEPS = 12;   // 切 12 段逼近 oklab 連續插值，肉眼已看不出階梯
    for (var i = 0; i <= STEPS; i++) {
      var t = i / STEPS;
      grad.addColorStop(
        from + (to - from) * t,
        oklabToRgbString(
          C0[0] + (C1[0] - C0[0]) * t,
          C0[1] + (C1[1] - C0[1]) * t,
          C0[2] + (C1[2] - C0[2]) * t
        )
      );
    }
  }

  /* 只畫漸層，不畫光暈 —— 光暈維持「浮在水面上」（上層那三顆 CSS .glow
     自己飄、不受折射），這是 2026-08-03 選定的模式 */
  function makeBackground(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    /* 重現 CSS 的 linear-gradient(135deg, ...)。
       不能偷懒用 createLinearGradient(0,0,w,h) —— 那是「面板對角線」，
       角度會跟著長寬比跑。CSS 的規則是：角度從「向上」順時針起算，
       漸層線長度 L = |w·sin A| + |h·cos A|，並以面板中心為軸對稱。 */
    var A = 135 * Math.PI / 180;
    var dx = Math.sin(A), dy = -Math.cos(A);
    var L = Math.abs(w * dx) + Math.abs(h * dy);
    var grad = ctx.createLinearGradient(
      w / 2 - dx * L / 2, h / 2 - dy * L / 2,
      w / 2 + dx * L / 2, h / 2 + dy * L / 2
    );
    addOklabStops(grad, 0, 0.34);
    grad.addColorStop(1, oklabToRgbString(C1[0], C1[1], C1[2]));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    return cv.toDataURL('image/png');   // data URI 不觸發 CORS，不用外部圖檔
  }

  function currentBg() {
    // 底圖尺寸取面板實際像素（乘 devicePixelRatio 太吃記憶體，1x 對水波紋理已足夠）
    return makeBackground(panel.offsetWidth, panel.offsetHeight);
  }

  /* ---------- 啟動 ---------- */
  var on = false;
  try {
    panel.classList.add('is-ripples');
    $panel.ripples({
      resolution:  OPTS.resolution,
      dropRadius:  OPTS.dropRadius,
      perturbance: OPTS.perturbance,
      interactive: true,          // 只有滑鼠劃過會有波，不自動呼吸
      imageUrl:    currentBg()
    });
    on = true;
  } catch (e) {
    // 多半是瀏覽器不支援 WebGL 浮點紋理 —— 收回 class，退回原本的 CSS 漸層
    panel.classList.remove('is-ripples');
  }

  /* 視窗改變大小時底圖要重畫，否則水波紋理會被拉伸變形 */
  var resizeTimer;
  window.addEventListener('resize', function () {
    if (!on) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      $panel.ripples('set', 'imageUrl', currentBg());
    }, 250);
  });
})();
