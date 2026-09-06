import type { MessageKeys } from "@/messages/keys";

// 使い方ガイド（#353）の項目データ。旧 public/guide.js の ENTRIES / GROUPS をそのまま TypeScript に移した（#423）。
//
// なぜここが唯一の出どころか: 項目名や件数を画面（JSX）にも書くと、説明を 1 つ足したときに必ず片方が古くなる。
// 一覧・説明 Modal・テストの 3 つとも、この配列と下の 2 つの規則（pagesOf / prefixOf）だけを見る。
//
// なぜ項目ごとに中身の形が違うか: 読み手が知りたいことは項目ごとに違うため、説明の部品を選べるようにしてある。
//   lead   … 1 段落の要約。Modal の冒頭に必ず出す
//   points … 順序のない箇条書き。「〜とは」の概要向け
//   steps  … 順序のある手順。「〜の連携方法」「〜の作成方法」向け
//   fields … 設定項目の名前と説明の対。「この画面のこの欄は何か」向け
//   note   … 注記。上限・できないこと・元に戻せないことを最後に置く
// 必要な i18n キーはこの指定から機械的に決まる（entries.test.ts が 3 言語ぶん確認する）。
//
// なぜ送りが「項目の中だけ」なのか: どの項目を押しても同じ器が開くと、どこまでがその説明なのか分からなくなる。
// 送りは 1 項目の中のページ間だけに限り、項目をまたがない（次の項目は一覧に戻って選ぶ）。
// あわせて、1 ページぶんが iPhone 12（390×664）でスクロールせずに収まる量に抑えている。
// 収まらない説明は文を削るのではなく、ページを足す（一覧のボタンは増やさない）。

/** 一覧の章立て。ここに無い group の項目は一覧に出ない（entries.test.ts が全項目の group を確認する） */
export const GROUPS = ["overview", "setup", "run", "more"] as const;
export type GuideGroup = (typeof GROUPS)[number];

/** 1 ページぶんの部品指定。指定の無い部品は描かない */
export type GuideBlock = {
  steps?: number;
  points?: number;
  fields?: number;
  note?: boolean;
};

export type GuideEntry = GuideBlock & {
  /** i18n の接頭辞（guide 名前空間の中で `<key>.title` / `<key>.lead` …）。URL の #<key> にもなる */
  key: string;
  group: GuideGroup;
  /** 「該当画面を開く」の行き先。無い項目はボタンを出さない */
  href?: string;
  /** 複数ページの項目だけ。単ページは書かず、上の部品指定をそのまま 1 ページとして扱う */
  pages?: readonly GuideBlock[];
};

export const ENTRIES: readonly GuideEntry[] = [
  // ===== 概要 =====
  { key: "about", group: "overview", steps: 3, note: true },
  { key: "page-about", group: "overview", points: 3, href: "/booking-settings.html" },

  // ===== 予約受付の準備 =====
  {
    key: "calendar",
    group: "setup",
    href: "/settings.html#integrations",
    pages: [{ steps: 4 }, { steps: 2, note: true }],
  },
  {
    key: "zoom",
    group: "setup",
    href: "/settings.html#integrations",
    pages: [{ steps: 4 }, { steps: 3, note: true }],
  },
  // 予約ページ設定の画面で上から順に触る項目を、そのままページの順にしている
  // （作成 → 基本 → 面談の条件 → 受付時間 → 前後バッファ → 候補の出し方 → 事前アンケート）。
  {
    key: "page-create",
    group: "setup",
    href: "/booking-settings.html",
    pages: [
      { steps: 5 },
      { fields: 4 },
      { fields: 3 },
      { steps: 3 },
      { steps: 4, note: true },
      { fields: 3 },
      { steps: 4, note: true },
    ],
  },
  {
    key: "profile",
    group: "setup",
    href: "/profile.html",
    pages: [{ steps: 3, note: true }, { fields: 4 }],
  },

  // ===== 案内から面談当日まで =====
  { key: "share", group: "run", steps: 4, note: true, href: "/dashboard.html" },
  {
    key: "pinpoint",
    group: "run",
    href: "/dashboard.html",
    pages: [{ steps: 5 }, { points: 3 }],
  },
  { key: "after", group: "run", steps: 4, href: "/schedule.html" },
  // 回答を「読む」のは予約が入ったあとの作業なので、設定の章ではなくこちらに置く
  { key: "survey-answers", group: "run", points: 3, href: "/answers.html" },
  { key: "change", group: "run", steps: 4, note: true, href: "/schedule.html" },
  { key: "pause", group: "run", steps: 2, note: true, href: "/booking-settings.html" },

  // ===== 継続的な利用 =====
  { key: "contacts-about", group: "more", points: 3, href: "/contacts.html" },
  { key: "contacts-use", group: "more", steps: 4, href: "/contacts.html" },
  {
    key: "plan",
    group: "more",
    href: "/plan",
    pages: [{ points: 4 }, { points: 4 }, { points: 3, note: true }],
  },
];

