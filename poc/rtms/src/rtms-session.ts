// RTMS の 1 ストリーム分の接続（シグナリング → メディア）を担う。
//
// 流れ（出典: https://developers.zoom.us/docs/rtms/event-reference/ と github.com/zoom/rtms-samples RTMS_CONNECTION_FLOW.md）
//   1. webhook の server_urls（シグナリング）へ WebSocket 接続 → SIGNALING_HAND_SHAKE_REQ(1) を送る
//   2. SIGNALING_HAND_SHAKE_RESP(2) status_code 0 で media_server.server_urls が返る
//   3. その audio（無ければ all）へ接続 → DATA_HAND_SHAKE_REQ(3) を送る（media_type 1・音声パラメータ）
//   4. DATA_HAND_SHAKE_RESP(4) status_code 0 → シグナリング側へ CLIENT_READY_ACK(7)
//   5. メディア側に MEDIA_DATA_AUDIO(14) が流れてくる（base64 の PCM）→ sink（WAV 書き込み）へ
//   - 両接続に 10 秒ごとに KEEP_ALIVE_REQ(12) が来る → 同じ接続へ KEEP_ALIVE_RESP(13)（timestamp をそのまま返す）
//     3 回無応答でサーバー側が切る。65 秒来なければ再ハンドシェイクが推奨（この PoC は終了扱い・再接続は次の段）
//   - STREAM_STATE_UPDATE(8) の TERMINATING/TERMINATED で終わり。webhook の rtms_stopped でも終わる
//
// WebSocket の実装は差し替え可能（wsFactory）にして、テストは Zoom に繋がずにハンドシェイクを通す。

import WebSocket from "ws";
import {
  MSG,
  STATUS_OK,
  STREAM_STATE,
  buildClientReadyAck,
  buildKeepAliveResponse,
  buildMediaHandshake,
  buildSignalingHandshake,
  decodeAudioPacket,
  parseRtmsMessage,
  pickAudioMediaUrl,
  sampleRateHz,
  statusName,
  stopReasonName,
  streamStateName,
  type AudioParams,
  type RtmsMessage,
} from "./rtms-protocol";

