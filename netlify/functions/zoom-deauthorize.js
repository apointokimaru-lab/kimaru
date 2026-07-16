// Zoom アプリのイベント受信（Marketplace 公開の必須要件）。
// ユーザーが Zoom 側でアプリを削除（deauthorize）したら、保存済みの接続（zoom_connections）を
// 即時削除する。エンドポイントURL検証（endpoint.url_validation）と署名検証にも対応。
// Zoom アプリ設定の Event Subscription にこのURL（/api/zoom-deauthorize）を登録し、
// Secret Token を env ZOOM_WEBHOOK_SECRET_TOKEN に設定する。未設定なら 503（安全に無効）。
const crypto = require("crypto");
const { json, readJson } = require("./_lib/response");
const { optional } = require("./_lib/config");
const { timingEqual } = require("./_lib/crypto");
const { sb, eq } = require("./_lib/supabase");

function verifySignature(event, secret) {
  const timestamp = event.headers["x-zm-request-timestamp"] || event.headers["X-Zm-Request-Timestamp"] || "";
  const signature = event.headers["x-zm-signature"] || event.headers["X-Zm-Signature"] || "";
  if (!timestamp || !signature) return false;
  // リプレイ防止：タイムスタンプは±5分のみ許容
  const age = Math.abs(Date.now() - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60000) return false;
  const expected = `v0=${crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${event.body || ""}`).digest("hex")}`;
  return timingEqual(signature, expected);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
    const secret = optional("ZOOM_WEBHOOK_SECRET_TOKEN", "");
    if (!secret) return json(503, { error: "Zoom webhook は未設定です（ZOOM_WEBHOOK_SECRET_TOKEN）" });
    if (!verifySignature(event, secret)) return json(401, { error: "署名が不正です" });

    const body = readJson(event);

    // Zoom からのエンドポイント検証チャレンジ
    if (body.event === "endpoint.url_validation") {
      const plainToken = String(body.payload?.plainToken || "");
      return json(200, { plainToken, encryptedToken: crypto.createHmac("sha256", secret).update(plainToken).digest("hex") });
    }

    // アンインストール：該当ユーザーの接続（暗号化トークン）を即時削除
    if (body.event === "app_deauthorized") {
      const userId = String(body.payload?.user_id || "");
      if (userId) await sb(`zoom_connections?zoom_user_id=${eq(userId)}`, { method: "DELETE" }).catch(() => null);
      return json(200, { ok: true });
    }

    return json(200, { ignored: true });
  } catch (_) {
    return json(500, { error: "サーバーでエラーが発生しました" });
  }
};
