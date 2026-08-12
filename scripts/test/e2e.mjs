// E2E（Playwright）。public/ を静的配信し、各ページを実ブラウザでロード。
// /api/* は route で実データ形のモックに差し替え、実データ描画・ボタン動作・残ダミー無し・JS例外無しを検証。
//   node scripts/test/e2e.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pub = path.join(repo, "public");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  ✗ " + n); } };
const section = (n) => console.log("\n# " + n);

// ---- 静的サーバ（public/）。/api/* は Playwright route が処理するのでここでは触らない ----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(pub, p);
  if (!file.startsWith(pub) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "text/plain" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

// ---- モックデータ（実APIのレスポンス形に一致） ----
const now = new Date();
const iso = (off, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + off, h, m).toISOString();
const MOCK_BOOKINGS = [
  { id: "b-today", visitor_name: "モック 太郎", visitor_email: "taro@example.com", topic: "初回相談したい", start_at: iso(0, 14, 0), end_at: iso(0, 14, 30), location_type: "google_meet", meeting_url: "https://meet.google.com/mock-today", manage_url: "/manage-booking.html?id=b-today&t=tok", status: "confirmed", answers: [{ question_text: "ご相談の背景", answer_text: "初回相談したい" }, { question_text: "ご予算感", answer_text: "未定" }] },
  { id: "b-up", visitor_name: "モック 花子", visitor_email: "hana@example.com", topic: "採用の相談", start_at: iso(2, 11, 0), end_at: iso(2, 11, 30), location_type: "zoom", manage_url: "/manage-booking.html?id=b-up&t=tok2", status: "confirmed", answers: [] },
  { id: "b-cancel", visitor_name: "キャンセル 三郎", start_at: iso(0, 16, 0), end_at: iso(0, 16, 30), status: "cancelled", answers: [] },
];
const MOCK = {
  "me": { owner: { id: "o1", name: "テスト オーナー", email: "owner@example.com", plan: "pro" }, calendar_connected: true },
  "owner-bookings": { bookings: MOCK_BOOKINGS },
  "booking-pages": { pages: [{ id: "p1", slug: "taro", title: "初回相談", duration_minutes: 30, location_type: "google_meet", candidate_days: 0, booking_range_months: 2, is_active: true }], availability: [] },
  "profile": { profile: { profile_name: "テストオーナー", profile_title: "", profile_strengths: "", profile_style: "", profile_offer: "", profile_values: "", profile_goal: "" } },
  "appointment-log": { logs: [{ visitor_email: "taro@example.com", keywords: "初回", notes: "丁寧な問い合わせ。", next_action: "日程を案内する。", scores: {} }] },
  // 会話記録（booking_notes）: リストGET(booking_ids)と単体GET(note)の両方をこの1オブジェクトで満たす（route はクエリを除去して同じキーに寄せるため）。
  "booking-note": { booking_ids: ["b-today"], note: { keywords: "初回", notes: "丁寧な問い合わせ。", next_action: "日程を案内する。", scores: {} } },
  "pending-answers": { count: 0, items: [] },
};

const DUMMY = ["佐藤 りく", "山田 はな", "高橋 あおい", "田中 さくら", "鈴木 みなと", "佐藤 健", "b/tanaka", "abc-defg-hij", "ENTP", "サウナ / 登山"];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/api/**", (route) => {
  const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
  const body = Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});

async function newPage() {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page._errors = errors;
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  return page;
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);

// ===== 1) 全ページ：JS例外なし＆ダミー文字列なし =====
section("all pages: no JS exception, no dummy strings");
const PAGES = [
  "index", "landing3", "plan", "login", "signup", "reset-password", "square", "pro-thanks",
  "dashboard", "contacts", "booking-settings", "profile", "settings", "schedule", "answers",
  "meeting?id=b-today", "booking?slug=taro", "public-profile?slug=taro", "manage-booking?id=b-today&t=tok",
  "manage-booking?k=b-today.tok", // 新しい1パラメータ形式の管理リンク
  "answer-question?id=b-today&t=tok", "pending-questions", "ai-assist",
  "operator-login", "operators", "cat-key-admin", "privacy", "terms", "tokushoho",
];
for (const route of PAGES) {
  const [name, query] = route.split("?");
  const url = `${base}/${name}.html${query ? "?" + query : ""}`;
  const page = await newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
  } catch (e) { /* networkidle timeout は許容 */ }
  await page.waitForTimeout(400);
  const text = await bodyText(page).catch(() => "");
  const hit = DUMMY.find((d) => text.includes(d));
  ok(`${name}: no dummy string` + (hit ? ` (found "${hit}")` : ""), !hit);
  ok(`${name}: no JS exception` + (page._errors.length ? ` (${page._errors[0].slice(0, 80)})` : ""), page._errors.length === 0);
  await page.close();
}

