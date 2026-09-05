import { z } from "zod";

import { apiGet } from "./client";

// /api/me（ログイン中のアカウント）。owners の行のうち画面が使う項目だけを型にする（余分な項目は捨てる）。
// 旧 plan.js は plan を body クラス（plan-free|pro|premium）にしていた。未ログイン・不明は free 扱い。

export const PLANS = ["free", "pro", "premium"] as const;
export type Plan = (typeof PLANS)[number];

export const MeSchema = z.object({
  owner: z
    .object({
      id: z.string().optional(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      plan: z.enum(PLANS).optional(),
    })
    .nullable()
    .optional(),
  calendar_connected: z.boolean().optional(),
  zoom_connected: z.boolean().optional(),
});
export type Me = z.infer<typeof MeSchema>;

export function fetchMe(): Promise<Me> {
  return apiGet("/api/me", MeSchema);
}

/** 旧 plan.js と同じ判定: premium は pro の全機能を含む上位（決定20） */
export function planOf(me: Me | null | undefined): Plan {
  return me?.owner?.plan ?? "free";
}
export const isPro = (plan: Plan): boolean => plan === "pro" || plan === "premium";
export const isPremium = (plan: Plan): boolean => plan === "premium";
