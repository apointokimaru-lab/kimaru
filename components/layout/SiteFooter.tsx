"use client";

import Link from "next/link";

import { useT } from "@/lib/i18n/client";

// 共通フッター（法務リンク）。Edge（auth-gate.js）が旧ページに注入している SITE_FOOTER と同じ構造・同じクラス名（#419）。
// 法務 3 ページは Next に移した（#420 /terms・#421 /privacy・#422 /tokushoho）ので Link。
export function SiteFooter() {
  const t = useT("footer");
  return (
    <footer className="foot footer">
      <div className="foot-in">
        <nav className="footer-nav">
          <Link href="/terms">{t("terms")}</Link>
          <Link href="/privacy">{t("privacy")}</Link>
          <Link href="/tokushoho">{t("tokushoho")}</Link>
        </nav>
        <p className="footer-copy">{t("copy")}</p>
      </div>
    </footer>
  );
}
