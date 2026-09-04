"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import type { Lang, Namespace } from "@/messages";

import { LEGACY_STORAGE_KEY, langCookieString } from "./lang";
import { createT, type NamespaceDicts, type Translator } from "./messages";

// クライアント側の入口（#414・規約 6 章）。
// サーバー（getMessages）が読んだ辞書を Provider で配り、Client の部品は useT(ns) で受け取る。
// Provider は必要な深さで巻き、画面が使う namespace だけを渡す（配信量を言語 × 画面ぶんに抑える）。

type I18nContextValue = { lang: Lang; messages: NamespaceDicts };

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  lang,
  messages,
  children,
}: I18nContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ lang, messages }), [lang, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18nContext(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx)
    throw new Error("[i18n] I18nProvider の外で使われた。layout か page で I18nProvider を巻く");
  return ctx;
}

export function useLang(): Lang {
  return useI18nContext().lang;
}

/** namespace 専用の t()。Provider に渡していない namespace は実行時に例外（getMessages の列挙漏れを早く気づかせる） */
export function useT<NS extends Namespace>(ns: NS): Translator<NS> {
  const { messages } = useI18nContext();
  const dict = messages[ns];
  if (!dict) {
    throw new Error(
      `[i18n] namespace "${ns}" が I18nProvider に渡されていない。getMessages([... , "${ns}"]) に加える`,
    );
  }
  return useMemo(() => createT(ns, dict), [ns, dict]);
}

/**
 * 言語を切り替える。Cookie（新側の正）と localStorage（旧ページが見る）の両方に書き、
 * サーバー描画部分を取り直す（router.refresh）。URL は変えない。
 */
export function useSetLang(): (lang: Lang) => void {
  const router = useRouter();
  return useCallback(
    (lang: Lang) => {
      document.cookie = langCookieString(lang, window.location.protocol === "https:");
      try {
        window.localStorage.setItem(LEGACY_STORAGE_KEY, lang);
      } catch {
        // プライベートモード等で localStorage が使えなくても Cookie があれば足りる
      }
      router.refresh();
    },
    [router],
  );
}