/** 1 ページぶんの、部品の件数と文言キーの接頭辞（画面もテストもこの形だけを見る） */
export type GuidePage = {
  prefix: string;
  steps: number;
  points: number;
  fields: number;
  note: boolean;
};

// 1 項目は 1 ページ以上を持つ。単ページの項目は pages を書かず、項目の部品指定をそのまま 1 ページとして扱う。
const pagesOf = (entry: GuideEntry): readonly GuideBlock[] =>
  entry.pages ?? [
    { steps: entry.steps, points: entry.points, fields: entry.fields, note: entry.note },
  ];

// 文言のキーは「単ページ = <key>.*」「複数ページ = <key>.p<n>.*」。単ページ側にまで p1 を付けると
// 既存の 20 項目ぶんのキーを機械的に書き換えることになるので、ここだけ規則を分けている。
// この 2 つの規則は resolvePages に閉じ込め、テストも同じ出力を使う（規則が 2 か所に散らない）。
const prefixOf = (entry: GuideEntry, index: number): string =>
  entry.pages ? `${entry.key}.p${index + 1}` : entry.key;

/** 項目を「ページの配列」に開く。単ページ・複数ページの違いはここから先に漏らさない */
export function resolvePages(entry: GuideEntry): GuidePage[] {
  return pagesOf(entry).map((block, i) => ({
    prefix: prefixOf(entry, i),
    steps: block.steps ?? 0,
    points: block.points ?? 0,
    fields: block.fields ?? 0,
    note: Boolean(block.note),
  }));
}

export const findEntry = (key: string): GuideEntry | undefined =>
  ENTRIES.find((entry) => entry.key === key);

/** guide 名前空間の文言キー。t() が受ける型（messages/keys.ts の生成物） */
export type GuideTextKey = MessageKeys["guide"];

// 文言キーは ENTRIES の件数から機械的に決まる（`page-create.p2.field3.name` など）ので、
// 型として書き下すことができない。ここ 1 か所だけキャストし、3 言語ぶんの存在は entries.test.ts が固定する。
export const textKey = (prefix: string, suffix: string): GuideTextKey =>
  `${prefix}.${suffix}` as GuideTextKey;

/** その項目を描くのに要る文言キー（テストと画面で同じ規則を使うため、ここで組み立てる） */
export function requiredKeys(entry: GuideEntry): GuideTextKey[] {
  const pages = resolvePages(entry);
  const keys: GuideTextKey[] = [textKey(entry.key, "title")];
  for (const page of pages) {
    // 複数ページの項目は、見出しがページ名になる（項目名は上のラベルへ回る）
    if (pages.length > 1) keys.push(textKey(page.prefix, "title"));
    keys.push(textKey(page.prefix, "lead"));
    for (let i = 1; i <= page.steps; i++) keys.push(textKey(page.prefix, `step${i}`));
    for (let i = 1; i <= page.points; i++) keys.push(textKey(page.prefix, `point${i}`));
    for (let i = 1; i <= page.fields; i++) {
      keys.push(textKey(page.prefix, `field${i}.name`), textKey(page.prefix, `field${i}.desc`));
    }
    if (page.note) keys.push(textKey(page.prefix, "note"));
  }
  return keys;
}

/** 項目に依らない文言（一覧の見出し・Modal の操作）。テストが 3 言語ぶんの存在を固定する */
export const CHROME_KEYS = [
  "pageTitle",
  "index.eyebrow",
  "index.heading",
  "index.lead",
  "note",
  "open",
  "prev",
  "next",
  "close",
] as const satisfies readonly GuideTextKey[];
