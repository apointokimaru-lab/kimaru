// mock 専用：プラン切替（デモ）。本番では plan.js が /api/me から body.plan-* を付与する。
// 右下のトグルで Free / Pro / プレミアム を切替→ body.plan-free|plan-pro|plan-premium。
// URL に ?plan=free|pro|premium があればそれを初期値にする（スクショ用）。
(function () {
  var PLANS = ["free", "pro", "premium"];
  var LABEL = { free: "無料", pro: "Pro", premium: "プレミアム" };

  function current() {
    var q = new URLSearchParams(location.search).get("plan");
    if (PLANS.indexOf(q) >= 0) return q;
    var s = localStorage.getItem("mock.plan");
    return PLANS.indexOf(s) >= 0 ? s : "pro";
  }

  function apply(p) {
    try { localStorage.setItem("mock.plan", p); } catch (e) {}
    PLANS.forEach(function (x) { document.body.classList.toggle("plan-" + x, x === p); });
    // ヘッダー右肩のプランバッジ（最初の .nav .badge）をプランに合わせて更新
    var badge = document.querySelector(".nav .badge");
    if (badge) {
      badge.className = "badge " + (p === "premium" ? "badge-premium" : p === "pro" ? "badge-pro" : "badge-free");
      badge.textContent = LABEL[p];
    }
    document.querySelectorAll(".mock-plan-btn").forEach(function (b) {
      b.classList.toggle("on", b.dataset.plan === p);
    });
  }

  function build() {
    var bar = document.createElement("div");
    bar.className = "mock-plan-switch";
    bar.innerHTML =
      '<div class="mock-plan-title"><b>表示プラン</b><span>mock確認用</span></div>' +
      '<div class="mock-plan-btns">' +
      PLANS.map(function (p) {
        return '<button type="button" class="mock-plan-btn" data-plan="' + p + '">' + LABEL[p] + "</button>";
      }).join("") +
      "</div>";
    bar.addEventListener("click", function (e) {
      var b = e.target.closest(".mock-plan-btn");
      if (b) apply(b.dataset.plan);
    });
    document.body.appendChild(bar);
    apply(current());
  }

  if (document.readyState !== "loading") build();
  else document.addEventListener("DOMContentLoaded", build);
})();
