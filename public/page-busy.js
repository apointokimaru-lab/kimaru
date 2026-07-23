// 全ページ共通の「全画面ローディング」。
// (1) 初回ロード: fetch が来たら画面を覆い、通信が静まったら閉じる（未完成画面のちらつき防止）。
// (2) 以降ずっと: サーバーAPI(/api/*)呼び出し（保存・送信・再取得など）の間、自動で全画面ローディングを表示。
//     速い通信でちらつかないよう ~180ms 待ってから表示する。fetch が無い/速いページでは何も出ない。
// 使い方: 各ページ <head> に <script src="/page-busy.js"></script> を（他スクリプトより前・非defer）置くだけ。
// 手動制御が要る場合: window.KimaruBusy.show() / hide()。見た目は styles.css の .page-busy。
(function () {
  if (window.KimaruBusy) return;

  var overlay = null;
  var inflight = 0;          // 進行中の（対象）fetch 数
  var initialDone = false;   // 初回ロード完了か（以降は /api/ のみ対象）
  var showTimer = null, hideTimer = null;

  function build() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "page-busy";
    overlay.className = "page-busy";
    overlay.setAttribute("data-auto", "1");
    var box = document.createElement("div");
    box.className = "page-busy__box";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="page-busy__label">読み込み中…</span>';
    overlay.appendChild(box);
    (document.body || document.documentElement).appendChild(overlay);
    localizeLabel();
  }

  // i18n が初期化済みなら現在の言語でラベルを差し替える（未初期化なら既定の日本語）。
  function localizeLabel() {
    try {
      if (!overlay || !window.KimaruI18n || !window.KimaruI18n.t) return;
      var el = overlay.querySelector(".page-busy__label");
      if (el) el.textContent = window.KimaruI18n.t("common.busy");
    } catch (_) {}
  }

  function show() { build(); if (overlay) overlay.hidden = false; localizeLabel(); }
  function hide() { if (overlay) overlay.hidden = true; }

  function isApi(url) {
    try { var u = new URL(url, location.href); return u.origin === location.origin && u.pathname.indexOf("/api/") === 0; }
    catch (_) { return false; }
  }

  function scheduleShow(delay) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (showTimer || (overlay && overlay.hidden === false)) return; // 既に表示中/予約済みなら何もしない
    showTimer = setTimeout(function () { showTimer = null; if (inflight > 0) show(); }, delay);
  }
  function scheduleHide() {
    if (inflight > 0) return;
    if (showTimer) { clearTimeout(showTimer); showTimer = null; } // 速い通信は表示前にキャンセル＝ちらつかない
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { hideTimer = null; if (inflight <= 0) { hide(); initialDone = true; } }, 160);
  }

  // fetch を早期にラップ（他スクリプトより前に読み込む前提）。初回は全fetch、以降は /api/ 呼び出しのみ対象。
  var origFetch = (typeof window.fetch === "function") ? window.fetch : null;
  if (origFetch) {
    window.fetch = function (input) {
      var url = (typeof input === "string") ? input : (input && input.url) || "";
      var track = !initialDone || isApi(url);
      if (track) { inflight++; scheduleShow(initialDone ? 180 : 0); }
      var out;
      try { out = origFetch.apply(this, arguments); }
      catch (e) { if (track) { inflight--; scheduleHide(); } throw e; }
      return Promise.resolve(out).then(
        function (r) { if (track) { inflight--; scheduleHide(); } return r; },
        function (e) { if (track) { inflight--; scheduleHide(); } throw e; }
      );
    };
  }

  // 初回ロードで対象 fetch が無い/取りこぼしたページの締め（何も出さず初回完了扱い）。
  function settleInitial() { if (!initialDone && inflight <= 0) scheduleHide(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", settleInitial, { once: true });
  else settleInitial();
  window.addEventListener("load", settleInitial);
  // 保険: 初回ロードは最大8秒で完了扱い（固まっても閉じる。以降のAPI表示は各呼び出しで開閉）。
  setTimeout(function () { initialDone = true; if (inflight <= 0) hide(); }, 8000);

  window.KimaruBusy = { show: show, hide: hide, finish: function () { initialDone = true; if (inflight <= 0) hide(); } };
})();
