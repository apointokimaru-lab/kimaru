const { json } = require("./_lib/response");
const { requireOperator } = require("./_lib/auth");
const { sb } = require("./_lib/supabase");
const { jstDayKey } = require("./_lib/analytics");

// 運営コンソールの分析ダッシュボード（#343）の集計API。運営セッション必須（ユーザーの kimaru_session では通らない）。
//
// なぜ必要か: 経営判断（どのプランに寄せるか）と機能改善の優先順位づけに使う数字が、これまで
// Supabase を直接叩かないと見られなかった。
// 何をしているか: 必要な表を1回ずつ引いて JS で集計し、1レスポンスにまとめる。
//
// 集計を SQL 側（ビュー）に寄せていないのは page_events だけ（#342 のビューを使う）。
// それ以外の表はこのサービスの規模では数千行なので、素直に引いて JS で数えるほうが
// 手で SQL を両DBへ適用する手間（移行ツールが無い）に見合う。将来行数が増えたらビュー化する。
//
// 取得に失敗した表は null にして画面へ渡す。「まだ0件」と「テーブル未適用/取得不可」を
// 画面で区別できないと、数字が0なのを機能が使われていないと読み違えるため。

// プラン価格（MRR概算用）。docs/plan-comparison.md の確定値。
const PRICE = { pro: 980, premium: 2200 };
// 1表あたりの取得上限。超えたら notes に載せて「全部は見ていない」ことを画面に出す。
const ROW_CAP = 20000;

async function rows(path) {
  try {
    const data = await sb(path);
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return null; // 表・ビューが無い / 取得できない
  }
}

const jstDay = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? jstDayKey(date) : "";
};

// 0件の日を落とすと折れ線が詰まって日付がずれるので、期間ぶんの日付を先に作って埋める。
function dayRange(days, now) {
  const list = [];
  for (let i = days - 1; i >= 0; i -= 1) list.push(jstDayKey(new Date(now.getTime() - i * 86400000)));
  return list;
}

// サマリーは期間ではなく「全体」を見る画面なので、月次は集計期間と無関係に直近12ヶ月を並べる。
// 0件の月を落とすと棒が詰まって山谷がずれるため、先に月を並べてから埋める。
function monthRange(count, now) {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const list = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    list.push(new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return list;
}

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null); // %（小数1桁）
const uniq = (list, key) => new Set((list || []).map((row) => row[key]).filter(Boolean));
const bump = (map, key, by = 1) => { if (key) map[key] = (map[key] || 0) + by; };

// 中央値・四分位。件数が少ないうちは平均だと1件の外れ値で動くので分位で見る。
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return Math.round((next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base]) * 10) / 10;
}

