import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RootHtml } from "@/components/layout/RootHtml";
import { DEFAULT_LANG } from "@/lib/i18n/lang";

import "../globals.css";

// 公開ページ（LP・料金・法務・ガイド・404）のルートレイアウト（#415・規約 1 章）。
// 静的生成にするため、ここでは Cookie を読まない（読むとこの配下すべてが動的描画になり CDN に載らない）。
// lang は ja 固定で出し、利用者が選んだ言語への切替は Client 側で行う（#419 で辞書を配る仕組みを作る）。
// CSP は next.config.ts の headers() が旧サイトと同じ静的ポリシーを付ける（nonce は無い）。
// Web フォント（next/font）は当てない: 公開ページはシステムフォントで初回表示を速く保つ（旧 LP と同じ・#418）。
// 各ページのフォント方針は移すときに決める（規約 14 章）。

export const metadata: Metadata = {
  title: { default: "キマル", template: "%s | キマル" },
};

export default function PublicRootLayout({ children }: { children: ReactNode }) {
  return <RootHtml lang={DEFAULT_LANG}>{children}</RootHtml>;
}
