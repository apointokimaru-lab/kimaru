// 5日タイムグリッド（週表）の描画。ゲストの予約画面と、ホストのピンポイント候補選択（#303）で共用する。
//
// なぜ切り出すか: 「表示間隔に合わせて縦軸を伸ばす」「次の枠の開始までで高さを打ち切る」「低い枠は開始時刻だけ出す」
// といった非自明な計算が、画面ごとにコピーされると片方だけ直って崩れる。描画はここ1か所に集約し、
// 「選択の意味」（予約＝1つ選ぶ／候補選択＝複数をトグル）は呼び出し側が isSelected / onPick で決める。
(function () {
  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[<>'"&]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    }[char]));
  }

  function currentLocale() {
    const lang = window.KimaruI18n ? window.KimaruI18n.getLanguage() : "ja";
    if (lang === "en") return "en-US";
    if (lang === "zh-TW") return "zh-TW";
    return "ja-JP";
  }

  function parseYmd(str) {
    const [y, m, d] = String(str || "").split("-").map(Number);
    return { y, m: (m || 1) - 1, d: d || 1 };
  }
  function ymdStr(y, m0, d) { return `${y}-${pad2(m0 + 1)}-${pad2(d)}`; }
  function dateFromYmd(str, addDays = 0) { const p = parseYmd(str); return new Date(p.y, p.m, p.d + addDays); }
  function shiftYmd(str, deltaDays) { const dt = dateFromYmd(str, deltaDays); return ymdStr(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
  function todayYmd() { const d = new Date(); return ymdStr(d.getFullYear(), d.getMonth(), d.getDate()); }

  // ISO(UTC) → JST の年月日・その日の分。
  function jstFields(iso) {
    const shifted = new Date(iso).getTime() + 9 * 3600 * 1000;
    const u = new Date(shifted);
    return { y: u.getUTCFullYear(), m: u.getUTCMonth(), d: u.getUTCDate(), min: u.getUTCHours() * 60 + u.getUTCMinutes() };
  }
  function fmtMin(min) { return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; }
  function weekdayShort(date) { return new Intl.DateTimeFormat(currentLocale(), { weekday: "short" }).format(date).replace("曜日", ""); }

  function rangeLabelText(startYmd, days) {
    const start = dateFromYmd(startYmd, 0);
    const end = dateFromYmd(startYmd, (days || 5) - 1);
    const locale = currentLocale();
    const startTxt = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(start);
    const sameMonth = start.getMonth() === end.getMonth();
    const endTxt = new Intl.DateTimeFormat(locale, sameMonth ? { day: "numeric" } : { month: "long", day: "numeric" }).format(end);
    return `${startTxt} – ${endTxt}`;
  }

  // 空き枠が無い日も列を出す（軸は稼働時間帯）。
  // options: { grid, weekcal, data, actionLabel, picker, isSelected(slot), onPick(slot, button) }
  function render(options) {
    const { grid, weekcal, data } = options;
    if (!grid) return;
    const axis = data.axis || { start_min: 600, end_min: 1080 };
    const startHour = Math.max(0, Math.floor(axis.start_min / 60));
    const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(axis.end_min / 60)));
    const hours = endHour - startHour;
    const days = Number(data.days) || 5;
    const cols = Array.from({ length: days }, (_, i) => dateFromYmd(data.range_start, i));
    const colKey = (dt) => `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
    const byCol = new Map(cols.map((dt) => [colKey(dt), []]));
    (data.slots || []).forEach((s) => {
      const j = jstFields(s.start);
      const key = `${j.y}-${j.m}-${j.d}`;
      if (byCol.has(key)) byCol.get(key).push({ start: s.start, end: s.end, startMin: j.min, endMin: jstFields(s.end).min });
    });
    // 表示間隔（=隣接枠の最小間隔）に応じて縦軸(--hh)を伸ばし、短い間隔でも各枠に読みやすい高さを確保する。
    if (weekcal) {
      let step = Infinity;
      byCol.forEach((list) => {
        const mins = list.map((s) => s.startMin).sort((a, b) => a - b);
        for (let i = 1; i < mins.length; i++) { const d = mins[i] - mins[i - 1]; if (d > 0 && d < step) step = d; }
      });
      if (!isFinite(step)) step = 60;
      weekcal.style.removeProperty("--hh");
      const baseHH = parseFloat(getComputedStyle(weekcal).getPropertyValue("--hh")) || 56;
      const SLOT_MIN = 42; // 1枠の最低高さ(px)。間隔が短いほど --hh を伸ばす。
      const hh = Math.max(baseHH, Math.min(120, Math.round((SLOT_MIN * 60) / step)));
      weekcal.style.setProperty("--hh", `${hh}px`);
    }
    let axisLabels = "";
    for (let h = startHour; h <= endHour; h++) axisLabels += `<span class="hr" style="top:calc(var(--hh)*${h - startHour})">${pad2(h)}:00</span>`;
    const axisHtml = `<div class="wk-axis" style="min-height:calc(var(--hh)*${hours})">${axisLabels}</div>`;
    const headHtml = cols.map((dt) => `<div class="wk-headcell tappable" data-cal-open><span class="d">${dt.getDate()}</span>${escapeHtml(weekdayShort(dt))}</div>`).join("");
    const actionLabel = options.actionLabel || "";
    const isSelected = typeof options.isSelected === "function" ? options.isSelected : () => false;
    const dayColsHtml = cols.map((dt) => {
      const list = (byCol.get(colKey(dt)) || []).slice().sort((a, b) => a.startMin - b.startMin);
      const blocks = list.map((s, i) => {
        const top = (s.startMin - startHour * 60) / 60;
        const durH = (s.endMin - s.startMin) / 60;
        // 表示間隔が所要より短いと枠が重なるため、高さは「次の枠の開始まで(=表示間隔)」を超えないようにする。
        const gapH = (i + 1 < list.length) ? (list[i + 1].startMin - s.startMin) / 60 : durH;
        const height = Math.min(durH, gapH);
        // 低い枠は開始時刻のみ表示（終了は所要から自明）。2行が収まらず重なるのを防ぐ。
        const compact = height < 0.62;
        const label = compact
          ? `<span class="wk-slot-t">${escapeHtml(fmtMin(s.startMin))}</span>`
          : `<span class="wk-slot-t">${escapeHtml(fmtMin(s.startMin))}</span><span class="wk-slot-e">${escapeHtml(fmtMin(s.endMin))}</span>`;
        const picked = options.picker && isSelected({ start: s.start, end: s.end });
        const cls = `wk-slot${compact ? " is-compact" : ""}${picked ? " is-picked" : ""}`;
        const pressed = options.picker ? ` aria-pressed="${picked ? "true" : "false"}"` : "";
        return `<button type="button" class="${cls}"${pressed} data-start="${escapeHtml(s.start)}" data-end="${escapeHtml(s.end)}" title="${escapeHtml(actionLabel)}" style="top:calc(var(--hh)*${top.toFixed(3)});height:calc(var(--hh)*${height.toFixed(3)})">${label}</button>`;
      }).join("");
      return `<div class="wk-day" style="min-height:calc(var(--hh)*${hours})">${blocks}</div>`;
    }).join("");
    // 時間軸は右側だけにする（#321）。左右に同じ目盛りを置くと、その分だけ日の列が細くなる。
    // 残すのは右側。ラベルが右寄せ（.wk-axis .hr{right:8px}）で、隣の列との境界に時刻が並ぶため。
    grid.innerHTML = `${headHtml}<div class="wk-navcell"></div>${dayColsHtml}${axisHtml}`;
    grid._slots = data.slots || [];
    grid.querySelectorAll(".wk-slot").forEach((btn) => {
      const slot = { start: btn.dataset.start, end: btn.dataset.end };
      btn.addEventListener("click", () => { if (typeof options.onPick === "function") options.onPick(slot, btn); });
      // 単一選択（予約画面）は .sel、複数選択（候補選択）は .is-picked で見た目を分ける。
      if (!options.picker && isSelected(slot)) btn.classList.add("sel");
    });
    if (weekcal) weekcal.style.display = "";
  }

  window.KimaruWeekGrid = {
    render,
    rangeLabelText,
    currentLocale,
    escapeHtml,
    parseYmd,
    ymdStr,
    dateFromYmd,
    shiftYmd,
    todayYmd,
    jstFields,
    fmtMin,
    pad2,
  };
})();