/** `ws` の WebSocket と同じ最小の面。テストではメモリ上の偽物を渡す */
export interface WebSocketLike {
  on(event: "open", cb: () => void): unknown;
  on(event: "message", cb: (data: unknown) => void): unknown;
  on(event: "close", cb: (code?: number, reason?: unknown) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

export type WsFactory = (url: string) => WebSocketLike;

/** 音声の受け口。WavChunkWriter がこれを満たす */
export interface AudioSink {
  write(pcm: Buffer, packetTs?: number): void;
  close(reason: string): unknown;
}

export interface SessionEndInfo {
  reason: string;
  audioPackets: number;
  audioBytes: number;
}

export interface RtmsSessionOptions {
  meetingUuid: string;
  streamId: string;
  signalingUrl: string;
  clientId: string;
  clientSecret: string;
  sink: AudioSink;
  wsFactory?: WsFactory;
  audioParams?: AudioParams;
  bufferData?: boolean;
  /** keep-alive が途絶えたと見なすまでの時間（ms）。Zoom の推奨は 65 秒 */
  keepAliveTimeoutMs?: number;
  log?: (message: string, data?: unknown) => void;
  onEnd?: (info: SessionEndInfo) => void;
  onError?: (err: Error) => void;
}

export type SessionState = "idle" | "signaling" | "media" | "streaming" | "ended";

const OPEN = 1;

export class RtmsSession {
  readonly meetingUuid: string;
  readonly streamId: string;
  state: SessionState = "idle";
  audioPackets = 0;
  audioBytes = 0;
  /** メディアサーバーが確定した音声パラメータ（DATA_HAND_SHAKE_RESP の media_params.audio） */
  confirmedAudio: Partial<AudioParams> | null = null;

  private readonly opts: RtmsSessionOptions;
  private readonly wsFactory: WsFactory;
  private signaling: WebSocketLike | null = null;
  private media: WebSocketLike | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private readonly log: (message: string, data?: unknown) => void;

  constructor(opts: RtmsSessionOptions) {
    this.opts = opts;
    this.meetingUuid = opts.meetingUuid;
    this.streamId = opts.streamId;
    this.wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.log = opts.log ?? (() => {});
  }

  start(): void {
    if (this.state !== "idle") return;
    this.state = "signaling";
    this.log("signaling: connecting", { url: this.opts.signalingUrl });
    const ws = this.wsFactory(this.opts.signalingUrl);
    this.signaling = ws;
    ws.on("open", () => {
      this.touch();
      const req = buildSignalingHandshake({
        clientId: this.opts.clientId,
        clientSecret: this.opts.clientSecret,
        meetingUuid: this.meetingUuid,
        streamId: this.streamId,
        sequence: 1,
        bufferData: this.opts.bufferData ?? true,
      });
      this.log("signaling: handshake →", { ...req, signature: "<hmac>" });
      ws.send(JSON.stringify(req));
    });
    ws.on("message", (data) => this.onSignalingMessage(ws, data));
    ws.on("close", (code, reason) => {
      this.log("signaling: closed", { code, reason: String(reason ?? "") });
      this.end(`signaling_closed:${code ?? ""}`);
    });
    ws.on("error", (err) => {
      this.opts.onError?.(err);
      this.end(`signaling_error:${err.message}`);
    });
  }

  /** webhook の rtms_stopped や Ctrl-C から呼ぶ */
  stop(reason: string): void {
    this.end(reason);
  }

  // ---- シグナリング ----

  private onSignalingMessage(ws: WebSocketLike, data: unknown): void {
    // 終了後に遅れて届いたフレームは捨てる（閉じた sink に書いたり、見張りを再武装したりしない）
    if (this.state === "ended") return;
    this.touch();
    const msg = parseRtmsMessage(data);
    if (!msg) {
      this.log("signaling: JSON でないフレームを無視");
      return;
    }
    switch (msg.msg_type) {
      case MSG.SIGNALING_HAND_SHAKE_RESP: {
        if (msg["status_code"] !== STATUS_OK) {
          this.end(`signaling_handshake_failed:${statusName(msg["status_code"])}:${String(msg["reason"] ?? "")}`);
          return;
        }
        const mediaServer = msg["media_server"] as Record<string, unknown> | undefined;
        const url = pickAudioMediaUrl(mediaServer?.["server_urls"]);
        if (!url) {
          this.end("signaling_handshake_ok_but_no_audio_url");
          return;
        }
        this.log("signaling: handshake OK", { mediaUrl: url });
        this.openMedia(url);
        return;
      }
      case MSG.KEEP_ALIVE_REQ:
        this.replyKeepAlive(ws, msg);
        return;
      case MSG.STREAM_STATE_UPDATE:
        this.onStreamState(msg);
        return;
      case MSG.SESSION_STATE_UPDATE:
        this.log("signaling: session state", { state: msg["state"], reason: msg["reason"], stop_reason: msg["stop_reason"] });
        return;
      case MSG.EVENT_UPDATE:
        this.log("signaling: event", { event_type: msg["event_type"] });
        return;
      default:
        this.log("signaling: 未対応の msg_type", { msg_type: msg.msg_type });
    }
  }

  // ---- メディア ----

  private openMedia(url: string): void {
    this.state = "media";
    const ws = this.wsFactory(url);
    this.media = ws;
    ws.on("open", () => {
      this.touch();
      const req = buildMediaHandshake({
        clientId: this.opts.clientId,
        clientSecret: this.opts.clientSecret,
        meetingUuid: this.meetingUuid,
        streamId: this.streamId,
        sequence: 1,
        audio: this.opts.audioParams,
      });
      this.log("media: handshake →", { ...req, signature: "<hmac>" });
      ws.send(JSON.stringify(req));
    });
    ws.on("message", (data) => this.onMediaMessage(ws, data));
    ws.on("close", (code, reason) => {
      this.log("media: closed", { code, reason: String(reason ?? "") });
      this.end(`media_closed:${code ?? ""}`);
    });
    ws.on("error", (err) => {
      this.opts.onError?.(err);
      this.end(`media_error:${err.message}`);
    });
  }

  private onMediaMessage(ws: WebSocketLike, data: unknown): void {
    if (this.state === "ended") return;
    this.touch();
    const msg = parseRtmsMessage(data);
    if (!msg) return;
    switch (msg.msg_type) {
      case MSG.DATA_HAND_SHAKE_RESP: {
        if (msg["status_code"] !== STATUS_OK) {
          this.end(`media_handshake_failed:${statusName(msg["status_code"])}:${String(msg["reason"] ?? "")}`);
          return;
        }
        const params = msg["media_params"] as Record<string, unknown> | undefined;
        const audio = params?.["audio"];
        if (typeof audio === "object" && audio !== null) {
          this.confirmedAudio = audio as Partial<AudioParams>;
          // 要求と違う形で確定されたら WAV ヘッダと合わなくなる。PoC では警告して続ける（sink の形は 16k mono 固定）
          const sr = this.confirmedAudio.sample_rate;
          if (typeof sr === "number" && sampleRateHz(sr) !== 16000) {
            this.log("media: 警告 サーバーが確定した sample_rate が 16 kHz でない", { confirmed: this.confirmedAudio });
          }
        }
        this.state = "streaming";
        // ACK はメディア側ではなくシグナリング側へ送る（送り先を間違えると音声が始まらない）
        this.signaling?.send(JSON.stringify(buildClientReadyAck(this.streamId)));
        this.log("media: handshake OK → CLIENT_READY_ACK を signaling へ", { confirmed: this.confirmedAudio });
        return;
      }
      case MSG.MEDIA_DATA_AUDIO: {
        const packet = decodeAudioPacket(msg);
        if (!packet) return;
        this.audioPackets += 1;
        this.audioBytes += packet.pcm.length;
        this.opts.sink.write(packet.pcm, packet.timestamp);
        return;
      }
      case MSG.KEEP_ALIVE_REQ:
        this.replyKeepAlive(ws, msg);
        return;
      case MSG.STREAM_STATE_UPDATE:
        this.onStreamState(msg);
        return;
      case MSG.SESSION_STATE_UPDATE:
        this.log("media: session state", { state: msg["state"], reason: msg["reason"] });
        return;
      default:
        this.log("media: 未対応の msg_type", { msg_type: msg.msg_type });
    }
  }

  // ---- 共通 ----

  private replyKeepAlive(ws: WebSocketLike, msg: RtmsMessage): void {
    const ts = msg["timestamp"];
    if (typeof ts !== "number") return;
    ws.send(JSON.stringify(buildKeepAliveResponse(ts)));
  }

  private onStreamState(msg: RtmsMessage): void {
    const state = msg["state"];
    const name = streamStateName(state);
    this.log("stream state", { state: name, reason: stopReasonName(msg["reason"]) });
    if (state === STREAM_STATE.TERMINATED || state === STREAM_STATE.TERMINATING) {
      this.end(`stream_${name}:${stopReasonName(msg["reason"])}`);
    }
  }

  /** 何か届くたびに見張りを延ばす。65 秒黙ったら keep-alive が途絶えたと見なす */
  private touch(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    const ms = this.opts.keepAliveTimeoutMs ?? 65_000;
    this.watchdog = setTimeout(() => this.end("keepalive_timeout"), ms);
    this.watchdog.unref?.();
  }

  private end(reason: string): void {
    if (this.state === "ended") return;
    this.state = "ended";
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    for (const ws of [this.media, this.signaling]) {
      try {
        if (ws && ws.readyState === OPEN) ws.close(1000, "done");
        else ws?.close();
      } catch {
        /* 既に閉じている */
      }
    }
    this.media = null;
    this.signaling = null;
    try {
      this.opts.sink.close(reason);
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
    this.log("session end", { reason, audioPackets: this.audioPackets, audioBytes: this.audioBytes });
    this.opts.onEnd?.({ reason, audioPackets: this.audioPackets, audioBytes: this.audioBytes });
  }
}
