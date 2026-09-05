"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { Lang, Namespace } from "@/messages";

import { DEFAULT_LANG, readLangCookie, resolveLang, writeLangCookie } from "./lang";
import { createT, loadDict, type NamespaceDicts, type Translator } from "./messages";

// クライアント側の入口（#414・#419・規約 6 章）。Provider は 2 種類:
//   I18nProvider       … 動的ページ用。サーバー（getMessages）が Cookie の言語で読んだ辞書を配る。切替は Cookie + router.refresh()
//   StaticI18nProvider … 静的ページ用。サーバーは ja で描く。マウント後に Cookie の言語が ja 以外なら辞書を読み込んで差し替える
//                        （旧 i18n.js が textContent を入れ替えていたのと同じ「ja が一瞬見える」挙動。静的生成＝CDN を守るため）
// 部品はどちらでも useT(ns) / useLang() / useSetLang() を同じように使う。

type I18nContextValue = {
  lang: Lang;
  messages: NamespaceDicts;
  setLang: (lang: Lang) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function useI18nContext(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx)
    throw new Error("[i18n] I18nProvider の外で使われた。layout か page で I18nProvider を巻く");
  return ctx;
}

/** 動的ページ用 */
export function I18nProvider({
  lang,
  messages,
  children,
}: {
  lang: Lang;
  messages: NamespaceDicts;
  children: ReactNode;
}) {
  const router = useRouter();
  const setLang = useCallback(
    (next: Lang) => {
      writeLangCookie(next);
      router.refresh(); // サーバー描画部分を Cookie の言語で取り直す
    },
    [router],
  );
  const value = useMemo(() => ({ lang, messages, setLang }), [lang, messages, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 静的ページ用。initial は ja の辞書（サーバーで getStaticMessages が作る）。
 * namespaces は切替時に読み込む namespace（initial のキー集合と同じにする）。
 * titleKey を渡すと document.title も言語に合わせる（旧 data-i18n-title 相当）。
 */
export function StaticI18nProvider({
  namespaces,
  initial,
  titleKey,
  children,
}: {
  namespaces: readonly Namespace[];
  initial: NamespaceDicts;
  titleKey?: readonly [Namespace, string];
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);
  const [messages, setMessages] = useState<NamespaceDicts>(initial);

  // 言語×namespace の JSON を遅延 import（messages/index.ts の loaders）。state は触らない純粋な読み込み
  const loadDicts = useCallback(
    async (next: Lang): Promise<NamespaceDicts> => {
      const dicts = await Promise.all(namespaces.map((ns) => loadDict(next, ns)));
      const merged: Partial<Record<Namespace, (typeof dicts)[number]>> = {};
      namespaces.forEach((ns, i) => {
        merged[ns] = dicts[i];
      });
      return merged;
    },
    [namespaces],
  );

  // 読み込んだ辞書を反映する（非同期の完了コールバックから呼ぶ。effect 本体では setState しない）
  const apply = useCallback((next: Lang, dicts: NamespaceDicts) => {
    setMessages(dicts);
    setLangState(next);
    document.documentElement.lang = next;
  }, []);

  // マウント後に Cookie を見る。ja ならサーバー描画のまま（何も読まない）
  useEffect(() => {
    const fromCookie = resolveLang(readLangCookie());
    if (fromCookie === DEFAULT_LANG) return;
    let cancelled = false;
    void loadDicts(fromCookie).then((dicts) => {
      if (!cancelled) apply(fromCookie, dicts);
    });
    return () => {
      cancelled = true;
    };
  }, [loadDicts, apply]);

  // document.title を言語に合わせる（旧 body[data-i18n-title] と同じ役目）
  useEffect(() => {
    if (!titleKey) return;
    const value = messages[titleKey[0]]?.[titleKey[1]];
    if (value) document.title = value;
  }, [messages, titleKey]);

  const setLang = useCallback(
    (next: Lang) => {
      writeLangCookie(next);
      void loadDicts(next).then((dicts) => apply(next, dicts));
    },
    [loadDicts, apply],
  );

  const value = useMemo(() => ({ lang, messages, setLang }), [lang, messages, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
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
      `[i18n] namespace "${ns}" が Provider に渡されていない。getMessages / getStaticMessages に "${ns}" を加える`,
    );
  }
  return useMemo(() => createT(ns, dict), [ns, dict]);
}

/** 言語を切り替える（Cookie に書き、動的ページは再描画、静的ページは辞書を差し替える） */
export function useSetLang(): (lang: Lang) => void {
  return useI18nContext().setLang;
}
