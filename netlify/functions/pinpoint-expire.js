// 期限切れのピンポイントリンクを片付ける（#326）。
// リンクの有効期限（expires_at）が過ぎたら、押さえていたGoogleカレンダーの予定を消す。
//
// 消すのは「リンク作成時にできた仮の押さえ予定」だけ。そのリンク経由で成立した実際の予約と、
// その予約のGoogleカレンダー予定には触らない（別のイベントとして作られており、hold_events には
// 入っていないので、ここからは辿れない＝取り違えようがない）。
//
// 定期実行は pinpoint-expire-scheduled.js（netlify.toml のスケジュール）。
// このHTTPエンドポイントはローカル確認用に残す: /api/pinpoint-expire?dry_run=1
const { json } = require("./_lib/response");
const { optional } = require("./_lib/config");
const { sb, eq } = require("./_lib/supabase");
const { timingEqual } = require("./_lib/crypto");
const pinpoint = require("./_lib/pinpoint");

// リマインダー（reminder-mails.js）と同じ鍵を使い回す。cron 用の秘密を増やさない。
function isAuthorized(event) {
  const secret = optional("REMINDER_CRON_SECRET", optional("CRON_SECRET", ""));
  if (!secret) return false; // fail-closed: 未設定ならHTTP経由の手動実行は不可（定期実行は run() を直接呼ぶので影響なし）
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || "";
  const querySecret = event.queryStringParameters?.secret || "";
  return timingEqual(authorization, `Bearer ${secret}`) || timingEqual(querySecret, secret);
}

// 期限切れで、まだ押さえ予定が残っているリンクを集める。
//
// expires_at を PostgREST のフィルタに書かないのは、列が未適用の環境でエラーになり
// catch で握りつぶすと「毎回0件」で静かに動かなくなるため。全件取って JS 側で絞る
// （ピンポイントリンクはオーナーあたり数件の規模なので、これで足りる）。
async function expiredLinks() {
  const rows = await sb("pinpoint_links?is_active=is.true&limit=1000").catch(() => []);
  return (rows || []).filter((link) => pinpoint.isExpired(link) && pinpoint.holdEventsOf(link).length > 0);
}

async function run(dryRun) {
  const links = await expiredLinks();
  const results = [];
  for (const link of links) {
    const events = pinpoint.holdEventsOf(link);
    if (dryRun) {
      results.push({ link_id: link.id, token: link.token, expires_at: link.expires_at, hold_events: events.length, status: "dry_run" });
      continue;
    }
    const removed = await pinpoint.releaseHold(link);
    // hold_events を空にするのが「片付け済み」の目印。これを消さないと、削除済みの予定に対して
    // 毎時 Google へ DELETE を投げ続ける（404 は成功扱いなので無害だが、ただの無駄打ちになる）。
    // 予定の削除に全部失敗したときは空にしない＝次の実行でもう一度試す。
    let cleared = false;
    if (removed > 0 || events.length === 0) {
      cleared = await sb(`pinpoint_links?id=${eq(link.id)}`, { method: "PATCH", body: JSON.stringify({ hold_events: [] }) })
        .then(() => true)
        .catch(() => false);
    }
    results.push({ link_id: link.id, token: link.token, expires_at: link.expires_at, hold_events: events.length, removed, cleared, status: removed > 0 ? "released" : "failed" });
  }
  return { checked: links.length, dry_run: Boolean(dryRun), results };
}

exports.run = run;

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "許可されていない操作です" });
  if (!isAuthorized(event)) return json(401, { error: "認証が必要です" });
  const dryRun = event.queryStringParameters?.dry_run === "1" || event.queryStringParameters?.dry_run === "true";
  try {
    return json(200, await run(dryRun));
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。" });
  }
};
