import type { Metadata, Viewport } from "next";

import { LandingPage } from "./_components/LandingPage";

// トップ / ＝ LP（#418・段階1）。静的生成（Cookie も headers も読まない）。
// 旧 public/index.html の <head>（title・description・theme-color）を Metadata API で出す。

export const metadata: Metadata = {
  title: { absolute: "キマル | 予約から次の一手までキマる" },
  description:
    "キマルは、予約URLを送るだけで日程調整、事前アンケート、Web会議URL、リマインド、面談後の相手管理までまとめる1対1向け予約システムです。",
};

export const viewport: Viewport = {
  themeColor: "#eaf8fb",
};

export default function TopPage() {
  return <LandingPage />;
}
