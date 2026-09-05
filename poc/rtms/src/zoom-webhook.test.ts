// Zoom の資格情報なしで通る: URL 検証の応答・署名検証（正・偽・古い timestamp）・payload の読み取り。
// 期待値は Zoom の手順（v0:<ts>:<body> を Secret Token で HMAC-SHA256）を node の crypto で一度計算して埋め込んだ。
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  computeWebhookSignature,
  parseWebhookEnvelope,
  rtmsStartedFromPayload,
  rtmsStoppedFromPayload,
  urlValidationResponse,
  verifyWebhookSignature,
} from "./zoom-webhook";

const SECRET = "test-secret-token";
const BODY = '{"event":"meeting.rtms_started","payload":{"meeting_uuid":"abc","rtms_stream_id":"s1","server_urls":"wss://x"}}';
const TS = "1626230691"; // 秒
const NOW_MS = 1626230691_000;
const EXPECTED_SIG = "v0=644389c618308af6185eae41746d040b236d73a5f62e23a7fe05d477b911ed9e";

test("URL 検証: plainToken を Secret Token で HMAC-SHA256（hex）した encryptedToken を返す", () => {
  const r = urlValidationResponse("qgg8vlvZRS6UYooatFL8Aw", SECRET);
  assert.equal(r.plainToken, "qgg8vlvZRS6UYooatFL8Aw");
  assert.equal(r.encryptedToken, "9c8ad56737c19db2904b301c0781e86857e999f39f07727668cf62a5e7e298c8");
  // 独立に計算しても同じ
  assert.equal(r.encryptedToken, createHmac("sha256", SECRET).update("qgg8vlvZRS6UYooatFL8Aw").digest("hex"));
});

test("署名: v0:<timestamp>:<body> の HMAC に v0= を付けた値", () => {
  assert.equal(computeWebhookSignature(BODY, TS, SECRET), EXPECTED_SIG);
  assert.equal(computeWebhookSignature(Buffer.from(BODY), TS, SECRET), EXPECTED_SIG);
});

test("検証: 正しい署名・新しい timestamp は ok", () => {
  const r = verifyWebhookSignature({ signature: EXPECTED_SIG, timestamp: TS, rawBody: BODY, secretToken: SECRET, nowMs: NOW_MS + 30_000 });
  assert.deepEqual(r, { ok: true, ageSec: 30 });
});

test("検証: ボディが 1 文字違えば invalid_signature", () => {
  const r = verifyWebhookSignature({ signature: EXPECTED_SIG, timestamp: TS, rawBody: BODY.replace("abc", "abd"), secretToken: SECRET, nowMs: NOW_MS });
  assert.deepEqual(r, { ok: false, reason: "invalid_signature" });
});

test("検証: Secret Token が違えば invalid_signature", () => {
  const r = verifyWebhookSignature({ signature: EXPECTED_SIG, timestamp: TS, rawBody: BODY, secretToken: "other", nowMs: NOW_MS });
  assert.deepEqual(r, { ok: false, reason: "invalid_signature" });
});

test("検証: 長さの違う署名でも例外にならず invalid_signature", () => {
  const r = verifyWebhookSignature({ signature: "v0=short", timestamp: TS, rawBody: BODY, secretToken: SECRET, nowMs: NOW_MS });
  assert.deepEqual(r, { ok: false, reason: "invalid_signature" });
});

test("検証: timestamp が 300 秒より古い（リプレイ）は stale_timestamp。署名が正しくても弾く", () => {
  const r = verifyWebhookSignature({ signature: EXPECTED_SIG, timestamp: TS, rawBody: BODY, secretToken: SECRET, nowMs: NOW_MS + 301_000 });
  assert.deepEqual(r, { ok: false, reason: "stale_timestamp" });
  // 未来側も同じ（時計ずれの範囲を超えるもの）
  const f = verifyWebhookSignature({ signature: EXPECTED_SIG, timestamp: TS, rawBody: BODY, secretToken: SECRET, nowMs: NOW_MS - 400_000 });
  assert.deepEqual(f, { ok: false, reason: "stale_timestamp" });
  // 許容を広げれば通る
  const w = verifyWebhookSignature({ signature: EXPECTED_SIG, timestamp: TS, rawBody: BODY, secretToken: SECRET, nowMs: NOW_MS + 301_000, toleranceSec: 600 });
  assert.equal(w.ok, true);
});

