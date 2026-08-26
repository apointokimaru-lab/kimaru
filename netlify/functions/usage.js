const { readJson } = require("./_lib/response");
const { sb } = require("./_lib/supabase");
const { verifySession } = require("./_lib/crypto");
const { clientIp, checkRateLimit } = require("./_lib/rate-limit");
const { normalizePath, referrerHost, visitorHash, isBotUserAgent, deviceFromUserAgent, normalizeEvent, normalizeFeature } = require("./_lib/analytics");

// 画面表示の記録（#342）。全HTMLに注入された public/usage.js から1ページ1回だけ叩かれる。
//
// なぜ必要か: どの画面が使われているかを知る手段が他に無く、しかも計測は「入れた時点から先」しか
// 貯まらない（過去に遡れない）。集計画面（#343）より先に記録だけ始める。
// 何をしているか: 送られてきた値を _lib/analytics.js で保存してよい形へ潰し、page_events に1行入れる。
//
// この関数は「失敗しても何も起きない」ことを最優先にする:
//  - 認証なし・常に 204（ボットでも、レート超過でも、DBが落ちていても同じ）。
//    クライアント側に失敗を返すと再送やコンソールエラーの原因になるだけで、計測の精度は上がらない。
//  - page_events テーブル未適用の環境でも例外を投げない（プロジェクト方針＝DB遅延にグレースフルに劣化）。
const LANGS = ["ja", "en", "zh-TW"];

// 204 は本文を持てないので json() は使わない。
const noContent = () => ({ statusCode: 204, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, body: "" });

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return noContent();

    const headers = event.headers || {};
    const userAgent = headers["user-agent"] || headers["User-Agent"] || "";
    if (isBotUserAgent(userAgent)) return noContent();

    const body = readJson(event);
    const page = normalizePath(body.path);

    // 無認証の書き込み口なので、1IPあたりの投入数に上限を掛ける（テーブル未適用時は fail-open）。
    // 通常利用（1ページ1回・同一パスは30分デデュープ）なら10分で300件に届かない。
    const ip = clientIp(event);
    const { allowed } = await checkRateLimit({ bucket: "usage", ident: ip, limit: 300, windowSec: 600 });
    if (!allowed) return noContent();

    // ログイン中なら owner_id を残す（プラン別にどの画面が使われているかを見るため）。
    // ここでは DB を引かない（1PVごとにアカウント照会すると計測のほうが重くなる）。プランは集計時に owners と突き合わせる。
    let ownerId = null;
    try {
      const session = verifySession(event);
      if (session && typeof session.ownerId === "string" && /^[0-9a-f-]{36}$/i.test(session.ownerId)) ownerId = session.ownerId;
    } catch (_) { /* 署名検証に失敗しても計測は続ける（未ログイン扱い） */ }

    const lang = LANGS.includes(String(body.lang || "")) ? String(body.lang) : "";

    // 有料の壁（#342）。上限の多くは画面側で止めるのでサーバには届かない＝クライアントからも受ける。
    // 機能名は許可リストで固定し、外れた値は記録せずに捨てる（無認証の口なので任意の文字列は通さない）。
    const eventName = normalizeEvent(body.event);
    const feature = eventName === "limit_hit" ? normalizeFeature(body.feature) : "";
    if (eventName === "limit_hit" && !feature) return noContent();

    const row = {
      event: eventName,
      page,
      owner_id: ownerId,
      visitor_hash: visitorHash(ip, userAgent),
      referrer_host: referrerHost(body.ref, headers.host || headers.Host || ""),
      device: deviceFromUserAgent(userAgent),
      lang,
      // plan はクライアントの申告を信じない（偽れる）。ぶつかった時点のプランを正確に残せるのは
      // サーバ側の判定（_lib/auth.js・各API）なので、そちらは recordLimitHit で plan を控える。
      meta: feature ? { feature } : {},
    };
    await sb("page_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }).catch(() => {});
    return noContent();
  } catch (_) {
    return noContent();
  }
};
