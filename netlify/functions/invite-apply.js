const { json, readJson } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");
const { optional } = require("./_lib/config");
const { verifyAdminSession, timingEqual } = require("./_lib/crypto");
const { applyPlanLimits } = require("./_lib/plan-freeze");
const { deleteOwnerCascade } = require("./_lib/account-delete");

const proCodes = new Set([
  "NEKO20240222",
]);
const CODE_RE = /^[A-Z0-9_-]{6,40}$/;

function clientIp(event) {
  const headers = event.headers || {};
  return String(headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "").split(",")[0].trim();
}

function isCatKeyAdmin(event) {
  // 運営セッション（/operator-login で発行）があれば許可。
  if (verifyAdminSession(event)) return true;
  // 後方互換は Authorization: Bearer のみ（定数時間比較）。
  // クエリ文字列/ボディでの秘密送付はログ・履歴に残るため廃止。
  const secret = optional("ADMIN_SECRET", "");
  if (!secret) return false;
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || "";
  return timingEqual(authorization, `Bearer ${secret}`);
}

async function auditCatKey(event, payload) {
  try {
    await sb("cat_key_events", {
      method: "POST",
      body: JSON.stringify({
        owner_id: payload.owner_id || null,
        email: payload.email || "",
        action: payload.action,
        code: payload.code || "",
        ip_address: clientIp(event),
        user_agent: String(event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "").slice(0, 300),
        metadata: payload.metadata || {},
      }),
    });
  } catch (_) {
    // Audit logging should not block the user flow if the migration has not run yet.
  }
}

async function listOwners(event) {
  if (!isCatKeyAdmin(event)) return json(401, { error: "認証が必要です" });
  const owners = await sb("owners?select=id,email,name,plan,invite_code,cat_key_disabled,cat_key_pending,created_at&order=created_at.desc&limit=200").catch(() =>
    sb("owners?select=id,email,name,plan,invite_code,cat_key_disabled,created_at&order=created_at.desc&limit=200"));
  const events = await sb("cat_key_events?select=id,owner_id,email,action,code,ip_address,user_agent,metadata,created_at&order=created_at.desc&limit=50").catch(() => []);
  return json(200, { owners, events });
}

async function updateOwnerCatKey(event) {
  const body = readJson(event);
  if (!isCatKeyAdmin(event)) return json(401, { error: "認証が必要です" });
  const ownerId = String(body.owner_id || "").trim();
  const action = String(body.action || "");
  if (!ownerId) return json(400, { error: "owner_id が指定されていません" });
  if (!["approve", "reject", "suspend", "resume", "demote", "delete"].includes(action)) return json(400, { error: "操作が不正です" });
  // 退会（完全削除）: 予約・相手管理・連携などの関連データごと物理削除。元に戻せない。
  if (action === "delete") {
    const removed = await deleteOwnerCascade(ownerId);
    if (!removed) return json(404, { error: "対象のユーザーが見つかりません" });
    await auditCatKey(event, { owner_id: null, email: removed.email || "", action: "admin_delete", metadata: { source: "cat-key-admin" } });
    return json(200, { ok: true, deleted: true });
  }
  // メンバー判定: invite_code があれば Cat Key メンバー（過去含む）。停止/再開の plan 変更はメンバーのみ。
  // （非メンバーは凍結フラグだけ切替＝Square課金者を誤って降格せず、再開でも昇格しない）
  const cur = await sb(`owners?id=${eq(ownerId)}&select=invite_code`).catch(() => []);
  const isMember = !!(cur[0] && cur[0].invite_code);
  // 状態は既存列で表現: 申請中=cat_key_pending / 停止中=cat_key_disabled / 退会済=plan=free・invite_code有 / 利用中=それ以外
  let patch;
  if (action === "suspend") {
    patch = isMember ? { plan: "free", cat_key_disabled: true } : { cat_key_disabled: true }; // 利用停止
  } else if (action === "resume") {
    patch = isMember ? { plan: "pro", cat_key_disabled: false } : { cat_key_disabled: false }; // 利用再開（非メンバーは昇格しない）
  } else {
    patch = {
      approve: { plan: "pro", cat_key_pending: false, cat_key_disabled: false }, // 申請を承認 → 利用中（invite_code 保持）
      reject:  { cat_key_pending: false, invite_code: "" },                       // 申請を却下 → 非メンバーへ戻す
      demote:  { plan: "free", cat_key_disabled: false, cat_key_pending: false }, // 無料へ降格 → 退会済（invite_code 保持）
    }[action];
  }
  const rows = await sb(`owners?id=${eq(ownerId)}`, { method: "PATCH", body: JSON.stringify(patch) });
  // Pro 昇格→凍結データ復元 / 無料降格→超過データ凍結（プランが実際に変わるメンバー操作のみ・決定15・#174）。
  const promoted = action === "approve" || (action === "resume" && isMember);
  const demotedToFree = action === "demote" || (action === "suspend" && isMember);
  if (promoted) await applyPlanLimits(ownerId, "pro").catch(() => null); // Cat Key は Pro 付与
  else if (demotedToFree) await applyPlanLimits(ownerId, "free").catch(() => null);
  await auditCatKey(event, { owner_id: ownerId, email: rows[0]?.email || "", action: `admin_${action}`, metadata: { source: "cat-key-admin" } });
  return json(200, { ok: true, owner: rows[0] });
}

exports.handler = async (event) => {
  try {
    if (event.queryStringParameters?.admin === "cat-key") {
      if (event.httpMethod === "GET") return listOwners(event);
      if (event.httpMethod === "POST") return updateOwnerCatKey(event);
      return json(405, { error: "許可されていない操作です" });
    }

    if (event.httpMethod !== "POST") return json(405, { error: "許可されていない操作です" });
    const owner = await requireOwner(event);
    if (owner.cat_key_disabled) {
      await auditCatKey(event, { owner_id: owner.id, email: owner.email, action: "blocked_apply" });
      return json(403, { error: "このアカウントではCat Keyを利用できません" });
    }
    const body = readJson(event);
    const code = String(body.code || "").trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      await auditCatKey(event, { owner_id: owner.id, email: owner.email, action: "invalid_format", code });
      return json(400, { error: "招待コード（Cat Key）が正しくありません" });
    }
    if (!proCodes.has(code)) {
      await auditCatKey(event, { owner_id: owner.id, email: owner.email, action: "invalid_code", code });
      return json(400, { error: "招待コード（Cat Key）が正しくありません" });
    }
    // 承認制（決定 2026-06-03）: 即時付与せず「承認待ち」にする。運営がコンソールで承認するとproになる。
    try {
      const rows = await sb(`owners?id=${eq(owner.id)}`, { method: "PATCH", body: JSON.stringify({ cat_key_pending: true, invite_code: code }) });
      await auditCatKey(event, { owner_id: owner.id, email: owner.email, action: "apply_pending", code });
      return json(200, { ok: true, pending: true, owner: rows[0] });
    } catch (error) {
      // cat_key_pending 列が未マイグレーションの環境では従来どおり即時付与（運用を止めない）
      if (!String(error.message || "").includes("cat_key_pending")) throw error;
      const rows = await sb(`owners?id=${eq(owner.id)}`, { method: "PATCH", body: JSON.stringify({ plan: "pro", invite_code: code }) });
      await auditCatKey(event, { owner_id: owner.id, email: owner.email, action: "apply_success", code });
      return json(200, { ok: true, pending: false, owner: rows[0] });
    }
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
