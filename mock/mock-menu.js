// mock 専用：予約の「⋯」操作メニュー（開閉のみのデモ）。本番は app.js が実挙動（日程変更・キャンセル）を担う。
// ・⋯ クリックでポップオーバーを開閉（他は閉じる）
// ・外側クリック / Esc で閉じる
// ・項目はデモのためダミー（リンクはそのまま遷移、ボタンは閉じるだけ）
(function () {
  function closeAll(except) {
    document.querySelectorAll(".menu-pop").forEach(function (p) {
      if (p === except) return;
      p.hidden = true;
      var b = p.parentElement.querySelector(".menu-btn");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".menu-btn");
    if (btn) {
      e.preventDefault();
      var pop = btn.parentElement.querySelector(".menu-pop");
      var willOpen = pop.hidden;
      closeAll(willOpen ? pop : null);
      pop.hidden = !willOpen;
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      return;
    }
    var item = e.target.closest(".menu-item");
    if (item) {
      if (item.tagName !== "A") e.preventDefault(); // ボタン項目はデモのため遷移なし
      closeAll(null);
      return;
    }
    closeAll(null); // 外側クリックで閉じる
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAll(null);
  });
})();
