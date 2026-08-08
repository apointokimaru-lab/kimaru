/* キマル LP — スクロールで時間を進める。

   奥行き  : 帯ごとに 遠景（透かし字）・中景（図版）・近景（紙片）が別々の速さで動く。
   進捗    : 忘却曲線・水引・ロードマップは「量」ではなく「進み」を描く。
             スクロール量そのものを --p（0〜1）として配り、描画はCSS側に任せる。
   ピン留め: AI議事録の面だけ画面を止め、記録が残るまでの5段を順に灯す。

   読み取り（getBoundingClientRect）と書き込み（style）を1フレーム内で分け、
   レイアウトの往復を起こさない。JSが動かないとき・動きを減らす設定のときは、
   --p の既定値 1 によってすべて最終状態で表示される。 */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var doc = document.documentElement;

  var layers = [];   // data-px    … 視差レイヤ
  var tracks = [];   // data-track … 進捗を配る区間
  var cordPaths = null;
  var vh = 0, amp = 1, ticking = false;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function round(v, n) { var k = Math.pow(10, n); return Math.round(v * k) / k; }

  function measure() {
    vh = window.innerHeight || doc.clientHeight || 800;
    /* 画面が狭いほど視差は控えめに。狭い画面では大きな移動が酔いにつながる。 */
    amp = window.innerWidth < 760 ? 0.4 : 1;
  }

  /* ---- 収集 --------------------------------------------------------- */
  function collect() {
    var els, i, el, a;

    els = document.querySelectorAll("[data-px]");
    for (i = 0; i < els.length; i++) {
      el = els[i];
      layers.push({ el: el, k: parseFloat(el.getAttribute("data-px")) || 0, y: null, c: null });
    }

    els = document.querySelectorAll("[data-track]");
    for (i = 0; i < els.length; i++) {
      el = els[i];
      a = (el.getAttribute("data-track") || "").split(/\s+/).filter(Boolean);
      tracks.push({
        el: el,
        /* pin  : 区間の頭で止まり、区間を抜けるまでを 0→1
           exit : 要素が自分の高さぶん上へ抜けるまでを 0→1
           既定 : 要素が画面を通り抜けるあいだを 0→1 */
        mode: el.classList.contains("pin-track") ? "pin" : (a[0] === "exit" ? "exit" : "span"),
        from: a[0] && a[0] !== "exit" ? parseFloat(a[0]) : 0.88,
        to: a[1] ? parseFloat(a[1]) : 0.4,
        cnt: el.querySelector("[data-count]"),
        p: -1
      });
    }

    cordPaths = document.querySelectorAll(".cord .s1,.cord .s2");
    for (i = 0; i < cordPaths.length; i++) {
      cordPaths[i].style.strokeDasharray = "1";
      cordPaths[i].style.strokeDashoffset = "1";
    }
  }

  /* ---- 1フレーム：先にすべて読み、あとにすべて書く --------------------- */
  function frame() {
    ticking = false;
    var i, o, r;

    for (i = 0; i < layers.length; i++) layers[i].r = layers[i].el.getBoundingClientRect();
    for (i = 0; i < tracks.length; i++) tracks[i].r = tracks[i].el.getBoundingClientRect();

    for (i = 0; i < layers.length; i++) {
      o = layers[i]; r = o.r;
      if (r.bottom < -vh * 0.5 || r.top > vh * 1.5) continue;   /* 画面から遠い層は触らない */
      var c = (r.top + r.height / 2 - vh / 2) / vh;             /* 画面中心からの隔たり -1〜1 */
      if (c < -1.6) c = -1.6; else if (c > 1.6) c = 1.6;
      var y = round(-c * o.k * 260 * amp, 1);
      if (y !== o.y) { o.el.style.setProperty("--y", y + "px"); o.y = y; }
      var cc = round(c, 3);
      if (cc !== o.c) { o.el.style.setProperty("--c", String(cc)); o.c = cc; }
    }

    for (i = 0; i < tracks.length; i++) {
      o = tracks[i]; r = o.r;
      var p;
      if (o.mode === "pin") {
        p = clamp01(-r.top / Math.max(1, r.height - vh));
      } else if (o.mode === "exit") {
        p = clamp01(-r.top / Math.max(1, r.height));
      } else {
        var s = vh * o.from;                  /* r.top がここに来たとき 0 */
        var e = vh * o.to - r.height;         /* r.top がここに来たとき 1 */
        p = clamp01((s - r.top) / Math.max(1, s - e));
      }
      p = round(p, 3);
      if (p === o.p) continue;
      o.p = p;
      o.el.style.setProperty("--p", String(p));
      if (o.cnt) {
        /* 忘れた量は、読み進めた分だけ増える。 */
        var goal = parseInt(o.cnt.getAttribute("data-count"), 10) || 0;
        o.cnt.textContent = String(Math.round(goal * (1 - Math.pow(1 - p, 2))));
      }
    }

    if (cordPaths && cordPaths.length) {
      var span = doc.scrollHeight - vh;
      var q = span > 0 ? clamp01(window.scrollY / span) : 1;
      var drawn = 1 - (0.08 + q * 0.92);
      for (i = 0; i < cordPaths.length; i++) cordPaths[i].style.strokeDashoffset = String(drawn);
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(frame);
  }

  function onResize() {
    measure();
    for (var i = 0; i < layers.length; i++) { layers[i].y = null; layers[i].c = null; }
    for (var j = 0; j < tracks.length; j++) tracks[j].p = -1;
    onScroll();
  }

  /* ---- 出現：節ごとに一度だけ ----------------------------------------- */
  function reveal() {
    var items = document.querySelectorAll(".rv");
    if (!items.length) return;
    if (reduce || !("IntersectionObserver" in window)) {
      for (var i = 0; i < items.length; i++) items[i].classList.add("in");
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    for (var j = 0; j < items.length; j++) io.observe(items[j]);
  }

  function start() {
    reveal();
    if (reduce) return;   /* 動きを減らす設定：--p は既定の 1 のまま、最終状態を見せる */
    measure();
    collect();
    frame();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    /* Webフォントの読み込みで高さが変わるため、確定後に測り直す */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
