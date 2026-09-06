// RTMS の WebSocket プロトコル（定数・署名・メッセージの組み立て）。ネットワークに触らない純粋な部分。
//
// 出典（取得日 2026-09-05）:
//   - メッセージ一覧・JSON の形: https://developers.zoom.us/docs/rtms/event-reference/
//   - 数値の定義: https://developers.zoom.us/docs/rtms/data-types/
//   - 署名の式: https://github.com/zoom/rtms（index.ts generateSignature）と
//     https://github.com/zoom/rtms-samples（RTMS_CONNECTION_FLOW.md）
//       message = `${client_id},${meeting_uuid},${rtms_stream_id}`、key = client_secret、HMAC-SHA256 hex
//
// enum を使わないのはリポジトリの規約（as const のオブジェクトで書く）。

import { createHmac } from "node:crypto";

/** msg_type（RTMS_MESSAGE_TYPE）。この PoC が扱うものだけ */
export const MSG = {
  SIGNALING_HAND_SHAKE_REQ: 1,
  SIGNALING_HAND_SHAKE_RESP: 2,
  DATA_HAND_SHAKE_REQ: 3,
  DATA_HAND_SHAKE_RESP: 4,
  EVENT_SUBSCRIPTION: 5,
  EVENT_UPDATE: 6,
  CLIENT_READY_ACK: 7,
  STREAM_STATE_UPDATE: 8,
  SESSION_STATE_UPDATE: 9,
  KEEP_ALIVE_REQ: 12,
  KEEP_ALIVE_RESP: 13,
  MEDIA_DATA_AUDIO: 14,
  MEDIA_DATA_VIDEO: 15,
  MEDIA_DATA_SHARE: 16,
  MEDIA_DATA_TRANSCRIPT: 17,
  MEDIA_DATA_CHAT: 18,
  STREAM_CLOSE_REQ: 21,
  STREAM_CLOSE_RESP: 22,
} as const;

/** media_type（MEDIA_DATA_TYPE）。ビットマスク。32 で全部 */
export const MEDIA_TYPE = { AUDIO: 1, VIDEO: 2, DESKSHARE: 4, TRANSCRIPT: 8, CHAT: 16, ALL: 32 } as const;

export const AUDIO = {
  /** MEDIA_CONTENT_TYPE.RAW_AUDIO */
  CONTENT_TYPE_RAW_AUDIO: 2,
  /** AUDIO_SAMPLE_RATE */
  SAMPLE_RATE: { SR_8K: 0, SR_16K: 1, SR_32K: 2, SR_48K: 3 },
  /** AUDIO_CHANNEL */
  CHANNEL: { MONO: 1, STEREO: 2 },
  /** MEDIA_PAYLOAD_TYPE（音声） */
  CODEC: { L16: 1, G711: 2, G722: 3, OPUS: 4 },
  /** MEDIA_DATA_OPTION（音声） */
  DATA_OPT: { AUDIO_MIXED_STREAM: 1, AUDIO_MULTI_STREAMS: 2 },
} as const;

/** RTMS_STREAM_STATE */
export const STREAM_STATE = {
  INACTIVE: 0,
  ACTIVE: 1,
  INTERRUPTED: 2,
  TERMINATING: 3,
  TERMINATED: 4,
  PAUSED: 5,
  RESUMED: 6,
} as const;

/** RTMS_SESSION_STATE */
export const SESSION_STATE = { INACTIVE: 0, INITIALIZE: 1, STARTED: 2, PAUSED: 3, RESUMED: 4, STOPPED: 5 } as const;

/** RTMS_STATUS_CODE（ハンドシェイク応答の status_code）。0 だけが成功 */
export const STATUS_OK = 0;
const STATUS_NAMES: Record<number, string> = {
  0: "OK",
  1: "INVALID_MESSAGE_TYPE",
  2: "INVALID_RTMS_STREAM_ID",
  3: "INVALID_SIGNATURE",
  4: "INVALID_PAYLOAD",
  5: "INVALID_EVENTS",
  6: "INVALID_EVENT_TYPE",
  7: "INVALID_MEDIA_TYPE",
};

