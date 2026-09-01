// 新LP（#364）のふるまい。ライブラリは入れない（CSPで外部スクリプトを禁止しているため、
// そもそも読み込めない）。やることは3つだけで、いずれも「読み進み」を助けるためのもの。
//   1. 上端の罫を読み進みに合わせて伸ばす（台帳のどこまで綴じたか）
//   2. 差別化軸のスクロールに合わせて「相手の1枚」を埋めていく（このページのシグネチャー）
//   3. ヒーローを過ぎたらスマホだけ追従CTAを出す（出口は登録の1本だけ）
// JSが動かなくても意味は通る（カードは埋まった状態にはならないが、説明文は全部読める）。
(function () {
  "use strict";

  var reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* noop */ }

  // ---- 1. 読み進みの罫 ----
  var bar = document.querySelector(".progress > i");
  if (bar) {
    var ticking = false;
    var paint = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
      bar.style.width = (ratio * 100).toFixed(2) + "%";
      ticking = false;
    };
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(paint);
    }, { passive: true });
    paint();
  }

  // ---- 2. スクロールで埋まっていく「相手の1枚」 ----
  // 軸1が見えたらA1、軸2でA2、軸3でメモと印象、と1段ずつ増やす。段を戻さないのは、
  // 一度書いたものが消えるのは「記録が残る」という主張と矛盾するため（上限だけ更新する）。
  var card = document.getElementById("fill-card");
  var axes = document.querySelectorAll(".axis[data-axis]");
  if (card && axes.length) {
    if (reduce || !("IntersectionObserver" in window)) {
      card.classList.add("is-done"); // 動きを止める設定なら、最初から埋まった状態で見せる
    } else {
      var state = 0;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var n = Number(entry.target.getAttribute("data-axis")) || 0;
          if (n > state) {
            state = n;
            card.setAttribute("data-state", String(state));
          }
        });
      }, { rootMargin: "-30% 0px -40% 0px", threshold: 0 });
      axes.forEach(function (axis) { io.observe(axis); });
    }
  }

  // ---- 3. スマホの追従CTA ----
  // ヒーローのCTAが画面外に出てから出す。最初から出すと、まだ何も読んでいない人の画面を
  // 占領するだけになる。
  var sticky = document.getElementById("sticky-cta");
  var heroCta = document.querySelector(".hero-actions .cta");
  if (sticky && heroCta && "IntersectionObserver" in window) {
    var io2 = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        sticky.classList.toggle("is-on", !entry.isIntersecting);
      });
    }, { threshold: 0 });
    io2.observe(heroCta);
  }
})();
