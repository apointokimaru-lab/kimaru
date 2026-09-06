import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StaticI18nProvider } from "@/lib/i18n/client";
import { getStaticMessages, getStaticT } from "@/lib/i18n/static";

import { TermsPage } from "./_components/TermsPage";

// 利用規約 /terms（#420・段階1）。静的生成（Cookie も headers も読まない）。
// 旧 /terms.html は next.config.ts の redirects() で恒久リダイレクト。
// 本文は法務レビュー済みの文言を旧 i18n.js の terms.* からそのまま出す（1 字も変えない・正本は docs/legal/terms.md）。
// 旧ページと同じく 3 言語の辞書があるので、言語の差し替えも旧と同じ挙動（StaticI18nProvider が Cookie を見て差し替える）。

const NAMESPACES = ["common", "nav", "footer", "terms"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getStaticT("terms");
  return { title: { absolute: t("title") } };
}

export default async function TermsRoute() {
  const initial = await getStaticMessages(NAMESPACES);
  return (
    <StaticI18nProvider namespaces={NAMESPACES} initial={initial} titleKey={["terms", "title"]}>
      <SiteHeader />
      <TermsPage />
      <SiteFooter />
    </StaticI18nProvider>
  );
}
