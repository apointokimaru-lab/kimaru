// 新LP（#364）のふるまい。ライブラリは入れない（CSPで外部スクリプトは読み込めない）。
// やることは2つだけ。どちらも無くてもページの意味は通る。
//   1. セクションの軽い出現（reveal）。動きを止める設定の人には最初から出す
//   2. ヒーローのCTAが画面外に出たら、スマホだけ追従CTAを出す（出口は登録の1本）
(function () {
  "use strict";

  var reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* noop */ }

  // ---- 1. 出現 ----
  var items = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);   // 一度出したら戻さない
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.05 });
    items.forEach(function (el) { io.observe(el); });
  }

  // ---- 2. スマホの追従CTA ----
  // 最初から出すと、まだ何も読んでいない人の画面を占領するだけになる。
  var sticky = document.getElementById("sticky-cta");
  var heroCta = document.querySelector(".hero .actions .cta");
  if (sticky && heroCta && "IntersectionObserver" in window) {
    var io2 = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { sticky.classList.toggle("is-on", !entry.isIntersecting); });
    }, { threshold: 0 });
    io2.observe(heroCta);
  }
})();
