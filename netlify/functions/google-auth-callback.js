const { json } = require("./_lib/response");
const { appBaseUrl } = require("./_lib/config");
const { exchangeCode, userInfo, saveGoogleConnection } = require("./_lib/google");
const { sessionCookie, verifyOauthState, clearOauthStateCookie } = require("./_lib/crypto");
const { upsertOwner } = require("./_lib/supabase");
const { currentOwner } = require("./_lib/auth");

const SECURE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

// 複数 Set-Cookie を返すための 302。Location は headers、Cookie は multiValueHeaders に置く。
function redirectWithCookies(location, cookies) {
  return {
    statusCode: 302,
    headers: { ...SECURE_HEADERS, Location: location },
    multiValueHeaders: { "Set-Cookie": cookies },
    body: "",
  };
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const code = q.code;
    if (!code) return json(400, { error: "認証コードがありません" });
    // ログインCSRF対策：start で発行した state cookie と query の state を定数時間で照合。
    // 不一致（＝この攻撃ブラウザ発の正規フローではない）なら code を交換せずに拒否する。
    if (!verifyOauthState(event, q.state)) {
      return redirectWithCookies(`${appBaseUrl()}/login.html?error=state`, [clearOauthStateCookie()]);
    }
    const tokens = await exchangeCode(code);
    const profile = await userInfo(tokens.access_token);

    // 設定画面からの「連携」(state 先頭 "c") でログイン中なら、そのアカウントにカレンダーを繋ぐだけにする。
    // 以前は常に Google のメールで owner を解決していたため、「別アカウントで再連携」を押すと
    // 連携ではなく別アカウントへのログイン（無ければ新規作成）になっていた。
    // セッションが切れている場合は通常のログインとして扱い、操作が行き止まりにならないようにする。
    const connectMode = String(q.state || "").startsWith("c");
    const sessionOwner = connectMode ? await currentOwner(event).catch(() => null) : null;
    const owner = sessionOwner
      || await upsertOwner({ email: profile.email, name: profile.name || profile.email, avatar_url: profile.picture || null });
    // 利用停止アカウントはログイン不可（セッションを発行せずログイン画面へ戻す）。
    if (owner.cat_key_disabled) {
      return redirectWithCookies(`${appBaseUrl()}/login.html?suspended=1`, [clearOauthStateCookie()]);
    }
    // 既定の予約ページは自動作成しない（ユーザーが予約設定で作成する）。
    await saveGoogleConnection(owner, tokens);
    // 連携目的なら元の設定画面へ戻す（ログイン時はこれまでどおりホームへ）。
    const next = sessionOwner ? "/settings.html?calendar=connected" : "/dashboard.html";
    return redirectWithCookies(`${appBaseUrl()}${next}`, [sessionCookie(owner.id), clearOauthStateCookie()]);
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
