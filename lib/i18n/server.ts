import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { Lang, Namespace } from "@/messages";

import { LANG_COOKIE, resolveLang } from "./lang";
import { createT, loadDict, type NamespaceDicts, type Translator } from "./messages";

// サーバー側の入口（#414・規約 6 章）。page.tsx / layout.tsx から使う。
// Cookie を読む＝そのルートは動的描画になる。(public) の静的ページで言語を切り替える設計は段階1 で決める
// （静的生成のまま 3 言語を出すなら、言語ごとの静的化か Client 側切替が要る）。

/** 表示言語。1 リクエスト内では 1 回だけ Cookie を読む */
export const getLang = cache(async (): Promise<Lang> => {
  const store = await cookies();
  return resolveLang(store.get(LANG_COOKIE)?.value);
});

/** namespace 専用の t() を返す。例: `const t = await getT("dash"); t("todo.title")` */
export async function getT<NS extends Namespace>(ns: NS): Promise<Translator<NS>> {
  const lang = await getLang();
  return createT(ns, await loadDict(lang, ns));
}

/** Client の I18nProvider に渡す辞書をまとめて読む。画面が使う namespace だけを列挙する */
export async function getMessages(
  namespaces: readonly Namespace[],
): Promise<{ lang: Lang; messages: NamespaceDicts }> {
  const lang = await getLang();
  const dicts = await Promise.all(namespaces.map((ns) => loadDict(lang, ns)));
  const messages: Partial<Record<Namespace, (typeof dicts)[number]>> = {};
  namespaces.forEach((ns, i) => {
    messages[ns] = dicts[i];
  });
  return { lang, messages };
}
