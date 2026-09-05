import type { ReactNode } from "react";

import type { Lang } from "@/messages";

// <html> と <body> の器（#415）。ルートレイアウトは 2 つある（規約 1 章）:
//   app/(public)/layout.tsx  … 静的生成。lang は ja 固定で、Client 側で Cookie の言語に合わせる。**Web フォントは当てない**
//   app/(dynamic)/layout.tsx … 動的描画。Cookie の言語をサーバーで読んで lang に出す。next/font の変数クラスを渡す
// どちらも同じ <html>/<body> を出すよう、ここに 1 つにまとめる。
// フォントを公開ページに当てない理由（#418）: Next 16 の next/font は @font-face を実名 "Noto Sans JP" で登録する
// （5 ウェイトで 621 面・CSS 472 KB・フォント最大 620 KB）。LP はシステムフォントで速さを守る設計（旧 LP と同じ）なのに、
// 変数クラスがあるだけで CSS が載り、"Noto Sans JP" を指すテキストが Web フォントに一致して全部読みに行く。
// Next 16 は既定でスムーズスクロールを上書きしないため、旧 CSS の html{scroll-behavior:smooth} を活かすには
// data-scroll-behavior="smooth" が要る。
export function RootHtml({
  lang,
  fontClassName,
  children,
}: {
  lang: Lang;
  fontClassName?: string;
  children: ReactNode;
}) {
  return (
    <html lang={lang} className={fontClassName} data-scroll-behavior="smooth">
      {/* Edge（auth-gate.js）が応答の <body> に data-auth="authed|guest" を足す（React の外）。その属性差で
          hydration の警告を出さないため。属性は React が消さないので、CSS の出し分けはそのまま効く */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
