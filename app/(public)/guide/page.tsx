import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StaticI18nProvider } from "@/lib/i18n/client";
import { getStaticMessages, getStaticT } from "@/lib/i18n/static";

import { GuidePage } from "./_components/GuidePage";

// 使い方ガイド /guide（#423・段階1）。静的生成（Cookie も headers も読まない）。
// 旧 /guide.html は next.config.ts の redirects() で恒久リダイレクト（/guide.html#zoom の直リンクも hash ごと届く）。
// 一覧も説明 Modal も文言は guide.* の辞書から出し、項目の一覧は features/guide/entries.ts が唯一の出どころ。
// 初期 HTML は ja。利用者の言語は StaticI18nProvider が Cookie を見て辞書を差し替える。

const NAMESPACES = ["common", "nav", "footer", "guide"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getStaticT("guide");
  return { title: { absolute: t("pageTitle") } };
}

export default async function GuideRoute() {
  const initial = await getStaticMessages(NAMESPACES);
  return (
    <StaticI18nProvider namespaces={NAMESPACES} initial={initial} titleKey={["guide", "pageTitle"]}>
      <SiteHeader />
      <GuidePage />
      <SiteFooter />
    </StaticI18nProvider>
  );
}
