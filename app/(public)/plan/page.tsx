import type { Metadata } from "next";

import { PlanClassSync } from "@/components/plan/PlanClassSync";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StaticI18nProvider } from "@/lib/i18n/client";
import { getStaticMessages, getStaticT } from "@/lib/i18n/static";

import { PlanPage } from "./_components/PlanPage";

// 料金・プラン /plan（#419・段階1）。静的生成（Cookie も headers も読まない）。
// 旧 /plan.html は next.config.ts の redirects() で恒久リダイレクト。/pro.html → /plan は netlify.toml。
// 初期 HTML は ja。利用者の言語は StaticI18nProvider が Cookie を見て辞書を差し替える。
// 必要な namespace だけ埋める（home は 9 キーしか使わないので使うキーだけ）。

const NAMESPACES = ["common", "nav", "footer", "pricing", "catkey", "home"] as const;
const HOME_KEYS = [
  "hero.startFree",
  "plan.th.feature",
  "plan.th.free",
  "plan.th.pro",
  "plan.th.premium",
  "plan.price.label",
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getStaticT("pricing");
  return { title: { absolute: t("pageTitle") } };
}

export default async function PlanRoute() {
  const initial = await getStaticMessages([
    "common",
    "nav",
    "footer",
    "pricing",
    "catkey",
    ["home", HOME_KEYS],
  ]);
  return (
    <StaticI18nProvider
      namespaces={NAMESPACES}
      initial={initial}
      titleKey={["pricing", "pageTitle"]}
    >
      <SiteHeader />
      <PlanPage />
      <SiteFooter />
      <PlanClassSync />
    </StaticI18nProvider>
  );
}
