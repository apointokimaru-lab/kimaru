// Zoom からの webhook を受ける小さな HTTP サーバー（フレームワーク無し・node:http）。
//
// 受けるもの:
//   POST <webhookPath>  … Zoom の Event Subscription。全リクエストの署名を検証してから中を見る
//     - endpoint.url_validation → { plainToken, encryptedToken } を返す（Zoom がアプリ設定保存時に送るチャレンジ）
//     - meeting.rtms_started    → onStarted（セッション開始）
//     - meeting.rtms_stopped    → onStopped（セッション終了）
//     - その他                  → 200 で無視（購読を増やしても壊れない）
//   GET /healthz        … トンネル越しに疎通を見るため
//
// Zoom は 3 秒以内に 200/204 を要求する（超えると再送）。接続の開始は非同期に始めて、即座に 200 を返す。

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  parseWebhookEnvelope,
  rtmsStartedFromPayload,
  rtmsStoppedFromPayload,
  urlValidationResponse,
  verifyWebhookSignature,
  type RtmsStartedInfo,
  type RtmsStoppedInfo,
} from "./zoom-webhook";

export interface WebhookServerOptions {
  webhookPath: string;
  secretToken: string;
  toleranceSec?: number;
  onStarted: (info: RtmsStartedInfo, raw: Record<string, unknown>) => void;
  onStopped: (info: RtmsStoppedInfo) => void;
  log?: (message: string, data?: unknown) => void;
  /** テスト用 */
  nowMs?: () => number;
  /** ボディの上限（webhook は数 KB。巨大な投げ込みで落ちないように） */
  maxBodyBytes?: number;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

export function createWebhookServer(opts: WebhookServerOptions): Server {
  const log = opts.log ?? (() => {});
  const limit = opts.maxBodyBytes ?? 1024 * 1024;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url.pathname !== opts.webhookPath) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const rawBody = await readBody(req, limit);
    if (rawBody === null) {
      sendJson(res, 413, { error: "body_too_large" });
      return;
    }

    // 署名の検証は JSON を読む前に、生のボディに対して行う（整形し直すと署名が合わなくなる）
    const verified = verifyWebhookSignature({
      signature: header(req, "x-zm-signature"),
      timestamp: header(req, "x-zm-request-timestamp"),
      rawBody,
      secretToken: opts.secretToken,
      toleranceSec: opts.toleranceSec,
      nowMs: opts.nowMs?.(),
    });
    if (!verified.ok) {
      log("webhook: 署名検証に失敗", { reason: verified.reason });
      sendJson(res, 401, { error: verified.reason });
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      sendJson(res, 400, { error: "invalid_json" });
      return;
    }
    const env = parseWebhookEnvelope(json);
    if (!env) {
      sendJson(res, 400, { error: "invalid_envelope" });
      return;
    }

    switch (env.event) {
      case "endpoint.url_validation": {
        const plainToken = env.payload["plainToken"];
        if (typeof plainToken !== "string") {
          sendJson(res, 400, { error: "missing_plain_token" });
          return;
        }
        log("webhook: URL 検証に応答");
        sendJson(res, 200, urlValidationResponse(plainToken, opts.secretToken));
        return;
      }
      case "meeting.rtms_started": {
        const info = rtmsStartedFromPayload(env.payload);
        if (!info) {
          // 形が読めない。Zoom に 4xx を返しても再送はされないので、ログに残して 200
          log("webhook: rtms_started の payload を読めない", env.payload);
          sendJson(res, 200, { ignored: "unreadable_payload" });
          return;
        }
        log("webhook: rtms_started", { meetingUuid: info.meetingUuid, streamId: info.streamId, signalingUrl: info.signalingUrl });
        // 先に 200 を返し、接続はその後（3 秒ルール）
        sendJson(res, 200, { ok: true });
        setImmediate(() => opts.onStarted(info, env.payload));
        return;
      }
      case "meeting.rtms_stopped": {
        const info = rtmsStoppedFromPayload(env.payload);
        sendJson(res, 200, { ok: true });
        if (info) {
          log("webhook: rtms_stopped", info);
          setImmediate(() => opts.onStopped(info));
        }
        return;
      }
      default:
        log("webhook: 未対応イベント（無視）", { event: env.event });
        sendJson(res, 200, { ignored: env.event });
    }
  });
}
