const { sb, eq } = require("./supabase");
const { planLimits } = require("./plan-limits");

// プラン変更時に上限超過データを「削除せず凍結」、上限内に戻ったら復元する（決定15・#174、決定27・3段階対応）。
// 凍結: 予約ページ frozen=true / is_active=false（公開停止＝予約不可）、質問 frozen=true（ゲストに出さない）。
// frozen 列が未マイグレーションの環境では各処理を握りつぶす（降格/昇格自体は plan 更新で完了済み）。

async function ownerPageIds(ownerId, order = "updated_at.desc") {
  const pages = await sb(`booking_pages?owner_id=${eq(ownerId)}&select=id&order=${order}`);
  return (pages || []).map((p) => p.id);
}

// 変更後プランの上限に合わせて凍結／復元を一括適用（冪等）。
// - 予約ページ: 直近更新の上限数だけ残し、超過は凍結。上限内に戻った凍結ページは復元。
// - 質問: 残すページの上限超過設問を凍結、上限内の凍結設問を復元。
// free 1 / pro 2 / premium 5 ページ、質問は free 2 / pro・premium 5。
async function applyPlanLimits(ownerId, plan) {
  const { pages: pageLimit, questions: questionLimit } = planLimits(plan);
  try {
    const ids = await ownerPageIds(ownerId, "updated_at.desc");
    const keep = ids.slice(0, pageLimit);
    const excess = ids.slice(pageLimit);
    if (excess.length) {
      await sb(`booking_pages?id=in.(${excess.join(",")})`, {
        method: "PATCH",
        body: JSON.stringify({ frozen: true, is_active: false, active: false }),
      });
    }
    if (keep.length) {
      // 上限内に戻った凍結ページのみ復元（ユーザーが手動で受付停止したページ frozen=false は触らない）。
      await sb(`booking_pages?id=in.(${keep.join(",")})&frozen=is.true`, {
        method: "PATCH",
        body: JSON.stringify({ frozen: false, is_active: true, active: true }),
      });
      // 質問: 上限超過を凍結、上限内の凍結分を復元。
      await sb(`questionnaire_questions?booking_page_id=in.(${keep.join(",")})&sort_order=gt.${questionLimit}`, {
        method: "PATCH",
        body: JSON.stringify({ frozen: true }),
      });
      await sb(`questionnaire_questions?booking_page_id=in.(${keep.join(",")})&sort_order=lte.${questionLimit}&frozen=is.true`, {
        method: "PATCH",
        body: JSON.stringify({ frozen: false }),
      });
    }
  } catch (_) {
    // frozen 列未マイグレーション等では何もしない。
  }
}

module.exports = { applyPlanLimits };
