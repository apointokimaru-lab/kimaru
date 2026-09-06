"use client";

import { Fragment } from "react";

import { useT } from "@/lib/i18n/client";

// 特定商取引法に基づく表記の本文（#422）。旧 public/tokushoho.html の構造をそのまま写した:
// 利用規約・プライバシーと違い <main class="shell narrow"> の直下に <section class="panel legal">（枠付き）で、
// 本文は <dl class="legal-dl"> の項目名（dt）と値（dd）の 14 組。文言は法務レビュー済みで 1 字も変えない
// （正本 docs/legal/tokushoho.md・HTML と同期済み）。価格の行（Pro 月額 ¥980）もそのまま。
// Client Component なのは、言語切替で文言を差し替えるため（旧 i18n.js と同じ）。

// 項目の並び（旧 HTML の順）。辞書のキーは <name>.label / <name>.value の対。
// dt/dd は .legal-dl（grid: 200px 1fr）の直接の子でないと 2 列に並ばないので、組を div で包まず Fragment で並べる
const ROWS = [
  "seller",
  "manager",
  "address",
  "email",
  "phone",
  "invoice",
  "price",
  "extraFees",
  "trial",
  "payment",
  "paymentTiming",
  "delivery",
  "cancel",
  "refund",
] as const;

export function TokushohoPage() {
  const t = useT("tokushoho");
  return (
    <main className="shell narrow">
      <section className="panel legal">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("heading")}</h1>
        <p className="muted">{t("updated")}</p>
        <p className="lead">{t("lead")}</p>

        <dl className="legal-dl">
          {ROWS.map((name) => (
            <Fragment key={name}>
              <dt>{t(`${name}.label`)}</dt>
              <dd>{t(`${name}.value`)}</dd>
            </Fragment>
          ))}
        </dl>
      </section>
    </main>
  );
}
