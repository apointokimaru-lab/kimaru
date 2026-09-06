import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StaticI18nProvider } from "@/lib/i18n/client";
import { getStaticMessages, getStaticT } from "@/lib/i18n/static";

import { TokushohoPage } from "./_components/TokushohoPage";

// 特定商取引法に基づく表記 /tokushoho（#422・段階1）。静的生成（Cookie も headers も読まない）。
// 旧 /tokushoho.html は next.config.ts の redirects() で恒久リダイレクト。本文は法務レビュー済みの文言を旧 i18n.js の
// tokushoho.* からそのまま出す（1 字も変えない・正本 docs/legal/tokushoho.md）。3 言語の辞書も旧のままなので、言語切替の挙動は旧と同じ。

const NAMESPACES = ["common", "nav", "footer", "tokushoho"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getStaticT("tokushoho");
  return { title: { absolute: t("title") } };
}

export default async function TokushohoRoute() {
  const initial = await getStaticMessages(NAMESPACES);
  return (
    <StaticI18nProvider namespaces={NAMESPACES} initial={initial} titleKey={["tokushoho", "title"]}>
      <SiteHeader />
      <TokushohoPage />
      <SiteFooter />
    </StaticI18nProvider>
  );
}
