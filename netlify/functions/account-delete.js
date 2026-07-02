const { json, readJson } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb } = require("./_lib/supabase");
const { clearSessionCookie } = require("./_lib/crypto");
const { deleteOwnerCascade } = require("./_lib/account-delete");

// ユーザー自身によるアカウント退会（完全削除）。
// - 有料プラン（Square課金）のユーザーは、削除では課金が止まらないため先にSquare解約が必要。
//   Cat Key メンバー(invite_code 有・無料でPro)は課金が無いので退会可能。
// - 誤操作防止に、登録メールアドレスの再入力(confirm_email)で本人確認する。

function clientIp(event) {
  const headers = event.headers || {};
  return String(headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "").split(",")[0].trim();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  try {
    const owner = await requireOwner(event);

    // Square課金中のユーザーは先に解約が必要（Cat Keyメンバーは課金無しなので対象外）。
    const isPaid = (owner.plan === "pro" || owner.plan === "premium") && !owner.invite_code;
    if (isPaid) {
      return json(403, {
        error: "有料プランのご利用中は退会できません。先に Square でサブスクリプションを解約し、無料プランに戻ってから、もう一度お試しください。",
        needs_cancel: true,
      });
    }

    const body = readJson(event);
    const confirmEmail = String(body.confirm_email || "").trim().toLowerCase();
    if (!confirmEmail || confirmEmail !== String(owner.email || "").trim().toLowerCase()) {
      return json(400, { error: "確認のため、登録メールアドレスを正確に入力してください。" });
    }

    const removed = await deleteOwnerCascade(owner.id);

    // 監査ログ（owner は削除済みのため owner_id は null、メールは保持）。失敗しても退会は成立させる。
    try {
      await sb("cat_key_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          owner_id: null,
          email: removed?.email || owner.email || "",
          action: "self_delete",
          ip_address: clientIp(event),
          user_agent: String(event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "").slice(0, 300),
          metadata: { source: "settings" },
        }),
      });
    } catch (_) {
      // 監査ログはマイグレーション未適用でもユーザー操作を止めない。
    }

    // セッションを無効化してログアウト状態にする。
    return json(200, { ok: true, deleted: true }, { "Set-Cookie": clearSessionCookie() });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
