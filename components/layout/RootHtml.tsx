import type { ReactNode } from "react";

import { notoSansJp } from "@/app/fonts";
import type { Lang } from "@/messages";

// <html> と <body> の器（#415）。ルートレイアウトは 2 つある（規約 1 章）:
//   app/(public)/layout.tsx  … 静的生成。lang は ja 固定で、Client 側で Cookie の言語に合わせる
//   app/(dynamic)/layout.tsx … 動的描画。Cookie の言語をサーバーで読んで lang に出す
// どちらも同じ <html>/<body> を出すよう、ここに 1 つにまとめる。
// Next 16 は既定でスムーズスクロールを上書きしないため、旧 CSS の html{scroll-behavior:smooth} を活かすには
// data-scroll-behavior="smooth" が要る。
export function RootHtml({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <html lang={lang} className={notoSansJp.variable} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