exports.handler = async (event) => {
  try {
    requireOperator(event);

    const query = event.queryStringParameters || {};
    const days = Math.min(365, Math.max(7, Number(query.days) || 30));
    const now = new Date();
    const since = new Date(now.getTime() - days * 86400000);
    const sinceIso = since.toISOString();
    const sinceDay = jstDayKey(since);
    const monthStart = `${jstDayKey(now).slice(0, 7)}-01T00:00:00+09:00`; // AIアシストの当月集計はJST月で数える（上限判定と同じ切り方）
    const notes = [];

    const [
      ownerRows, paymentRows, bookingRows, pageRows, availabilityRows, googleRows, zoomRows,
      questionRows, aiRows, pinpointRows, noteRows, logRows, manualRows,
      usageDaily, usageByPlan, usageSources,
    ] = await Promise.all([
      rows(`owners?select=id,plan,created_at,invite_code,cat_key_disabled,cat_key_pending,email_verified&order=created_at.asc&limit=${ROW_CAP}`),
      rows(`payment_events?select=owner_id,event_type,created_at&order=created_at.asc&limit=${ROW_CAP}`),
      rows(`bookings?select=owner_id,status,created_at,location_type&order=created_at.desc&limit=${ROW_CAP}`),
      rows(`booking_pages?select=id,owner_id,is_active,frozen&limit=${ROW_CAP}`),
      rows(`availability_settings?select=owner_id&limit=${ROW_CAP}`),
      rows(`google_connections?select=owner_id&limit=${ROW_CAP}`),
      rows(`zoom_connections?select=owner_id&limit=${ROW_CAP}`),
      rows(`questionnaire_questions?select=booking_page_id&limit=${ROW_CAP}`),
      rows(`ai_assist_logs?select=owner_id,created_at&created_at=gte.${encodeURIComponent(monthStart)}&limit=${ROW_CAP}`),
      rows(`pinpoint_links?select=owner_id,created_at&limit=${ROW_CAP}`),
      rows(`booking_notes?select=owner_id&limit=${ROW_CAP}`),
      rows(`appointment_logs?select=owner_id&limit=${ROW_CAP}`),
      rows(`manual_contacts?select=owner_id&limit=${ROW_CAP}`),
      rows(`page_events_daily?select=day,page,views,visitors&day=gte.${sinceDay}&limit=${ROW_CAP}`),
      rows(`page_events_by_plan?select=day,page,plan,views&day=gte.${sinceDay}&limit=${ROW_CAP}`),
      rows(`page_events_sources?select=day,source,device,views&day=gte.${sinceDay}&limit=${ROW_CAP}`),
    ]);

    if ((bookingRows || []).length >= ROW_CAP) notes.push(`予約は直近 ${ROW_CAP} 件までを集計しています（それ以前は含みません）。`);
    if ((usageDaily || []).length >= ROW_CAP) notes.push(`画面の利用状況は ${ROW_CAP} 行までを集計しています。期間を短くすると正確になります。`);

    const owners = ownerRows || [];
    const dayList = dayRange(days, now);
    const monthList = monthRange(12, now);

    // ---- アカウント ----
    const planCount = { free: 0, pro: 0, premium: 0 };
    const signupsByDay = {};
    const signupsByMonth = {};
    let disabled = 0;
    let pendingCatKey = 0;
    let verified = 0;
    for (const owner of owners) {
      planCount[owner.plan] = (planCount[owner.plan] || 0) + 1;
      bump(signupsByDay, jstDay(owner.created_at));
      bump(signupsByMonth, jstDay(owner.created_at).slice(0, 7));
      if (owner.cat_key_disabled) disabled += 1;
      if (owner.cat_key_pending) pendingCatKey += 1;
      if (owner.email_verified) verified += 1;
    }
    const paidCount = planCount.pro + planCount.premium;

    // ---- 課金（Square）----
    // 付与/解約の判定は square-webhook.js と同じ規則にする。ここだけ違う数え方をすると
    // 「プランは上がっているのに課金として数えられない」ズレが出る。
    const firstGrantAt = new Map();
    let cancelEvents = 0;
    let cancelEventsInRange = 0;
    for (const ev of paymentRows || []) {
      const type = String(ev.event_type || "").toLowerCase();
      const isCancel = /cancel|deactivat|delete|expire|fail|unpaid/.test(type);
      const isGrant = !isCancel && /payment|subscription|invoice|charge/.test(type);
      if (isCancel) {
        cancelEvents += 1;
        if (ev.created_at >= sinceIso) cancelEventsInRange += 1;
      }
      if (isGrant && ev.owner_id && !firstGrantAt.has(ev.owner_id)) firstGrantAt.set(ev.owner_id, ev.created_at);
    }
    const paying = owners.filter((owner) => firstGrantAt.has(owner.id) && (owner.plan === "pro" || owner.plan === "premium"));
    const payingPro = paying.filter((owner) => owner.plan === "pro").length;
    const payingPremium = paying.filter((owner) => owner.plan === "premium").length;
    // Cat Key の無償Pro。招待コードを持ち、決済イベントが無い有料アカウント＝売上にはならない会員。
    const catKeyPaid = owners.filter((o) => (o.plan === "pro" || o.plan === "premium") && o.invite_code && !firstGrantAt.has(o.id)).length;

    const daysToPaid = [];
    for (const owner of owners) {
      const grantedAt = firstGrantAt.get(owner.id);
      if (!grantedAt) continue;
      const diff = (new Date(grantedAt).getTime() - new Date(owner.created_at).getTime()) / 86400000;
      if (Number.isFinite(diff) && diff >= 0) daysToPaid.push(diff);
    }
    daysToPaid.sort((a, b) => a - b);

    // 登録月コホート（直近12ヶ月）。全体の転換率だけ見ていると、母数の大きい古い月に薄められて
    // 「最近の登録者が有料になっているか」が見えないため月ごとに割る。
    const monthKeys = Object.keys(signupsByMonth).sort().slice(-12);
    const cohorts = monthKeys.map((month) => {
      const members = owners.filter((owner) => jstDay(owner.created_at).slice(0, 7) === month);
      const paid = members.filter((owner) => owner.plan === "pro" || owner.plan === "premium").length;
      const payingMembers = members.filter((owner) => firstGrantAt.has(owner.id)).length;
      return { month, signups: members.length, paid, paying: payingMembers, rate: rate(paid, members.length) };
    });

    // ---- アクティベーション（稼働中アカウントのうち、機能に到達している割合）----
    const activeOwners = owners.filter((owner) => !owner.cat_key_disabled);
    const activeIds = new Set(activeOwners.map((owner) => owner.id));
    const pageOwner = new Map((pageRows || []).map((page) => [page.id, page.owner_id]));
    const questionOwners = new Set((questionRows || []).map((q) => pageOwner.get(q.booking_page_id)).filter(Boolean));
    const within = (set) => [...set].filter((id) => activeIds.has(id)).length;
    const step = (label, set, available = true) => {
      const count = available ? within(set) : null;
      return { label, count, rate: available ? rate(count, activeOwners.length) : null, available };
    };
    const activation = [
      step("予約ページを作成", uniq(pageRows, "owner_id"), pageRows !== null),
      step("受付時間を設定", uniq(availabilityRows, "owner_id"), availabilityRows !== null),
      step("Googleカレンダー連携", uniq(googleRows, "owner_id"), googleRows !== null),
      step("Zoom連携", uniq(zoomRows, "owner_id"), zoomRows !== null),
      step("事前アンケートを設定", questionOwners, questionRows !== null && pageRows !== null),
      step("予約が入った", uniq(bookingRows, "owner_id"), bookingRows !== null),
      step("ピンポイントリンクを発行", uniq(pinpointRows, "owner_id"), pinpointRows !== null),
      step("相手管理を記録", new Set([...uniq(noteRows, "owner_id"), ...uniq(logRows, "owner_id"), ...uniq(manualRows, "owner_id")]), noteRows !== null || logRows !== null),
    ];

    // ---- 予約 ----
    const bookingsByMonth = {};
    let cancelledAllTime = 0;
    for (const booking of bookingRows || []) {
      bump(bookingsByMonth, jstDay(booking.created_at).slice(0, 7));
      if (booking.status === "cancelled") cancelledAllTime += 1;
    }
    const bookingsInRange = (bookingRows || []).filter((booking) => booking.created_at >= sinceIso);
    const bookingsByDay = {};
    const bookingsByLocation = {};
    let cancelled = 0;
    for (const booking of bookingsInRange) {
      bump(bookingsByDay, jstDay(booking.created_at));
      bump(bookingsByLocation, booking.location_type || "unknown");
      if (booking.status === "cancelled") cancelled += 1;
    }

    // ---- 画面の利用状況（#342 の page_events。未適用なら available:false）----
    const usageAvailable = usageDaily !== null;
    const viewsByPage = {};
    const visitorsByPage = {};
    const viewsByDay = {};
    const visitorsByDay = {};
    for (const row of usageDaily || []) {
      bump(viewsByPage, row.page, Number(row.views) || 0);
      bump(visitorsByPage, row.page, Number(row.visitors) || 0);
      bump(viewsByDay, row.day, Number(row.views) || 0);
      bump(visitorsByDay, row.day, Number(row.visitors) || 0);
    }
    const topPages = Object.keys(viewsByPage)
      .map((page) => ({ page, views: viewsByPage[page], visitors: visitorsByPage[page] || 0 }))
      .sort((a, b) => b.views - a.views);

    // 画面 × プラン。どのプランの人がどの画面を使っているか＝機能をどのプランに置くかの判断材料。
    const planMatrix = {};
    for (const row of usageByPlan || []) {
      planMatrix[row.page] = planMatrix[row.page] || { page: row.page, guest: 0, free: 0, pro: 0, premium: 0, total: 0 };
      const cell = planMatrix[row.page];
      const views = Number(row.views) || 0;
      if (cell[row.plan] !== undefined) cell[row.plan] += views;
      cell.total += views;
    }
    const byPlanPages = Object.values(planMatrix).sort((a, b) => b.total - a.total).slice(0, 12);

    const sourceViews = {};
    const deviceViews = {};
    for (const row of usageSources || []) {
      bump(sourceViews, row.source, Number(row.views) || 0);
      bump(deviceViews, row.device || "unknown", Number(row.views) || 0);
    }
    const topSources = Object.keys(sourceViews)
      .map((source) => ({ source, views: sourceViews[source] }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 12);

    const pageViews = (name) => viewsByPage[name] || 0;
    const signupsInRange = owners.filter((owner) => owner.created_at >= sinceIso).length;
    // 獲得ファネル。閲覧数は page_events、登録数は owners の実数（計測が落ちても登録数だけは正しい）。
    const acquisitionFunnel = [
      { label: "LP（トップ）閲覧", value: pageViews("/index.html") + pageViews("/landing3.html") },
      { label: "料金ページ閲覧", value: pageViews("/plan.html") },
      { label: "登録画面を開いた", value: pageViews("/signup.html") },
      { label: "登録完了", value: signupsInRange },
    ];
    // ゲスト側ファネル。予約ページを見た人のうち何割が予約まで行ったか＝ゲスト体験の詰まりどころ。
    const bookingFunnel = [
      { label: "予約ページ閲覧", value: pageViews("/b/:slug") + pageViews("/p/:token") },
      { label: "予約完了", value: bookingsInRange.length },
    ];

    return json(200, {
      generated_at: now.toISOString(),
      range: { days, since: sinceIso, days_list: dayList },
      notes,
      accounts: {
        total: owners.length,
        active: activeOwners.length,
        disabled,
        pending_cat_key: pendingCatKey,
        email_verified: verified,
        email_verified_rate: rate(verified, owners.length),
        by_plan: planCount,
        paid: paidCount,
        paid_rate: rate(paidCount, owners.length),
        signups_in_range: signupsInRange,
        signups_daily: dayList.map((day) => ({ day, count: signupsByDay[day] || 0 })),
        signups_monthly: monthList.map((month) => ({ month, count: signupsByMonth[month] || 0 })),
      },
      revenue: {
        available: paymentRows !== null,
        paying_pro: payingPro,
        paying_premium: payingPremium,
        paying_total: payingPro + payingPremium,
        cat_key_paid: catKeyPaid,
        mrr_estimate: payingPro * PRICE.pro + payingPremium * PRICE.premium,
        price: PRICE,
        cancel_events: cancelEvents,
        cancel_events_in_range: cancelEventsInRange,
        days_to_paid: {
          samples: daysToPaid.length,
          p25: quantile(daysToPaid, 0.25),
          median: quantile(daysToPaid, 0.5),
          p75: quantile(daysToPaid, 0.75),
        },
      },
      conversion: { cohorts },
      activation: { denominator: activeOwners.length, steps: activation },
      bookings: {
        available: bookingRows !== null,
        in_range: bookingsInRange.length,
        cancelled,
        cancel_rate: rate(cancelled, bookingsInRange.length),
        total_all_time: (bookingRows || []).length,
        cancelled_all_time: cancelledAllTime,
        cancel_rate_all_time: rate(cancelledAllTime, (bookingRows || []).length),
        owners_with_booking: uniq(bookingRows, "owner_id").size,
        daily: dayList.map((day) => ({ day, count: bookingsByDay[day] || 0 })),
        monthly: monthList.map((month) => ({ month, count: bookingsByMonth[month] || 0 })),
        by_location: bookingsByLocation,
        pinpoint_links_in_range: (pinpointRows || []).filter((link) => link.created_at >= sinceIso).length,
        pinpoint_links_total: (pinpointRows || []).length,
      },
      ai: {
        available: aiRows !== null,
        month: jstDayKey(now).slice(0, 7),
        calls: (aiRows || []).length,
        owners: uniq(aiRows, "owner_id").size,
      },
      usage: {
        available: usageAvailable,
        top_pages: topPages.slice(0, 20),
        daily: dayList.map((day) => ({ day, views: viewsByDay[day] || 0, visitors: visitorsByDay[day] || 0 })),
        by_plan: byPlanPages,
        sources: topSources,
        devices: deviceViews,
        acquisition_funnel: acquisitionFunnel,
        booking_funnel: bookingFunnel,
      },
    });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
