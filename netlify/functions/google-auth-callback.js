const { json, redirect } = require("./_lib/response");
const { appBaseUrl } = require("./_lib/config");
const { exchangeCode, userInfo, saveGoogleConnection } = require("./_lib/google");
const { sessionCookie } = require("./_lib/crypto");
const { upsertOwner } = require("./_lib/supabase");

exports.handler = async (event) => {
  try {
    const code = event.queryStringParameters?.code;
    if (!code) return json(400, { error: "認証コードがありません" });
    const tokens = await exchangeCode(code);
    const profile = await userInfo(tokens.access_token);
    const slug = (profile.email || "demo").split("@")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const owner = await upsertOwner({ email: profile.email, name: profile.name || profile.email, avatar_url: profile.picture || null, slug });
    // 利用停止アカウントはログイン不可（セッションを発行せずログイン画面へ戻す）。
    if (owner.cat_key_disabled) {
      return redirect(`${appBaseUrl()}/login.html?suspended=1`);
    }
    // 既定の予約ページは自動作成しない（ユーザーが予約設定で作成する）。
    await saveGoogleConnection(owner, tokens);
    return redirect(`${appBaseUrl()}/dashboard.html`, { "Set-Cookie": sessionCookie(owner.id) });
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
