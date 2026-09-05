// ESLint（flat config）。Next 16 は `next lint` を廃止し `next build` も lint しないため、CLI で回す（#416）。
// 規約の正本は docs/frontend-conventions.md 10 章。対象は新フロント（app/ 等）だけで、旧スタック
// （public/・netlify/・scripts/）は対象外。
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  globalIgnores([
    ".next/**",
    ".netlify/**",
    "node_modules/**",
    "next-env.d.ts",
    // 旧スタック（別規約・CLAUDE.md）。移行が終わるまで触らない
    "public/**",
    "netlify/**",
    "scripts/**",
    // 生成物（scripts/i18n/split.mjs が書く辞書・型・レジストリ）
    "messages/**",
  ]),
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    rules: {
      // ---- 禁止（規約 4 章）----
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            "HTML を直接描かない（XSS）。リッチテキストは lib/sanitize.ts を通した components/ui/RichText.tsx の 1 か所だけ。",
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: "innerHTML/outerHTML は使わない。JSX で描く。",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "insertAdjacentHTML は使わない。JSX で描く。",
        },
        {
          selector: "TSEnumDeclaration",
          message: "enum は使わない。文字列リテラルの union と as const の配列で。",
        },
      ],
      // Functions のコードはサーバー専用の橋渡し（lib/server/）からだけ触る。Client バンドルに秘密が混ざるのを防ぐ
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/netlify/functions/**"],
              message: "netlify/functions は lib/server/ 経由でだけ import する（規約 5 章）。",
            },
          ],
        },
      ],
      // ---- TypeScript（規約 3 章）----
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      // 未使用は _ 接頭辞だけ許す
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // ---- React ----
      "react/jsx-no-target-blank": ["error", { allowReferrer: false }],
      // style 属性は動的ページの CSP（style-src に 'unsafe-inline' が無い）で効かない。CSS Modules を使う（規約 4・8 章）
      "react/forbid-dom-props": [
        "error",
        {
          forbid: [
            {
              propName: "style",
              message: "style 属性は CSP で効かない。CSS Modules のクラスで書く。",
            },
          ],
        },
      ],
    },
  },
  {
    // サーバー専用の橋渡しだけは Functions の _lib を直接 import してよい
    files: ["lib/server/**/*.ts", "types/**/*.d.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  // Prettier と衝突する整形系ルールを最後に無効化する（整形は Prettier に任せる）
  prettier,
]);
