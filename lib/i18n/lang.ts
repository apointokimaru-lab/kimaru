import { LANGS, type Lang } from "@/messages";

// 言語の判定と保持（#414・規約 6 章）。旧 public/i18n.js の normalizeLanguage / pickLanguage の移植。
// 旧と同じ挙動を保つ: 既定は ja、明示の選択（Cookie）があればそれ。ブラウザの Accept-Language では切り替えない
// （旧 pickLanguage も stored || ja の時点で ja に決まり、ブラウザ言語を見ていなかった）。
// 保持先を localStorage から Cookie に変えたのは、サーバー描画（app/）で言語を決めるため。

export { LANGS };
export type { Lang };

export const DEFAULT_LANG: Lang = "ja";
/** 旧 t() と同じ最終フォールバック（active → ja → en の順） */
export const FALLBACK_LANG: Lang = "en";

export const LANG_COOKIE = "kimaru_lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 年
/** 旧 i18n.js が使っていた localStorage のキー。旧ページと選択を揃えるため、切替時はこちらにも書く */
export const LEGACY_STORAGE_KEY = "kimaru.language";

export const LANG_LABELS: Readonly<Record<Lang, string>> = {
  ja: "日本語",
  en: "English",
  "zh-TW": "繁體中文",
};

/**
 * 任意の言語コードを対応言語に寄せる（旧 normalizeLanguage と同じ規則）。
 * - 大文字小文字を無視した完全一致 → その言語
 * - `zh` で始まるものはすべて `zh-TW`（簡体字の zh-CN も繁体字ページへ。旧の割り切り）
 * - それ以外は `-` の前の基底言語で一致（`en-US` → `en`）
 * - 対応しないものは null
 */
export function normalizeLang(code: unknown): Lang | null {
  if (code === null || code === undefined || code === "") return null;
  const lower = String(code).trim().toLowerCase();
  if (!lower) return null;
  const exact = LANGS.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  if (lower.startsWith("zh")) return "zh-TW";
  const base = lower.split("-")[0];
  return LANGS.find((l) => l.toLowerCase().split("-")[0] === base) ?? null;
}

/** Cookie の値から表示言語を決める。無効・未設定なら ja */
export function resolveLang(cookieValue: string | null | undefined): Lang {
  return normalizeLang(cookieValue) ?? DEFAULT_LANG;
}

/** document.cookie に書く文字列。HttpOnly にしない（言語は秘密ではなく、Client 側で切り替えるため） */
export function langCookieString(lang: Lang, secure: boolean): string {
  const parts = [
    `${LANG_COOKIE}=${encodeURIComponent(lang)}`,
    "Path=/",
    `Max-Age=${LANG_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