test("検証: ヘッダ欠け・数値でない timestamp", () => {
  assert.deepEqual(verifyWebhookSignature({ signature: undefined, timestamp: TS, rawBody: BODY, secretToken: SECRET }), { ok: false, reason: "missing_signature" });
  assert.deepEqual(verifyWebhookSignature({ signature: EXPECTED_SIG, timestamp: undefined, rawBody: BODY, secretToken: SECRET }), { ok: false, reason: "missing_timestamp" });
  assert.deepEqual(verifyWebhookSignature({ signature: EXPECTED_SIG, timestamp: "abc", rawBody: BODY, secretToken: SECRET }), { ok: false, reason: "invalid_timestamp" });
});

test("envelope: event と payload が無ければ null", () => {
  assert.equal(parseWebhookEnvelope(null), null);
  assert.equal(parseWebhookEnvelope({ event: 1, payload: {} }), null);
  assert.equal(parseWebhookEnvelope({ event: "x" }), null);
  assert.deepEqual(parseWebhookEnvelope({ event: "x", event_ts: 5, payload: { a: 1 } }), { event: "x", event_ts: 5, payload: { a: 1 } });
});

test("rtms_started: quickstart の平らな payload と RTMS_CONNECTION_FLOW の payload.object の両方を読む", () => {
  const flat = {
    meeting_uuid: "TNhvT3WEBT6Srse3TgWRGr==",
    meeting_id: 81234567890,
    account_id: "B7Q4Y2M8X5L",
    operator_id: "P3Q8W2X9Y5",
    is_original_host: true,
    rtms_stream_id: "rtms_TN3WEBT6SrTgWRGr_001",
    server_urls: "wss://rtms-sjc.zoom.us/ws",
  };
  const expected = {
    meetingUuid: "TNhvT3WEBT6Srse3TgWRGr==",
    streamId: "rtms_TN3WEBT6SrTgWRGr_001",
    signalingUrl: "wss://rtms-sjc.zoom.us/ws",
    meetingId: "81234567890",
    accountId: "B7Q4Y2M8X5L",
    operatorId: "P3Q8W2X9Y5",
    isOriginalHost: true,
  };
  assert.deepEqual(rtmsStartedFromPayload(flat), expected);
  assert.deepEqual(rtmsStartedFromPayload({ account_id: "ignored", object: flat }), expected);
});

test("rtms_started: 3 点のどれかが欠ける・server_urls が ws でないなら null", () => {
  assert.equal(rtmsStartedFromPayload({ meeting_uuid: "a", rtms_stream_id: "b" }), null);
  assert.equal(rtmsStartedFromPayload({ meeting_uuid: "a", rtms_stream_id: "b", server_urls: "https://evil.example" }), null);
  assert.equal(rtmsStartedFromPayload({ meeting_uuid: 1, rtms_stream_id: "b", server_urls: "wss://x" }), null);
});

test("rtms_stopped: stop_reason を数値で持つ", () => {
  assert.deepEqual(rtmsStoppedFromPayload({ meeting_uuid: "a", rtms_stream_id: "b", stop_reason: 6 }), { meetingUuid: "a", streamId: "b", stopReason: 6 });
  assert.deepEqual(rtmsStoppedFromPayload({ meeting_uuid: "a", rtms_stream_id: "b" }), { meetingUuid: "a", streamId: "b", stopReason: undefined });
  assert.equal(rtmsStoppedFromPayload({ meeting_uuid: "a" }), null);
});
