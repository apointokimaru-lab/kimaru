import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StaticI18nProvider } from "@/lib/i18n/client";
import { getStaticMessages } from "@/lib/i18n/static";

import { NotFoundPage } from "./_components/NotFoundPage";

// 見つからないページ（#424・段階1）。旧 public/404.html の置き換えで、段階0 の暫定
// （app/[...path]/route.ts が旧 HTML を読んで返していた）はこの PR で撤去した。
//
// この画面が出る経路は 2 つ:
//  1. どのルートにも当たらない URL → app/(public)/[...path]/page.tsx が notFound() を呼ぶ
//  2. (public) 配下のページが自分で notFound() を呼んだとき
// どちらも 404 で返る（Next はストリームしない応答に 404 を付ける）。
//
// not-found.tsx は metadata を持てないので、<title> は StaticI18nProvider の titleKey が
// マウント後に入れる（初期 HTML はレイアウト既定の「キマル」。3 言語とも同じ扱い）。

const NAMESPACES = ["common", "nav", "footer", "nf"] as const;

export default async function NotFound() {
  const initial = await getStaticMessages(NAMESPACES);
  return (
    <StaticI18nProvider namespaces={NAMESPACES} initial={initial} titleKey={["nf", "pageTitle"]}>
      <SiteHeader />
      <NotFoundPage />
      <SiteFooter />
    </StaticI18nProvider>
  );
}
