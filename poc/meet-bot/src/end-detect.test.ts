// 終了検知の状態遷移を時刻を進めた入力で固定する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { EndDetector, type Signals } from "./end-detect.js";
import { classifyText } from "./selectors.js";

const T0 = Date.parse("2026-09-05T10:00:00Z");
const base: Omit<Signals, "nowMs"> = { participantCount: 2, text: "会議中", audioActive: true };
const make = () => new EndDetector({ startedAtMs: T0, maxSeconds: 4 * 3600, aloneSeconds: 300, inactivitySeconds: 1200 });

test("参加者 2 人・音あり → 続ける", () => {
  const d = make();
  assert.deepEqual(d.observe({ ...base, nowMs: T0 + 1000 }), { leave: false });
});

test("削除・終了・拒否の文言は即退出（日英）", () => {
  for (const [text, reason] of [
    ["通話から削除されました", "removed"],
    ["You've been removed from the meeting", "removed"],
    ["通話が終了しました", "meeting_ended"],
    ["The meeting has ended", "meeting_ended"],
    ["Your host ended the meeting", "meeting_ended"],
    ["参加できませんでした", "denied"],
    ["Someone in the call denied your request to join", "denied"],
    ["No one responded to your request to join the call", "denied"],
  ] as const) {
    const d = make();
    const r = d.observe({ ...base, text, nowMs: T0 + 1000 });
    assert.ok(r.leave, text);
    assert.equal(r.leave && r.reason, reason, text);
  }
});

test("Bot だけ（1 人）が aloneSeconds 未満なら続け、超えたら everyone_left", () => {
  const d = make();
  assert.deepEqual(d.observe({ ...base, participantCount: 1, nowMs: T0 }), { leave: false });
  assert.deepEqual(d.observe({ ...base, participantCount: 1, nowMs: T0 + 299_000 }), { leave: false });
  const r = d.observe({ ...base, participantCount: 1, nowMs: T0 + 300_000 });
  assert.ok(r.leave && r.reason === "everyone_left");
});

test("途中で相手が戻れば alone の計時はリセット", () => {
  const d = make();
  d.observe({ ...base, participantCount: 1, nowMs: T0 });
  d.observe({ ...base, participantCount: 2, nowMs: T0 + 200_000 });
  d.observe({ ...base, participantCount: 1, nowMs: T0 + 250_000 });
  assert.deepEqual(d.observe({ ...base, participantCount: 1, nowMs: T0 + 540_000 }), { leave: false });
  const r = d.observe({ ...base, participantCount: 1, nowMs: T0 + 550_000 });
  assert.ok(r.leave && r.reason === "everyone_left");
});

test("参加者 0 人も 1 人と同じ扱い（Bot が数えられていない DOM でも退出できる）", () => {
  const d = make();
  d.observe({ ...base, participantCount: 0, nowMs: T0 });
  const r = d.observe({ ...base, participantCount: 0, nowMs: T0 + 300_000 });
  assert.ok(r.leave && r.reason === "everyone_left");
});

test("参加者数が読めない: 音があれば続け、無音が inactivitySeconds 続いたら inactivity", () => {
  const d = make();
  assert.deepEqual(d.observe({ ...base, participantCount: null, audioActive: true, nowMs: T0 }), { leave: false });
  assert.deepEqual(d.observe({ ...base, participantCount: null, audioActive: false, nowMs: T0 + 10_000 }), { leave: false });
  assert.deepEqual(d.observe({ ...base, participantCount: null, audioActive: false, nowMs: T0 + 1_200_000 }), { leave: false });
  const r = d.observe({ ...base, participantCount: null, audioActive: false, nowMs: T0 + 1_210_000 });
  assert.ok(r.leave && r.reason === "inactivity");
});

test("参加者数が読めていれば、無音が長くても退出しない（会議中の沈黙は普通にある）", () => {
  const d = make();
  d.observe({ ...base, participantCount: 2, audioActive: false, nowMs: T0 });
  assert.deepEqual(d.observe({ ...base, participantCount: 2, audioActive: false, nowMs: T0 + 3_000_000 }), { leave: false });
});

test("安全タイムアウトは会議が続いていても退出", () => {
  const d = make();
  assert.deepEqual(d.observe({ ...base, nowMs: T0 + 4 * 3600 * 1000 - 1000 }), { leave: false });
  const r = d.observe({ ...base, nowMs: T0 + 4 * 3600 * 1000 });
  assert.ok(r.leave && r.reason === "max_seconds");
});

test("classifyText: 待機・無効 URL・未ログインも分類でき、無関係な文は null", () => {
  assert.equal(classifyText("参加をリクエストしています…"), "waiting");
  assert.equal(classifyText("Asking to be let in..."), "waiting");
  assert.equal(classifyText("You'll join the call when someone lets you in"), "waiting");
  assert.equal(classifyText("Check your meeting code"), "invalid_url");
  assert.equal(classifyText("Sign in\nto continue to Google Meet"), "not_logged_in");
  assert.equal(classifyText("会議に参加しますか？\n今すぐ参加"), null);
  // 「参加をリクエスト」ボタンの文言だけでは待機とみなさない（押す前の画面）
  assert.equal(classifyText("参加をリクエスト"), null);
});
