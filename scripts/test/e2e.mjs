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
  // netlify.toml の rewrite 相当。/b/<slug> と /p/<token> は booking.html を返す。
  if (/^\/(b|p)\//.test(p)) p = "/booking.html";
  const file = path.join(pub, p);
  if (!file.startsWith(pub) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("nf"); }
  let body = fs.readFileSync(file);
  // netlify/edge-functions/auth-gate.js 相当。全HTMLの </body> 直前に計測スニペットを差し込む。
  // 入れておかないと、テストの中だけ usage.js が読み込まれず「壁に当たった記録」を検証できない。
  if (path.extname(file) === ".html") {
    const html = body.toString("utf8");
    const end = html.lastIndexOf("</body>");
    if (end >= 0) body = Buffer.from(html.slice(0, end) + '<script src="/usage.js" defer></script>' + html.slice(end), "utf8");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "text/plain" });
  res.end(body);
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
// 運営の分析ダッシュボード（#343）。/api/usage-summary の実レスポンス形に合わせる。
const USAGE_DAYS = Array.from({ length: 30 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + i).toISOString().slice(0, 10));
const MOCK_USAGE_SUMMARY = {
  generated_at: now.toISOString(),
  range: { days: 30, since: iso(-30, 0, 0), days_list: USAGE_DAYS },
  notes: [],
  accounts: {
    total: 42, active: 40, disabled: 2, pending_cat_key: 1,
    email_verified: 30, email_verified_rate: 71.4,
    by_plan: { free: 30, pro: 9, premium: 3 }, paid: 12, paid_rate: 28.6,
    signups_in_range: 7,
    signups_daily: USAGE_DAYS.map((day, i) => ({ day, count: i % 5 === 0 ? 2 : 0 })),
    signups_monthly: [{ month: "2026-06", count: 0 }, { month: "2026-07", count: 20 }, { month: "2026-08", count: 22 }],
  },
  revenue: {
    available: true, paying_pro: 6, paying_premium: 2, paying_total: 8, cat_key_paid: 4,
    mrr_estimate: 6 * 980 + 2 * 2200, price: { pro: 980, premium: 2200 },
    cancel_events: 3, cancel_events_in_range: 1,
    days_to_paid: { samples: 8, p25: 2, median: 5.5, p75: 12 },
  },
  conversion: { cohorts: [{ month: "2026-07", signups: 20, paid: 5, paying: 3, rate: 25 }, { month: "2026-08", signups: 22, paid: 7, paying: 5, rate: 31.8 }] },
  activation: {
    denominator: 40,
    steps: [
      { label: "予約ページを作成", count: 33, rate: 82.5, available: true },
      { label: "受付時間を設定", count: 28, rate: 70, available: true },
      { label: "Googleカレンダー連携", count: 21, rate: 52.5, available: true },
      { label: "Zoom連携", count: null, rate: null, available: false },
      { label: "予約が入った", count: 14, rate: 35, available: true },
    ],
  },
  bookings: {
    available: true, in_range: 18, cancelled: 3, cancel_rate: 16.7,
    total_all_time: 120, cancelled_all_time: 14, cancel_rate_all_time: 11.7, owners_with_booking: 22,
    daily: USAGE_DAYS.map((day, i) => ({ day, count: i % 3 === 0 ? 1 : 0 })),
    monthly: [{ month: "2026-06", count: 31 }, { month: "2026-07", count: 52 }, { month: "2026-08", count: 37 }],
    by_location: { google_meet: 12, zoom: 4, in_person: 2 },
    pinpoint_links_in_range: 3, pinpoint_links_total: 11,
  },
  ai: { available: true, month: "2026-08", calls: 24, owners: 3 },
  usage: {
    available: true,
    top_pages: [{ page: "/dashboard.html", views: 540, visitors: 120 }, { page: "/b/:slug", views: 310, visitors: 180 }],
    daily: USAGE_DAYS.map((day, i) => ({ day, views: 20 + i, visitors: 8 + (i % 7) })),
    by_plan: [{ page: "/dashboard.html", guest: 0, free: 300, pro: 180, premium: 60, total: 540 }],
    sources: [{ source: "(direct)", views: 400 }, { source: "www.google.com", views: 120 }],
    devices: { desktop: 600, mobile: 250 },
    acquisition_funnel: [
      { label: "LP（トップ）閲覧", value: 900 }, { label: "料金ページ閲覧", value: 320 },
      { label: "登録画面を開いた", value: 90 }, { label: "登録完了", value: 7 },
    ],
    booking_funnel: [{ label: "予約ページ閲覧", value: 310 }, { label: "予約完了", value: 18 }],
  },
};

const MOCK = {
  "me": { owner: { id: "o1", name: "テスト オーナー", email: "owner@example.com", plan: "pro" }, calendar_connected: true },
  "owner-bookings": { bookings: MOCK_BOOKINGS },
  "booking-pages": { pages: [{ id: "p1", slug: "taro", title: "初回相談", duration_minutes: 30, location_type: "google_meet", candidate_days: 0, booking_range_months: 2, is_active: true }], availability: [] },
  "profile": { profile: { profile_name: "テストオーナー", profile_title: "", profile_strengths: "", profile_style: "", profile_offer: "", profile_values: "", profile_goal: "" } },
  "appointment-log": { logs: [{ visitor_email: "taro@example.com", keywords: "初回", notes: "丁寧な問い合わせ。", next_action: "日程を案内する。", scores: {} }] },
  // 会話記録（booking_notes）: リストGET(booking_ids)と単体GET(note)の両方をこの1オブジェクトで満たす（route はクエリを除去して同じキーに寄せるため）。
  "booking-note": { booking_ids: ["b-today"], note: { keywords: "初回", notes: "丁寧な問い合わせ。", next_action: "日程を案内する。", scores: {} } },
  "pending-answers": { count: 0, items: [] },
  "usage-summary": MOCK_USAGE_SUMMARY,
};

