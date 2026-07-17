// 週の空き枠テーブル（時間×曜日・スマホ<=680pxは空きのある日を最大5日ずつ縦積み）の共有レンダラ。
// 予約ページ（booking-week.js）と予約変更画面（manage-booking.js）で同じ見た目を使うための切り出し。
// 使い方:
//   window.KimaruWeekTable.render(container, slots, {
//     navId,        // 週ナビ要素のid（カレンダー直上へ移動配置される）
//     labelId,      // 週範囲ラベル要素のid
//     actionLabel,  // 枠ボタンの小ラベル（例:「予約する」「変更する」）
//     onSelect,     // (slot, button) => void 枠選択時のコールバック
//   })
// container._slots に表示中スロットを保持する（booking-week.js の「直近の空き時間」が参照）。
(() => {
  const t = (key, fallback) => (window.KimaruI18n ? window.KimaruI18n.t(key) : fallback);
  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const pad2 = (value) => String(value).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const timeText = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

  function currentLocale() {
    const lang = window.KimaruI18n ? window.KimaruI18n.getLanguage() : "ja";
    if (lang === "en") return "en-US";
    if (lang === "zh-TW") return "zh-TW";
    return "ja-JP";
  }

  function dayHeading(date) {
    return new Intl.DateTimeFormat(currentLocale(), { month: "numeric", day: "numeric", weekday: "short" })
      .format(date)
      .replace("曜日", "");
  }

  function weekTitle(days) {
    const first = days[0];
    const last = days[days.length - 1];
    const locale = currentLocale();
    const fmt = (d, withYear) => new Intl.DateTimeFormat(locale, withYear ? { year: "numeric", month: "long", day: "numeric" } : { month: "long", day: "numeric" }).format(d);
    return `${fmt(first, true)} - ${fmt(last, false)}`;
  }

  function buildWeekDays(slots) {
    const firstSlot = slots[0]?.startDate || new Date();
    const firstDay = new Date(firstSlot.getFullYear(), firstSlot.getMonth(), firstSlot.getDate());
    return Array.from({ length: 7 }, (_, index) => new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + index));
  }

  function buildTimeRows(slots) {
    // 実際の枠の開始時刻から行を作る（所要時間60分やバッファで30分グリッドから外れても確実に表示）
    const times = [...new Set(slots.map((slot) => minutesOfDay(slot.startDate)))].sort((a, b) => a - b);
    return times.length ? times : [10 * 60];
  }

  const slotKey = (slot) => `${dateKey(slot.startDate)}-${timeText(slot.startDate)}`;

  // 1グループ分（最大7日）の時間×曜日テーブルを描画する。
  // rows は週全体で共通の時間行。予定がない日・時間帯も列/セルを必ず出す（空きは「-」表示）。
  function weekTableHtml(days, rows, byStart) {
    return `
      <div class="week-table-wrap">
        <table class="week-table">
          <thead>
            <tr>
              <th>${escapeHtml(t("booking.week.timeHeader", "時間"))}</th>
              ${days.map((day) => `<th>${dayHeading(day)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((minute) => `
              <tr>
                <th>${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}</th>
                ${days.map((day) => {
                  const key = `${dateKey(day)}-${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
                  const slot = byStart.get(key);
                  return `<td data-slot-key="${key}">${slot ? "" : '<span class="week-busy">-</span>'}</td>`;
                }).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  // スマホ（<=680px）は横スクロールを使わず、空きがある日だけを最大5日ずつ縦に積んで表示する。
  const narrowMq = window.matchMedia("(max-width:680px)");
  let lastRender = null;

  function render(container, rawSlots, options = {}) {
    lastRender = [container, rawSlots, options];
    const slots = [...rawSlots]
      .map((slot) => ({ ...slot, startDate: new Date(slot.start), endDate: new Date(slot.end) }))
      .filter((slot) => !Number.isNaN(slot.startDate.getTime()) && !Number.isNaN(slot.endDate.getTime()))
      .sort((a, b) => a.startDate - b.startDate);

    if (!slots.length) {
      container._slots = [];
      container.innerHTML = `<p class="muted">${escapeHtml(t("booking.week.empty", "この週は空き枠がありません。「次の週 →」もご確認ください。"))}</p>`;
      return;
    }
    container._slots = slots;

    const allDays = buildWeekDays(slots);
    const byStart = new Map(slots.map((slot) => [slotKey(slot), slot]));
    const duration = Math.round((slots[0].endDate - slots[0].startDate) / 60000);
    // 週全体で共通の時間行。空きがある時間だけでなく、どの曜日にも同じ行を出して「-」で埋める。
    const timeRows = buildTimeRows(slots);

    let dayGroups;
    if (narrowMq.matches) {
      // スマホでも「予定がない日」を含めて全曜日を表示する（空きが無い日/時間は「-」）。
      // 横スクロールを避けるため、最大4日ずつに分割して縦に積む。
      const groupSize = 4;
      dayGroups = [];
      for (let i = 0; i < allDays.length; i += groupSize) dayGroups.push(allDays.slice(i, i + groupSize));
    } else {
      dayGroups = [allDays];
    }
    const tables = dayGroups.map((days) => weekTableHtml(days, timeRows, byStart)).join("");

    container.innerHTML = `
    <div class="week-schedule-card">
      <div class="week-schedule-head">
        <div>
          <p class="eyebrow">${escapeHtml(t("booking.week.cardEyebrow", "1週間の空き枠"))}</p>
          <h3>${escapeHtml(weekTitle(allDays))}</h3>
        </div>
        <div class="week-schedule-meta">
          <span>${escapeHtml(t("booking.week.openTime", "空いている時間"))}</span>
          <strong>${escapeHtml(t("booking.week.durationMeta", "所要時間 {min}分").replace("{min}", duration))}</strong>
        </div>
      </div>
      ${tables}
    </div>
  `;

    // 週移動ボタン等のナビをカレンダー（最初の表）の直上に配置する。
    // 静的ノードの移動なのでリスナーは維持される（書き換え前の退避は呼び出し側 loadWeek）。
    const nav = options.navId ? document.getElementById(options.navId) : null;
    const card = container.querySelector(".week-schedule-card");
    const firstWrap = container.querySelector(".week-table-wrap");
    if (nav && card && firstWrap) card.insertBefore(nav, firstWrap);
    // ナビの範囲ラベルを実際に表示中の週（先頭スロット起点）に合わせる。
    const label = options.labelId ? document.getElementById(options.labelId) : null;
    if (label) {
      const last = allDays[allDays.length - 1];
      label.textContent = `${allDays[0].getMonth() + 1}/${allDays[0].getDate()} - ${last.getMonth() + 1}/${last.getDate()}`;
    }

    const actionLabel = options.actionLabel || t("booking.week.book", "予約する");
    container.querySelectorAll("td[data-slot-key]").forEach((cell) => {
      const slot = byStart.get(cell.dataset.slotKey);
      if (!slot) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "week-slot";
      button.innerHTML = `<span>${timeText(slot.startDate)}</span><small>${escapeHtml(actionLabel)}</small>`;
      button.addEventListener("click", () => options.onSelect && options.onSelect(slot, button));
      cell.replaceChildren(button);
    });
  }

  // 端末回転などで幅区分が変わったら組み直す（選択済みの日程は呼び出し側が保持する）。
  narrowMq.addEventListener?.("change", () => {
    if (lastRender) render(...lastRender);
  });

  window.KimaruWeekTable = { render };
})();
