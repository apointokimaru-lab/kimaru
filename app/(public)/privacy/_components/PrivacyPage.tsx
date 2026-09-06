"use client";

import { useT } from "@/lib/i18n/client";

// プライバシーポリシーの本文（#421）。旧 public/privacy.html の構造（.section > .shell > .legal。利用規約と違い narrow ではない）と
// 文言キーをそのまま写した。文言は法務レビュー済みで 1 字も変えない（正本 docs/legal/privacy-policy.md・HTML と同期済み）。
// 壊さないこと（issue）: 第3条の外部 AI 送信（MCP）条項、第1条・第8条の利用計測（#342）の文。どれも辞書の値そのもの。
// Client Component なのは、言語切替で文言を差し替えるため（旧 i18n.js と同じ）。

// 節の並び。決定31（MCP一本化）で「5. 外部AIサービス連携（MCP）」を s5ai として差し込んだため、以降はキー名（s5〜s8）と
// 表示番号（6〜9）がずれている。辞書のキーは旧のまま（3 言語の対称と履歴を保つため）で、並び順だけここで決める。
// 4 節は本文のあとに Google のポリシーへのリンク（旧は rel="noopener"。lint（react/jsx-no-target-blank）が noreferrer を求めるので足した）、
// 9 節（s8）は本文が 3 段落（組織・所在地・メール）なので個別に書く。
const GOOGLE_POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";

export function PrivacyPage() {
  const t = useT("privacy");
  return (
    <main>
      <section className="section">
        <div className="shell">
          <div className="legal">
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1>{t("h1")}</h1>
            <p className="muted">{t("updated")}</p>
            <p className="lead">{t("lead")}</p>

            <h2>{t("s1.h")}</h2>
            <p>{t("s1.p")}</p>

            <h2>{t("s2.h")}</h2>
            <p>{t("s2.p")}</p>

            <h2>{t("s3.h")}</h2>
            <p>{t("s3.p")}</p>

            <h2>{t("s4.h")}</h2>
            <p>{t("s4.p")}</p>
            <p className="field-note">
              <a href={GOOGLE_POLICY_URL} target="_blank" rel="noopener noreferrer">
                {t("s4.link")}
              </a>
            </p>

            <h2>{t("s5ai.h")}</h2>
            <p>{t("s5ai.p")}</p>

            <h2>{t("s5.h")}</h2>
            <p>{t("s5.p")}</p>

            <h2>{t("s6.h")}</h2>
            <p>{t("s6.p")}</p>

            <h2>{t("s7.h")}</h2>
            <p>{t("s7.p")}</p>

            <h2>{t("s8.h")}</h2>
            <p>{t("s8.org")}</p>
            <p>{t("s8.addr")}</p>
            <p>{t("s8.mail")}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
