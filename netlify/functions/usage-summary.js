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
const PRICE = { pro: 980, premium: 4800 };
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

// 未適用の列を select に混ぜると、その列だけでなく**クエリ全体**が失敗する（＝アカウントの数字が
// すべて空になる）。signup_source（#342）はまだ両DBに当たっていない可能性があるので、
// 落ちたら列を外して引き直す。プロジェクト方針の「列が無ければグレースフルに劣化」をここでも守る。
const OWNER_COLUMNS = "id,name,email,plan,created_at,invite_code,cat_key_disabled,cat_key_pending,email_verified";
async function fetchOwners() {
  const withSource = await rows(`owners?select=${OWNER_COLUMNS},signup_source&order=created_at.asc&limit=${ROW_CAP}`);
  if (withSource !== null) return withSource;
  return rows(`owners?select=${OWNER_COLUMNS}&order=created_at.asc&limit=${ROW_CAP}`);
}

// プロフィールは owners の列ではなく profiles 表の data(jsonb) に入る（`bio` に JSON 文字列で
// 入っている環境もある：profile.js のフォールバックと同じ形）。列の有無で全体が落ちないよう、
// 重い順に落として引き直す。
async function fetchProfiles() {
  const withData = await rows(`profiles?select=owner_id,data,bio&limit=${ROW_CAP}`);
  if (withData !== null) return withData;
  return rows(`profiles?select=owner_id,bio&limit=${ROW_CAP}`);
}

