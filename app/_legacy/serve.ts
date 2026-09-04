import { readFile } from "node:fs/promises";
import path from "node:path";

// 旧サイトの HTML を Next.js から返すための最小の器（#412・段階0）。
//
// なぜ必要か: Next.js は public/ のファイルを同じパスで配信するが、「/」だけは public/index.html を返さない
// （ルートにはページかルートハンドラが要る）。また、存在しない URL は旧サイトでは Netlify が public/404.html を
// 返していたが、Next 同居後は Next の側に落ちるので、同じ内容・同じ 404 ステータスで返し直す必要がある。
// どちらも段階1（#418 LP・#424 404）で Next のルートに置き換わり、このファイルは役目を終えて消える。
//
// 中身は一切いじらない（i18n・共通ヘッダーの注入は旧サイトと同じく public/i18n.js と Edge の auth-gate.js が担う）。

type LegacyFile = "index.html" | "404.html";

// 読み込みは 1 プロセスにつき 1 回（関数のコールドスタート毎）。Promise を入れておけば同時要求でも二重に読まない。
const cache = new Map<LegacyFile, Promise<string>>();

export function legacyHtml(file: LegacyFile): Promise<string> {
  let pending = cache.get(file);
  if (!pending) {
    // process.cwd() 基準で public/ を読む。Netlify の関数バンドルに含めるため next.config.ts の
    // outputFileTracingIncludes に同じファイルを列挙してある（無いと本番だけ ENOENT）。
    pending = readFile(path.join(process.cwd(), "public", file), "utf8");
    cache.set(file, pending);
  }
  return pending;
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // 旧サイトの静的配信と同じく、ブラウザには都度確認させる（移行中に中身が差し替わるため）
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
