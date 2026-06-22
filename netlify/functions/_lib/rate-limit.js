const { sb, eq } = require("./supabase");

const RATE_LIMIT_MESSAGE = "リクエストが多すぎます。しばらく時間をおいてから再度お試しください。";

function clientIp(event) {
  const h = (event && event.headers) || {};
  const raw =
    h["x-nf-client-connection-ip"] ||
    h["x-forwarded-for"] || h["X-Forwarded-For"] ||
    h["client-ip"] || h["Client-Ip"] || "";
  return String(raw).split(",")[0].trim();
}

// 固定ウィンドウのレート制限。rate_limit_hits に記録し、ウィンドウ内の件数で判定する。
// テーブル未適用・DB障害時は fail-open（allowed:true）でサービスを止めない（プロジェクト方針：
// 列/テーブル欠如時はグレースフルに劣化）。レート制限は「無いと困るが、誤って全ロックは避ける」ため fail-open が妥当。
async function checkRateLimit({ bucket, ident, limit, windowSec }) {
  if (!ident) return { allowed: true };
  const key = `${bucket}:${ident}`;
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const rows = await sb(
      `rate_limit_hits?key=${eq(key)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${limit + 1}`
    );
    if ((rows || []).length >= limit) return { allowed: false };
    // 記録（古い行は created_at で自然に対象外になる。肥大時は定期 DELETE を別途実施）。
    await sb("rate_limit_hits", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ key }) }).catch(() => {});
    return { allowed: true };
  } catch (_) {
    return { allowed: true };
  }
}

module.exports = { checkRateLimit, clientIp, RATE_LIMIT_MESSAGE };
