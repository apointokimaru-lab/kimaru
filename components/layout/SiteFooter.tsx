"use client";

import Link from "next/link";

import { useT } from "@/lib/i18n/client";

// 共通フッター（法務リンク）。Edge（auth-gate.js）が旧ページに注入している SITE_FOOTER と同じ構造・同じクラス名（#419）。
// 法務ページは Next に移したものから Link に替える（#420 利用規約 → /terms）。残り（.html）は旧ページへの <a>。
export function SiteFooter() {
  const t = useT("footer");
  return (
    <footer className="foot footer">
      <div className="foot-in">
        <nav className="footer-nav">
          <Link href="/terms">{t("terms")}</Link>
          <a href="/privacy.html">{t("privacy")}</a>
          <a href="/tokushoho.html">{t("tokushoho")}</a>
        </nav>
        <p className="footer-copy">{t("copy")}</p>
      </div>
    </footer>
  );
}
