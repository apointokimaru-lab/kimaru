const { json } = require("./_lib/response");
const { optional } = require("./_lib/config");
const { sb, eq, findOwnerByEmail } = require("./_lib/supabase");
const { applyPlanLimits } = require("./_lib/plan-freeze");
const { rawBody, verifySquareSignature, verifySharedSecret } = require("./_lib/webhook");

function eventId(body) {
  return body.event_id || body.id || body.data?.id || body.data?.object?.payment?.id || "";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
  // 認証：Square 正規署名（SQUARE_WEBHOOK_SIGNATURE_KEY）を生ボディで検証。無ければ共有シークレット（定数時間）にフォールバック。
  // どちらの認証情報も無ければ fail-closed（503）。漏洩した場合に任意アカウントを昇格できる経路なので厳格に閉じる。
  const sigKey = optional("SQUARE_WEBHOOK_SIGNATURE_KEY", "");
  const sharedSecret = optional("SQUARE_WEBHOOK_SHARED_SECRET", "");
  if (!sigKey && !sharedSecret) return json(503, { error: "Square Webhookが設定されていません" });
  const raw = rawBody(event);
  const authed = verifySquareSignature(event, raw) || verifySharedSecret(event, sharedSecret);
  if (!authed) return json(401, { error: "認証が必要です" });

  try {
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { return json(400, { error: "リクエストが不正です" }); }
    const eventType = String(body.type || body.event_type || "");
    const email = String(
      body.email ||
      body.data?.object?.payment?.buyer_email_address ||
      body.data?.object?.subscription?.customer_email ||
      ""
    ).trim().toLowerCase();
    const lowerType = eventType.toLowerCase();
    // 解約・失効系は無料へ、それ以外の課金/サブスク/請求系は pro 付与（トライアル含む）
    const isCancel = /cancel|deactivat|delete|expire|fail|unpaid/.test(lowerType);
    const isGrant = !isCancel && /payment|subscription|invoice|charge/i.test(lowerType) && Boolean(email);
    const owner = email ? await findOwnerByEmail(email) : null;
    const subscription = body.data?.object?.subscription || {};
    // プレミアムプラン判定: サブスクの plan variation id が env(SQUARE_PREMIUM_PLAN_ID) と一致すれば premium。一致しなければ pro。
    // Pro・プレミアムとも無料お試しなし（Square で実装不可のため廃止）＝ trial_ends_at は付与しない。
    const premiumPlanId = optional("SQUARE_PREMIUM_PLAN_ID", "");
    const planVariationId = String(subscription.plan_variation_id || subscription.plan_id || body.plan_variation_id || "");
    const targetPlan = premiumPlanId && planVariationId && planVariationId === premiumPlanId ? "premium" : "pro";

    let planResult = "none";
    if (owner) {
      if (isCancel) {
        await sb(`owners?id=${eq(owner.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ plan: "free", updated_at: new Date().toISOString() }),
        });
        await applyPlanLimits(owner.id, "free").catch(() => null); // 無料の上限に合わせ超過データを凍結（決定15・#174 / 決定27）
        planResult = "downgraded";
      } else if (isGrant) {
        const grant = { plan: targetPlan, trial_ends_at: null, updated_at: new Date().toISOString() };
        await sb(`owners?id=${eq(owner.id)}`, {
          method: "PATCH",
          body: JSON.stringify(grant),
        }).catch(() =>
          // trial_ends_at 未マイグレーション環境向けフォールバック
          sb(`owners?id=${eq(owner.id)}`, { method: "PATCH", body: JSON.stringify({ plan: targetPlan, updated_at: new Date().toISOString() }) }));
        await applyPlanLimits(owner.id, targetPlan).catch(() => null); // 昇格先プランの上限に合わせ復元/凍結（決定15・#174 / 決定27）
        planResult = targetPlan;
      }
    }
    const shouldGrantPro = planResult === "pro" || planResult === "premium";

    await sb("payment_events", {
      method: "POST",
      body: JSON.stringify({
        owner_id: owner?.id || null,
        provider: "square",
        provider_event_id: eventId(body),
        event_type: eventType,
        raw_payload: body,
      }),
    }).catch(() => null);

    return json(200, { ok: true, pro_granted: Boolean(shouldGrantPro && owner), plan: planResult });
  } catch (error) {
    // 内部のDBエラーメッセージ（列名/制約ヒント等）を外部に返さない。
    return json(500, { error: "サーバーでエラーが発生しました。" });
  }
};
