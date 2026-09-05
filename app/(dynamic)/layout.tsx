import type { Metadata } from "next";
import type { ReactNode } from "react";

import { notoSansJp } from "@/app/fonts";
import { RootHtml } from "@/components/layout/RootHtml";
import { getLang } from "@/lib/i18n/server";

import "../globals.css";

// 動的ページ（(auth) (guest) (app) (operator) の各グループをこの下に置く）のルートレイアウト（#415・規約 1 章）。
// Cookie の言語をサーバーで読んで <html lang> に出す。Cookie を読む時点でこの配下は動的描画になる
// （それでよい: ユーザーデータを描くページはもともとキャッシュしない）。
// CSP は proxy.ts が要求ごとの nonce 付きポリシーを付け、Next が自分の <script>/<style> に nonce を付ける。
// next/font（Noto Sans JP）の変数クラスはこちらだけに当てる（公開ページには当てない・#418）。
// ⚠️ 5 ウェイトで CSS 472 KB・フォント最大 620 KB。ウェイト削減かシステムフォント化は段階2 の最初の画面で決める（規約 14 章）。

export const metadata: Metadata = {
  title: { default: "キマル", template: "%s | キマル" },
};

export default async function DynamicRootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return (
    <RootHtml lang={lang} fontClassName={notoSansJp.variable}>
      {children}
    </RootHtml>
  );
}
