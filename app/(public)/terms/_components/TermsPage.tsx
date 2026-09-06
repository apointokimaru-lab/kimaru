"use client";

import { useT } from "@/lib/i18n/client";

// 利用規約の本文（#420）。旧 public/terms.html の構造（.section > .shell.narrow > .legal）と文言キーをそのまま写した。
// 文言は法務レビュー済みで 1 字も変えない（正本 docs/legal/terms.md・HTML と同期済み）。ここでは辞書のキーを並べるだけ。
// 見た目は styles/shared.css の .legal（styles.css から逐語で抜き出し）と base.css の .section/.shell.narrow/.eyebrow/.lead/.muted。
// Client Component なのは、言語切替で文言を差し替えるため（旧 i18n.js と同じ）。

// 条の並び。決定31（MCP一本化）で第6条を s6ai として差し込んだため、以降はキー名（s6〜s10）と
// 表示番号（第7〜11条）がずれている。辞書のキーは旧のまま（3 言語の対称と履歴を保つため）で、並び順だけここで決める。
const SECTIONS = [
  ["s1.h", "s1.p"],
  ["s2.h", "s2.p"],
  ["s3.h", "s3.p"],
  ["s4.h", "s4.p"],
  ["s5.h", "s5.p"],
  ["s6ai.h", "s6ai.p"],
  ["s6.h", "s6.p"],
  ["s7.h", "s7.p"],
  ["s8.h", "s8.p"],
  ["s9.h", "s9.p"],
  ["s10.h", "s10.p"],
] as const;

export function TermsPage() {
  const t = useT("terms");
  return (
    <main>
      <section className="section">
        <div className="shell narrow">
          <div className="legal">
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1>{t("h1")}</h1>
            <p className="muted">{t("updated")}</p>
            <p className="lead">{t("intro")}</p>
            {SECTIONS.map(([h, p]) => (
              <div key={h}>
                <h2>{t(h)}</h2>
                <p>{t(p)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
