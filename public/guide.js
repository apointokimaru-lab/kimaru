// 使い方ガイド（#353）— 機能一覧ページ（/guide.html）と、1機能ぶんのModal。
//
// なぜ必要か: 「初期設定の方法がわかりにくい」という声への対応。画面ごとの説明文だけでは
// 「どの機能を・どんなときに・どの順番で使うのか」が伝わらない。1枚＝1機能で、図（＝実際の画面の見立て）と
// 「こんなときに」「使い方」を並べる。
//
// なぜ一覧を挟むか: 最初は通しの紙芝居だけだったが、それだと「予約ページの作り方だけ知りたい」人が
// 目的の1枚に着くまで送り続けることになる。ヘッダーの「使い方ガイド」はまず一覧（/guide.html）へ送り、
// 知りたい機能を選んでもらってから、その機能のModalを開く。読み物として通しで見たい人のために、
// Modal側の「次へ」と上部のセグメントは一覧の並び順のまま残してある。
//
// なぜこのファイルを guide.html だけが読むか: 開く先が一覧ページ1枚に決まったので、
// 全ページに配る必要がなくなった（以前は Edge Function が全HTMLに注入していた）。
// 他の画面からは共通ヘッダーのリンク＝ただの遷移で足りる。
//
// 文言は i18n.js（guide.* キー）に置く。3言語の対称性は scripts/test/unit.mjs が固定している。
// 図には文字を入れない（数字と記号だけ）。図に日本語を焼き込むと en / zh-TW でそこだけ日本語が残る。
(function () {
  const t = (key) => (window.KimaruI18n ? window.KimaruI18n.t(key) : key);

  // ---- 図の部品（すべて viewBox 600×240 の座標系）----------------------------------
  // 実際の画面の骨格だけを写す。白いカード＋1pxの線＝キマルの画面、朱＝いま説明している場所。
  const card = (x, y, w, h, cls = "") => `<rect class="s-card ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>`;
  const bar = (x, y, w, h = 8, cls = "s-line") => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;
  const chip = (x, y, w, h, cls = "s-chip") => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`;
  const dot = (cx, cy, r, cls = "s-avatar") => `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${r}"/>`;
  // 右向きの矢印。線＋三角（marker は単体表示や sanitize で落ちやすいので使わない）。
  const arrow = (x1, y, x2) => `<path class="s-arrow" d="M${x1} ${y}H${x2 - 8}"/><path class="s-head" d="M${x2 - 9} ${y - 5}L${x2} ${y}L${x2 - 9} ${y + 5}Z"/>`;
  const num = (cx, y, text, cls = "s-t") => `<text class="${cls} s-mid" x="${cx}" y="${y}">${text}</text>`;
  // 封筒（メール）。カード上辺から折り返しの線を引くだけで封筒に見える。
  const envelope = (x, y, w, h) => card(x, y, w, h) + `<path class="s-fold" d="M${x} ${y + 6}L${x + w / 2} ${y + h * 0.55}L${x + w} ${y + 6}"/>`;
  // 朱印（ブランドの回転した四角）。「決まった」ことの印として図の締めに使う。
  const seal = (x, y, size = 26) => `<g transform="translate(${x} ${y}) rotate(-6)"><rect class="s-seal" x="0" y="0" width="${size}" height="${size}" rx="6"/><path class="s-check" d="M${size * 0.28} ${size * 0.5}l${size * 0.15} ${size * 0.18} ${size * 0.3} -${size * 0.32}"/></g>`;

  const svg = (parts) => `<svg viewBox="0 0 600 240" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;

  // 予約枠のグリッド（ゲストの予約画面の見立て）。picked=朱、dim=埋まっていて出ない枠。
  function weekGrid(x, y, o) {
    const cols = o.cols || 5;
    const rows = o.rows || 4;
    const cw = o.cw || 40;
    const cgap = o.cgap == null ? 12 : o.cgap;
    const ch = o.ch || 18;
    const rgap = o.rgap == null ? 8 : o.rgap;
    const picked = o.picked || [];
    const dim = o.dim || [];
    const hit = (list, c, r) => list.some((p) => p[0] === c && p[1] === r);
    let out = "";
    for (let c = 0; c < cols; c++) {
      const cx = x + c * (cw + cgap);
      out += bar(cx, y, Math.round(cw * 0.7), 6, "s-line-2"); // 曜日の見出し
      for (let r = 0; r < rows; r++) {
        // dim の枠は「描かない」。薄く塗るより、穴が空いているほうが
        //「予定が入っている時間は候補から消える」という説明と一致する。
        if (hit(dim, c, r)) continue;
        out += chip(cx, y + 16 + r * (ch + rgap), cw, ch, hit(picked, c, r) ? "s-chip-acc" : "s-chip");
      }
    }
    return out;
  }

  // ---- ガイド本体（1枚＝1機能）------------------------------------------------------
  // key: i18n の接頭辞（guide.<key>.title / .when / .step1..N）
  // href: その機能の画面。無い枚は「この画面を開く」を出さない。
  const SLIDES = [
    {
      // 全体の流れ：URLを渡す → 相手が選ぶ → 双方のカレンダーに入る
      key: "flow",
      group: "start",
      steps: 3,
      fig: svg([
        card(10, 45, 165, 150),
        bar(30, 72, 90, 8), bar(30, 92, 110, 6, "s-line-2"),
        chip(30, 118, 125, 28, "s-chip-acc"),
        arrow(183, 120, 213),
        card(221, 45, 158, 150),
        weekGrid(241, 70, { cols: 4, rows: 4, cw: 26, cgap: 8, ch: 14, rgap: 6, picked: [[1, 2]] }),
        arrow(387, 120, 417),
        card(425, 32, 150, 140),
        card(440, 58, 150, 140),
        bar(458, 84, 84, 8),
        chip(458, 106, 116, 24), chip(458, 138, 116, 24, "s-chip-acc"),
        seal(548, 168),
      ]),
    },
    {
      // カレンダー連携：予定が入っている時間は候補から消える
      key: "calendar",
      group: "setup",
      steps: 3,
      href: "/settings.html#integrations",
      fig: svg([
        card(10, 32, 250, 176),
        bar(32, 58, 78, 8),
        chip(32, 80, 64, 110, "s-chip-off"), chip(104, 80, 64, 110, "s-chip-off"), chip(176, 80, 64, 110, "s-chip-off"),
        chip(32, 92, 64, 26, "s-chip-acc"), chip(104, 130, 64, 34, "s-chip-acc"), chip(176, 86, 64, 20, "s-chip-acc"),
        arrow(268, 120, 300),
        card(310, 32, 280, 176),
        bar(332, 58, 78, 8),
        weekGrid(332, 84, { cols: 5, rows: 3, cw: 40, cgap: 12, ch: 18, rgap: 10, dim: [[0, 0], [2, 1], [2, 2], [4, 0]] }),
      ]),
    },
    {
      // 予約ページ：所要時間・場所・公開する期間を決める
      key: "page",
      group: "setup",
      steps: 3,
      href: "/booking-settings.html",
      fig: svg([
        card(55, 18, 490, 204),
        bar(80, 44, 120, 8),
        chip(80, 60, 440, 28),
        bar(80, 106, 64, 6, "s-line-2"),
        chip(80, 118, 62, 26), num(111, 136, "15"),
        chip(150, 118, 62, 26, "s-chip-acc"), num(181, 136, "30", "s-t-acc"),
        chip(220, 118, 62, 26), num(251, 136, "60"),
        bar(316, 106, 64, 6, "s-line-2"),
        chip(316, 118, 62, 26), num(347, 137, "▶"),
        chip(386, 118, 62, 26), num(417, 137, "◎"),
        chip(456, 118, 64, 26), num(488, 137, "☎"),
        bar(80, 164, 84, 6, "s-line-2"),
        chip(80, 176, 130, 26), num(145, 194, "2 – 6"),
        chip(404, 176, 116, 28, "s-chip-acc"), seal(500, 176, 20),
      ]),
    },
    {
      // 受付時間と前後バッファ：3行目だけ「前バッファ＋予約＋後バッファ」を分解して見せる
      key: "hours",
      group: "setup",
      steps: 3,
      href: "/booking-settings.html",
      fig: svg([
        card(20, 24, 560, 192),
        num(44, 54, "10", "s-t-s"), num(300, 54, "14", "s-t-s"), num(548, 54, "18", "s-t-s"),
        bar(44, 66, 492, 14, "s-band"),
        bar(44, 98, 492, 14, "s-band"),
        bar(44, 130, 492, 14, "s-band"),
        chip(140, 128, 34, 18, "s-chip-buf"),
        chip(178, 128, 120, 18, "s-chip-acc"),
        chip(302, 128, 34, 18, "s-chip-buf"),
        `<path class="s-tick" d="M140 150v12M178 150v12M298 150v12M336 150v12"/>`,
        bar(44, 186, 492, 14, "s-band"),
      ]),
    },
    {
      // 事前アンケート：質問を作る → 回答が届く
      key: "survey",
      group: "setup",
      steps: 3,
      href: "/answers.html",
      fig: svg([
        card(25, 20, 300, 200),
        bar(48, 46, 96, 8),
        chip(48, 62, 254, 26), num(74, 80, "1", "s-t-s"),
        chip(48, 96, 254, 26), num(74, 114, "2", "s-t-s"),
        chip(48, 130, 166, 26, "s-chip-off"), chip(222, 130, 80, 26, "s-chip-off"), num(262, 148, "▾"),
        chip(48, 170, 92, 26, "s-chip-acc"), num(94, 189, "＋", "s-t-acc"),
        arrow(335, 120, 367),
        card(377, 20, 198, 200),
        bar(400, 46, 72, 8),
        bar(400, 72, 150, 6, "s-line-2"), bar(400, 86, 120, 6, "s-line-2"),
        bar(400, 118, 150, 6, "s-line-2"), bar(400, 132, 96, 6, "s-line-2"),
        bar(400, 164, 150, 6, "s-line-2"), bar(400, 178, 110, 6, "s-line-2"),
      ]),
    },
    {
      // プロフィール：公開プロフィール ＋ リマインダーメールに載る
      key: "profile",
      group: "setup",
      steps: 3,
      href: "/profile.html",
      fig: svg([
        card(20, 26, 268, 188),
        dot(58, 68, 18),
        bar(88, 58, 100, 8), bar(88, 76, 72, 6, "s-line-2"),
        bar(44, 110, 220, 6, "s-line-2"), bar(44, 128, 190, 6, "s-line-2"),
        bar(44, 152, 220, 6, "s-line-2"), bar(44, 170, 150, 6, "s-line-2"),
        chip(44, 184, 96, 24, "s-chip-acc"),
        arrow(298, 120, 330),
        envelope(340, 40, 240, 160),
        dot(378, 142, 12),
        bar(398, 136, 120, 6, "s-line-2"),
        bar(364, 168, 192, 6, "s-line-2"),
      ]),
    },
    {
      // 共有：URLをコピー / ピンポイントで候補を絞る → 相手の画面
      key: "share",
      group: "run",
      steps: 3,
      href: "/dashboard.html",
      fig: svg([
        card(20, 30, 270, 84),
        bar(44, 54, 78, 8),
        chip(44, 74, 140, 24),
        chip(192, 74, 74, 24, "s-chip-acc"),
        `<path class="s-copy" d="M214 82h22v18h-22z"/><path class="s-copy" d="M220 78h22v18"/>`,
        card(20, 130, 270, 84),
        bar(44, 154, 96, 8),
        chip(44, 174, 62, 24, "s-chip-acc"), chip(112, 174, 62, 24, "s-chip-acc"), chip(180, 174, 62, 24, "s-chip-off"),
        arrow(300, 120, 332),
        card(342, 30, 238, 184),
        bar(366, 56, 90, 8),
        weekGrid(366, 82, { cols: 4, rows: 3, cw: 40, cgap: 12, ch: 18, rgap: 10, picked: [[1, 1]] }),
      ]),
    },
    {
      // 予約が入ったあと：確認メール → 22分前のリマインダー → 今日の予定
      key: "after",
      group: "run",
      steps: 3,
      href: "/schedule.html",
      fig: svg([
        envelope(14, 60, 168, 120),
        bar(38, 138, 120, 6, "s-line-2"), bar(38, 154, 84, 6, "s-line-2"),
        arrow(192, 120, 224),
        card(234, 50, 132, 140),
        `<circle class="s-clock" cx="300" cy="102" r="28"/><path class="s-hand" d="M300 102V86M300 102l12 8"/>`,
        num(300, 158, "22", "s-t-acc"),
        arrow(376, 120, 408),
        card(418, 40, 168, 160),
        bar(440, 64, 76, 8),
        chip(440, 84, 124, 30, "s-chip-acc"), num(502, 104, "14:00", "s-t-acc"),
        chip(440, 122, 124, 30), num(502, 142, "16:30"),
        chip(440, 160, 124, 30), num(502, 180, "11:00"),
      ]),
    },
    {
      // 相手管理：一覧 → 相手の詳細（回答・面談の記録）
      key: "contacts",
      group: "more",
      steps: 3,
      href: "/contacts.html",
      fig: svg([
        card(14, 26, 300, 188),
        bar(38, 50, 88, 8),
        dot(52, 86, 12), bar(74, 82, 110, 6, "s-line-2"), chip(238, 76, 52, 20),
        dot(52, 126, 12), bar(74, 122, 138, 6, "s-line-2"), chip(238, 116, 52, 20),
        dot(52, 166, 12), bar(74, 162, 96, 6, "s-line-2"), chip(238, 156, 52, 20),
        arrow(324, 120, 356),
        card(366, 26, 220, 188),
        bar(390, 50, 96, 8),
        bar(390, 74, 168, 6, "s-line-2"), bar(390, 88, 130, 6, "s-line-2"),
        bar(390, 116, 140, 10, "s-band"), bar(390, 116, 96, 10, "s-band-acc"),
        bar(390, 140, 140, 10, "s-band"), bar(390, 140, 124, 10, "s-band-acc"),
        bar(390, 164, 140, 10, "s-band"), bar(390, 164, 62, 10, "s-band-acc"),
        bar(390, 190, 168, 6, "s-line-2"),
      ]),
    },
    {
      // キャンセル・日程変更：管理リンク → 選び直す → 予定が置き換わる
      key: "change",
      group: "run",
      steps: 3,
      fig: svg([
        envelope(14, 44, 216, 152),
        bar(38, 118, 130, 6, "s-line-2"),
        chip(38, 140, 82, 26, "s-chip-acc"), chip(128, 140, 82, 26, "s-chip-off"),
        arrow(240, 120, 272),
        card(282, 30, 172, 180),
        weekGrid(302, 56, { cols: 3, rows: 4, cw: 34, cgap: 10, ch: 16, rgap: 8, picked: [[1, 2]], dim: [[0, 1]] }),
        arrow(464, 120, 496),
        card(506, 56, 82, 128),
        bar(524, 78, 46, 6, "s-line-2"),
        chip(524, 94, 46, 22, "s-chip-off"),
        `<path class="s-strike" d="M518 105h58"/>`,
        chip(524, 126, 46, 22, "s-chip-acc"),
        seal(534, 152, 22),
      ]),
    },
    {
      // プラン：作れる予約ページの枚数（1 / 2 / 5）が増える。プレミアム面だけ寒色。
      key: "plan",
      group: "more",
      steps: 3,
      href: "/plan.html",
      fig: svg([
        card(30, 96, 160, 118),
        bar(54, 120, 60, 8),
        chip(54, 138, 112, 58),
        card(220, 62, 160, 152),
        bar(244, 86, 60, 8),
        chip(244, 104, 112, 44), chip(244, 156, 112, 44),
        card(410, 26, 160, 188, "s-card-prem"),
        bar(434, 50, 60, 8, "s-line-prem"),
        chip(434, 68, 112, 24, "s-chip-prem"), chip(434, 98, 112, 24, "s-chip-prem"),
        chip(434, 128, 112, 24, "s-chip-prem"), chip(434, 158, 112, 24, "s-chip-prem"),
        chip(434, 188, 112, 16, "s-chip-prem"),
      ]),
    },
  ];

  // 一覧の章立て。SLIDES の並び順はそのままに、「いつ読むか」でまとめ直したもの。
  // ここに無い group の枚は一覧に出ない（増やしたときに黙って消えるのを防ぐため、
  // scripts/test/unit.mjs が「全スライドの group がこの表にある」ことを固定している）。
  const GROUPS = ["start", "setup", "run", "more"];

  let overlay = null;
  let index = 0;
  let lastFocus = null;

  const indexOfKey = (key) => SLIDES.findIndex((s) => s.key === key);

  // 文言は i18n.js 由来（自リポジトリのソース）だが、innerHTML で組む箇所は必ずエスケープする。
  function escapeText(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function stepsHtml(slide) {
    let out = "";
    for (let i = 1; i <= slide.steps; i++) out += `<li>${escapeText(t(`guide.${slide.key}.step${i}`))}</li>`;
    return out;
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay guide-overlay";
    overlay.id = "guide-modal";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal guide" role="dialog" aria-modal="true" aria-labelledby="guide-slide-title">
        <button class="modal-close" type="button" data-guide-close aria-label="${escapeText(t("guide.close"))}">✕</button>
        <div class="guide-head">
          <p class="eyebrow" data-guide-eyebrow></p>
          <div class="guide-track" data-guide-track></div>
        </div>
        <div class="guide-stage" data-guide-stage>
          <div class="guide-fig s-fig" data-guide-fig></div>
          <div class="guide-tx">
            <h2 id="guide-slide-title" data-guide-title></h2>
            <p class="guide-when"><span class="guide-tag" data-guide-whenlabel></span><span data-guide-when></span></p>
            <ol class="guide-steps" data-guide-steps></ol>
            <a class="button secondary btn-sm guide-cta" data-guide-cta hidden></a>
          </div>
        </div>
        <div class="guide-foot">
          <button class="button secondary btn-sm" type="button" data-guide-prev></button>
          <span class="guide-count" data-guide-count></span>
          <button class="button primary btn-sm" type="button" data-guide-next></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 目次を兼ねた進捗セグメント。押すとその枚へ飛ぶ（11枚を順に送るだけだと戻りづらい）。
    const track = overlay.querySelector("[data-guide-track]");
    SLIDES.forEach((slide, i) => {
      const seg = document.createElement("button");
      seg.type = "button";
      seg.className = "guide-seg";
      seg.dataset.guideGo = String(i);
      track.appendChild(seg);
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-guide-close]")) return close();
      const go = event.target.closest("[data-guide-go]");
      if (go) return show(Number(go.dataset.guideGo), 0);
      if (event.target.closest("[data-guide-prev]")) return show(index - 1, -1);
      if (event.target.closest("[data-guide-next]")) {
        // 最後の1枚では「次へ」を「ガイドを閉じる」に変える（行き止まりのボタンを押させない）。
        return index >= SLIDES.length - 1 ? close() : show(index + 1, 1);
      }
    });
    // 言語を切り替えたら、開いたまま今の枚を組み直す（閉じて開き直させない）。
    document.addEventListener("kimaru:languagechange", () => { if (overlay && !overlay.hidden) show(index, 0); });
  }

  function show(next, direction) {
    index = Math.max(0, Math.min(SLIDES.length - 1, next));
    const slide = SLIDES[index];
    const q = (sel) => overlay.querySelector(sel);
    q("[data-guide-eyebrow]").textContent = t("guide.eyebrow");
    q("[data-guide-fig]").innerHTML = slide.fig;
    q("[data-guide-title]").textContent = t(`guide.${slide.key}.title`);
    q("[data-guide-whenlabel]").textContent = t("guide.when");
    q("[data-guide-when]").textContent = t(`guide.${slide.key}.when`);
    q("[data-guide-steps]").innerHTML = stepsHtml(slide);
    const cta = q("[data-guide-cta]");
    cta.hidden = !slide.href;
    if (slide.href) { cta.href = slide.href; cta.textContent = t("guide.open"); }
    q("[data-guide-count]").textContent = `${index + 1} / ${SLIDES.length}`;
    const prev = q("[data-guide-prev]");
    prev.textContent = t("guide.prev");
    prev.disabled = index === 0;
    q("[data-guide-next]").textContent = index >= SLIDES.length - 1 ? t("guide.finish") : t("guide.next");
    overlay.querySelectorAll(".guide-seg").forEach((seg, i) => {
      seg.classList.toggle("is-on", i <= index);
      seg.setAttribute("aria-current", i === index ? "true" : "false");
      seg.setAttribute("aria-label", `${i + 1} / ${SLIDES.length}`);
    });
    // 紙芝居らしく、送った向きへ滑り込ませる。prefers-reduced-motion では CSS 側で無効。
    const stage = q("[data-guide-stage]");
    stage.classList.remove("slide-from-right", "slide-from-left");
    if (direction) {
      void stage.offsetWidth; // 同じクラスを付け直すだけでは再生されないので、レイアウトを1回確定させる
      stage.classList.add(direction > 0 ? "slide-from-right" : "slide-from-left");
    }
    q(".guide").scrollTop = 0;
    // 送るたびにURLを合わせる。pushState にしないのは、11枚送ったあとの「戻る」が
    // 11回ぶん必要になるため（戻る＝一覧に戻る、でいい）。
    if (location.hash.slice(1) !== slide.key) history.replaceState(null, "", `${location.pathname}${location.search}#${slide.key}`);
  }

  function open(at = 0) {
    if (!overlay) build();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add("modal-open");
    show(at, 0);
    overlay.querySelector("[data-guide-next]").focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove("modal-open");
    // 開いている機能を #key でURLに載せているので、閉じたら消す
    //（そのまま再読み込みするとまた開いてしまい、一覧に戻れない）。
    if (indexOfKey(location.hash.slice(1)) >= 0) history.replaceState(null, "", location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---- 機能一覧（/guide.html）------------------------------------------------------
  // カードは figure＋タイトル＋「こんなとき」の1行。図はModalと同じものを縮めて出す
  //（一覧とModalで絵が変わると、開いたときに「別の機能を開いた」と感じるため）。
  function renderIndex() {
    const host = document.querySelector("[data-guide-index]");
    if (!host) return;
    host.innerHTML = "";
    GROUPS.forEach((group) => {
      const slides = SLIDES.filter((slide) => slide.group === group);
      if (!slides.length) return;
      const section = document.createElement("section");
      section.className = "guide-group";
      section.dataset.guideGroup = group;
      section.innerHTML = `
        <div class="guide-group-head">
          <p class="eyebrow">${escapeText(t(`guide.group.${group}`))}</p>
          <p class="muted">${escapeText(t(`guide.group.${group}.desc`))}</p>
        </div>
        <div class="guide-cards${slides.length === 1 ? " is-single" : ""}">${slides.map((slide) => `
          <button class="guide-card" type="button" data-guide-open="${escapeText(slide.key)}">
            <span class="guide-card-fig s-fig">${slide.fig}</span>
            <b>${escapeText(t(`guide.${slide.key}.title`))}</b>
            <small>${escapeText(t(`guide.${slide.key}.when`))}</small>
            <span class="guide-card-cta">${escapeText(t("guide.index.cta"))}</span>
          </button>`).join("")}</div>`;
      host.appendChild(section);
    });
  }

  // ---- 開く導線 --------------------------------------------------------------------
  // 一覧のカード（data-guide-open="<key>"）。値が無いときは先頭から通しで読む。
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
    else if (event.key === "ArrowRight") { event.preventDefault(); show(index + 1, 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); show(index - 1, -1); }
  });

  // スワイプで送る（スマホ）。縦スクロールを邪魔しないよう、横移動が縦より大きいときだけ拾う。
  let touchX = 0;
  let touchY = 0;
  document.addEventListener("touchstart", (event) => {
    if (!overlay || overlay.hidden) return;
    touchX = event.changedTouches[0].clientX;
    touchY = event.changedTouches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", (event) => {
    if (!overlay || overlay.hidden || !touchX) return;
    const dx = event.changedTouches[0].clientX - touchX;
    const dy = event.changedTouches[0].clientY - touchY;
    touchX = 0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  }, { passive: true });

  // 一覧の描画と、/guide.html#page のような直リンク（案内メールから特定の機能へ誘導できるようにする）。
  // 言語を切り替えたら一覧も組み直す（Modalだけ訳されて一覧が元の言語のまま、を避ける）。
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

  // slides はテスト（scripts/test/unit.mjs）から参照する。ここに出ている key と steps の数だけ
  // i18n.js に guide.<key>.title / .when / .step1..N が要る、という対応をテストで固定している。
  window.KimaruGuide = { open, close, groups: GROUPS, slides: SLIDES.map((s) => ({ key: s.key, group: s.group, steps: s.steps, href: s.href || "" })) };
})();