/** RTMS_STOP_REASON（webhook の stop_reason・STREAM_STATE_UPDATE の reason）。Zoom の rtms-mock-server-sample の定義から */
const STOP_REASON_NAMES: Record<number, string> = {
  0: "UNDEFINED",
  1: "HOST_TRIGGERED",
  2: "USER_TRIGGERED",
  3: "USER_LEFT",
  4: "USER_EJECTED",
  5: "APP_DISABLED_BY_HOST",
  6: "MEETING_ENDED",
  7: "STREAM_CANCELED",
  8: "STREAM_REVOKED",
  9: "ALL_APPS_DISABLED",
  10: "INTERNAL_EXCEPTION",
  11: "CONNECTION_TIMEOUT",
  12: "MEETING_CONNECTION_INTERRUPTED",
  13: "SIGNAL_CONNECTION_INTERRUPTED",
  14: "DATA_CONNECTION_INTERRUPTED",
  15: "SIGNAL_CONNECTION_CLOSED_ABNORMALLY",
  16: "DATA_CONNECTION_CLOSED_ABNORMALLY",
  17: "EXIT_SIGNAL",
  18: "AUTHENTICATION_FAILURE",
};

export function statusName(code: unknown): string {
  return typeof code === "number" ? (STATUS_NAMES[code] ?? `STATUS_${code}`) : "STATUS_UNKNOWN";
}

export function stopReasonName(code: unknown): string {
  return typeof code === "number" ? (STOP_REASON_NAMES[code] ?? `REASON_${code}`) : "REASON_UNKNOWN";
}

export function streamStateName(state: unknown): string {
  const found = Object.entries(STREAM_STATE).find(([, v]) => v === state);
  return found ? found[0] : `STATE_${String(state)}`;
}

// ---- 署名 ----

export interface HandshakeSignatureInput {
  clientId: string;
  clientSecret: string;
  meetingUuid: string;
  streamId: string;
}

/**
 * シグナリング／メディア両方のハンドシェイクに載せる署名。
 * 「Client ID, meeting_uuid, rtms_stream_id」をカンマ区切り（空白なし）で並べ、Client Secret を鍵に HMAC-SHA256、hex。
 * 順序と区切りを変えると STATUS_INVALID_SIGNATURE(3) で弾かれる。
 */
export function handshakeSignature({ clientId, clientSecret, meetingUuid, streamId }: HandshakeSignatureInput): string {
  if (!clientId || !clientSecret) throw new Error("clientId / clientSecret が空");
  return createHmac("sha256", clientSecret).update(`${clientId},${meetingUuid},${streamId}`).digest("hex");
}

// ---- メッセージの組み立て ----

export interface AudioParams {
  content_type: number;
  sample_rate: number;
  channel: number;
  codec: number;
  data_opt: number;
  /** 1 メッセージに載せる音声の長さ（ms）。20 の倍数・最大 1000 */
  send_rate: number;
}

/**
 * この PoC が要求する音声形式: 16 kHz・モノラル・L16（16-bit リニア PCM）・全員ミックス・100 ms ごと。
 *
 * なぜ 16 kHz mono か: 文字起こし（faster-whisper）の入力が 16 kHz mono なので、受け取った PCM をそのまま WAV に
 * 包めば変換なしで渡せる（SDK の既定は 48 kHz ステレオで、渡す前にリサンプルが要る）。
 * なぜ MIXED か: まず「会議の音声がキマル側に届いて文字になる」ことを見る PoC で、話者別（MULTI_STREAMS）は次の段。
 * 100 ms × 16000 Hz × 2 byte = 1 メッセージ 3200 byte。
 */
export const DEFAULT_AUDIO_PARAMS: AudioParams = {
  content_type: AUDIO.CONTENT_TYPE_RAW_AUDIO,
  sample_rate: AUDIO.SAMPLE_RATE.SR_16K,
  channel: AUDIO.CHANNEL.MONO,
  codec: AUDIO.CODEC.L16,
  data_opt: AUDIO.DATA_OPT.AUDIO_MIXED_STREAM,
  send_rate: 100,
};

export function sampleRateHz(code: number): number {
  return [8000, 16000, 32000, 48000][code] ?? 16000;
}

export interface SignalingHandshakeInput extends HandshakeSignatureInput {
  sequence?: number;
  /** false にすると webhook 受信〜接続完了までの音声を捨てる。既定 true（Zoom 側の既定と同じ） */
  bufferData?: boolean;
}

