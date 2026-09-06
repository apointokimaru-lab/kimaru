// Zoom webhook の受け口で行う 2 つの暗号処理と、RTMS イベントの取り出し。
//
// 出典（取得日 2026-09-05）: https://developers.zoom.us/docs/api/webhooks/
//   - URL 検証: `endpoint.url_validation` の `plainToken` を Secret Token で HMAC-SHA256（hex）し、
//     `{ plainToken, encryptedToken }` を 3 秒以内に 200 で返す
//   - 署名検証: `v0:<x-zm-request-timestamp>:<生のボディ>` を Secret Token で HMAC-SHA256（hex）し、
//     `v0=<hex>` が `x-zm-signature` と一致すること
// Zoom 自身のサンプル（github.com/zoom/rtms-samples library/javascript/webhookManager/zoomWebhookSignature.js）は
// timestamp を「秒」として扱い、許容ずれ 300 秒。ここも同じにする。

import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_TIMESTAMP_TOLERANCE_SEC = 300;

/** URL 検証の応答本文。Zoom はアプリ設定で endpoint URL を保存するときにこのチャレンジを送る */
export function urlValidationResponse(
  plainToken: string,
  secretToken: string,
): { plainToken: string; encryptedToken: string } {
  return {
    plainToken,
    encryptedToken: createHmac("sha256", secretToken).update(plainToken).digest("hex"),
  };
}

/** `x-zm-signature` の期待値。fake-zoom（送信側）と検証側で同じ関数を使う */
export function computeWebhookSignature(rawBody: Buffer | string, timestampSec: string, secretToken: string): string {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return `v0=${createHmac("sha256", secretToken).update(`v0:${timestampSec}:${body}`).digest("hex")}`;
}

export type VerifyFailure =
  | "missing_signature"
  | "missing_timestamp"
  | "invalid_timestamp"
  | "stale_timestamp"
  | "invalid_signature";

export type VerifyResult = { ok: true; ageSec: number } | { ok: false; reason: VerifyFailure };

export interface VerifyInput {
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: Buffer | string;
  secretToken: string;
  /** テスト用に現在時刻を差し替える（ミリ秒） */
  nowMs?: number;
  toleranceSec?: number;
}

/**
 * webhook 1 件の真正性を確かめる。
 *
 * なぜ timestamp の窓が要るか: 署名だけだと、過去に正しく届いた `rtms_started` を第三者が再送（リプレイ）して
 * こちらから Zoom のメディアサーバーへ接続させられる。timestamp を署名対象に含めたうえで「今から 300 秒以内」に
 * 絞ることで、盗んだ webhook を後から使えなくする。
 * なぜ timingSafeEqual か: 文字列比較で先頭から違いを探すと、一致した長さが応答時間に出る（タイミング攻撃）。
 */
export function verifyWebhookSignature(input: VerifyInput): VerifyResult {
  const { signature, timestamp, rawBody, secretToken } = input;
  if (!signature) return { ok: false, reason: "missing_signature" };
  if (!timestamp) return { ok: false, reason: "missing_timestamp" };

  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return { ok: false, reason: "invalid_timestamp" };

  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const ageSec = Math.abs(nowSec - tsSec);
  const tolerance = input.toleranceSec ?? DEFAULT_TIMESTAMP_TOLERANCE_SEC;
  if (ageSec > tolerance) return { ok: false, reason: "stale_timestamp" };

  const expected = Buffer.from(computeWebhookSignature(rawBody, timestamp, secretToken));
  const received = Buffer.from(String(signature));
  // 長さが違うと timingSafeEqual が例外を投げるので先に見る（長さの違い自体は秘密ではない）
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true, ageSec };
}

// ---- イベント本文 ----

export interface WebhookEnvelope {
  event: string;
  event_ts?: number;
  payload: Record<string, unknown>;
}

/** JSON を最低限の形（event 文字列 + payload オブジェクト）に絞る。外から来る値なので型を信用しない */
export function parseWebhookEnvelope(json: unknown): WebhookEnvelope | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  if (typeof o["event"] !== "string") return null;
  const payload = o["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  return {
    event: o["event"],
    event_ts: typeof o["event_ts"] === "number" ? o["event_ts"] : undefined,
    payload: payload as Record<string, unknown>,
  };
}

export interface RtmsStartedInfo {
  meetingUuid: string;
  streamId: string;
  /** シグナリングサーバーの WebSocket URL（wss://...） */
  signalingUrl: string;
  meetingId?: string;
  accountId?: string;
  operatorId?: string;
  isOriginalHost?: boolean;
}

export interface RtmsStoppedInfo {
  meetingUuid: string;
  streamId: string;
  stopReason?: number;
}

/**
 * payload から RTMS 接続に必要な 3 つ（meeting_uuid / rtms_stream_id / server_urls）を取り出す。
 *
 * 公式の quickstart（/docs/rtms/meetings/quickstart-websockets/）のサンプルは `payload.meeting_uuid` と平らだが、
 * 同じ Zoom の rtms-samples/RTMS_CONNECTION_FLOW.md は `payload.object.meeting_uuid` と一段深い。
 * 実物がどちらで来ても動くよう、`payload.object` があればそれを、無ければ `payload` を見る。
 */
function pickObject(payload: Record<string, unknown>): Record<string, unknown> {
  const obj = payload["object"];
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : payload;
}

export function rtmsStartedFromPayload(payload: Record<string, unknown>): RtmsStartedInfo | null {
  const o = pickObject(payload);
  const meetingUuid = o["meeting_uuid"];
  const streamId = o["rtms_stream_id"];
  const serverUrls = o["server_urls"];
  if (typeof meetingUuid !== "string" || typeof streamId !== "string" || typeof serverUrls !== "string") return null;
  if (!/^wss?:\/\//.test(serverUrls)) return null;
  return {
    meetingUuid,
    streamId,
    signalingUrl: serverUrls,
    meetingId: o["meeting_id"] === undefined ? undefined : String(o["meeting_id"]),
    accountId: typeof o["account_id"] === "string" ? o["account_id"] : undefined,
    operatorId: typeof o["operator_id"] === "string" ? o["operator_id"] : undefined,
    isOriginalHost: typeof o["is_original_host"] === "boolean" ? o["is_original_host"] : undefined,
  };
}

export function rtmsStoppedFromPayload(payload: Record<string, unknown>): RtmsStoppedInfo | null {
  const o = pickObject(payload);
  const meetingUuid = o["meeting_uuid"];
  const streamId = o["rtms_stream_id"];
  if (typeof meetingUuid !== "string" || typeof streamId !== "string") return null;
  return {
    meetingUuid,
    streamId,
    stopReason: typeof o["stop_reason"] === "number" ? o["stop_reason"] : undefined,
  };
}