const DUMMY = ["佐藤 りく", "山田 はな", "高橋 あおい", "田中 さくら", "鈴木 みなと", "佐藤 健", "b/tanaka", "abc-defg-hij", "ENTP", "サウナ / 登山"];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/api/**", (route) => {
  const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
  const body = Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});

async function newPage() {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page._errors = errors;
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  page._requests = requests;
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch (e) {}
    // 計測ビーコンの中身を検証できるようにする。Blob で送られた本文は request.postData() では見えないため、
    // sendBeacon を差し替えて本文を window.__beacons に控える（送信自体はしない＝テストのAPIモックも汚さない）。
    window.__beacons = [];
    try {
      Object.defineProperty(navigator, "sendBeacon", {
        value: (url, blob) => { blob.text().then((text) => window.__beacons.push({ url, body: text })); return true; },
        configurable: true,
      });
    } catch (e) {}
  });
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
  "operator-login", "operators", "cat-key-admin", "analytics", "privacy", "terms", "tokushoho",
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
  // #321: プレビューは削除し、「＋ 新しい予約ページ」は見出しの横へ
  ok("no preview button in the share card", (await page.locator("#share-preview").count()) === 0);
  ok("new page button sits next to the heading", (await page.locator('.side-card-head a[href="/booking-settings.html?new=1"]').count()) === 1);
  const week = await page.textContent("#todo-week-count").catch(() => "");
  ok("todo-week-count is numeric", /^\d+$/.test(week.trim()));
  // #321: 今週の予約は件数があるときだけ出す（モックは今日の予約あり）
  ok("this week's row is shown when there are bookings", await page.locator("#todo-week").isVisible());
  ok("empty note is hidden when there is something to do", !(await page.locator("#todo-empty").isVisible()));
  // 「回答待ちの質問」は停止中（#314）。要対応に出さず、APIも叩かない。
  ok("no pending-questions link in todos", (await page.locator('a[href="/pending-questions.html"]').count()) === 0);
  ok("no 回答待ちの質問 row", !(await page.textContent(".todo")).includes("回答待ち"));
  ok("pending-answers API is not called", !page._requests.some((u) => u.includes("/api/pending-answers")));
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
  // bookings.topic は実在しない質問なので、回答履歴のどこにも「今回お話したい内容」を出さない（#312）。
  const ansText = await page.textContent("#ans-list");
  ok("no 今回お話したい内容 row anywhere", !ansText.includes("今回お話したい内容"));
  ok("real question label is shown instead", ansText.includes("ご相談の背景"));
  ok("the answer itself is shown once", (ansText.match(/初回相談したい/g) || []).length === 1);
  // topic しか持たない予約（回答レコード無し）は、回答一覧に出さない。
  ok("booking without answer records is not listed", !ansText.includes("モック 花子"));
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
  ok("meeting survey has no 今回お話したい内容 row", !(await page.textContent("#meeting-survey")).includes("今回お話したい内容"));
  await page.close();
}

// ===== 5b) 回答レコードが無い面談は「アンケートが未設定です」 =====
section("meeting: no questionnaire message (#312)");
{
  const page = await newPage();
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
    const body = name === "owner-bookings"
      ? { bookings: [{ ...MOCK_BOOKINGS[0], topic: "初回相談したい", answers: [] }] }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/meeting.html?id=b-today`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const survey = await page.textContent("#meeting-survey");
  ok("shows アンケートが未設定です", survey.includes("アンケートが未設定です"));
  ok("does not fall back to topic", !survey.includes("初回相談したい"));
  ok("no JS exception", page._errors.length === 0);
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
    // バッファありのページは予定名が必須（#321）。空だと送信がブラウザ側で止まり、この節の検証に入れない。
    buffer_before_title: "準備", buffer_after_title: "片付け",
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
    const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
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

// ===== 7) 質問ゼロの予約ページはアンケート欄を出さない（#312） =====
section("booking page with no questions shows no questionnaire");
{
  const page = await newPage();
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
    const body = name === "availability"
      ? { host: { title: "初回相談", duration_minutes: 30, location_type: "google_meet", slug: "taro" }, questions: [], slots: [], axis: { start_min: 600, end_min: 1080 } }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/booking.html?slug=taro`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok("no questionnaire field is rendered", (await page.locator("#questionnaire-fields .q-field").count()) === 0);
  ok("no default 今回お話したい内容 question", !(await bodyText(page)).includes("今回お話したい内容"));
  ok("no JS exception", page._errors.length === 0);
  await page.close();
}

// ===== 8) ゲストの5日グリッド（週表の描画は week-grid.js をホストと共用）=====
section("guest week grid renders slots (shared week-grid.js)");
{
  const day = new Date(Date.now() + 2 * 86400000);
  day.setHours(11, 0, 0, 0);
  const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const gridSlots = [
    { start: day.toISOString(), end: new Date(day.getTime() + 1800000).toISOString() },
    { start: new Date(day.getTime() + 86400000).toISOString(), end: new Date(day.getTime() + 86400000 + 1800000).toISOString() },
  ];
  const page = await newPage();
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
    const body = name === "availability"
      ? { host: { title: "初回相談", duration_minutes: 30, location_type: "google_meet", slug: "taro" }, questions: [], slots: gridSlots, range_start: ymd, days: reqDays, axis: { start_min: 600, end_min: 1080 }, hasPrev: false, hasNext: true }
      : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/booking.html?slug=taro`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  ok("week grid shows the open slots", (await page.locator("#wk-grid .wk-slot").count()) === 2);
  await page.locator("#wk-grid .wk-slot").first().click();
  await page.waitForTimeout(200);
  ok("picking a slot marks it selected", (await page.locator("#wk-grid .wk-slot.sel").count()) === 1);
  ok("picking a slot fills the form", (await page.inputValue('#booking-form input[name="start"]')) === gridSlots[0].start);
  // #321: 時間軸は右の1本だけ（左右に置くと日の列が細くなる）
  ok("time axis is shown once, on the right", (await page.locator("#wk-grid .wk-axis").count()) === 1);
  ok("no how-it-works bullets on the guest page (#321)", !(await bodyText(page)).includes("重ならない空き枠だけを表示"));
  // PCは1週間表示。列数・送りのラベル・見出しの数字が食い違わないこと。
  ok("desktop guest view shows a full week", (await page.locator("#wk-grid").evaluate((el) => el.style.getPropertyValue("--wk-cols"))) === "7");
  ok("guest nav labels follow the day count", (await page.textContent("#next-days")).includes("7日"));
  ok("guest heading follows the day count", (await page.textContent("#slots-heading")).includes("7日間"));
  ok("no JS exception", page._errors.length === 0);
  await page.close();
}

// ===== 8c) #321 デザイン・文言の修正 =====
section("#321 copy and layout fixes");
{
  // --- 予約ページ一覧: ボタンの並びと文言 ---
  {
    const page = await newPage();
    await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#booking-pages-list .actions", { timeout: 8000 }).catch(() => {});
    const labels = (await page.locator("#booking-pages-list .actions .button").allTextContents()).map((s) => s.trim());
    ok("list buttons start with copy/edit/delete", labels.slice(0, 3).join("|") === "URLをコピー|編集|削除");
    ok("open button names the booking page", labels[labels.length - 1] === "予約ページを開く");
    ok("mobile line break marker exists", (await page.locator("#booking-pages-list .actions .actions-break").count()) === 1);
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- 受付停止中の予約ページは 404 へ飛ばす ---
  {
    const page = await newPage();
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      const body = name === "availability" ? { paused: true, slots: [], questions: [], host: {} } : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/b/taro`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    ok("paused booking page redirects to 404", new URL(page.url()).pathname === "/404.html");
    ok("404 page explains the page is gone", (await bodyText(page)).includes("ページが見つかりません"));
    await page.close();
  }
  // --- 事前アンケート回答: 10件ごとのページ送り ---
  {
    const page = await newPage();
    const many = Array.from({ length: 23 }, (_, i) => ({
      id: `pg-${i}`, visitor_name: `回答者${i}`, visitor_email: `a${i}@example.com`,
      start_at: iso(-i - 1, 10, 0), end_at: iso(-i - 1, 10, 30), status: "confirmed", location_type: "google_meet",
      answers: [{ question_text: "ご相談の背景", answer_text: `本文${i}` }],
    }));
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      const body = name === "owner-bookings" ? { bookings: many }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/answers.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    ok("first page shows 10 answers", (await page.locator("#ans-list .ans-card").count()) === 10);
    ok("pager is visible", await page.locator("#ans-pager").isVisible());
    ok("pager shows 3 pages", (await page.textContent("#ans-pager .pg-status")).includes("3"));
    ok("prev is disabled on the first page", await page.locator('#ans-pager [data-page-step="-1"]').isDisabled());
    await page.click('#ans-pager [data-page-step="1"]');
    await page.waitForTimeout(300);
    ok("second page shows the next 10", (await page.locator("#ans-list .ans-card").count()) === 10);
    ok("second page starts at the 11th answer", (await page.textContent("#ans-list")).includes("回答者10"));
    await page.click('#ans-pager [data-page-step="1"]');
    await page.waitForTimeout(300);
    ok("last page shows the remainder", (await page.locator("#ans-list .ans-card").count()) === 3);
    ok("next is disabled on the last page", await page.locator('#ans-pager [data-page-step="1"]').isDisabled());
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- ダッシュボード「要対応」: 何も無いときは0を並べず、代わりに一文だけ出す ---
  {
    const page = await newPage();
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      // 予約ゼロ・プロフィール全項目入力済み＝要対応が1つも無い状態
      const body = name === "owner-bookings" ? { bookings: [] }
        : name === "profile" ? { profile: { profile_name: "a", profile_title: "a", profile_strengths: "a", profile_style: "a", profile_offer: "a", profile_values: "a", profile_goal: "a" } }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/dashboard.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    ok("this week's row is hidden at zero (#321)", !(await page.locator("#todo-week").isVisible()));
    ok("no zero rows are left in the todo card", (await page.locator(".todo a.has:visible").count()) === 0);
    ok("empty note is shown instead", await page.locator("#todo-empty").isVisible());
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- 設定: ログイン情報から連携行を消し、解除は外部連携に一本化 ---
  {
    const page = await newPage();
    await page.goto(`${base}/settings.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    ok("no duplicate Google row in account info", (await page.locator("#calendar-badge").count()) === 0);
    ok("disconnect lives in the integrations panel", (await page.locator("#integrations #calendar-disconnect").count()) === 1);
    // #321: 解約枠の「Squareを開く」は削除（squareup.com のトップに飛ぶだけで解約にたどり着けなかった）
    ok("no dead link to squareup.com", (await page.locator('a[href="https://squareup.com/"]').count()) === 0);
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
}

// ===== 9) ピンポイント日程調整（#303） =====
section("pinpoint scheduling link (#303)");
{
  const DAY_MS = 86400000;
  const future = new Date(Date.now() + 5 * 86400000);
  future.setHours(14, 0, 0, 0);
  const SLOTS = [
    { start: future.toISOString(), end: new Date(future.getTime() + 1800000).toISOString() },
    { start: new Date(future.getTime() + 86400000).toISOString(), end: new Date(future.getTime() + 86400000 + 1800000).toISOString() },
  ];
  // --- ゲスト: /p/<token> は候補一覧＋ラジオで出る ---
  {
    const page = await newPage();
    let booked = null;
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      if (name === "book") { booked = JSON.parse(route.request().postData() || "{}"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, manage_url: "/manage-booking.html?k=x" }) }); }
      const body = name === "pinpoint"
        ? { token: "toke2e", slots: SLOTS, questions: [], host: { slug: "taro", title: "初回相談", duration_minutes: 30, location_type: "google_meet", name: "テスト オーナー" } }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    // /p/* は booking.html を返す（netlify.toml の rewrite 相当）
    await page.goto(`${base}/p/toke2e`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const radios = await page.locator('input[name="pp-slot"]').count();
    ok("pinpoint shows candidate radios", radios === 2);
    ok("week calendar is hidden", !(await page.locator("#weekcal").isVisible().catch(() => false)));
    // 候補は日付ごとにまとめ、日付は見出しに1回だけ出す（行は時間のみ）。SLOTS は別日の2件。
    ok("candidates are grouped by date", (await page.locator(".pp-daylabel").count()) === 2);
    ok("rows show only the time range", /^\d{2}:\d{2}〜\d{2}:\d{2}$/.test((await page.locator(".pp-item .pp-time").first().textContent()).replace(/\s/g, "")));
    ok("heading says these are the host's candidates", (await page.textContent("#slots-heading")).includes("候補"));
    // ラジオ本体は見た目を .pp-mark に譲って隠してあるので、実ユーザーと同じくラベルを押す。
    await page.locator(".pp-item").first().click();
    await page.waitForTimeout(200);
    ok("selecting a candidate marks the row", (await page.locator(".pp-item.sel").count()) === 1);
    ok("selecting a candidate reveals the form", await page.locator("#booking-form").isVisible());
    ok("selected slot label is filled", (await page.textContent("#selected-slot")).includes("〜"));
    await page.fill('input[name="visitor_name"]', "ピン 太郎");
    await page.fill('input[name="visitor_email"]', "pin@example.com");
    await page.locator("#booking-form").evaluate((f) => f.requestSubmit());
    await page.waitForTimeout(300);
    await page.click("#confirm-book").catch(() => {});
    await page.waitForTimeout(400);
    ok("booking payload carries pinpoint_token", booked?.pinpoint_token === "toke2e");
    ok("booking payload uses the chosen slot", booked?.start === SLOTS[0].start);
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- ゲスト: 期限切れのリンク（#326）は404に飛ばさず、切れたことを伝える ---
  {
    const page = await newPage();
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      const body = name === "pinpoint" ? { expired: true, slots: [], questions: [], host: null }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    // /p/* は booking.html を返す（netlify.toml の rewrite 相当）。トークンはパスから読む。
    await page.goto(`${base}/p/tokexp`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    ok("expired link stays on the page (not 404)", !page.url().includes("404"));
    ok("expired link says it expired", (await page.textContent("#slot-grid")).includes("有効期限"));
    ok("expired link tells the guest to contact the host", (await page.textContent("#slot-grid")).includes("主催者"));
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- ホスト: 一覧 → 候補選択画面（予約と同じカレンダー）→ リンク発行 ---
  {
    const page = await newPage();
    let created = null;
    // グリッドは range_start から5日分の列に枠を割り振るので、先頭日を候補の初日に合わせる。
    const ymd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      if (name === "pinpoint-create") { created = JSON.parse(route.request().postData() || "{}"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, url: "https://kimaru-co.jp/p/tok-new" }) }); }
      // 当面プレミアム限定で配信するので、ホスト側の確認はプレミアムで行う（既定モックは pro）。
      const body = name === "me" ? { ...MOCK.me, owner: { ...MOCK.me.owner, plan: "premium" } }
        : name === "availability" ? { slots: SLOTS, range_start: ymd, days: reqDays, questions: [], host: {}, hasPrev: false, hasNext: true }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-page-action="pinpoint"]', { timeout: 8000 }).catch(() => {});
    ok("pinpoint button is next to copy button", (await page.locator('[data-page-action="pinpoint"]').count()) === 1);
    await page.click('[data-page-action="pinpoint"]');
    await page.waitForTimeout(500);
    ok("picker screen replaces the list", await page.locator("#pinpoint-view").isVisible() && !(await page.locator("#list-view").isVisible()));
    ok("slots are shown on the week calendar", (await page.locator("#pp-grid .wk-slot").count()) === 2);
    // PCは1週間表示。列数はCSS変数で渡すので、そこと送りのラベルを見る。
    ok("desktop shows a full week", (await page.locator("#pp-grid").evaluate((el) => el.style.getPropertyValue("--wk-cols"))) === "7");
    ok("nav labels follow the day count", (await page.textContent("#pp-next")).includes("7日"));
    ok("hold is a select, not a checkbox", (await page.locator("#pp-hold").evaluate((el) => el.tagName)) === "SELECT");
    // 枠を押す＝候補に入る／もう一度押す＝外れる
    await page.locator("#pp-grid .wk-slot").first().click();
    await page.waitForTimeout(150);
    ok("clicking a slot marks it as a candidate", (await page.locator("#pp-grid .wk-slot.is-picked").count()) === 1);
    ok("chosen candidate appears as a chip", (await page.locator("#pp-chips .pp-chip").count()) === 1);
    await page.locator("#pp-grid .wk-slot").first().click();
    await page.waitForTimeout(150);
    ok("clicking again removes it", (await page.locator("#pp-grid .wk-slot.is-picked").count()) === 0);
    await page.locator("#pp-grid .wk-slot").first().click();
    // 押さえない間は予定名を聞かない（カレンダーに何も作らないので聞く意味がない・#325）
    ok("hold title field is hidden while not holding", await page.locator("#pp-hold-title-field").isHidden());
    await page.selectOption("#pp-hold", "hold");
    await page.waitForTimeout(150);
    ok("choosing hold reveals the calendar event name field", await page.locator("#pp-hold-title-field").isVisible());
    ok("calendar event name is required", await page.locator("#pp-hold-title").evaluate((el) => el.required) === true);
    ok("connected calendar hides the not-connected note", await page.locator("#pp-hold-nocal").isHidden());
    // 予定名が空のままでは発行させない（サーバも400で止めるが、往復させずここで気づかせる）
    await page.click("#pp-create");
    await page.waitForTimeout(300);
    ok("empty calendar event name blocks the request", created === null);
    ok("empty calendar event name shows an error", (await page.textContent("#pp-message")).includes("予定の名前"));
    await page.fill("#pp-hold-title", "仮おさえ");
    await page.click("#pp-create");
    await page.waitForTimeout(400);
    ok("create request carries the chosen slot", created?.slots?.length === 1 && created.slots[0].start === SLOTS[0].start);
    ok("create request carries hold flag", created?.hold_slots === true);
    ok("create request carries the calendar event name", created?.hold_title === "仮おさえ");
    // 有効期限（#326）: 既定は1週間。3日も選べる。
    ok("expiry defaults to one week", created?.expires_days === 7);
    ok("issued url is shown for copying", (await page.inputValue("#pp-url")).includes("/p/tok-new"));
    ok("expiry offers three days and one week", (await page.locator("#pp-expires option").count()) === 2);
    await page.selectOption("#pp-expires", "3");
    await page.click("#pp-create");
    await page.waitForTimeout(400);
    ok("choosing three days is sent through", created?.expires_days === 3);
    await page.click("#pp-back");
    await page.waitForTimeout(200);
    ok("back returns to the list", await page.locator("#list-view").isVisible() && !(await page.locator("#pinpoint-view").isVisible()));
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- Google未連携（#325）: 押さえてもカレンダーには入らないと先に断る ---
  {
    const page = await newPage();
    const ymd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      // 押さえたが予定は0件＝Google未連携。発行自体は通る（キマル内の押さえは効く）。
      if (name === "pinpoint-create") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, url: "https://kimaru-co.jp/p/tok-nocal", hold_events_created: 0 }) });
      const body = name === "me" ? { ...MOCK.me, owner: { ...MOCK.me.owner, plan: "premium" }, calendar_connected: false }
        : name === "availability" ? { slots: SLOTS, range_start: ymd, days: reqDays, questions: [], host: {}, hasPrev: false, hasNext: true }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-page-action="pinpoint"]', { timeout: 8000 }).catch(() => {});
    await page.click('[data-page-action="pinpoint"]');
    await page.waitForTimeout(500);
    await page.locator("#pp-grid .wk-slot").first().click();
    // 未連携では押さえられない（#327 レビュー指摘）。理由と連携導線をその場に出す。
    ok("holding is disabled without a calendar", await page.locator('#pp-hold option[value="hold"]').evaluate((el) => el.disabled) === true);
    ok("the reason is shown next to the choice", await page.locator("#pp-hold-nocal").isVisible());
    ok("the warning links to integrations", (await page.getAttribute("#pp-hold-nocal a", "href")) === "/settings.html#integrations");
    ok("hold stays off without a calendar", (await page.inputValue("#pp-hold")) === "none");
    ok("no calendar event name is asked for", await page.locator("#pp-hold-title-field").isHidden());
    // 押さえなしのリンクは未連携でも作れる（押さえだけが連携を要る）。
    await page.click("#pp-create");
    await page.waitForTimeout(400);
    ok("a link without holds can still be issued", (await page.inputValue("#pp-url")).includes("/p/tok-nocal"));
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- ホスト: リンク一覧と手動の無効化（#327） ---
  {
    const page = await newPage();
    let disabled = null;
    let deleted = null;
    const DAY = 86400000;
    const LINKS = [
      // サーバは作成順（新しいものから）で返す＝使えなくなったリンクが上に来る。
      // 画面側でこれを「有効が上」に並べ替えるので（#338）、モックもその並びで渡す。
      { id: "l-off", url: "https://kimaru-co.jp/p/tk-off", page_title: "初回相談", slot_count: 0, first_slot: null, last_slot: null, hold_slots: false, hold_title: "", expires_at: null, status: "disabled" },
      { id: "l-old", url: "https://kimaru-co.jp/p/tk-old", page_title: "初回相談", slot_count: 1, first_slot: new Date(Date.now() + 5 * DAY).toISOString(), last_slot: new Date(Date.now() + 5 * DAY).toISOString(), hold_slots: false, hold_title: "", expires_at: new Date(Date.now() - DAY).toISOString(), status: "expired" },
      { id: "l-live", url: "https://kimaru-co.jp/p/tk-live", page_title: "初回相談", slot_count: 2, first_slot: new Date(Date.now() + 2 * DAY).toISOString(), last_slot: new Date(Date.now() + 3 * DAY).toISOString(), hold_slots: true, hold_title: "仮おさえ", expires_at: new Date(Date.now() + DAY).toISOString(), status: "active" },
    ];
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      // 表示日数はクライアントが要求した値をそのまま返す（サーバの許可リストと同じ振る舞い）。
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      if (name === "pinpoint-deactivate") { disabled = JSON.parse(route.request().postData() || "{}"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); }
      if (name === "pinpoint-delete") { deleted = JSON.parse(route.request().postData() || "{}"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); }
      const body = name === "me" ? { ...MOCK.me, owner: { ...MOCK.me.owner, plan: "premium" } }
        : name === "pinpoint-list" ? { links: LINKS, limits: { links: 5, slots: 30, expires_days: [3, 7], hold: true }, active_count: 1 }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#pp-list .list-item", { timeout: 8000 }).catch(() => {});
    // 一覧は予約ページ一覧の下に常設（#338）。開くための操作は要らない。
    ok("the link list is shown without opening anything", await page.locator("#pinpoint-links").isVisible());
    ok("it sits under the booking pages, inside the same view", await page.evaluate(() => {
      const view = document.querySelector("#list-view");
      const section = document.querySelector("#pinpoint-links");
      const pages = document.querySelector("#booking-pages-list");
      return !!view && !!section && !!pages && view.contains(section)
        && Boolean(pages.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    ok("the active count is shown against the limit", (await page.textContent("#pp-list-count")).replace(/\s/g, "").includes("1/5"));
    ok("every issued link is listed", (await page.locator("#pp-list .list-item").count()) === 3);
    const listText = await page.textContent("#pp-list");
    ok("status labels are shown", listText.includes("有効") && listText.includes("期限切れ") && listText.includes("無効"));
    // 有効が上（#338）。サーバは使えなくなったリンクを先に返しているので、
    // 並べ替えていなければここで落ちる。
    ok("usable links are sorted to the top", await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#pp-list .pp-link")];
      return rows.map((row) => (row.classList.contains("is-live") ? "live" : "dead")).join(",") === "live,dead,dead";
    }));
    ok("the live link is marked apart from the dead ones", await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#pp-list .pp-link")];
      const state = (row) => row.querySelector(".pp-state");
      // 有効だけ朱で塗った印、使えないものは枠線だけ＝背景が透ける。
      const live = getComputedStyle(state(rows[0])).backgroundColor;
      const dead = getComputedStyle(state(rows[1])).backgroundColor;
      const rail = (row) => getComputedStyle(row).borderLeftColor;
      return live !== dead && rail(rows[0]) !== rail(rows[1]);
    }));
    // 区切りは「有効」と「使えなくなった」が両方あるときだけ、境目に1本。
    ok("a single divider separates the dead links", await page.evaluate(() => {
      const groups = [...document.querySelectorAll("#pp-list .pp-group")];
      if (groups.length !== 1) return false;
      const next = groups[0].nextElementSibling;
      return !!next && next.classList.contains("is-dead");
    }));
    ok("held slots show the calendar event name", listText.includes("仮おさえ"));
    ok("candidate count is shown", listText.includes("候補2件"));
    // URLのコピーも有効なリンクだけ。使えなくなったリンクのURLは、コピーできても送りようがない。
    ok("only usable links offer a copy button", (await page.locator('[data-pp-link-action="copy"]').count()) === 1);
    ok("the copy button sits on the live row", await page.evaluate(() => {
      const row = document.querySelector('#pp-list .pp-link:has([data-pp-link-action="copy"])');
      return !!row && row.classList.contains("is-live");
    }));
    // 有効なリンクだけ無効にできる（期限切れ・無効化済みは押さえも解けているので出さない）
    ok("only the active link can be disabled", (await page.locator('[data-pp-link-action="disable"]').count()) === 1);
    await page.click('[data-pp-link-action="disable"]');
    await page.waitForTimeout(250);
    ok("disabling asks for confirmation first", await page.locator("#pp-disable-modal").isVisible());
    ok("modal says it cannot be undone", (await page.textContent("#pp-disable-modal")).includes("有効にはできません"));
    ok("nothing is sent before confirming", disabled === null);
    await page.click("#pp-disable-cancel");
    await page.waitForTimeout(200);
    ok("cancelling closes the modal without disabling", await page.locator("#pp-disable-modal").isHidden() && disabled === null);
    await page.click('[data-pp-link-action="disable"]');
    await page.waitForTimeout(250);
    await page.click("#pp-disable-confirm");
    await page.waitForTimeout(400);
    ok("confirming sends the link id", disabled?.id === "l-live");
    // 削除（#336）: 使えなくなったリンク（期限切れ・無効）だけに出す
    ok("delete is offered only for unusable links", (await page.locator('[data-pp-link-action="delete"]').count()) === 2);
    ok("the active link cannot be deleted", (await page.locator('.list-item:has([data-pp-link-action="disable"]) [data-pp-link-action="delete"]').count()) === 0);
    await page.locator('[data-pp-link-action="delete"]').first().click();
    await page.waitForTimeout(250);
    ok("deleting asks for confirmation first", await page.locator("#pp-delete-modal").isVisible());
    ok("delete modal says it cannot be undone", (await page.textContent("#pp-delete-modal")).includes("元に戻すことはできません"));
    ok("nothing is deleted before confirming", deleted === null);
    await page.click("#pp-delete-cancel");
    await page.waitForTimeout(200);
    ok("cancelling closes the modal without deleting", await page.locator("#pp-delete-modal").isHidden() && deleted === null);
    await page.locator('[data-pp-link-action="delete"]').first().click();
    await page.waitForTimeout(250);
    await page.click("#pp-delete-confirm");
    await page.waitForTimeout(400);
    ok("confirming sends the link id to delete", deleted?.id === "l-old");
    // 候補選択を開くと、一覧も一緒に隠れる（#list-view の中に置いてあるため）。
    await page.click('[data-page-action="pinpoint"]');
    await page.waitForTimeout(300);
    ok("opening the picker hides the link list too", await page.locator("#pinpoint-links").isHidden());
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- 無料プランの上限（#338）: 導線は出るが、候補・期限・押さえが絞られる ---
  {
    const page = await newPage();
    let created = null;
    const ymd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
    // 候補上限（無料3件）を確かめるので、枠は4つ出す。
    const MANY = [0, 1, 2, 3].map((n) => ({
      start: new Date(future.getTime() + n * 86400000).toISOString(),
      end: new Date(future.getTime() + n * 86400000 + 1800000).toISOString(),
    }));
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const name = url.pathname.replace(/^.*\/api\//, "").split("?")[0];
      const reqDays = Number(url.searchParams.get("days")) === 7 ? 7 : 5;
      if (name === "pinpoint-create") { created = JSON.parse(route.request().postData() || "{}"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, url: "https://kimaru-co.jp/p/tok-free" }) }); }
      const body = name === "me" ? { ...MOCK.me, owner: { ...MOCK.me.owner, plan: "free" } }
        // 無料の上限。リンクはまだ0本なので、一覧のセクションは出ない。
        : name === "pinpoint-list" ? { links: [], limits: { links: 1, slots: 3, expires_days: [3], hold: false }, active_count: 0 }
        : name === "availability" ? { slots: MANY, range_start: ymd, days: reqDays, questions: [], host: {}, hasPrev: false, hasNext: true }
        : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-page-action="pinpoint"]', { timeout: 8000 }).catch(() => {});
    ok("free sees the pinpoint button", (await page.locator('[data-page-action="pinpoint"]').count()) === 1);
    ok("an empty link list is not shown at all", await page.locator("#pinpoint-links").isHidden());
    await page.click('[data-page-action="pinpoint"]');
    await page.waitForTimeout(500);
    // 有効期限は3日固定。選べない選択肢は disabled にし、理由をその場に出す。
    ok("expiry falls back to three days", (await page.inputValue("#pp-expires")) === "3");
    ok("one week cannot be chosen", await page.locator('#pp-expires option[value="7"]').evaluate((el) => el.disabled) === true);
    ok("the reason for the fixed expiry is shown", await page.locator("#pp-expires-plan").isVisible());
    // 押さえは Pro 以上。カレンダーは連携済みなので、出る理由はプランのほうだけ。
    ok("holding is disabled on the free plan", await page.locator('#pp-hold option[value="hold"]').evaluate((el) => el.disabled) === true);
    ok("the plan reason is shown", await page.locator("#pp-hold-plan").isVisible());
    ok("the calendar reason is not shown at the same time", await page.locator("#pp-hold-nocal").isHidden());
    ok("the plan reason links to the pricing page", (await page.getAttribute("#pp-hold-plan a", "href")) === "/plan.html");
    // 候補は3つまで。4つ目は候補に入らず、理由を出す（黙って切らない）。
    for (const index of [0, 1, 2, 3]) {
      await page.locator("#pp-grid .wk-slot").nth(index).click();
      await page.waitForTimeout(120);
    }
    ok("the fourth candidate is refused", (await page.locator("#pp-grid .wk-slot.is-picked").count()) === 3);
    ok("the refusal explains the limit", (await page.textContent("#pp-message")).includes("3件"));
    ok("the tray counts against the limit", (await page.textContent("#pp-count")).replace(/\s/g, "").includes("3/3"));
    await page.click("#pp-create");
    await page.waitForTimeout(400);
    ok("only three candidates are sent", created?.slots?.length === 3);
    ok("the request carries the three-day expiry", created?.expires_days === 3);
    ok("no JS exception", page._errors.length === 0);
    await page.close();
  }
  // --- 上限に達したら候補選択を開かず、その場で理由と次の手を出す（#338） ---
  {
    const AT_LIMIT = [{ id: "l-live", url: "https://kimaru-co.jp/p/tk-live", page_title: "初回相談", slot_count: 1, first_slot: new Date(Date.now() + 2 * DAY_MS).toISOString(), last_slot: null, hold_slots: false, hold_title: "", expires_at: new Date(Date.now() + DAY_MS).toISOString(), status: "active" }];
    const openAtLimit = async (plan, limit) => {
      const page = await newPage();
      await page.route("**/api/**", (route) => {
        const name = new URL(route.request().url()).pathname.replace(/^.*\/api\//, "").split("?")[0];
        const body = name === "me" ? { ...MOCK.me, owner: { ...MOCK.me.owner, plan } }
          : name === "pinpoint-list" ? { links: AT_LIMIT, limits: { links: limit, slots: 3, expires_days: [3], hold: plan !== "free" }, active_count: limit }
          : Object.prototype.hasOwnProperty.call(MOCK, name) ? MOCK[name] : {};
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      });
      await page.goto(`${base}/booking-settings.html`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-page-action="pinpoint"]', { timeout: 8000 }).catch(() => {});
      await page.click('[data-page-action="pinpoint"]');
      await page.waitForTimeout(300);
      return page;
    };

    const free = await openAtLimit("free", 1);
    ok("hitting the limit stops at the button", await free.locator("#pp-limit-modal").isVisible());
    // 上限にぶつかった瞬間を記録する（#342）。画面側で止める壁はサーバに届かないので、
    // ここが飛ばないと「無料の人がどの上限に当たっているか」が永久に分からない。
    await free.waitForTimeout(200);
    const beacons = await free.evaluate(() => window.__beacons.map((b) => b.body));
    const limitBeacon = beacons.find((b) => b.includes("limit_hit"));
    ok("hitting the limit is recorded", Boolean(limitBeacon) && limitBeacon.includes("pinpoint_link"));
    ok("the beacon carries no plan claim from the client", !String(limitBeacon).includes("plan"));
    ok("the picker does not open", await free.locator("#pinpoint-view").isHidden());
    const message = await free.textContent("#pp-limit-body");
    ok("the message names the limit", message.includes("1件"));
    ok("it offers both disabling a link and upgrading", message.includes("無効") && message.includes("アップグレード"));
    ok("the upgrade button points at the pricing page", (await free.getAttribute("#pp-limit-plan", "href")) === "/plan.html");
    await free.click("#pp-limit-cancel");
    await free.waitForTimeout(200);
    ok("closing leaves the page list in place", await free.locator("#pp-limit-modal").isHidden() && await free.locator("#list-view").isVisible());
    ok("no JS exception", free._errors.length === 0);
    await free.close();

    // プレミアムには上げる先が無いので、アップグレードの案内も導線も出さない。
    const premium = await openAtLimit("premium", 5);
    ok("premium is told about the limit too", await premium.locator("#pp-limit-modal").isVisible());
    ok("premium is not asked to upgrade", !(await premium.textContent("#pp-limit-body")).includes("アップグレード"));
    ok("premium gets no pricing link", await premium.locator("#pp-limit-plan").isHidden());
    ok("no JS exception", premium._errors.length === 0);
    await premium.close();
  }
}

// ===== 運営の分析ダッシュボード（#343）=====
// 数字が「出ている」ことだけでなく、期間の切り替えがサーバまで届くこと、
// 計測が未適用のときに 0 ではなく断りが出ることを見る（0だと「使われていない」と読み違えるため）。
section("analytics dashboard (#343)");
{
  const page = await newPage();
  await page.goto(`${base}/analytics.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const stats = await page.textContent("#overview-stats");
  ok("サマリーにアカウント数が出る", stats.includes("42"));
  ok("サマリーに有料転換率が出る", stats.includes("28.6%"));
  ok("サマリーにMRR概算が出る", stats.includes("10,280"));
  // サマリーは全体を見る画面。期間で絞った数字ではなく累計を出し、期間タブ自体を隠す。
  ok("サマリーは予約の累計を出す", stats.includes("120") && stats.includes("11.7%"));
  ok("サマリーでは期間タブを隠す", await page.locator("#range-buttons").isHidden());
  ok("サマリーの但し書きは全体の累計", (await page.textContent("#admin-message")).includes("全体の累計"));
  ok("推移は月次（直近12ヶ月）", (await page.locator("#chart-signups svg rect").count()) === 3 && (await page.locator("#chart-bookings svg rect").count()) === 3);

  await page.click('.op-nav-sub[data-nav-href="/analytics.html#revenue"]');
  await page.waitForTimeout(150);
  ok("期間で集計するビューでは期間タブが出る", await page.locator("#range-buttons").isVisible());
  ok("但し書きも期間表示に戻る", (await page.textContent("#admin-message")).includes("直近30日"));
  const cohorts = await page.textContent("#cohort-list");
  ok("コホート表が新しい月から並ぶ", cohorts.indexOf("2026-08") < cohorts.indexOf("2026-07"));
  ok("コホートの転換率が出る", cohorts.includes("31.8%"));

  await page.click('.op-nav-sub[data-nav-href="/analytics.html#activation"]');
  await page.waitForTimeout(150);
  const funnelText = await page.textContent("#activation-funnel");
  ok("定着ファネルが母数に対する割合で出る", funnelText.includes("33") && funnelText.includes("82.5%"));
  ok("取得できない段は0ではなく—で出す", funnelText.includes("—"));

  await page.click('.op-nav-sub[data-nav-href="/analytics.html#screens"]');
  await page.waitForTimeout(150);
  ok("画面別の表が出る", (await page.textContent("#pages-list")).includes("/b/:slug"));
  ok("画面×プランの内訳が出る", (await page.textContent("#plan-pages-list")).includes("300"));
  ok("流入元が出る", (await page.textContent("#sources-list")).includes("www.google.com"));
  ok("PV/UVの折れ線が2本ある", (await page.locator("#chart-usage svg path").count()) === 2);

  // サイドメニューは3画面で共通。分析だけ子ビューまでアコーディオンで出す。
  ok("メニューは現在地の子項目を選択状態にする", await page.locator('.op-nav-sub[data-nav-href="/analytics.html#screens"].is-active').count() === 1);
  ok("親のアコーディオンは開いたまま", await page.locator(".op-nav-group[open]").count() === 1);
  ok("他画面への導線も同じメニューに並ぶ", (await page.locator('.op-nav-item[data-nav-href="/operators.html"]').count()) === 1);

  // 期間ボタンはサーバへ days を渡す（クライアント側だけで切ったふりをしない）
  page._requests.length = 0;
  await page.click('#range-buttons button[data-days="7"]');
  await page.waitForTimeout(400);
  ok("期間ボタンが days=7 で再取得する", page._requests.some((url) => url.includes("usage-summary?days=7")));
  ok("no JS exception", page._errors.length === 0);
  await page.close();

  // 計測テーブル未適用（available:false）のとき
  const notReady = await newPage();
  await notReady.route("**/api/usage-summary*", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ...MOCK_USAGE_SUMMARY, usage: { ...MOCK_USAGE_SUMMARY.usage, available: false } }),
  }));
  await notReady.goto(`${base}/analytics.html#screens`, { waitUntil: "networkidle" });
  await notReady.waitForTimeout(400);
  const body = await notReady.textContent("#screens-body");
  ok("未計測は0ではなく理由を出す", body.includes("page_events") && !body.includes("表示数（PV）"));
  ok("no JS exception", notReady._errors.length === 0);
  await notReady.close();
}