/** SIGNALING_HAND_SHAKE_REQ（msg_type 1）。sequence は 1 から */
export function buildSignalingHandshake(input: SignalingHandshakeInput) {
  return {
    msg_type: MSG.SIGNALING_HAND_SHAKE_REQ,
    protocol_version: 1,
    sequence: input.sequence ?? 1,
    meeting_uuid: input.meetingUuid,
    rtms_stream_id: input.streamId,
    signature: handshakeSignature(input),
    buffer_data: input.bufferData ?? true,
  };
}

export interface MediaHandshakeInput extends HandshakeSignatureInput {
  sequence?: number;
  audio?: AudioParams;
}

/** DATA_HAND_SHAKE_REQ（msg_type 3）。音声だけ要求する（media_type 1） */
export function buildMediaHandshake(input: MediaHandshakeInput) {
  return {
    msg_type: MSG.DATA_HAND_SHAKE_REQ,
    protocol_version: 1,
    sequence: input.sequence ?? 1,
    meeting_uuid: input.meetingUuid,
    rtms_stream_id: input.streamId,
    signature: handshakeSignature(input),
    media_type: MEDIA_TYPE.AUDIO,
    media_params: { audio: input.audio ?? DEFAULT_AUDIO_PARAMS },
  };
}

/** CLIENT_READY_ACK（msg_type 7）。メディアのハンドシェイクが通った後、シグナリング側へ送る */
export function buildClientReadyAck(streamId: string) {
  return { msg_type: MSG.CLIENT_READY_ACK, rtms_stream_id: streamId };
}

/** KEEP_ALIVE_RESP（msg_type 13）。要求の timestamp をそのまま返す（違う値だと生存確認にならない） */
export function buildKeepAliveResponse(timestamp: number) {
  return { msg_type: MSG.KEEP_ALIVE_RESP, timestamp };
}

// ---- 受信側の型 ----

export interface RtmsMessage {
  msg_type: number;
  [key: string]: unknown;
}

/** WebSocket の 1 フレームを RTMS メッセージとして読む。JSON でない・msg_type が無いものは null */
export function parseRtmsMessage(raw: unknown): RtmsMessage | null {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (Buffer.isBuffer(raw)) text = raw.toString("utf8");
  else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString("utf8");
  else if (Array.isArray(raw)) text = Buffer.concat(raw as Buffer[]).toString("utf8");
  else return null;
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== "object" || obj === null) return null;
    const m = obj as Record<string, unknown>;
    if (typeof m["msg_type"] !== "number") return null;
    return m as RtmsMessage;
  } catch {
    return null;
  }
}

/**
 * シグナリング応答の media_server.server_urls から音声用の URL を選ぶ。
 * 音声専用（audio）があればそれ、無ければ all。スコープに無いメディアの URL は返ってこない。
 */
export function pickAudioMediaUrl(serverUrls: unknown): string | undefined {
  if (typeof serverUrls !== "object" || serverUrls === null) return undefined;
  const u = serverUrls as Record<string, unknown>;
  for (const key of ["audio", "all"]) {
    const v = u[key];
    if (typeof v === "string" && /^wss?:\/\//.test(v)) return v;
  }
  return undefined;
}

/** MEDIA_DATA_AUDIO（msg_type 14）の content を PCM バッファに戻す */
export interface AudioPacket {
  pcm: Buffer;
  timestamp?: number;
  userId?: number;
  userName?: string;
}

export function decodeAudioPacket(msg: RtmsMessage): AudioPacket | null {
  const content = msg["content"];
  if (typeof content !== "object" || content === null) return null;
  const c = content as Record<string, unknown>;
  if (typeof c["data"] !== "string") return null;
  const pcm = Buffer.from(c["data"], "base64");
  // length は base64 前の長さ。食い違えば転送で壊れているので捨てる（無いサンプルもあるので任意）
  if (typeof c["length"] === "number" && c["length"] !== pcm.length) return null;
  return {
    pcm,
    timestamp: typeof c["timestamp"] === "number" ? c["timestamp"] : undefined,
    userId: typeof c["user_id"] === "number" ? c["user_id"] : undefined,
    userName: typeof c["user_name"] === "string" ? c["user_name"] : undefined,
  };
}
