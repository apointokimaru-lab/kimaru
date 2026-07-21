const { json, readJson } = require("./_lib/response");
const { requireOwner } = require("./_lib/auth");
const { sb, eq } = require("./_lib/supabase");

const BASIC_FIELDS = [
  "profile_name",
  "profile_email",
  "profile_title",
  "profile_strengths",
  "profile_style",
  "profile_offer",
  "profile_values",
  "profile_goal",
];
// 高度プロフィール（色・太字・見出し・公開設定）は Pro/Premium のみ保存（#176）。画像は保存先未決のため対象外。
const ADVANCED_FIELDS = [
  "profile_headline",
  "profile_bio_rich",
  "profile_accent_color",
  "profile_links",
  "profile_public",
];

function cleanProfile(input, isPro) {
  const out = {};
  BASIC_FIELDS.forEach((field) => {
    if (input[field] != null) out[field] = String(input[field]).slice(0, 4000);
  });
  if (isPro) {
    ADVANCED_FIELDS.forEach((field) => {
      if (input[field] == null) return;
      if (field === "profile_accent_color") {
        const hex = String(input[field]).trim();
        out[field] = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "";
      } else if (field === "profile_public") {
        out[field] = input[field] === "off" || input[field] === false ? "off" : "on";
      } else {
        out[field] = String(input[field]).slice(0, 8000);
      }
    });
    // リンク（表示名＋URL）: フロントは items 配列で送り、ここで「表示名<TAB>URL」を改行連結して
    // 既存の profile_links カラムに保存する（区切りを壊さないよう name/url からタブ・改行を除去）。
    if (Array.isArray(input.profile_links_items)) {
      out.profile_links = input.profile_links_items
        .map((it) => ({
          name: String((it && it.name) || "").replace(/[\t\r\n]+/g, " ").trim().slice(0, 120),
          url: String((it && it.url) || "").replace(/[\t\r\n]+/g, " ").trim().slice(0, 500),
        }))
        .filter((it) => it.url || it.name)
        .map((it) => it.name + "\t" + it.url)
        .join("\n")
        .slice(0, 8000);
    }
  }
  return out;
}
exports.cleanProfile = cleanProfile; // テスト用に公開（handler には影響なし）

function safeParse(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function findProfile(ownerId) {
  const rows = await sb(`profiles?owner_id=${eq(ownerId)}&limit=1`);
  return rows[0] || null;
}

async function upsert(payload, existing) {
  if (existing) {
    return sb(`profiles?id=${eq(existing.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
  }
  return sb("profiles", { method: "POST", body: JSON.stringify(payload) });
}

exports.handler = async (event) => {
  try {
    const owner = await requireOwner(event);

    if (event.httpMethod === "GET") {
      const row = await findProfile(owner.id);
      const profile = row ? (row.data && Object.keys(row.data).length ? row.data : safeParse(row.bio)) : {};
      return json(200, { profile });
    }

    if (event.httpMethod === "POST") {
      const isPro = owner.plan === "pro" || owner.plan === "premium";
      const data = cleanProfile(readJson(event), isPro);
      const existing = await findProfile(owner.id);
      const base = { owner_id: owner.id, display_name: data.profile_name || owner.name || "" };
      try {
        const saved = await upsert({ ...base, data }, existing);
        return json(200, { ok: true, profile: saved[0]?.data || data });
      } catch (error) {
        // `data` 列が未マイグレーションの環境向けフォールバック（bio に JSON 保存）
        if (!String(error.message || "").includes("data")) throw error;
        await upsert({ ...base, bio: JSON.stringify(data) }, existing);
        return json(200, { ok: true, profile: data });
      }
    }

    return json(405, { error: "許可されていない操作です" });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
