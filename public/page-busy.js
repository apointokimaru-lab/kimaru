// ログイン後ユーザーページ共通の「全画面ローディング」。
// 初回のデータ取得（/api/* fetch）が落ち着くまで全画面オーバーレイで画面を覆い、
// 読み込み中の未完成な画面やちらつきを隠す。見た目は styles.css の .page-busy
// （予約ページ booking.html と同じスピナー）。
//
// 使い方: 各ユーザーページの <head> に <script src="/page-busy.js"></script> を
// できるだけ早く（他スクリプトより前・非 defer）置くだけ。DOM への追記や個別の
// 表示制御は不要。手動で出し入れしたい場合は window.KimaruBusy.show()/hide()。
(function () {
  if (window.KimaruBusy) return;

  var overlay = null;
  var inflight = 0;        // 進行中の fetch 数
  var watching = false;    // 初回ロード監視中か（DOMContentLoaded 以降 true）
  var done = false;        // 初回ロード完了（オーバーレイを閉じたら true）
  var settleTimer = null;

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
    box.innerHTML =
      '<span class="spinner" aria-hidden="true"></span>' +
      '<span class="page-busy__label">読み込み中…</span>';
    overlay.appendChild(box);
    (document.body || document.documentElement).appendChild(overlay);
    localizeLabel();
  }

  // i18n が初期化済みなら現在の言語でラベルを差し替える（未初期化なら既定の日本語のまま）。
  function localizeLabel() {
    try {
      if (!overlay || !window.KimaruI18n || !window.KimaruI18n.t) return;
      var el = overlay.querySelector(".page-busy__label");
      if (el) el.textContent = window.KimaruI18n.t("common.busy");
    } catch (_) {}
  }

  function show() { build(); if (overlay) overlay.hidden = false; }
  function hide() { if (overlay) overlay.hidden = true; }

  function finish() {
    if (done) return;
    done = true;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    hide();
    if (origFetch) window.fetch = origFetch; // 初回ロード後は監視を外す（以降の操作に介入しない）
  }

  // ネットワークが一定時間静かになったら初回ロード完了とみなして閉じる。
  function scheduleSettle() {
    if (!watching || done) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      settleTimer = null;
      if (inflight <= 0) finish();
    }, 220);
  }

  // fetch を早期にラップして進行中数を数える（他スクリプトより前に読み込む前提）。
  var origFetch = (typeof window.fetch === "function") ? window.fetch : null;
  if (origFetch) {
    window.fetch = function () {
      inflight++;
      var out;
      try {
        out = origFetch.apply(this, arguments);
      } catch (e) {
        inflight--; scheduleSettle(); throw e;
      }
      return Promise.resolve(out).then(
        function (r) { inflight--; scheduleSettle(); return r; },
        function (e) { inflight--; scheduleSettle(); throw e; }
      );
    };
  }

  function startWatching() {
    if (watching || done) return;
    watching = true;
    show();
    localizeLabel();
    scheduleSettle(); // 既にネットワークが静かならそのまま閉じ判定へ
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startWatching, { once: true });
  } else {
    startWatching();
  }
  // fetch が一度も無い/取りこぼしたページのための保険。
  window.addEventListener("load", function () { watching = true; scheduleSettle(); });
  // 最終保険：API が固まっても最大 8 秒で必ず閉じる。
  setTimeout(finish, 8000);

  window.KimaruBusy = { show: show, hide: hide, finish: finish };
})();