// ===== 2) dashboard 実データ =====
section("dashboard: real data");
{
  const page = await newPage();
  await page.goto(`${base}/dashboard.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#today-list")?.textContent?.includes("モック"), null, { timeout: 8000 }).catch(() => {});
  const today = await page.textContent("#today-list").catch(() => "");
  ok("today-list shows mock today booking", today.includes("モック 太郎"));
  ok("today-list join button present (meeting_url)", (await page.locator("#today-list a.button.primary").count()) >= 1);
  const share = await page.textContent("#share-url").catch(() => "");
  ok("share-url shows real booking page url", /\/b\/taro$/.test(share.trim()));
  ok("share copy button visible", await page.locator("#share-copy").isVisible());
  const week = await page.textContent("#todo-week-count").catch(() => "");
  ok("todo-week-count is numeric", /^\d+$/.test(week.trim()));
  await page.close();
}

// ===== 3) schedule 実データ＋週ナビ =====
section("schedule: real grid + nav");
{
  const page = await newPage();
  await page.goto(`${base}/schedule.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#week-grid .week-col").length === 7, null, { timeout: 8000 }).catch(() => {});
  ok("week-grid has 7 columns", (await page.locator("#week-grid .week-col").count()) === 7);
  ok("week-grid shows today's mock booking", (await page.textContent("#week-grid")).includes("モック 太郎"));
  const before = await page.textContent("#weekRange");
  await page.click("#weekNext");
  await page.waitForTimeout(150);
  ok("week nav changes range", (await page.textContent("#weekRange")) !== before);
  await page.close();
}

// ===== 4) answers 実データ＋既読 =====
section("answers: real cards + mark read");
{
  const page = await newPage();
  await page.goto(`${base}/answers.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#ans-list .ans-card").length > 0, null, { timeout: 8000 }).catch(() => {});
  const cards = await page.locator("#ans-list .ans-card").count();
  ok("answer cards rendered from real data", cards >= 1);
  ok("answers show mock guest", (await page.textContent("#ans-list")).includes("モック 太郎"));
  // bookings.topic は1問目の回答のコピーなので、同じ内容を「今回お話したい内容」として二重に出さない。
  const todayCard = await page.locator(".ans-card", { hasText: "モック 太郎" }).first().innerText();
  ok("topic row is not duplicated as 今回お話したい内容", !todayCard.includes("今回お話したい内容"));
  ok("real question label is shown instead", todayCard.includes("ご相談の背景"));
  ok("the answer itself is shown once", (todayCard.match(/初回相談したい/g) || []).length === 1);
  // 回答が無く topic だけを持つ旧データは、従来どおり「今回お話したい内容」として出す。
  const legacyCard = await page.locator(".ans-card", { hasText: "モック 花子" }).first().innerText();
  ok("legacy topic-only booking still shows the topic row", legacyCard.includes("今回お話したい内容") && legacyCard.includes("採用の相談"));
  const unreadBefore = Number(await page.textContent("#unread-count"));
  await page.locator("#ans-list [data-mark-read]").first().click();
  await page.waitForTimeout(150);
  const unreadAfter = Number(await page.textContent("#unread-count"));
  ok("mark-read decrements unread count", unreadAfter === unreadBefore - 1);
  await page.close();
}

// ===== 5) meeting 実データ＋管理リンク＋既読 =====
section("meeting: real briefing");
{
  const page = await newPage();
  await page.goto(`${base}/meeting.html?id=b-today`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#meeting-survey")?.textContent?.includes("初回相談"), null, { timeout: 8000 }).catch(() => {});
  ok("meeting h1 shows guest name", (await page.textContent("#meeting-h1")).includes("モック 太郎"));
  ok("meeting survey shows real topic", (await page.textContent("#meeting-survey")).includes("初回相談したい"));
  ok("meet url is real", (await page.textContent("#meet-url")).includes("mock-today"));
  const mgrHref = await page.locator("[data-meeting-manage]").first().getAttribute("href");
  ok("manage link has real href", (mgrHref || "").includes("id=b-today"));
  await page.waitForFunction(() => document.querySelector("#meeting-memos")?.textContent?.includes("丁寧な問い合わせ"), null, { timeout: 8000 }).catch(() => {});
  ok("memo shows conversation note (booking_notes)", (await page.textContent("#meeting-memos")).includes("丁寧な問い合わせ"));
  ok("memo add button opens note editor", await (async () => { await page.click("#meeting-note-add"); await page.waitForTimeout(200); const vis = await page.locator("#note-edit-modal").isVisible(); await page.locator("#note-edit-modal [data-note-close]").first().click().catch(() => {}); return vis; })());
  await page.close();
}

// ===== 6) 予約ページの編集で設定が消えない（#300） =====
// 保存済みの値が select の選択肢に無いと、代入しても「選択なし」＝空表示になり、
// そのまま保存すると 0 に落ちて設定が消える。選択肢へ足してから選ぶこと。
section("booking-settings: edit keeps out-of-list values (#300)");
{
  const PAGE = {
    id: "p1", slug: "taro", title: "初回相談", description: "",
    duration_minutes: 60, buffer_before_minutes: 15, buffer_after_minutes: 15, // 15分=UIの選択肢に無い旧データ（本番に実在）
    location_type: "google_meet", location_value: "", booking_range_months: 2, candidate_days: 0,
    accept_holidays: true, lead_time_hours: 18, slot_interval_minutes: 30, is_active: true,
    // 保存済み質問には id が付いてくる。保存時にそのまま返さないとサーバ側で
    // 「追加」扱いになり、質問のUUIDが変わって過去の回答との紐付けが切れる（#304）。
    questionnaire_questions: [{ id: "q-1", question_text: "ご予算感", is_required: true, answer_type: "text", options: [], sort_order: 1 }],
    availability: [{ day_of_week: 1, start_time: "10:00:00", end_time: "18:00:00" }],
  };
  const page = await newPage();
  let sent = null;
  await page.route("**/api/**", (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
    if (name === "booking-page-save") { sent = JSON.parse(route.request().postData() || "{}"); }
    const body = name === "booking-pages" ? { pages: [PAGE], availability: [], default_availability: [] }
      : name === "booking-page-save" ? { ok: true, booking_page: PAGE }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-page-action="edit"]', { timeout: 8000 }).catch(() => {});
  await page.click('[data-page-action="edit"]');
  await page.waitForTimeout(300);
  const form = await page.evaluate(() => {
    const f = document.querySelector("#booking-page-form");
    const g = (n) => { const e = f.elements[n]; return { value: e ? e.value : null, idx: e ? e.selectedIndex : null }; };
    return { bufB: g("buffer_before_minutes"), bufA: g("buffer_after_minutes"), interval: g("slot_interval_minutes"), lead: g("lead_time_hours") };
  });
  ok("edit form shows stored buffer 15 (not blank)", form.bufB.value === "15" && form.bufB.idx >= 0);
  ok("edit form shows stored after-buffer 15", form.bufA.value === "15" && form.bufA.idx >= 0);
  ok("edit form shows stored interval 30", form.interval.value === "30");
  ok("edit form shows stored lead time 18", form.lead.value === "18");
  await page.click('#booking-page-form button[type="submit"]');
  await page.waitForTimeout(400);
  ok("saving unchanged keeps buffers (not reset to 0)", sent?.buffer_before_minutes === 15 && sent?.buffer_after_minutes === 15);
  ok("saving unchanged keeps interval", sent?.slot_interval_minutes === 30);
  // #304: 保存済み質問の id を往復させる（サーバ側の「更新」判定に使う）
  ok("existing question keeps its id on save", sent?.questions?.[0]?.id === "q-1");
  ok("existing question keeps its text", sent?.questions?.[0]?.question_text === "ご予算感");
  await page.close();
}

// ===== 7) 質問ゼロの予約ページはアンケート欄を出さない =====
// 以前は「今回お話したい内容」を既定質問として自動で1問足していた。
section("booking page with no questions shows no questionnaire");
{
  const page = await newPage();
  await page.route("**/api/**", (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
    const body = name === "availability"
      ? { host: { title: "初回相談", duration_minutes: 30, location_type: "google_meet", slug: "taro" }, questions: [], slots: [], axis: { start_min: 600, end_min: 1080 } }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/booking.html?slug=taro`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const fields = await page.locator("#questionnaire-fields .q-field").count();
  ok("no questionnaire field is rendered", fields === 0);
  ok("no default 今回お話したい内容 question", !(await bodyText(page)).includes("今回お話したい内容"));
  ok("no JS exception", page._errors.length === 0);
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} e2e: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
