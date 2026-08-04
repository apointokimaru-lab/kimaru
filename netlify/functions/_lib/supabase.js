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

// owners.slug は公開プロフィールURL（/u/{slug}）になり、グローバル一意（owners_slug_unique）。
// メールのローカル部そのままだと別ドメインの同名（info@a.jp / info@b.com）で衝突するため、
// auth-register.js の makeSlug と同じくランダムサフィックスを付ける。
function ownerSlugCandidate(email) {
  const base = String(email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "user";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

async function upsertOwner(profile) {
  const existing = await findOwnerByEmail(profile.email);
  if (existing) {
    // slug は上書きしない。共有済みの公開プロフィールURL（メールにも載る）が切れるうえ、
    // 他アカウントと衝突すると unique 違反でログイン自体が 500 になるため。
    const { slug, ...patch } = profile;
    const rows = await sb(`owners?id=${eq(existing.id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    return rows[0];
  }
  // 新規作成。slug が衝突したら候補を変えて数回リトライする。
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = ownerSlugCandidate(profile.email);
    try {
      const rows = await sb("owners", { method: "POST", body: JSON.stringify({ ...profile, plan: "free", slug }) });
      return rows[0];
    } catch (error) {
      if (!/duplicate|unique/i.test(String(error.message || ""))) throw error;
      lastError = error;
    }
  }
  throw lastError;
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

module.exports = { sb, eq, findOwnerByEmail, findOwnerById, defaultOwner, upsertOwner, ownerSlugCandidate, isEmailSuppressed, addEmailSuppression };
