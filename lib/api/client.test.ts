import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { ApiError, apiGet, apiPost } from "./client";

// fetch を差し替えて、成功時の検証・失敗時の ApiError・本文が JSON でない場合を固定する（規約 5 章）

const fake =
  (status: number, body: unknown, json = true) =>
  async (_input: string, _init?: RequestInit) =>
    new Response(json ? JSON.stringify(body) : String(body), {
      status,
      headers: { "content-type": json ? "application/json" : "text/html" },
    });

test("apiGet: 200 の本文を Zod で検証して返す", async () => {
  const schema = z.object({ ok: z.boolean() });
  const v = await apiGet("/api/x", schema, { fetchImpl: fake(200, { ok: true, extra: 1 }) });
  assert.deepEqual(v, { ok: true }); // 余分な項目は捨てられる
});

test("apiGet: 失敗時は ApiError（status と本文の error）", async () => {
  await assert.rejects(
    apiGet("/api/x", z.object({}), { fetchImpl: fake(401, { error: "ログインが必要です" }) }),
    (e: unknown) => e instanceof ApiError && e.status === 401 && e.message === "ログインが必要です",
  );
});

test("apiGet: 本文が JSON でなくても落ちず、既定文言で ApiError", async () => {
  await assert.rejects(
    apiGet("/api/x", z.object({}), {
      fetchImpl: fake(500, "<html>error</html>", false),
      fallbackMessage: "失敗",
    }),
    (e: unknown) => e instanceof ApiError && e.status === 500 && e.message === "失敗",
  );
});

test("apiPost: JSON で送り、content-type と credentials を付ける", async () => {
  let seen: RequestInit | undefined;
  const fetchImpl = async (_input: string, init?: RequestInit) => {
    seen = init;
    return new Response(JSON.stringify({ pending: true }), { status: 200 });
  };
  const v = await apiPost("/api/invite-apply", { code: "X" }, z.object({ pending: z.boolean() }), {
    fetchImpl,
  });
  assert.deepEqual(v, { pending: true });
  assert.equal(seen?.method, "POST");
  assert.equal(seen?.credentials, "same-origin");
  assert.equal((seen?.headers as Record<string, string>)["content-type"], "application/json");
  assert.equal(seen?.body, JSON.stringify({ code: "X" }));
});

test("apiGet: 形が違う応答は Zod のエラー（黙って通さない）", async () => {
  await assert.rejects(
    apiGet("/api/x", z.object({ ok: z.boolean() }), { fetchImpl: fake(200, { ok: "yes" }) }),
  );
});
