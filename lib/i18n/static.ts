import "server-only";

import { loaders, type Dict, type Namespace } from "@/messages";

import { DEFAULT_LANG } from "./lang";
import { createT, type NamespaceDicts, type Translator } from "./messages";

// 静的生成する公開ページ（(public)）のサーバー側 i18n（#419・規約 6 章）。
// Cookie を読まないので静的化できる。サーバーは既定言語（ja）で描き、利用者の言語への切替は Client の
// StaticI18nProvider が Cookie を見て辞書を差し替える（lib/i18n/client.tsx）。
// 動的ページは lib/i18n/server.ts（Cookie の言語で描く）を使う。混ぜない。

/** namespace 全体、または [namespace, 使うキーだけ] で指定する。使うキーだけにすると初期 HTML に埋める辞書が小さくなる */
export type StaticSpec = Namespace | readonly [Namespace, readonly string[]];

function pick(dict: Dict, keys: readonly string[]): Dict {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = dict[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** ja の辞書を、Client の StaticI18nProvider に渡す形で読む */
export async function getStaticMessages(specs: readonly StaticSpec[]): Promise<NamespaceDicts> {
  const entries = await Promise.all(
    specs.map(async (spec) => {
      const [ns, keys] = typeof spec === "string" ? [spec, null] : [spec[0], spec[1]];
      const dict = await loaders[DEFAULT_LANG][ns]();
      return [ns, keys ? pick(dict, keys) : dict] as const;
    }),
  );
  return Object.fromEntries(entries) as NamespaceDicts;
}

/** ja の t()（metadata の title など、サーバーで 1 回だけ要るときに） */
export async function getStaticT<NS extends Namespace>(ns: NS): Promise<Translator<NS>> {
  return createT(ns, await loaders[DEFAULT_LANG][ns]());
}
