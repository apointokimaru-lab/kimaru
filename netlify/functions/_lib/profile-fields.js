// ホストのプロフィールのうち「外（ゲスト・第三者）へ出してよい項目」の唯一の出どころ（#360）。
//
// なぜ必要か: 外向きの面が3つ（公開プロフィール /u/<slug>・予約完了メール・カレンダー招待）あるのに、
// 出す項目の一覧がそれぞれの実装に別々に書かれていた。そのため公開ページでは「内部情報」として
// 外していた profile_goal（今回キメたいこと・次につなげたいこと＝ホスト側の狙い）が、
// 予約完了メールとカレンダー招待にだけ出ていた。#358（Zoomのミーティング名に事前アンケートの
// 回答が出ていた件）と同じ、「内部向けの値が外向きの面に出る」不具合。
//
// 何をしているか: 出してよいキーの集合と、メール・カレンダーに出す並び＋見出しを並べて置く。
// 項目を足すときは必ずこの2つを見比べる。ホストだけが見る項目（HOST_ONLY_PROFILE_FIELDS）は
// どちらにも入れない——入れていないことは scripts/test/unit.mjs で固定してある。

// 公開プロフィールページ（profile-public.js）が返す項目。
// bio_rich / accent_color / links はページの見た目に使うので、ここにだけ入る。
const PUBLIC_PROFILE_FIELDS = [
  "profile_name",
  "profile_title",
  "profile_headline",
  "profile_bio_rich",
  "profile_accent_color",
  "profile_strengths",
  "profile_offer",
  "profile_values",
  "profile_links",
];

// 予約完了メール・カレンダー招待の本文に出す項目（この並びで出す）。
// 名前は見出し（「◯◯のプロフィール」）に使うのでここには入れない。装飾つきの自己紹介・リンクは
// 本文に流し込むと読みづらいので、末尾の公開プロフィールURLに任せる。
const GUEST_PROFILE_FIELDS = [
  ["肩書き・活動内容", "profile_title"],
  ["キャッチコピー", "profile_headline"],
  ["強み・得意なこと", "profile_strengths"],
  ["提供できる価値", "profile_offer"],
  ["大切にしていること", "profile_values"],
];

// ホストだけが見る項目。外向きのどの面にも出さない。
//  - profile_goal … 「今回キメたいこと・次につなげたいこと」＝ホスト側の狙い（例: 提案書送付・紹介依頼）
//  - profile_email … 連絡先メール（予約の連絡はキマル経由で行う）
//  - profile_style … 話し方・提案スタイル（相手への接し方の内部メモ。AIアシストの入力には使う）
const HOST_ONLY_PROFILE_FIELDS = ["profile_goal", "profile_email", "profile_style"];

module.exports = { PUBLIC_PROFILE_FIELDS, GUEST_PROFILE_FIELDS, HOST_ONLY_PROFILE_FIELDS };
