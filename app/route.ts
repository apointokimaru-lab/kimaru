import { htmlResponse, legacyHtml } from "./_legacy/serve";

// トップ「/」= 旧 LP（public/index.html）をそのまま返す（#412・段階0）。
// Next.js は public/index.html を「/」では返さないため、置き換え先の LP（#418）ができるまでの暫定。
// ビルド時に静的化する（Next 15 以降、ルートハンドラの GET は既定で動的なので明示する）。
// これで本番では旧サイトと同じく静的配信になり、実行時に fs を読まない。
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  return htmlResponse(await legacyHtml("index.html"));
}
