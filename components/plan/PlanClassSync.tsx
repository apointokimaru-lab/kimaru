"use client";

import { useEffect } from "react";

import { fetchMe, planOf } from "@/lib/api/me";

// 旧 plan.js の移植（#419）。/api/me を 1 回だけ叩き、body に plan-free / plan-pro / plan-premium を付ける。
// CSS（styles/shared.css の .plan-free-only / .plan-paid-only / .pro-feature 等）が body クラスで出し分ける。
//
// body のクラスを直接触るのは規約 4 章の「DOM 直接操作をしない」の例外: 出し分けの CSS が旧ページと共通で
// body クラスを前提にしており、Edge の data-auth と同じ層（React の外）で動くため。Edge を撤去する #452 で
// Provider（React の状態）へ寄せる。
//
// 未ログイン（Edge が data-auth="guest" を付けている）は API を叩かず free 扱い。
// data-auth が無い環境（Edge 無し）は旧 plan.js と同じく叩いてみて、失敗したら free。
export function PlanClassSync() {
  useEffect(() => {
    const body = document.body;
    const apply = (plan: string) => {
      body.classList.remove("plan-free", "plan-pro", "plan-premium");
      body.classList.add(`plan-${plan}`);
    };
    if (body.dataset.auth === "guest") {
      apply("free");
      return;
    }
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (!cancelled) apply(planOf(me));
      })
      .catch(() => {
        if (!cancelled) apply("free");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
