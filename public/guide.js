// 使い方ガイド（#353）— 機能一覧ページ（/guide.html）と、1項目ぶんの説明Modal。
//
// なぜ必要か: 「初期設定の方法がわかりにくい」という声への対応。画面ごとの短い注記だけでは
// 「どの機能を・どんなときに・どう設定するのか」が伝わらない。
//
// なぜ1項目ずつ独立しているか: 当初はModalに「前へ/次へ」を付けて16項目を通しで送れるようにしていたが、
// 「Googleカレンダーの連携方法」を押しても他の項目と同じ器が開くため、どこまでがその説明なのかが
// 分からなかった。1項目＝1つのModalで閉じ、送りは持たない（一覧に戻って次を選ぶ）。
// あわせて、1項目ぶんが iPhone 12（390×664）でスクロールせずに収まる量に抑えている。
// 収まらない説明は文を削るのではなく、項目を分ける。
//
// なぜ項目ごとに中身の形が違うか: 当初は全項目を「図＋利用場面＋3ステップ」の同じ型で書いていたが、
// それでは「Zoomはどう連携するのか」「予約ページの各欄は何を意味するのか」に答えられなかった。
// 読み手が知りたいことは項目ごとに違うので、説明の部品を選べるようにしてある:
//   lead   … 1段落の要約。一覧にもこの文を出す（2か所で別の文を持つと必ず食い違う）
//   points … 順序のない箇条書き。「〜とは」の概要向け
//   steps  … 順序のある手順。「〜の連携方法」「〜の作成方法」向け
//   fields … 設定項目の名前と説明の対。「この画面のこの欄は何か」向け
//   note   … 注記。上限・できないこと・元に戻せないことを最後に置く
// 必要な i18n キーはこの指定から機械的に決まる（scripts/test/unit.mjs が3言語ぶん確認する）。
//
// なぜ図を持たないか: 以前は画面の骨格を描いたインラインSVGを1項目に1枚持っていた。項目が
// 「機能」から「操作」に細かくなったことで（例: 予約ページの設定項目）、図が手順の言い換えにしかならず、
// 16枚を保守し続ける理由が無くなったため外した。
//
// なぜこのファイルを guide.html だけが読むか: 開く先が一覧ページ1枚に決まっているため。
// 他の画面からは共通ヘッダーのリンク＝ただの遷移で足りる。
//
// 文言は i18n.js（guide.* キー）に置く。3言語の対称性は scripts/test/unit.mjs が固定している。
(function () {
  const t = (key) => (window.KimaruI18n ? window.KimaruI18n.t(key) : key);

  // ---- 一覧の章立て。ここに無い group の項目は一覧に出ない（unit.mjs が全項目の group を確認する）。
  const GROUPS = ["overview", "setup", "run", "more"];

  // ---- 説明の中身 ------------------------------------------------------------------
  // key   : i18n の接頭辞（guide.<key>.title / .lead / …）
  // group : 一覧のどの章に置くか
  // href  : 「該当画面を開く」の行き先。無い項目はボタンを出さない
  // steps / points / fields : それぞれの件数。未指定ならその部品を出さない
  // note  : 注記を出すか
  const ENTRIES = [
    // ===== 概要 =====
    { key: "about", group: "overview", steps: 3, note: true },
    { key: "page-about", group: "overview", points: 3, href: "/booking-settings.html" },

    // ===== 予約受付の準備 =====
    { key: "calendar-connect", group: "setup", steps: 4, href: "/settings.html#integrations" },
    { key: "calendar-manage", group: "setup", steps: 2, note: true, href: "/settings.html#integrations" },
    { key: "zoom-connect", group: "setup", steps: 4, href: "/settings.html#integrations" },
    { key: "zoom-use", group: "setup", steps: 3, note: true, href: "/booking-settings.html" },
    { key: "page-create", group: "setup", steps: 5, href: "/booking-settings.html?new=1" },
    { key: "page-settings-basic", group: "setup", fields: 4, href: "/booking-settings.html" },
    { key: "page-settings-meeting", group: "setup", fields: 3, href: "/booking-settings.html" },
    { key: "page-settings-slots", group: "setup", fields: 3, href: "/booking-settings.html" },
    { key: "hours", group: "setup", steps: 3, href: "/booking-settings.html" },
    { key: "buffer", group: "setup", steps: 4, note: true, href: "/booking-settings.html" },
    { key: "survey-setup", group: "setup", steps: 4, note: true, href: "/booking-settings.html" },
    { key: "survey-answers", group: "setup", points: 3, href: "/answers.html" },
    { key: "profile-setup", group: "setup", steps: 3, note: true, href: "/profile.html" },
    { key: "profile-fields", group: "setup", fields: 4, href: "/profile.html" },

    // ===== 案内から面談当日まで =====
    { key: "share", group: "run", steps: 4, note: true, href: "/dashboard.html" },
    { key: "pinpoint", group: "run", steps: 5, href: "/dashboard.html" },
    { key: "pinpoint-limit", group: "run", points: 3, href: "/dashboard.html" },
    { key: "after", group: "run", steps: 4, href: "/schedule.html" },
    { key: "change", group: "run", steps: 4, note: true, href: "/schedule.html" },
    { key: "pause", group: "run", steps: 2, note: true, href: "/booking-settings.html" },

    // ===== 継続的な利用 =====
    { key: "contacts-about", group: "more", points: 3, href: "/contacts.html" },
    { key: "contacts-use", group: "more", steps: 4, href: "/contacts.html" },
    { key: "plan-free", group: "more", points: 4, href: "/plan.html" },
    { key: "plan-pro", group: "more", points: 4, href: "/plan.html" },
    { key: "plan-premium", group: "more", points: 3, note: true, href: "/plan.html" },
  ];

  let overlay = null;
  let index = 0;
  let lastFocus = null;

  const indexOfKey = (key) => ENTRIES.findIndex((e) => e.key === key);

  // 文言は i18n.js 由来（自リポジトリのソース）だが、innerHTML で組む箇所は必ずエスケープする。
  function escapeText(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const tx = (entry, suffix) => escapeText(t(`guide.${entry.key}.${suffix}`));
  const times = (n, fn) => Array.from({ length: n || 0 }, (_, i) => fn(i + 1)).join("");

  // ---- 説明の本文（部品を並べるだけ。持っていない部品は出さない）--------------------
  function bodyHtml(entry) {
    let out = `<p class="guide-lead">${tx(entry, "lead")}</p>`;
    if (entry.points) {
      out += `<ul class="guide-points">${times(entry.points, (i) => `<li>${tx(entry, `point${i}`)}</li>`)}</ul>`;
    }
    if (entry.steps) {
      out += `<ol class="guide-steps">${times(entry.steps, (i) => `<li>${tx(entry, `step${i}`)}</li>`)}</ol>`;
    }
    if (entry.fields) {
      out += `<dl class="guide-fields">${times(entry.fields, (i) =>
        `<dt>${tx(entry, `field${i}.name`)}</dt><dd>${tx(entry, `field${i}.desc`)}</dd>`)}</dl>`;
    }
    if (entry.note) {
      out += `<p class="guide-note"><span class="guide-tag">${escapeText(t("guide.note"))}</span><span>${tx(entry, "note")}</span></p>`;
    }
    return out;
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay guide-overlay";
    overlay.id = "guide-modal";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal guide" role="dialog" aria-modal="true" aria-labelledby="guide-entry-title">
        <button class="modal-close" type="button" data-guide-close aria-label="${escapeText(t("guide.close"))}">✕</button>
        <div class="guide-head">
          <p class="eyebrow" data-guide-eyebrow></p>
          <h2 id="guide-entry-title" data-guide-title></h2>
        </div>
        <div class="guide-body" data-guide-body></div>
        <a class="button secondary btn-sm guide-cta" data-guide-cta hidden></a>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-guide-close]")) close();
    });
    // 言語を切り替えたら、開いたまま今の項目を組み直す（閉じて開き直させない）。
    document.addEventListener("kimaru:languagechange", () => { if (overlay && !overlay.hidden) show(index); });
  }

  function show(next) {
    index = Math.max(0, Math.min(ENTRIES.length - 1, next));
    const entry = ENTRIES[index];
    const q = (sel) => overlay.querySelector(sel);
    q("[data-guide-eyebrow]").textContent = t(`guide.group.${entry.group}`);
    q("[data-guide-title]").textContent = t(`guide.${entry.key}.title`);
    q("[data-guide-body]").innerHTML = bodyHtml(entry);
    const cta = q("[data-guide-cta]");
    cta.hidden = !entry.href;
    if (entry.href) { cta.href = entry.href; cta.textContent = t("guide.open"); }
    q(".guide").scrollTop = 0;
    // 開いている項目をURLに載せる。pushState にしないのは、閉じる操作を「戻る」と
    // 二重に持たせないため（戻る＝一覧に戻る、でいい）。
    if (location.hash.slice(1) !== entry.key) history.replaceState(null, "", `${location.pathname}${location.search}#${entry.key}`);
  }

  function open(at = 0) {
    if (!overlay) build();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add("modal-open");
    show(at);
    overlay.querySelector("[data-guide-close]").focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove("modal-open");
    // 開いている項目を #key でURLに載せているので、閉じたら消す
    //（そのまま再読み込みするとまた開いてしまい、一覧に戻れない）。
    if (indexOfKey(location.hash.slice(1)) >= 0) history.replaceState(null, "", location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---- 機能一覧（/guide.html）------------------------------------------------------
  // 並べるのは項目名だけ。ここで見せたいのは「どの説明があるか」なので、
  // 図や要約が付くと1件あたりが縦に伸びて、目的の項目を探しにくくなる。
  // 要約（lead）はModalの冒頭にだけ出す。
  function renderIndex() {
    const host = document.querySelector("[data-guide-index]");
    if (!host) return;
    host.innerHTML = "";
    GROUPS.forEach((group) => {
      const entries = ENTRIES.filter((entry) => entry.group === group);
      if (!entries.length) return;
      const section = document.createElement("section");
      section.className = "guide-group";
      section.dataset.guideGroup = group;
      section.innerHTML = `
        <div class="guide-group-head">
          <p class="eyebrow">${escapeText(t(`guide.group.${group}`))}</p>
          <p class="muted">${escapeText(t(`guide.group.${group}.desc`))}</p>
        </div>
        <ul class="guide-list">${entries.map((entry) => `
          <li>
            <button class="guide-item" type="button" data-guide-open="${escapeText(entry.key)}">
              <b>${tx(entry, "title")}</b>
            </button>
          </li>`).join("")}</ul>`;
      host.appendChild(section);
    });
  }

  // ---- 開く導線 --------------------------------------------------------------------
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-guide-open]");
    if (!trigger) return;
    event.preventDefault();
    // スマホはナビが開いたままだとModalに重なるので、チェックボックスハックを外して閉じる。
    const navToggle = document.getElementById("km-nav-toggle");
    if (navToggle) navToggle.checked = false;
    const at = indexOfKey(trigger.dataset.guideOpen || "");
    open(at >= 0 ? at : 0);
  });

  document.addEventListener("keydown", (event) => {
    if (!overlay || overlay.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
  });

  // 一覧の描画と、/guide.html#zoom-connect のような直リンク（案内メールから特定の説明へ送れるようにする）。
  function start() {
    // i18n.js より先に走ると、選んだ言語（activeLanguage）が決まる前に t() を呼ぶことになり、
    // 一覧だけ日本語で組まれてしまう。init() は二重呼び出しを自分で弾くので、先に確定させておく。
    try { window.KimaruI18n && window.KimaruI18n.init(); } catch (e) { /* i18n 未読込でもガイドは出す */ }
    renderIndex();
    const at = indexOfKey(location.hash.slice(1));
    if (at >= 0) open(at);
  }
  document.addEventListener("kimaru:languagechange", renderIndex);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  // entries はテスト（scripts/test/unit.mjs）から参照する。ここに出ている key と部品の件数だけ
  // i18n.js に guide.<key>.* が要る、という対応をテストで固定している。
  window.KimaruGuide = {
    open,
    close,
    groups: GROUPS,
    entries: ENTRIES.map((e) => ({ key: e.key, group: e.group, href: e.href || "", steps: e.steps || 0, points: e.points || 0, fields: e.fields || 0, note: Boolean(e.note) })),
  };
})();
