const { json } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { optional } = require("./_lib/config");
const { createProCheckoutLink } = require("./_lib/square");

// ログイン中ユーザー向けの Pro 決済リンクを返す。
// - 設定が揃っていれば Square API でユーザー専用リンク（メールプリフィル＋戻りURL付き）を生成。
// - 生成不可（env未設定 / API失敗）なら従来の静的共有リンクにフォールバック。
const STATIC_PRO_LINK = "https://square.link/u/Q1aRiSST";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") return json(405, { error: "許可されていない操作です" });
  try {
    const owner = await requireOwner(event);
    // すでに有料なら重複課金を避けて導線を出さない。
    if (owner.plan === "pro" || owner.plan === "premium") {
      return json(200, { url: null, already_paid: true, plan: owner.plan });
    }
    const fallback = optional("SQUARE_STATIC_PRO_LINK", STATIC_PRO_LINK);
    try {
      const link = await createProCheckoutLink(owner, { plan: "pro" });
      if (link && link.url) return json(200, { url: link.url, prefilled: true });
    } catch (_) {
      // 生成失敗時は静的リンクへフォールバック（決済導線を止めない）。
    }
    return json(200, { url: fallback, prefilled: false });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
