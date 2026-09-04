// セキュリティヘッダーと CSP の唯一の出どころ（#415・規約 8 章）。
//
// なぜ 1 か所か: 同じ値が netlify.toml（CDN の静的ファイル）・next.config.ts（Next が返す静的応答）・proxy.ts
// （動的応答・nonce 付き）の 3 経路で必要になる。ここに置き、next.config.ts と proxy.ts はここから読む。
// netlify.toml は TOML なので import できない代わりに、lib/csp.test.ts が「同じ値か」を照合する。
//
// CSP は 2 モード（規約 8 章の決定）:
//   静的ページ（公開ページ・旧 HTML）… STATIC_CSP。Next の hydration 用インラインが nonce を持てないため
//                                      script-src の 'unsafe-inline' を当面許容する
//   動的ページ（DYNAMIC_ROUTES）  … nonceCsp()。proxy.ts が要求ごとに nonce を作り、Next が <script nonce> を付ける

export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HTTPS 強制（1 年・サブドメイン含む）。preload は不可逆なので付けない
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // 使わない強力機能を無効化
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

/** 旧サイトと同じ CSP（netlify.toml の [[headers]] と同値。テストで照合） */
export const STATIC_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; " +
  "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; " +
  "upgrade-insecure-requests";

/**
 * 動的描画（nonce 付き CSP）にするルート。画面を Next に移すたびに、その PR でここへ足す（規約 12 章）。
 * 末尾 "/" は「その下すべて」、それ以外は「そのパスそのものと、その下」。
 * 公開ページ（/ /plan /terms /privacy /tokushoho /guide）は静的なので**入れない**。
 */
export const DYNAMIC_ROUTES: readonly string[] = [
  "/dev/", // 開発用の確認ページ（KIMARU_DEV_ROUTES=1 のときだけ存在）
];

export function isDynamicPath(pathname: string): boolean {
  return DYNAMIC_ROUTES.some((route) =>
    route.endsWith("/")
      ? pathname.startsWith(route)
      : pathname === route || pathname.startsWith(route + "/"),
  );
}

/** next.config.ts の headers() で「動的ルート以外」を表すための正規表現（否定先読みの中身） */
export function dynamicRoutesRegexSource(): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return DYNAMIC_ROUTES.map((route) =>
    route.endsWith("/") ? `${escape(route.slice(1))}.*` : `${escape(route.slice(1))}(?:/.*)?$`,
  ).join("|");
}

/**
 * 動的ページ用の CSP。
 * - script-src: 'self' ＋ nonce。'strict-dynamic' は付けない（Edge の auth-gate.js が全 HTML に /usage.js を
 *   注入しており、'strict-dynamic' だと nonce の無い外部スクリプトが止まる。Edge を撤去する #452 で再検討）
 * - style-src: 'self' ＋ nonce（Next が出す <style> は nonce 付き。style 属性は使わない＝lint で禁止）
 * - 開発時だけ 'unsafe-eval'（React がサーバースタックを復元するために要る）
 */
export function nonceCsp(nonce: string, isDev = false): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "font-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}
