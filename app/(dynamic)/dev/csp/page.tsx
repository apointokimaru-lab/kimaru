import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { NonceProbe } from "./_components/NonceProbe";

// nonce 付き CSP の確認ページ（#415）。環境変数 KIMARU_DEV_ROUTES=1 のときだけ存在し、本番では 404。
// 確認すること: 応答ヘッダーの CSP に nonce があり 'unsafe-inline' が無い／Client 部品が hydration して動く
// （＝Next のインライン script に nonce が付いている）／ブラウザに CSP 違反が出ない。
// e2e: tests/e2e/csp.spec.ts。Deploy Preview では Netlify の deploy-preview コンテキストにだけ同じ変数を置く。

export const dynamic = "force-dynamic";

export default async function CspCheckPage() {
  if (process.env.KIMARU_DEV_ROUTES !== "1") notFound();
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <main className="shell narrow">
      <p className="eyebrow">DEV</p>
      <h1>CSP nonce の確認</h1>
      <p className="lead">
        このページは動的描画で、proxy.ts が要求ごとに nonce
        を発行しています。下のボタンが動けば、Next の インラインスクリプトに nonce が付いて
        hydration が通っています。
      </p>
      <p>
        nonce の長さ: <span data-testid="nonce-length">{nonce.length}</span>
      </p>
      <NonceProbe />
    </main>
  );
}
