const crypto = require("crypto");
const { optional } = require("./config");
const { sb } = require("./supabase");

// 利用計測（#342）の共通処理。usage.js（記録）と usage-summary.js（集計・#343）から使う。
//
// なぜ必要か: キマルには計測が一切無く、「どの画面が使われているか」「LPのどこで落ちているか」が
// 分からないまま機能追加の優先順位を決めていた。外部の計測SaaSは使わない方針（第三者へデータを出さない・
// CSP connect-src 'self' を崩さない）なので、自前で最小限の記録を持つ。
// 何をしているか: 「保存してよい形」への正規化と、Cookieを増やさずに当日のUUだけ数えられる識別子の生成。

// 生の location.pathname をそのまま保存しない理由:
//  1) /p/<token>（ピンポイントリンク）や /manage-booking.html?id=&t= のように、URL自体が鍵になる画面がある。
//     計測テーブルに鍵を溜めると、集計画面を見られただけで予約の操作リンクが漏れる。
//  2) /b/<slug> はユーザー数だけ増えるので、そのまま入れると「画面別」の集計にならない。
// → 画面の種類まで潰してから保存する。
//
// 許可リストではなく「HTMLの名前として妥当なパターン」で通しているのは、画面が増えたときに
// 計測から漏れるのを防ぐため（新規ページのたびに配列へ足す運用は必ずどこかで抜ける）。
// 代わりに、長さ・使える文字を絞り、当てはまらないものは "other" の一語に潰して未知の文字列をDBへ通さない。
const PAGE_RE = /^\/[a-z0-9][a-z0-9-]{0,39}\.html$/;

function normalizePath(input) {
  let path = String(input || "");
  // クエリ・ハッシュは丸ごと捨てる（?id=&t= のトークン、?slug= の個別値を保存しないため）。
  path = path.split("#")[0].split("?")[0];
  if (!path.startsWith("/")) return "other";
  if (path === "/" || path === "/index.html") return "/index.html";
  // slug / token を含む公開ルート（netlify.toml の rewrite）。値は捨てて種類だけ残す。
  if (path.startsWith("/b/")) return "/b/:slug";
  if (path.startsWith("/p/")) return "/p/:token";
  if (path.startsWith("/u/")) return "/u/:slug";
  const lower = path.toLowerCase();
  if (PAGE_RE.test(lower)) return lower;
  return "other";
}

// 外部からの流入元。ホスト名だけを残す（パス・クエリには検索語や他サービス側のIDが載るため保存しない）。
// 自サイト内の遷移は "" にする（内部リンクの経路は page の並びで足りる）。
function referrerHost(referrer, selfHost) {
  try {
    const host = new URL(String(referrer || "")).hostname.toLowerCase();
    if (!host) return "";
    if (selfHost && host === String(selfHost).toLowerCase()) return "";
    return host.slice(0, 100);
  } catch (_) {
    return "";
  }
}

