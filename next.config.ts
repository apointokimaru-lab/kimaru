import type { NextConfig } from "next";

import { SECURITY_HEADERS, STATIC_CSP, dynamicRoutesRegexSource } from "./lib/csp";

// なぜこの設定か（#412・段階0）:
// 旧サイト（public/ の静的 HTML 33 枚＋バニラ JS）と Next.js を **同じサイト・同じドメインで同居** させ、
// 以降はページ単位で app/ へ移していく（親 issue #406〜#411）。
// public/ は Next.js の静的フォルダそのものなので、旧ページは何も変えずに同じ URL（/dashboard.html 等）で
// 配信され続ける。Netlify 側の書き換え（/b/* → /booking.html 等）は netlify.toml のまま効く
// （Netlify のユーザー定義 redirects は Next.js ランタイムが生成する内部ルールより優先される）。

const nextConfig: NextConfig = {
  // X-Powered-By: Next.js を出さない（バージョン推測の材料を減らす）
  poweredByHeader: false,
  reactStrictMode: true,
  // next/link の href と router.push を型で守る（規約 0 章）
  typedRoutes: true,

  // 旧 HTML を返すルートハンドラ（app/route.ts・app/[...path]/route.ts）が実行時に fs で読む public/ の
  // ファイルを関数バンドルへ含める。これが無いと、ローカルでは動くのに Netlify の関数側にだけファイルが無く
  // ENOENT になる（public/ は CDN 用の静的資産としてしか配置されない）。
  outputFileTracingIncludes: {
    "/[...path]": ["./public/404.html"],
  },

  async redirects() {
    // 移した旧ページの URL は恒久リダイレクトで新 URL へ（規約 12 章。permanent は 308＝301 と同じ意味）。クエリは引き継がれる
    return [
      // #418: LP を Next の / に移した。/index.html は直接来る人（ブックマーク・外部リンク）向け
      { source: "/index.html", destination: "/", permanent: true },
      // #418: 旧トップ（ログイン後のホームタイル）は廃止。行き先はダッシュボード（Edge も同じ先へ送る）
      { source: "/home.html", destination: "/dashboard.html", permanent: true },
      // #418: 旧デザイン見本（どこからもリンクされていない）は廃止
      { source: "/landing3.html", destination: "/", permanent: true },
      // #419: 料金・プランを Next の /plan に移した
      { source: "/plan.html", destination: "/plan", permanent: true },
      // #420: 利用規約を Next の /terms に移した
      { source: "/terms.html", destination: "/terms", permanent: true },
      // #421: プライバシーポリシーを Next の /privacy に移した（Google OAuth 審査・Zoom 申請に登録した旧 URL も 308 で届く）
      { source: "/privacy.html", destination: "/privacy", permanent: true },
      // #422: 特定商取引法に基づく表記を Next の /tokushoho に移した
      { source: "/tokushoho.html", destination: "/tokushoho", permanent: true },
    ];
  },

  async headers() {
    // netlify.toml の [[headers]] は CDN が返す静的ファイルにしか付かず、Next.js の応答には付かない。
    // 値の正本は lib/csp.ts（netlify.toml と同値であることを lib/csp.test.ts が照合する）。
    // CSP は 2 モード（#415・規約 8 章）: 動的ルート（lib/csp.ts の DYNAMIC_ROUTES）は proxy.ts が nonce 付きの
    // CSP を付けるので、ここでは **動的ルート以外** にだけ静的ポリシー（旧サイトと同じ）を付ける。
    // 両方に付けると CSP ヘッダーが 2 つになり、交差（＝より厳しい方）が効いて nonce ページが壊れる。
    return [
      { source: "/:path*", headers: [...SECURITY_HEADERS] },
      {
        source: `/((?!${dynamicRoutesRegexSource()}).*)`,
        headers: [{ key: "Content-Security-Policy", value: STATIC_CSP }],
      },
    ];
  },
};

export default nextConfig;
