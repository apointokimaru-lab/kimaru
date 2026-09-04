import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RootHtml } from "@/components/layout/RootHtml";
import { getLang } from "@/lib/i18n/server";

import "../globals.css";

// 動的ページ（(auth) (guest) (app) (operator) の各グループをこの下に置く）のルートレイアウト（#415・規約 1 章）。
// Cookie の言語をサーバーで読んで <html lang> に出す。Cookie を読む時点でこの配下は動的描画になる
// （それでよい: ユーザーデータを描くページはもともとキャッシュしない）。
// CSP は proxy.ts が要求ごとの nonce 付きポリシーを付け、Next が自分の <script>/<style> に nonce を付ける。

export const metadata: Metadata = {
  title: { default: "キマル", template: "%s | キマル" },
};

export default async function DynamicRootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return <RootHtml lang={lang}>{children}</RootHtml>;
}
