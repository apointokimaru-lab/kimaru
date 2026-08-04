const { json } = require("./_lib/response");
const { appBaseUrl } = require("./_lib/config");
const { exchangeCode, userInfo, saveGoogleConnection } = require("./_lib/google");
const { sessionCookie, verifyOauthState, clearOauthStateCookie, verifyBlob } = require("./_lib/crypto");
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
    // 設定画面からの「連携」(state 先頭 "c") は、フローを開始した本人が完了しているかを検証する。
    // state に署名して載せた owner id と、いま操作しているセッションの owner の一致を必須にする。
    // 一致しない＝別アカウントのセッションで連携を完了させられた（アカウント連携CSRF）ので、
    // トークンを保存せずに中断する。ここで「ログイン扱い」へフォールバックしてはならない
    // （被害者のGoogleトークンが攻撃者のアカウントに紐づく経路そのものになるため）。
    const rawState = String(q.state || "");
    const connectMode = rawState.startsWith("c");
    let sessionOwner = null;
    if (connectMode) {
      const [signedOwner, blob] = await Promise.all([
        currentOwner(event).catch(() => null),
        Promise.resolve(verifyBlob("gconnect", rawState.slice(1), 600000)),
      ]);
      if (!signedOwner || !blob || blob.o !== signedOwner.id) {
        return redirectWithCookies(`${appBaseUrl()}/settings.html?calendar=state_error#integrations`, [clearOauthStateCookie()]);
      }
      sessionOwner = signedOwner;
    }

    const tokens = await exchangeCode(code);
    const profile = await userInfo(tokens.access_token);
    const owner = sessionOwner
      || await upsertOwner({ email: profile.email, name: profile.name || profile.email, avatar_url: profile.picture || null });
    // 利用停止アカウントはログイン不可（セッションを発行せずログイン画面へ戻す）。
    if (owner.cat_key_disabled) {
      return redirectWithCookies(`${appBaseUrl()}/login.html?suspended=1`, [clearOauthStateCookie()]);
    }
    // 既定の予約ページは自動作成しない（ユーザーが予約設定で作成する）。
    await saveGoogleConnection(owner, tokens);
    // 連携モードは既に有効なセッションがあるので張り直さない（発行するのはログイン時だけ）。
    if (sessionOwner) {
      return redirectWithCookies(`${appBaseUrl()}/settings.html?calendar=connected#integrations`, [clearOauthStateCookie()]);
    }
    return redirectWithCookies(`${appBaseUrl()}/dashboard.html`, [sessionCookie(owner.id), clearOauthStateCookie()]);
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
