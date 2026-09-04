import type { NextConfig } from "next";

// なぜこの設定か（#412・段階0）:
// 旧サイト（public/ の静的 HTML 33 枚＋バニラ JS）と Next.js を **同じサイト・同じドメインで同居** させ、
// 以降はページ単位で app/ へ移していく（親 issue #406〜#411）。
// public/ は Next.js の静的フォルダそのものなので、旧ページは何も変えずに同じ URL（/dashboard.html 等）で
// 配信され続ける。Netlify 側の書き換え（/b/* → /booking.html 等）は netlify.toml のまま効く
// （Netlify のユーザー定義 redirects は Next.js ランタイムが生成する内部ルールより優先される）。

// netlify.toml の [[headers]] は CDN が返す静的ファイルにしか付かず、Next.js（関数）の応答には付かない。
// 旧サイトと同じ値をここでも付けて、どちらが返しても同じヘッダーになるようにする。
// CSP は旧 HTML のインライン script のために 'unsafe-inline' を許しているが、Next ルートを nonce 化して
// 外すのは #415（段階0）→ 全体で外すのは #453（段階5）。値を変えるときは netlify.toml と両方直す。
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; " +
      "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; " +
      "upgrade-insecure-requests",
  },
];

const nextConfig: NextConfig = {
  // X-Powered-By: Next.js を出さない（バージョン推測の材料を減らす）
  poweredByHeader: false,
  reactStrictMode: true,

  // 旧 HTML を返すルートハンドラ（app/route.ts・app/[...path]/route.ts）が実行時に fs で読む public/ の
  // ファイルを関数バンドルへ含める。これが無いと、ローカルでは動くのに Netlify の関数側にだけファイルが無く
  // ENOENT になる（public/ は CDN 用の静的資産としてしか配置されない）。
  outputFileTracingIncludes: {
    "/": ["./public/index.html"],
    "/[...path]": ["./public/404.html"],
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
