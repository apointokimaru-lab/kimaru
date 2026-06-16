const { json, readJson } = require("./_lib/response");
const { requireOperator } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { hashPassword } = require("./_lib/crypto");

// 運営者管理（operators テーブル）。運営セッション必須。owners（ユーザー）とは別管理。
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

exports.handler = async (event) => {
  try {
    requireOperator(event);

    if (event.httpMethod === "GET") {
      const operators = await sb("operators?select=id,email,name,is_active,created_at&order=created_at.asc&limit=200");
      return json(200, { operators });
    }

    if (event.httpMethod === "POST") {
      const body = readJson(event);
      const action = String(body.action || "create");

      if (action === "create") {
        const email = String(body.email || "").trim().toLowerCase();
        const name = String(body.name || "").trim();
        if (!EMAIL_RE.test(email)) return json(400, { error: "メールアドレスが不正です。" });
        const payload = { email, name, is_active: true };
        if (body.password) payload.password_hash = hashPassword(String(body.password));
        try {
          const rows = await sb("operators", { method: "POST", body: JSON.stringify(payload) });
          return json(200, { ok: true, operator: rows[0] });
        } catch (error) {
          if (String(error.message || "").includes("duplicate")) return json(409, { error: "このメールアドレスは既に登録済みです。" });
          throw error;
        }
      }

      const id = String(body.id || "").trim();
      if (!id) return json(400, { error: "id が必要です。" });

      if (action === "update") {
        const email = String(body.email || "").trim().toLowerCase();
        const name = String(body.name || "").trim();
        if (!EMAIL_RE.test(email)) return json(400, { error: "メールアドレスが不正です。" });
        const patch = { email, name };
        if (body.password) patch.password_hash = hashPassword(String(body.password)); // 空欄なら変更しない
        try {
          const rows = await sb(`operators?id=${eq(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
          return json(200, { ok: true, operator: rows[0] });
        } catch (error) {
          if (String(error.message || "").includes("duplicate")) return json(409, { error: "このメールアドレスは既に登録済みです。" });
          throw error;
        }
      }

      if (action === "toggle") {
        const rows = await sb(`operators?id=${eq(id)}`, { method: "PATCH", body: JSON.stringify({ is_active: !!body.is_active }) });
        return json(200, { ok: true, operator: rows[0] });
      }

      if (action === "delete") {
        await sb(`operators?id=${eq(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return json(200, { ok: true });
      }

      return json(400, { error: "操作が不正です" });
    }

    return json(405, { error: "許可されていない操作です" });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
