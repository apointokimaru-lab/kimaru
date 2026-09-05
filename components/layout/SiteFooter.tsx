"use client";

import { useT } from "@/lib/i18n/client";

// 共通フッター（法務リンク）。Edge（auth-gate.js）が旧ページに注入している SITE_FOOTER と同じ構造・同じクラス名（#419）。
// 法務 3 ページは旧ページ（.html）へのリンク。Next に移したら Link に替える（#420〜#422）。
export function SiteFooter() {
  const t = useT("footer");
  return (
    <footer className="foot footer">
      <div className="foot-in">
        <nav className="footer-nav">
          <a href="/terms.html">{t("terms")}</a>
          <a href="/privacy.html">{t("privacy")}</a>
          <a href="/tokushoho.html">{t("tokushoho")}</a>
        </nav>
        <p className="footer-copy">{t("copy")}</p>
      </div>
    </footer>
  );
}