// ===== 運営コンソールの共通サイドメニュー（#343）=====
// 画面ごとにメニューを直書きしていたため、移動するたび項目が入れ替わって現在地が分からなくなっていた。
// 3画面で同じ項目が並ぶことを固定する（片方だけ直して崩れるのを防ぐ）。
section("operator console: shared side menu (#343)");
{
  const labels = [];
  for (const name of ["cat-key-admin", "operators", "analytics"]) {
    const page = await newPage();
    await page.goto(`${base}/${name}.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    labels.push(await page.$$eval(".op-nav [data-nav-href]", (nodes) => nodes.map((n) => n.getAttribute("data-nav-href")).join(",")));
    ok(`${name}: メニューが描画される`, (await page.locator(".op-nav [data-nav-href]").count()) === 8);
    ok(`${name}: JS例外なし`, page._errors.length === 0);
    await page.close();
  }
  ok("3画面でメニューの項目が完全に一致する", labels[0] === labels[1] && labels[1] === labels[2]);

  // 別画面からでも分析の子ビューへ直接飛べる（アコーディオンを開いて選ぶ）
  const page = await newPage();
  await page.goto(`${base}/operators.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  ok("他画面では分析のアコーディオンは閉じている", (await page.locator(".op-nav-group[open]").count()) === 0);
  await page.click(".op-nav-group > summary");
  ok("見出しを押すと開く", (await page.locator(".op-nav-group[open]").count()) === 1);
  await page.click('.op-nav-sub[data-nav-href="/analytics.html#activation"]');
  await page.waitForURL("**/analytics.html#activation", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  ok("子項目から直接そのビューが開く", await page.locator("#view-activation.is-active").count() === 1);
  ok("no JS exception", page._errors.length === 0);
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} e2e: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
