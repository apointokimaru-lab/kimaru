const $ = (selector) => document.querySelector(selector);
const t = (k, fb) => (window.KimaruI18n ? window.KimaruI18n.t(k) : fb);

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function esc(value) {
  return String(value || "").replace(/[<>'"&]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
function pad2(n) { return String(n).padStart(2, "0"); }
function setMsg(sel, text, kind = "") { const el = $(sel); if (el) { el.textContent = text; el.className = `message ${kind}`.trim(); } }

function fmtRange(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime())) return "";
  const d = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(a);
  return `${d} ${pad2(a.getHours())}:${pad2(a.getMinutes())}〜${pad2(b.getHours())}:${pad2(b.getMinutes())}`;
}

const params = new URLSearchParams(location.search);
const state = { id: params.get("id") || "", t: params.get("t") || "", slug: "", week: 0, booking: null };

function row(label, value, primary) {
  return `<div${primary ? ' class="is-primary"' : ""}><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function renderSummary(b) {
  const cancelled = b.status === "cancelled";
  $("#manage-title").textContent = cancelled
    ? t("mb.title.cancelled", "この予約はキャンセル済みです")
    : t("mb.title.confirm", "予約の確認");
  const meetingWith = t("mb.sub.meetingWith", "{name} さんとの面談");
  $("#manage-sub").textContent = b.host_name ? meetingWith.replace("{name}", b.host_name) : "";
  const rows = [
    row(t("mb.field.datetime", "日時"), fmtRange(b.start_at, b.end_at), true),
    row(t("mb.field.content", "内容"), b.page_title || t("mb.value.meetingFallback", "面談")),
    row(t("mb.field.name", "お名前"), b.visitor_name || ""),
    row(t("mb.field.location", "開催方法"), b.location_label || ""),
  ];
  if (b.meeting_url) rows.push(row(t("mb.field.meeting", "ミーティング"), b.meeting_url));
  rows.push(row(t("mb.field.status", "状態"), cancelled ? t("mb.status.cancelled", "キャンセル済み") : t("mb.status.confirmed", "確定")));
  $("#manage-summary").innerHTML = rows.join("");
  $("#manage-actions").hidden = cancelled;
}

async function load() {
  try {
    const data = await api(`booking-manage?id=${encodeURIComponent(state.id)}&t=${encodeURIComponent(state.t)}`);
    state.booking = data.booking;
    state.slug = data.booking.slug || "";
    renderSummary(data.booking);
  } catch (error) {
    $("#manage-title").textContent = t("mb.title.invalid", "リンクが無効です");
    $("#manage-sub").textContent = "";
    $("#manage-summary").innerHTML = "";
    $("#manage-actions").hidden = true;
    setMsg("#manage-message", error.message, "error");
  }
}

$("#btn-cancel")?.addEventListener("click", async () => {
  if (!confirm(t("mb.cancel.confirm", "この予約をキャンセルします。よろしいですか？"))) return;
  setMsg("#manage-message", t("mb.cancel.progress", "キャンセルしています..."));
  try {
    await api("booking-manage", { method: "POST", body: JSON.stringify({ id: state.id, t: state.t, action: "cancel" }) });
    state.booking.status = "cancelled";
    renderSummary(state.booking);
    $("#reschedule-card").hidden = true;
    setMsg("#manage-message", t("mb.cancel.done", "予約をキャンセルしました。確認メールをお送りします。"), "success");
  } catch (error) {
    setMsg("#manage-message", error.message, "error");
  }
});

$("#btn-reschedule")?.addEventListener("click", () => {
  $("#reschedule-card").hidden = false;
  $("#reschedule-card").scrollIntoView({ behavior: "smooth", block: "start" });
  loadWeek(0);
});
$("#rs-back")?.addEventListener("click", () => { $("#reschedule-card").hidden = true; });
$("#rs-prev")?.addEventListener("click", () => { if (state.week > 0) loadWeek(state.week - 1); });
$("#rs-next")?.addEventListener("click", () => loadWeek(state.week + 1));

function weekLabel(week) {
  const base = new Date();
  base.setDate(base.getDate() + week * 7);
  const s = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
  return `${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`;
}

// range_start（"YYYY-MM-DD"）から days 日分のレンジ表記（例: 7/20 - 7/24）。
function rangeLabel(rangeStart, days) {
  const [y, m, d] = String(rangeStart).split("-").map(Number);
  const s = new Date(y, m - 1, d);
  const e = new Date(y, m - 1, d + (days || 5) - 1);
  return `${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`;
}

async function loadWeek(week) {
  const grid = $("#rs-slots");
  grid.innerHTML = `<p class="muted">${esc(t("booking.week.loading", "空き枠を読み込み中..."))}</p>`;
  try {
    const data = await api(`availability?slug=${encodeURIComponent(state.slug || "demo")}&week=${week}`);
    state.week = typeof data.week === "number" ? data.week : week;
    if (data.paused) {
      grid.innerHTML = `<p class="muted">${esc(t("mb.rs.paused", "現在、この予約ページは受付を停止しているため、日程変更ができません。主催者にお問い合わせください。"))}</p>`;
      $("#rs-week-nav").style.display = "none";
      return;
    }
    // 週ナビは共有レンダラがカレンダー直上へ移動配置するので、先に表示状態を確定させておく。
    $("#rs-week-nav").style.display = "";
    $("#rs-prev").disabled = !data.hasPrev;
    $("#rs-next").disabled = !data.hasNext;
    // 空き枠がある週は共有レンダラがラベルを上書きする。空週向けに range_start（5日窓）から補完。
    $("#rs-week-label").textContent = data.range_start ? rangeLabel(data.range_start, Number(data.days) || 5) : weekLabel(state.week);
    renderSlots(data.slots || []);
  } catch (error) {
    grid.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
  }
}

// 予約ページと同じ週テーブルUI（week-table.js・時間×曜日・スマホは5日縦積み）で空き枠を表示する。
function renderSlots(slots) {
  window.KimaruWeekTable.render($("#rs-slots"), slots, {
    navId: "rs-week-nav",
    labelId: "rs-week-label",
    actionLabel: t("mb.rs.book", "変更する"),
    onSelect: (slot) => chooseSlot(slot.start, slot.end),
  });
}

async function chooseSlot(start, end) {
  const confirmMsg = t("mb.rs.chooseConfirm", "この日時に変更します。\n{range}\nよろしいですか？").replace("{range}", fmtRange(start, end));
  if (!confirm(confirmMsg)) return;
  setMsg("#rs-message", t("mb.rs.progress", "変更しています..."));
  try {
    const data = await api("booking-manage", { method: "POST", body: JSON.stringify({ id: state.id, t: state.t, action: "reschedule", start, end }) });
    state.booking.start_at = data.start_at;
    state.booking.end_at = data.end_at;
    if (data.meeting_url !== undefined) state.booking.meeting_url = data.meeting_url;
    renderSummary(state.booking);
    $("#reschedule-card").hidden = true;
    setMsg("#manage-message", t("mb.rs.done", "日程を変更しました。確認メールをお送りします。"), "success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    setMsg("#rs-message", error.message, "error");
  }
}

window.addEventListener("kimaru:languagechange", () => {
  if (state.booking) renderSummary(state.booking);
  if (!$("#reschedule-card").hidden) loadWeek(state.week);
});

if (!state.id || !state.t) {
  $("#manage-title").textContent = t("mb.title.invalid", "リンクが無効です");
  setMsg("#manage-message", t("mb.err.invalidLink", "予約管理リンクが正しくありません。メールのリンクからアクセスしてください。"), "error");
} else {
  load();
}
