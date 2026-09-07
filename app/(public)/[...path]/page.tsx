import { notFound } from "next/navigation";

// どのルートにも当たらなかった URL（#424・段階1）。
//
// なぜページが要るか: ルートレイアウトが 2 つある（(public) と (dynamic)）ため、Next の「アプリ全体の 404」は
// experimental の global-not-found でしか作れない。代わりに **公開側のキャッチオールで notFound() を呼び**、
// 同じグループの not-found.tsx を出す。こうすると公開ページのレイアウト（共通ヘッダー／フッター・静的 CSP・
// システムフォント）をそのまま使える。
//
// ここに来るのは本当に存在しない URL だけ: public/ の実ファイル（旧ページ）と、より具体的なルートが常に優先される。
// 旧サイトでは Netlify が public/404.html を自動で返していた（受付停止中の予約ページからの誘導先・#321 も同じ）。
export default function CatchAllNotFound(): never {
  notFound();
}