// 初期設定カード（#353）の「プロフィール設定ずみ」と同じ基準＝基本7項目がすべて埋まっていること。
// ここだけ違う数え方をすると、ユーザーの画面では完了なのに運営の画面では未完了、が起きる。
const PROFILE_REQUIRED = ["profile_name", "profile_title", "profile_strengths", "profile_style", "profile_offer", "profile_values", "profile_goal"];
function profileFilled(row) {
  let data = row && row.data && typeof row.data === "object" ? row.data : null;
  if (!data || !Object.keys(data).length) {
    try { data = JSON.parse((row && row.bio) || "{}"); } catch (_) { data = {}; }
  }
  if (!data || typeof data !== "object") return false;
  return PROFILE_REQUIRED.every((field) => String(data[field] || "").trim());
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

// サマリーの「画面のアクセス」で見る画面（#355）。全画面の合計ではなく、この4つに絞る。
//
// なぜ必要か: 合計はLPとゲストが見る予約ページが大半を占めるため、数字が増えても
// 「予約が入る前（検討）と入った後（準備）に、キマルの画面が実際に使われているか」が読めない。
// 何をしているか: 役目ごとにパスをまとめ、予約の前後（phase）で並べる。1グループが複数の
// パスを持つのは、同じ役目の画面が分かれているため（トップは旧LPの landing3、事前の情報確認は
// 相手の詳細とアンケート回答の2画面）。パスは _lib/analytics.js の normalizePath 後の形で書く。
const SUMMARY_PAGE_GROUPS = [
  { key: "top", label: "トップ", phase: "before", paths: ["/index.html", "/landing3.html"] },
  { key: "plan", label: "プラン比較", phase: "before", paths: ["/plan.html"] },
  { key: "contacts", label: "相手管理", phase: "after", paths: ["/contacts.html"] },
  { key: "prep", label: "事前の情報確認", phase: "after", paths: ["/meeting.html", "/answers.html"] },
];

exports.handler = async (event) => {
  try {
    requireOperator(event);

    const query = event.queryStringParameters || {};
    const days = Math.min(365, Math.max(7, Number(query.days) || 30));
    const now = new Date();
    const since = new Date(now.getTime() - days * 86400000);
    const sinceIso = since.toISOString();
    const sinceDay = jstDayKey(since);
    // 休眠は「30日動きが無い」で見るので、期間の選択に関わらず最低30日ぶんの足あとを引く
    // （7日を選んだだけで全員が休眠に見える、という読み違えを構造的に防ぐ）。
    const activitySinceIso = new Date(Math.min(since.getTime(), now.getTime() - 30 * 86400000)).toISOString();
    // サマリーは期間ボタンを隠している画面なので、アクセス数は選んだ期間ではなく「直近30日」で固定して出す
    // （7日を選んだ人と30日を選んだ人で、同じ「サマリー」の数字が変わると読み違える）。前30日と比べる
    // ぶんも要るので、画面の計測は最低60日ぶん引いてから、期間ぶんに絞り直して集計する。
    const usageSinceDay = jstDayKey(new Date(Math.min(since.getTime(), now.getTime() - 60 * 86400000)));
    const day30 = jstDayKey(new Date(now.getTime() - 29 * 86400000)); // 当日を含めて30日
    const day60 = jstDayKey(new Date(now.getTime() - 59 * 86400000));
    const monthStart = `${jstDayKey(now).slice(0, 7)}-01T00:00:00+09:00`; // AIアシストの当月集計はJST月で数える（上限判定と同じ切り方）
    const notes = [];

    const [
      ownerRows, paymentRows, bookingRows, pageRows, availabilityRows, googleRows, zoomRows,
      questionRows, aiRows, pinpointRows, noteRows, logRows, manualRows, profileRows,
      usageDaily, usageByPlan, usageSources, ownerActivity, limitHitRows,
    ] = await Promise.all([
      fetchOwners(),
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
      fetchProfiles(),
      rows(`page_events_daily?select=day,page,views,visitors&day=gte.${usageSinceDay}&limit=${ROW_CAP}`),
      rows(`page_events_by_plan?select=day,page,plan,views&day=gte.${sinceDay}&limit=${ROW_CAP}`),
      rows(`page_events_sources?select=day,source,device,views&day=gte.${sinceDay}&limit=${ROW_CAP}`),
      // ログイン中の足あと。WAH（週次アクティブ）と休眠の判定に使う。owner_id が付く行だけで足りる。
      rows(`page_events?select=owner_id,created_at&event=eq.page_view&owner_id=not.is.null&created_at=gte.${encodeURIComponent(activitySinceIso)}&limit=${ROW_CAP}`),
      rows(`plan_limit_hits_daily?select=day,feature,plan,hits,owners&day=gte.${sinceDay}&limit=${ROW_CAP}`),
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
    // 「有料」は2つの意味を持つ（有料プランの機能を使っている人 ／ 売上になっている人）。
    // 混ぜると、Cat Key の無償Proが18件あるだけで「有料転換率41.7%」に見えて売上が立っているように
    // 読めてしまう（#349）。プランごとに 課金 / Cat Key（無償）/ その他（無償・運営付与）へ割る。
    const PAID_PLANS = ["pro", "premium"];
    const planSource = { pro: { paying: 0, cat_key: 0, other: 0 }, premium: { paying: 0, cat_key: 0, other: 0 } };
    for (const owner of owners) {
      if (!PAID_PLANS.includes(owner.plan)) continue;
      const bucket = firstGrantAt.has(owner.id) ? "paying" : (owner.invite_code ? "cat_key" : "other");
      planSource[owner.plan][bucket] += 1;
    }
    const catKeyPaidCount = planSource.pro.cat_key + planSource.premium.cat_key;
    const grantedOtherCount = planSource.pro.other + planSource.premium.other;

    const paying = owners.filter((owner) => firstGrantAt.has(owner.id) && PAID_PLANS.includes(owner.plan));
    const payingPro = paying.filter((owner) => owner.plan === "pro").length;
    const payingPremium = paying.filter((owner) => owner.plan === "premium").length;
    // Cat Key の無償Pro＝売上にはならない有料会員（上の planSource から取る。同じ判定を2か所に置かない）。
    const catKeyPaid = catKeyPaidCount;

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
    // 以降の「立ち上がり」「機能の採用率」でも同じ集合を使う（数え方をそろえる）。
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

    // ---- 北極星: 今月「日程が決まった」数（#343・2026-08-26 決定）----
    // キマルが売っているのは日程が決まること。登録数は無料で溜まるだけ、MRRは結果が遅れて出る。
    // 予約数と「決まったアカウント数」を必ず並べるのは、片方だけだと嘘をつくため
    // （予約数だけなら1人のヘビーユーザーで伸びて見え、人数だけなら1回試して終わった人が混ざる）。
    const confirmedByMonth = {};
    const ownersByMonth = {};
    for (const booking of bookingRows || []) {
      if (booking.status === "cancelled") continue; // キャンセルは「決まった」ではない
      const month = jstDay(booking.created_at).slice(0, 7);
      bump(confirmedByMonth, month);
      (ownersByMonth[month] = ownersByMonth[month] || new Set()).add(booking.owner_id);
    }
    const thisMonth = jstDayKey(now).slice(0, 7);
    const prevMonth = monthList[monthList.length - 2] || "";

    // ---- 立ち上がり: 最初の1件までの日数と、止まっている人 ----
    const firstBookingAt = new Map();
    const bookingCountByOwner = {};
    for (const booking of bookingRows || []) {
      if (!booking.owner_id) continue;
      bump(bookingCountByOwner, booking.owner_id);
      const at = booking.created_at;
      if (!firstBookingAt.has(booking.owner_id) || at < firstBookingAt.get(booking.owner_id)) firstBookingAt.set(booking.owner_id, at);
    }
    const daysToFirst = [];
    for (const owner of owners) {
      const at = firstBookingAt.get(owner.id);
      if (!at) continue;
      const diff = (new Date(at).getTime() - new Date(owner.created_at).getTime()) / 86400000;
      if (Number.isFinite(diff) && diff >= 0) daysToFirst.push(diff);
    }
    daysToFirst.sort((a, b) => a - b);

    const pageOwners = uniq(pageRows, "owner_id");
    const availabilityOwners = uniq(availabilityRows, "owner_id");
    const googleOwners = uniq(googleRows, "owner_id");
    // 予約が1件も無いアカウントを「どこで止まったか」別に出す。数字ではなく名簿で出すのは、
    // この規模なら運営が直接声をかけられるため（見て終わりの指標にしない）。
    const stuck = activeOwners
      .filter((owner) => !firstBookingAt.has(owner.id))
      .map((owner) => ({
        id: owner.id,
        name: owner.name || "",
        email: owner.email || "",
        created_at: owner.created_at,
        plan: owner.plan,
        step: !pageOwners.has(owner.id) ? "no_page"
          : !availabilityOwners.has(owner.id) ? "no_availability"
          : !googleOwners.has(owner.id) ? "no_calendar"
          : "no_booking",
      }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    // ---- 初期設定の完了状況（#355）----
    // なぜ必要か: 「登録はしたが受付を始められていない人が何人いるか」が運営の全体像に出ていなかった
    // （止まっている人の名簿はあるが、件数として並べる場所が無かった）。
    // 何をしているか: ダッシュボードの初期設定カード（#353）とまったく同じ3ステップで数える。
    // ユーザーの画面では完了なのに運営の画面では未完了、という食い違いを作らないため、判定条件は
    // 増やさない（受付時間の設定はカードに無いので、ここでも見ない）。
    const profileDoneOwners = new Set((profileRows || []).filter(profileFilled).map((row) => row.owner_id).filter(Boolean));
    const setupSteps = [
      { key: "calendar", label: "Googleカレンダー", done: googleOwners, available: googleRows !== null },
      { key: "profile", label: "プロフィール", done: profileDoneOwners, available: profileRows !== null },
      { key: "page", label: "予約ページ", done: pageOwners, available: pageRows !== null },
    ];
    const setupAvailable = setupSteps.every((step) => step.available);
    // 取れなかった項目を「未完了」として数えると、実際より未完了が多く見える。3つとも取れたときだけ数える。
    const setupDoneCounts = [0, 0, 0, 0]; // 添字＝終わっている段の数（0〜3）
    if (setupAvailable) {
      for (const owner of activeOwners) {
        setupDoneCounts[setupSteps.filter((step) => step.done.has(owner.id)).length] += 1;
      }
    }
    const setup = {
      available: setupAvailable,
      denominator: activeOwners.length,
      done: setupAvailable ? setupDoneCounts[3] : null,
      incomplete: setupAvailable ? activeOwners.length - setupDoneCounts[3] : null,
      done_rate: setupAvailable ? rate(setupDoneCounts[3], activeOwners.length) : null,
      // 「あと何段」の分布。1人が複数の段に足りていないことがあるので、下の steps とは合計が一致しない。
      distribution: setupAvailable
        ? [
            { key: "done", label: "3つとも完了", count: setupDoneCounts[3] },
            { key: "one_left", label: "あと1つ", count: setupDoneCounts[2] },
            { key: "two_left", label: "あと2つ", count: setupDoneCounts[1] },
            { key: "none", label: "未着手", count: setupDoneCounts[0] },
          ]
        : [],
      // 段ごとの「終わっていない人数」。どの段でいちばん止まっているか＝案内や画面を直す場所。
      steps: setupSteps.map((step) => ({
        key: step.key,
        label: step.label,
        available: step.available,
        pending: step.available ? activeOwners.filter((owner) => !step.done.has(owner.id)).length : null,
      })),
    };

    // ---- 継続: 週次アクティブ・休眠・2回目率 ----
    // 「その週に管理画面を開いた or 予約が入った」人。#342 を適用した日より前は足あとが無いので、
    // 計測開始前の週は 0 に見える（画面側でその旨を出す）。
    const weekKey = (value) => {
      const date = new Date(new Date(value).getTime() + 9 * 3600 * 1000); // JST
      const day = date.getUTCDay();
      const monday = new Date(date.getTime() - ((day + 6) % 7) * 86400000);
      return monday.toISOString().slice(0, 10);
    };
    const activeByWeek = {};
    const lastSeenAt = new Map();
    const touch = (ownerId, at) => {
      if (!ownerId || !at) return;
      (activeByWeek[weekKey(at)] = activeByWeek[weekKey(at)] || new Set()).add(ownerId);
      if (!lastSeenAt.has(ownerId) || at > lastSeenAt.get(ownerId)) lastSeenAt.set(ownerId, at);
    };
    for (const row of ownerActivity || []) touch(row.owner_id, row.created_at);
    for (const booking of bookingRows || []) if (booking.created_at >= activitySinceIso) touch(booking.owner_id, booking.created_at);
    const weekList = [...new Set(dayList.map(weekKey))];
    const dormantCutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
    // 足あと（page_events）が無い環境で休眠を数えると、全員が休眠に見える。
    // 「0件」ではなく「まだ出せない」として返し、画面で計測待ちと出す。
    const dormant = ownerActivity === null ? [] : activeOwners
      .filter((owner) => (lastSeenAt.get(owner.id) || "") < dormantCutoff && owner.created_at < dormantCutoff)
      .map((owner) => ({ id: owner.id, name: owner.name || "", email: owner.email || "", plan: owner.plan, last_seen: lastSeenAt.get(owner.id) || null }));
    const withBooking = Object.keys(bookingCountByOwner).length;
    const withRepeat = Object.values(bookingCountByOwner).filter((count) => count >= 2).length;

    // ---- 流入元ごとの登録数（#342 の owners.signup_source）----
    const sourceSignups = {};
    let sourceKnown = 0;
    for (const owner of owners) {
      if (owner.created_at < sinceIso) continue;
      const source = String(owner.signup_source || "");
      if (source) sourceKnown += 1;
      bump(sourceSignups, source || "(不明)");
    }

    // ---- 有料の壁（#342 の limit_hit）----
    const hitsByFeature = {};
    for (const row of limitHitRows || []) {
      const key = `${row.feature}|${row.plan || ""}`;
      hitsByFeature[key] = hitsByFeature[key] || { feature: row.feature, plan: row.plan || "", hits: 0, owners: 0 };
      hitsByFeature[key].hits += Number(row.hits) || 0;
      // owners は日ごとの重複排除なので、期間で足すと延べになる（同じ人が別日に当たれば2）。
      hitsByFeature[key].owners += Number(row.owners) || 0;
    }
    const limitHits = Object.values(hitsByFeature).sort((a, b) => b.hits - a.hits);

    // ---- 機能ごとの採用率（稼働中アカウントのうち何割が使ったか）----
    const adoption = [
      { key: "google", label: "Googleカレンダー連携", owners: within(googleOwners), available: googleRows !== null },
      { key: "zoom", label: "Zoom連携", owners: within(uniq(zoomRows, "owner_id")), available: zoomRows !== null },
      { key: "question", label: "事前アンケート", owners: within(questionOwners), available: questionRows !== null },
      { key: "pinpoint", label: "ピンポイント日程調整", owners: within(uniq(pinpointRows, "owner_id")), available: pinpointRows !== null },
      { key: "ai", label: `AIアシスト（${jstDayKey(now).slice(0, 7)}）`, owners: within(uniq(aiRows, "owner_id")), available: aiRows !== null },
      { key: "manual_contact", label: "相手の手動追加", owners: within(uniq(manualRows, "owner_id")), available: manualRows !== null },
      { key: "note", label: "会話記録", owners: within(uniq(noteRows, "owner_id")), available: noteRows !== null },
    ].map((row) => ({ ...row, rate: row.available ? rate(row.owners, activeOwners.length) : null }))
      .sort((a, b) => (b.owners || 0) - (a.owners || 0));

    // ---- 画面の利用状況（#342 の page_events。未適用なら available:false）----
    const usageAvailable = usageDaily !== null;
    const viewsByPage = {};
    const visitorsByPage = {};
    const viewsByDay = {};
    const visitorsByDay = {};
    // サマリー用（期間ボタンと無関係の直近30日）と、その前30日
    const recent = { views: 0, visitors: 0 };
    const previous = { views: 0, visitors: 0 };
    // サマリーで絞る4画面（SUMMARY_PAGE_GROUPS）は画面ごとの数が要るので、日ごとではなく画面ごとに足す。
    const recentViewsByPage = {};
    const recentVisitorsByPage = {};
    const prevViewsByPage = {};
    for (const row of usageDaily || []) {
      const views = Number(row.views) || 0;
      const visitors = Number(row.visitors) || 0;
      if (row.day >= day30) {
        recent.views += views;
        recent.visitors += visitors;
        bump(recentViewsByPage, row.page, views);
        bump(recentVisitorsByPage, row.page, visitors);
      } else if (row.day >= day60) {
        previous.views += views;
        previous.visitors += visitors;
        bump(prevViewsByPage, row.page, views);
      }
      // ここから下は「選んだ期間」の集計。60日ぶん引いているので、期間外の行は落とす。
      if (row.day < sinceDay) continue;
      bump(viewsByPage, row.page, views);
      bump(visitorsByPage, row.page, visitors);
      bump(viewsByDay, row.day, views);
      bump(visitorsByDay, row.day, visitors);
    }
    // 4画面ぶんに畳む。訪問者数は page_events_daily の画面別UUなので、グループ内で足すと
    // 同じ人を二重に数えるが、ここは「その画面が見られているか」を見る数字なので延べで足す
    // （合計を全体のUUとして使わないよう、画面側にも「延べ」と書く）。
    const sumPaths = (map, paths) => paths.reduce((total, path) => total + (map[path] || 0), 0);
    const summaryPages = SUMMARY_PAGE_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      phase: group.phase,
      paths: group.paths,
      views: sumPaths(recentViewsByPage, group.paths),
      visitors: sumPaths(recentVisitorsByPage, group.paths),
      prev_views: sumPaths(prevViewsByPage, group.paths),
    }));
    const focus = summaryPages.reduce((acc, group) => ({
      views: acc.views + group.views,
      visitors: acc.visitors + group.visitors,
      prev_views: acc.prev_views + group.prev_views,
    }), { views: 0, visitors: 0, prev_views: 0 });

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
      // 新LP（/lp.html・#364）もLPの閲覧として数える。ここに足さないと、新LPを見て登録した人が
      // 分母のいない転換率になり、LPの合否（閲覧→登録）が測れない。
      { label: "LP（トップ）閲覧", value: pageViews("/index.html") + pageViews("/landing3.html") + pageViews("/lp.html") },
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
      // 北極星（#343）。期間の指定に関わらず「今月」を見る（月の途中でも前月と並べれば勢いが分かる）。
      northstar: {
        month: thisMonth,
        bookings: confirmedByMonth[thisMonth] || 0,
        owners: (ownersByMonth[thisMonth] || new Set()).size,
        prev_month: prevMonth,
        prev_bookings: confirmedByMonth[prevMonth] || 0,
        prev_owners: (ownersByMonth[prevMonth] || new Set()).size,
        monthly: monthList.map((month) => ({ month, count: confirmedByMonth[month] || 0, owners: (ownersByMonth[month] || new Set()).size })),
      },
      accounts: {
        total: owners.length,
        active: activeOwners.length,
        disabled,
        pending_cat_key: pendingCatKey,
        email_verified: verified,
        email_verified_rate: rate(verified, owners.length),
        by_plan: planCount,
        // プランベース（有料機能を使えている人）
        paid: paidCount,
        paid_rate: rate(paidCount, owners.length),
        // 売上ベース（実際に払っている人）。この2つを別の行にしないと、無償のCat Keyが
        // 「転換した」ように見えて価格判断を誤る（#349）。
        paying: paying.length,
        paying_rate: rate(paying.length, owners.length),
        by_plan_source: planSource,
        cat_key_paid: catKeyPaidCount,
        granted_other: grantedOtherCount,
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
        granted_other: grantedOtherCount,
        by_plan_source: planSource,
        mrr_estimate: payingPro * PRICE.pro + payingPremium * PRICE.premium,
        price: PRICE,
        cancel_events: cancelEvents,
        cancel_events_in_range: cancelEventsInRange,
        // 有料の壁（#342）。無料/Proがどの上限に、何回・何人ぶつかったか。価格とプラン境界の一次資料。
        limit_hits: limitHits,
        limit_hits_available: limitHitRows !== null,
        days_to_paid: {
          samples: daysToPaid.length,
          p25: quantile(daysToPaid, 0.25),
          median: quantile(daysToPaid, 0.5),
          p75: quantile(daysToPaid, 0.75),
        },
      },
      conversion: { cohorts },
      setup,
      acquisition: {
        // 流入元は #342 で入れた owners.signup_source。入れる前に登録した人は「(不明)」に落ちる。
        sources: Object.keys(sourceSignups).map((source) => ({ source, count: sourceSignups[source] })).sort((a, b) => b.count - a.count),
        source_known: sourceKnown,
      },
      activation: {
        denominator: activeOwners.length,
        steps: activation,
        time_to_first_booking: {
          samples: daysToFirst.length,
          p25: quantile(daysToFirst, 0.25),
          median: quantile(daysToFirst, 0.5),
          p75: quantile(daysToFirst, 0.75),
        },
        stuck_total: stuck.length,
        stuck: stuck.slice(0, 50), // 名簿は50件まで（それ以上は画面で扱えない）
      },
      retention: {
        available: ownerActivity !== null,
        weekly_active: weekList.map((week) => ({ week, count: (activeByWeek[week] || new Set()).size })),
        dormant_total: ownerActivity === null ? null : dormant.length,
        dormant: dormant.slice(0, 50),
        owners_with_booking: withBooking,
        owners_with_repeat: withRepeat,
        repeat_rate: rate(withRepeat, withBooking),
      },
      features: { denominator: activeOwners.length, adoption },
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
        // サマリー専用（期間ボタンを隠している画面なので、期間の選択に関わらず直近30日で固定）。
        // 主役は絞った4画面（focus_*）で、全画面の合計（all_*）は「4画面だけを見ている」と分かるための添え物。
        summary: {
          days: 30,
          focus_views: focus.views,
          focus_visitors: focus.visitors,
          focus_prev_views: focus.prev_views,
          pages: summaryPages,
          all_views: recent.views,
          all_visitors: recent.visitors,
        },
      },
    });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : "サーバーでエラーが発生しました。時間をおいて再度お試しください。" });
  }
};
