const { required } = require("./config");

function headers() {
  const key = required("SUPABASE_SERVICE_ROLE_KEY");
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function sb(path, options = {}) {
  const url = `${required("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`;
  // headers は options から分離して合成する。`...options` を後に展開すると
  // options.headers がマージ済みヘッダ（apikey/Authorization 含む）を丸ごと上書きして
  // 「No API key found」になるため（addEmailSuppression 等の Prefer 指定呼び出しが該当）。
  const { headers: extraHeaders, ...rest } = options;
  const response = await fetch(url, { headers: { ...headers(), Prefer: "return=representation", ...(extraHeaders || {}) }, ...rest });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.hint || "データの取得・保存に失敗しました");
  return data;
}

const eq = (value) => `eq.${encodeURIComponent(value)}`;

async function findOwnerByEmail(email) {
  const rows = await sb(`owners?email=${eq(email)}&limit=1`);
  return rows[0] || null;
}

async function findOwnerById(id) {
  const rows = await sb(`owners?id=${eq(id)}&limit=1`);
  return rows[0] || null;
}

async function defaultOwner() {
  const rows = await sb("owners?select=*&order=created_at.asc&limit=1");
  return rows[0] || null;
}

async function upsertOwner(profile) {
  const existing = await findOwnerByEmail(profile.email);
  if (existing) {
    const rows = await sb(`owners?id=${eq(existing.id)}`, { method: "PATCH", body: JSON.stringify(profile) });
    return rows[0];
  }
  const rows = await sb("owners", { method: "POST", body: JSON.stringify({ ...profile, plan: "free", slug: profile.slug || "demo" }) });
  return rows[0];
}

// メール配信停止（解除/バウンス/苦情）リスト。営業メールはここに載った宛先には送らない。
async function isEmailSuppressed(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return false;
  const rows = await sb(`email_suppressions?email=${eq(value)}&select=email&limit=1`);
  return Boolean(rows[0]);
}

async function addEmailSuppression(email, reason = "unsubscribe") {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return null;
  // email に unique 制約あり。既存なら無視（ignore-duplicates）。
  return sb("email_suppressions?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ email: value, reason }),
  });
}

module.exports = { sb, eq, findOwnerByEmail, findOwnerById, defaultOwner, upsertOwner, isEmailSuppressed, addEmailSuppression };
