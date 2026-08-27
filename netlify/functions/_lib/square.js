const crypto = require("crypto");
const { optional, appBaseUrl } = require("./config");

// Square Checkout API（Payment Links）でユーザー専用のサブスク決済リンクを生成する。
// - buyer_email を登録メールでプリフィル → 支払者メール＝登録メールが基本一致し、
//   square-webhook のメール照合による自動有効化が確実に効く（決済後の無言失敗を防止）。
// - redirect_url で決済後にキマルの完了ページ（/pro-thanks.html）へ戻す。
// 必要な env（SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID / プランID）が無ければ null を返し、
// 呼び出し側は従来の静的リンクにフォールバックする（設定前でも決済導線を止めない）。

const SQUARE_API_VERSION = "2026-05-20";

function squareApiBase() {
  // 本番=connect.squareup.com / サンドボックス=connect.squareupsandbox.com
  return String(optional("SQUARE_ENV", "production")).toLowerCase() === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

async function createProCheckoutLink(owner, { plan = "pro" } = {}) {
  const accessToken = optional("SQUARE_ACCESS_TOKEN", "");
  const locationId = optional("SQUARE_LOCATION_ID", "");
  const isPremium = plan === "premium";
  const planId = isPremium ? optional("SQUARE_PREMIUM_PLAN_ID", "") : optional("SQUARE_PRO_PLAN_ID", "");
  if (!accessToken || !locationId || !planId) return null;

  const amount = isPremium ? 4800 : 980; // JPY は最小単位=1円
  const name = isPremium ? "キマル プレミアム（月額）" : "キマル Pro（月額）";
  const payload = {
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name,
      price_money: { amount, currency: "JPY" },
      location_id: locationId,
    },
    checkout_options: {
      subscription_plan_id: planId,
      redirect_url: `${appBaseUrl()}/pro-thanks.html`,
      ask_for_shipping_address: false,
    },
    pre_populated_data: {
      buyer_email: String(owner.email || "").trim(),
    },
    description: isPremium ? "キマル プレミアムプラン（月額 ¥4,800）" : "キマル Proプラン（月額 ¥980）",
  };

  const res = await fetch(`${squareApiBase()}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      "Square-Version": SQUARE_API_VERSION,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail || "Square決済リンクの生成に失敗しました";
    const err = new Error(detail);
    err.squareErrors = data?.errors;
    throw err;
  }
  return { url: data.payment_link?.url || null, orderId: data.payment_link?.order_id || null };
}

module.exports = { createProCheckoutLink };
