"use client";

import Link from "next/link";
import type { KeyboardEvent } from "react";

import { LANGS, LANG_LABELS, normalizeLang, DEFAULT_LANG } from "@/lib/i18n/lang";
import { useLang, useSetLang, useT } from "@/lib/i18n/client";

// 共通ヘッダー（#419・#426 の前倒し）。Edge（auth-gate.js）が旧ページに注入している SITE_HEADER と同じ構造・同じクラス名。
// - 出し分け（.guest-only / .app-only）は旧と同じく body[data-auth]（Edge が付ける）＋ styles/shared.css の CSS。
//   Edge を撤去する #452 で、data-auth の付け方（proxy.ts か Client）を決める
// - ハンバーガーは旧と同じ CSS だけの仕組み（#km-nav-toggle のチェックボックス）。「閉じる」のキー操作だけ React で
// - 旧ページへのリンクは <a>（.html）。Next に移した / と /plan は Link
// - 言語の選択は useSetLang（静的ページでは辞書の差し替え、動的ページでは再描画）
// Client Component なのは、言語切替で文言を差し替えるため

export function SiteHeader() {
  const t = useT("nav");
  const tc = useT("common");

  const closeOnKey = (e: KeyboardEvent<HTMLLabelElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const toggle = document.getElementById("km-nav-toggle") as HTMLInputElement | null;
      if (toggle) toggle.checked = false;
    }
  };

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span className="brand-dot" />
        {tc("brand")}
      </Link>
      <input type="checkbox" id="km-nav-toggle" />
      <label className="nav-burger" htmlFor="km-nav-toggle" aria-label="Menu">
        <span />
        <span />
        <span />
      </label>
      <nav>
        <Link className="guest-only" href="/plan">
          {t("pricing")}
        </Link>
        <a className="guest-only" href="/signup.html">
          {t("signup")}
        </a>
        <a className="guest-only" href="/login.html">
          {t("signin")}
        </a>
        <a className="app-only" href="/dashboard.html">
          {t("dashboard")}
        </a>
        <a className="app-only" href="/schedule.html">
          {t("schedule")}
        </a>
        <a className="app-only" href="/answers.html">
          {t("answers")}
        </a>
        <a className="app-only" href="/booking-settings.html">
          {t("bookingSettings")}
        </a>
        <a className="app-only" href="/profile.html">
          {t("profile")}
        </a>
        <a className="app-only" href="/contacts.html">
          {t("admin")}
        </a>
        <a className="app-only" href="/ai-assist.html">
          {t("aiAssist")}
        </a>
        <a className="app-only" href="/settings.html">
          {t("settings")}
        </a>
        <Link className="app-only" href="/guide">
          {t("guide")}
        </Link>
        <LangSelect />
        <a className="app-only nav-avatar" href="/settings.html" aria-hidden="true" tabIndex={-1}>
          キ
        </a>
        <label
          className="nav-close"
          htmlFor="km-nav-toggle"
          role="button"
          tabIndex={0}
          onKeyDown={closeOnKey}
        >
          {t("close")}
        </label>
      </nav>
    </header>
  );
}

/** 言語の選択（旧 [data-language-select] を i18n.js が埋めていたのと同じ 3 択） */
function LangSelect() {
  const lang = useLang();
  const setLang = useSetLang();
  return (
    <select
      className="lang-select"
      aria-label="Language"
      value={lang}
      onChange={(e) => setLang(normalizeLang(e.target.value) ?? DEFAULT_LANG)}
    >
      {LANGS.map((l) => (
        <option key={l} value={l}>
          {LANG_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
