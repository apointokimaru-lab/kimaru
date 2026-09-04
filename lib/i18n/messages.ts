import { loaders, type Dict, type Lang, type Namespace } from "@/messages";
import type { MessageKeys } from "@/messages/keys";

import { formatMessage, type Vars } from "./format";
import { DEFAULT_LANG, FALLBACK_LANG } from "./lang";

// 辞書の読み込みと t() の生成（#414・規約 6 章）。サーバー・クライアント両方から使う（副作用なし）。
// 画面が必要とする namespace だけを読む: 旧 i18n.js は 3 言語 338KB を全ページで読んでいたが、
// 新側は「言語 × namespace」の JSON を遅延 import する（messages/index.ts の loaders）。

/** namespace 専用の t()。キーは辞書から生成した union 型（messages/keys.ts）なので、無いキーはコンパイルで止まる */
export type Translator<NS extends Namespace> = (key: MessageKeys[NS], vars?: Vars) => string;

/** I18nProvider に渡す「namespace → 辞書」。無い namespace の t() は実行時に例外 */
export type NamespaceDicts = Readonly<Partial<Record<Namespace, Dict>>>;

/**
 * 言語 × namespace の辞書を、旧 t() と同じフォールバック順（active → ja → en）で 1 つに畳む。
 * 3 言語のキー集合は同一（テストで固定）なので通常は active だけで足りるが、
 * 「空文字は意図的に空」を尊重しつつ欠けにも耐えるよう、en ← ja ← active の順に上書きする。
 */
export async function loadDict(lang: Lang, ns: Namespace): Promise<Dict> {
  // active を必ず最後に置く（Set で重複を消すと lang=en のとき [en, ja] となり ja が en を上書きしてしまう）
  const chain: Lang[] = [FALLBACK_LANG, DEFAULT_LANG].filter((l) => l !== lang);
  chain.push(lang);
  const parts = await Promise.all(chain.map((l) => loaders[l][ns]()));
  const merged: Record<string, string> = {};
  for (const part of parts) Object.assign(merged, part);
  return merged;
}

/** 辞書から t() を作る。未知のキーは（型で弾けない動的な場合に備えて）キー名をそのまま返し、開発時は警告する */
export function createT<NS extends Namespace>(ns: NS, dict: Dict): Translator<NS> {
  return (key, vars) => {
    const value = dict[key as string];
    if (value === undefined) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[i18n] 未定義のキー: ${ns}.${String(key)}`);
      }
      return `${ns}.${String(key)}`;
    }
    return formatMessage(value, vars);
  };
}
