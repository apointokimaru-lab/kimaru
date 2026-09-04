// 文言の置換（#414・規約 6 章）。旧辞書の `{name}` 記法をそのまま使う。
// 旧側は呼び出し元が `t("…").replace("{name}", v)` と手で置換していた。新側は t() の第 2 引数で渡す。

export type Vars = Readonly<Record<string, string | number>>;

/**
 * `{name}` を vars の値で置き換える。渡されていない名前はそのまま残す（旧の replace と同じ）。
 * 文字列以外（数値）は String() で入れる。HTML は扱わない（辞書に HTML を入れない規約）。
 */
export function formatMessage(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}
