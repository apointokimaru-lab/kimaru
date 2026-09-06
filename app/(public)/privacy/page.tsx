import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StaticI18nProvider } from "@/lib/i18n/client";
import { getStaticMessages, getStaticT } from "@/lib/i18n/static";

import { PrivacyPage } from "./_components/PrivacyPage";

// プライバシーポリシー /privacy（#421・段階1）。静的生成（Cookie も headers も読まない）。
// 旧 /privacy.html は next.config.ts の redirects() で恒久リダイレクト（Google OAuth 審査・Zoom 申請に登録した URL は
// 旧のままでも 308 で届く）。本文は法務レビュー済みの文言を旧 i18n.js の privacy.* からそのまま出す（1 字も変えない・
// 正本 docs/legal/privacy-policy.md）。3 言語の辞書も旧のままなので、言語切替の挙動は旧と同じ。

const NAMESPACES = ["common", "nav", "footer", "privacy"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getStaticT("privacy");
  return { title: { absolute: t("title") } };
}

export default async function PrivacyRoute() {
  const initial = await getStaticMessages(NAMESPACES);
  return (
    <StaticI18nProvider namespaces={NAMESPACES} initial={initial} titleKey={["privacy", "title"]}>
      <SiteHeader />
      <PrivacyPage />
      <SiteFooter />
    </StaticI18nProvider>
  );
}