// 訪問者ID。Cookieを増やさず、IPも保存しない代わりに「日付＋IP＋UA」のHMACを持つ。
// 日付を混ぜているのが肝で、翌日には同じ人でも別IDになる＝日をまたいだ追跡はできないが、
// 「その日の画面別UU」は数えられる。鍵が無い環境では "" を返し、UUだけ諦めてPVは記録する。
function jstDayKey(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function visitorHash(ip, userAgent, now = new Date()) {
  const secret = optional("USAGE_HASH_SALT", "") || optional("SESSION_SECRET", "");
  if (!secret) return "";
  return crypto
    .createHmac("sha256", secret)
    .update(`${jstDayKey(now)}|${String(ip || "")}|${String(userAgent || "")}`)
    .digest("hex")
    .slice(0, 24);
}

// クローラを弾く。入れておかないと画面別PVがボットの巡回で埋まり、「よく見られている画面」を読み違える。
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pingdom|monitor|curl|wget|python-requests|axios|facebookexternalhit|embedly|preview/i;
const isBotUserAgent = (userAgent) => BOT_RE.test(String(userAgent || ""));

// 端末種別。画面幅はクライアントから送らせず UA で判定する（送らせると値の検証が増えるだけで精度は変わらない）。
const deviceFromUserAgent = (userAgent) => (/Mobile|Android|iPhone|iPod|Windows Phone/i.test(String(userAgent || "")) ? "mobile" : /iPad|Tablet/i.test(String(userAgent || "")) ? "tablet" : "desktop");

// ---- 有料の壁に当たった記録（#342 / 決定: 2026-08-26）----
// なぜ必要か: 価格とプランの境界（何を無料にし、何を有料にするか）を推測で決めていた。
// 「無料の人が、どの上限に、月に何回ぶつかっているか」は買う理由の一次資料になる。
// 何をしているか: page_events の event/meta 列に載せる。専用テーブルを作らないのは、
// 画面表示と同じ「利用の記録」で、集計もビューを1本足すだけで済むため。
//
// 機能名は許可リストで固定する。ここに無い値は捨てる（無認証の /api/usage からも送れるので、
// 任意の文字列を通すと集計軸が汚れて読めなくなる）。
const LIMIT_FEATURES = [
  "booking_page",     // 予約ページの保存数（無料1 / Pro2 / プレミアム5）
  "question",         // 事前アンケートの設問数（2 / 5 / 5）
  "question_type",    // 選択式の回答形式（Pro以上）
  "booking_range",    // 受付期間3ヶ月以降（Pro以上）
  "pinpoint_link",    // ピンポイントリンクの同時保有数
  "pinpoint_slot",    // 1リンクあたりの候補数
  "pinpoint_hold",    // 枠の押さえ（Pro以上）
  "ai_assist",        // AIアシスト（プレミアム限定・月間上限）
  "manual_contact",   // 相手の手動追加（プレミアム限定）
  "profile_advanced", // 高度プロフィール（Pro以上）
];

const EVENTS = ["page_view", "limit_hit"];
// 既定はページ表示。クライアント（public/usage.js）はページ表示のとき event を送らないので、
// ここで既定値を落とすと全部のページ表示が "other" になり、集計ビュー（event='page_view' で絞る）が
// 永久に空になる（#347）。未指定・空文字はページ表示として扱う。
const normalizeEvent = (value) => {
  const name = value == null || value === "" ? "page_view" : String(value);
  return EVENTS.includes(name) ? name : "other";
};
const normalizeFeature = (value) => (LIMIT_FEATURES.includes(String(value)) ? String(value) : "");

// 記録できなくても機能の挙動は変えない（計測のためにユーザーの操作を失敗させない）。
async function recordLimitHit({ ownerId = null, plan = "", feature, page = "" } = {}) {
  const name = normalizeFeature(feature);
  if (!name) return;
  try {
    await sb("page_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      // plan は「ぶつかった時点」のプランなので、ここで控える。集計時に owners を引くと、
      // その後アップグレードした人が「Proが無料の上限にぶつかった」ように見えてしまう。
      body: JSON.stringify({ event: "limit_hit", page: String(page || ""), owner_id: ownerId, meta: { feature: name, plan: String(plan || "") } }),
    });
  } catch (_) { /* noop */ }
}

// 登録時の流入元（owners.signup_source）。ホスト名だけを許す。
// パスやクエリには検索語や他サービスのIDが載るので、画面の計測と同じくホストまでで切る。
function sourceHost(value) {
  const host = String(value || "").trim().toLowerCase().slice(0, 100);
  return /^[a-z0-9][a-z0-9.-]*$/.test(host) ? host : "";
}

module.exports = { normalizePath, referrerHost, visitorHash, jstDayKey, isBotUserAgent, deviceFromUserAgent, LIMIT_FEATURES, normalizeEvent, normalizeFeature, recordLimitHit, sourceHost };
