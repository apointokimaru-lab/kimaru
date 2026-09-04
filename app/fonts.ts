import { Noto_Sans_JP } from "next/font/google";

// フォントの自己ホスト（#415・規約 7 章）。旧サイトは public/styles.css が Google Fonts から Noto Sans JP
// （400〜900）を読んでいた。next/font はビルド時にフォントを取り込んで同一オリジンから配信するので、
// fonts.googleapis.com / fonts.gstatic.com への依存が消え、動的ページの CSP（font-src 'self'）を縮められる。
// トークン（styles/tokens.css）は --font-noto-sans-jp を先頭に置き、無い環境では従来どおり "Noto Sans JP" にフォールバックする。
export const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  display: "swap",
  variable: "--font-noto-sans-jp",
  // CJK は unicode-range で分割配信される。latin 以外の先読みは不要（必要な範囲だけブラウザが取る）
  preload: false,
});
