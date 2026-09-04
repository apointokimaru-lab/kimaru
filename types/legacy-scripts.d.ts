// scripts/ は旧スタック（型検査の対象外・JS）。新側のテストから使う関数だけ、ここに型を手書きする（規約 5 章）。

/** scripts/i18n/split.mjs — 旧 public/i18n.js から messages/ を生成する変換器（#414） */
declare module "*/scripts/i18n/split.mjs" {
  export const LEGACY_FILE: string;
  export const OUT_DIR: string;
  export type Extracted = {
    languages: string[];
    messages: Record<string, Record<string, string>>;
  };
  export function extract(repoRoot?: string): Extracted;
  export function splitKey(key: string): [string, string];
  export function byNamespace(dict: Record<string, string>): Record<string, Record<string, string>>;
  export function render(data: Extracted): Map<string, string>;
  export function diffAgainstDisk(files: Map<string, string>, repoRoot?: string): string[];
}
