import { NextResponse, type NextRequest } from "next/server";

import { isDynamicPath, nonceCsp } from "@/lib/csp";

// リクエスト単位の前処理（#415・規約 8 章）。Next 16 では middleware.ts ではなく proxy.ts（Node.js 実行のみ）。
// 今の役割は「動的ルートに nonce 付き CSP を付ける」だけ。認証ゲート（旧 Edge auth-gate.js の後継）は #425 で足す。
//
// 仕組み: nonce を要求ヘッダー x-nonce と content-security-policy に載せて Next に渡すと、Next が描画時に
// 自分の <script>/<style> に nonce を付ける（同梱ドキュメント content-security-policy.md）。応答ヘッダーにも同じ CSP を付ける。

export function proxy(request: NextRequest): NextResponse {
  // 公開ページ・旧 HTML（ドット付きパス）は静的なので nonce を付けない（next.config.ts の headers() が STATIC_CSP を付ける）
  if (!isDynamicPath(request.nextUrl.pathname)) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = nonceCsp(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // 静的資産と「ドットを含むパス」（旧 .html・画像・favicon 等）では動かさない。
  // matcher は静的に解析されるため定数で書く。動的ルートかどうかの判定は上の isDynamicPath（lib/csp.ts）で行う
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
