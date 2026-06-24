// 軽量単体テスト（フレームワーク無し・Nodeのみ）。
//   node scripts/test/unit.mjs
// 対象:
//  1) i18n 対称性（ja / en / zh-TW のキー集合が一致）
//  2) ダッシュボード「今日の予定/これから」描画ロジック（app.js から関数を抽出して実行）
//  3) escapeHtml による XSS エスケープ
// 注: app.js / i18n.js は「自リポジトリのソース」を vm.runInContext で評価（外部入力ではない）。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0;
let fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log("  ✗ " + name); }
}
function section(name) { console.log("\n# " + name); }

// ---------- 1) i18n 対称性 ----------
section("i18n symmetry (ja / en / zh-TW)");
function loadMessages() {
  const src = fs.readFileSync(path.join(repo, "public/i18n.js"), "utf8");
  const ctx = {
    window: {}, navigator: { language: "ja" }, console,
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      addEventListener() {}, readyState: "complete",
      querySelectorAll: () => [], dispatchEvent() {},
      documentElement: { lang: "" }, body: { dataset: {} }, title: "",
    },
    CustomEvent: function () {},
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.KimaruI18n.messages;
}
const messages = loadMessages();
const langs = ["ja", "en", "zh-TW"];
const keysets = Object.fromEntries(langs.map((l) => [l, new Set(Object.keys(messages[l] || {}))]));
ok("all three dictionaries present", langs.every((l) => messages[l] && Object.keys(messages[l]).length > 0));
const base = keysets.ja;
for (const l of ["en", "zh-TW"]) {
  const missing = [...base].filter((k) => !keysets[l].has(k));
  const extra = [...keysets[l]].filter((k) => !base.has(k));
  ok(`${l}: no missing keys vs ja` + (missing.length ? ` (missing ${missing.length}: ${missing.slice(0, 6).join(", ")}…)` : ""), missing.length === 0);
  ok(`${l}: no extra keys vs ja` + (extra.length ? ` (extra ${extra.length}: ${extra.slice(0, 6).join(", ")}…)` : ""), extra.length === 0);
}
ok("dashboard empty-state keys exist in all langs",
  langs.every((l) => messages[l]["dash.today.empty"] && messages[l]["dash.upcoming.empty"]));

// ---------- 2) ダッシュボード描画ロジック ----------
section("dashboard schedule rendering (app.js)");
function makeRenderer() {
  const app = fs.readFileSync(path.join(repo, "public/app.js"), "utf8");
  const es = app.indexOf("function escapeHtml(value) {");
  const ee = app.indexOf("}[char]));", es);
  const ds = app.indexOf("const DASH_LOCATION_LABELS");
  const de = app.indexOf("function renderBookings(bookings) {");
  if (es < 0 || ee < 0 || ds < 0 || de < 0) throw new Error("could not locate functions in app.js");
  const escapeHtmlSrc = app.slice(es, ee) + "}[char]));\n}";
  const dashSrc = app.slice(ds, de);
  const store = { "today-list": { innerHTML: "" }, "upcoming-list": { innerHTML: "" } };
  const T = { "dash.today.empty": "今日の予定はありません。", "dash.upcoming.empty": "これからの予約はありません。", "dash.appt.join": "参加する", "admin.guest": "ゲスト" };
  const ctx = {
    console,
    t: (k) => T[k] || k,
    window: { KimaruI18n: { getLanguage: () => "ja" } },
    document: { getElementById: (id) => store[id] || null },
  };
  vm.createContext(ctx);
  vm.runInContext(`${escapeHtmlSrc}\n${dashSrc}`, ctx);
  return {
    render(bookings) {
      store["today-list"].innerHTML = "";
      store["upcoming-list"].innerHTML = "";
      ctx.renderDashboardSchedule(bookings);
      return { today: store["today-list"].innerHTML, upcoming: store["upcoming-list"].innerHTML };
    },
  };
}
const R = makeRenderer();
const render = (b) => R.render(b);
const now = new Date();
const at = (off, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + off, h, m).toISOString();
const sample = [
  { visitor_name: "本日 太郎", start_at: at(0, 14, 0), end_at: at(0, 14, 30), location_type: "google_meet", meeting_url: "https://meet.google.com/abc", status: "confirmed" },
  { visitor_name: "本日 朝子", start_at: at(0, 9, 0), end_at: at(0, 9, 30), location_type: "in_person", status: "confirmed" },
  { visitor_name: "キャンセル 花子", start_at: at(0, 16, 0), end_at: at(0, 16, 30), status: "cancelled" },
  { visitor_name: "手動 次郎", start_at: null, manual: true },
  { visitor_name: "明日 三郎", start_at: at(1, 11, 0), end_at: at(1, 11, 45), location_type: "zoom", status: "confirmed" },
  { visitor_name: "過去 四郎", start_at: at(-2, 10, 0), end_at: at(-2, 10, 30), status: "confirmed" },
];
const r = render(sample);
const cardCount = (html) => (html.match(/class="appt(?:"| appt-now")/g) || []).length;
ok("today shows both confirmed today bookings", cardCount(r.today) === 2);
ok("today is sorted (朝子 09:00 before 太郎 14:00)", r.today.indexOf("本日 朝子") < r.today.indexOf("本日 太郎"));
ok("today excludes cancelled", !r.today.includes("キャンセル 花子"));
ok("today excludes manual contact", !r.today.includes("手動 次郎"));
ok("today excludes past booking", !r.today.includes("過去 四郎"));
ok("today excludes tomorrow booking", !r.today.includes("明日 三郎"));
ok("join button only when meeting_url present", (r.today.match(/参加する/g) || []).length === 1);
ok("location label rendered (Google Meet)", r.today.includes("Google Meet"));
ok("upcoming shows only future non-today (明日 三郎)", r.upcoming.includes("明日 三郎") && !r.upcoming.includes("本日"));
ok("upcoming excludes past/cancelled/manual", !r.upcoming.includes("過去") && !r.upcoming.includes("キャンセル") && !r.upcoming.includes("手動"));

const empty = render([{ manual: true }, { status: "cancelled", start_at: at(0, 9, 0) }]);
ok("empty today state", empty.today.includes("今日の予定はありません。"));
ok("empty upcoming state", empty.upcoming.includes("これからの予約はありません。"));

const upMany = render(Array.from({ length: 8 }, (_, i) => ({ visitor_name: `未来${i}`, start_at: at(2 + i, 10, 0), end_at: at(2 + i, 10, 30), status: "confirmed" })));
ok("upcoming capped at 5", cardCount(upMany.upcoming) === 5);

// ---------- 3) XSS エスケープ ----------
section("XSS escaping");
const xss = render([{ visitor_name: '<img src=x onerror=alert(1)>', start_at: at(0, 12, 0), end_at: at(0, 12, 30), status: "confirmed" }]);
ok("dangerous name is escaped", xss.today.includes("&lt;img") && !xss.today.includes("<img src=x"));

// ---------- 結果 ----------
console.log(`\n${fail === 0 ? "✅" : "❌"} unit: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
