"use client";

import Link from "next/link";

import { useT } from "@/lib/i18n/client";

import s from "./NotFoundPage.module.css";

// 見つからないページの本文（#424）。旧 public/404.html を文言・構造・見た目を変えずに移した。
// 「一時的に止まっている」とは書かない——相手が待ってしまうので、見つからない事実だけを伝える（旧 HTML のコメント）。
// Client Component なのは、言語切替で文言を差し替えるため。

export function NotFoundPage() {
  const t = useT("nf");
  return (
    <main className="shell">
      <section className={`panel ${s.card}`}>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("heading")}</h1>
        <p className="lead">{t("desc")}</p>
        <div className={`actions ${s.actions}`}>
          <Link className="button primary" href="/">
            {t("goTop")}
          </Link>
        </div>
      </section>
    </main>
  );
}
