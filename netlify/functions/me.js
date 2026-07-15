const { json } = require("./_lib/response");
const { currentOwner } = require("./_lib/auth");
const { clearSessionCookie } = require("./_lib/crypto");
const { sb, eq } = require("./_lib/supabase");

exports.handler = async (event) => {
  try {
    const owner = await currentOwner(event);
    // Cookie はあるが owner に解決できない（別 SESSION_SECRET / 期限切れ / owner 不在）＝無効セッション。
    // 残った無効 Cookie を消して宙ぶらり状態を解消する。
    const cookieHeader = event.headers.cookie || event.headers.Cookie || "";
    const hadSessionCookie = /(?:^|;\s*)kimaru_session=[^;]+/.test(cookieHeader);
    const extraHeaders = !owner && hadSessionCookie ? { "Set-Cookie": clearSessionCookie() } : {};
    let calendarConnected = false;
    let zoomConnected = false;
    if (owner) {
      try {
        const rows = await sb(`google_connections?owner_id=${eq(owner.id)}&select=id&limit=1`);
        calendarConnected = Boolean(rows[0]);
      } catch (_) {
        calendarConnected = false;
      }
      try {
        const rows = await sb(`zoom_connections?owner_id=${eq(owner.id)}&select=id&limit=1`);
        zoomConnected = Boolean(rows[0]);
      } catch (_) {
        zoomConnected = false; // テーブル未適用の環境は未連携扱い
      }
    }
    // password_hash はクライアントへ渡さない。代わりに「パスワード登録済みか」のフラグのみ返す。
    let safeOwner = owner;
    if (owner) {
      const { password_hash, ...rest } = owner;
      safeOwner = { ...rest, has_password: Boolean(password_hash) };
    }
    return json(200, { owner: safeOwner, calendar_connected: calendarConnected, zoom_connected: zoomConnected }, extraHeaders);
  } catch (error) {
    return json(500, { error: "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
