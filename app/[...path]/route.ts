import { htmlResponse, legacyHtml } from "../_legacy/serve";

// 未マッチの URL 全部 = 旧 404 ページ（public/404.html）を 404 で返す（#412・段階0）。
// public/ の実ファイルと他のルートが常に優先されるので、ここに来るのは存在しない URL だけ。
// 旧サイトでは Netlify が public/404.html を自動で返していた挙動（受付停止中の予約ページからの誘導先・#321 も
// これ）を、Next 同居後も同じ内容・同じステータスで維持する。#424 で not-found.tsx に置き換える。
export async function GET(): Promise<Response> {
  return htmlResponse(await legacyHtml("404.html"), 404);
}
