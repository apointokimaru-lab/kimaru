"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";

import { ApiError, apiPost } from "@/lib/api/client";
import { useT } from "@/lib/i18n/client";

// Cat Key（招待コード）の申請フォーム（#419）。旧 plan.html のインライン script の移植。
// 既存の /api/invite-apply（承認制: owners.cat_key_pending を立てる）をそのまま呼ぶ。書き込みの責任は Functions 側。
// 文言は旧では日本語直書きだったので、pricing.catkey.* に 3 言語で足した（#419）。

const InviteApplyResult = z.object({ pending: z.boolean().optional() });

type Status = { kind: "" | "success" | "error" | "checking"; text: string };

export function CatKeyForm() {
  const t = useT("pricing");
  const tk = useT("catkey");
  const [status, setStatus] = useState<Status>({ kind: "", text: "" });
  const [code, setCode] = useState("");

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus({ kind: "checking", text: t("catkey.checking") });
    try {
      const result = await apiPost("/api/invite-apply", { code }, InviteApplyResult, {
        fallbackMessage: t("catkey.failed"),
      });
      setCode("");
      setStatus({
        kind: "success",
        text: result.pending ? t("catkey.pendingDone") : t("catkey.applied"),
      });
    } catch (err) {
      // 旧と同じ: ログイン系のエラーは「Google連携後に」へ言い換える
      const message = err instanceof Error ? err.message : t("catkey.failed");
      const needLogin =
        (err instanceof ApiError && (err.status === 401 || err.status === 403)) ||
        /login|owner|unauthorized/i.test(message);
      setStatus({ kind: "error", text: needLogin ? t("catkey.needLogin") : message });
    }
  };

  return (
    <>
      {/* .app-only: ログイン時だけ表示（body[data-auth]・styles/shared.css） */}
      <form id="pro-cat-key-form" className="inline-form app-only" onSubmit={onSubmit}>
        <input
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={tk("inputPlaceholder")}
          autoComplete="off"
        />
        <button className="button primary" type="submit" disabled={status.kind === "checking"}>
          {t("catkey.apply")}
        </button>
      </form>
      <p
        id="pro-cat-key-message"
        className={`message ${status.kind === "checking" ? "" : status.kind}`.trim()}
        role="status"
      >
        {status.text}
      </p>
    </>
  );
}
