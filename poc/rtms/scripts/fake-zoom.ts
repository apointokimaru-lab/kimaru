// Zoom の代わり（オフライン確認用）。Zoom の資格情報もクレジットも無しで、受信サーバー（npm start）を端から端まで通す。
//
// やること（本物の Zoom と同じ順序・同じメッセージの形）:
//   1. 偽のシグナリング／メディア WebSocket サーバーを 127.0.0.1 に立てる
//   2. 受信サーバーへ `endpoint.url_validation` を署名付きで POST → encryptedToken が正しいか見る
//   3. fixtures/rtms_started.json の server_urls を偽サーバーに差し替えて `meeting.rtms_started` を POST
//   4. 受信サーバーが繋いでくる → ハンドシェイクの署名を検証 → media_server の URL を返す → DATA_HAND_SHAKE_RESP
//      → CLIENT_READY_ACK を待つ → 合成 PCM（または --wav の 16 kHz mono WAV）を 100 ms ずつ msg_type 14 で流す
//   5. STREAM_STATE_UPDATE(TERMINATED) → `meeting.rtms_stopped` を POST → manifest.json を読んで結果を表示
//
// 使い方（受信サーバーを別ターミナルで `npm start` してから）:
//   npm run fake-zoom -- --seconds 12 --speed 20           # 12 秒ぶんを 20 倍速で
//   npm run fake-zoom -- --wav ../stt/samples/meeting_short.wav   # 実音声（16 kHz mono 16-bit の WAV）を流す
// 分割を見たいときは受信サーバー側の RTMS_CHUNK_SECONDS を 5 などに縮める。

import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { POC_ROOT, loadConfig, loadDotEnv } from "../src/config";
import { MSG, STREAM_STATE, handshakeSignature, parseRtmsMessage, type RtmsMessage } from "../src/rtms-protocol";
import { safeDirName, type Manifest } from "../src/wav-chunk-writer";
import { computeWebhookSignature, urlValidationResponse } from "../src/zoom-webhook";

// ---- 引数 ----
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const SECONDS = Number(arg("seconds") ?? 12);
const SPEED = Math.max(1, Number(arg("speed") ?? 20));
const WAV = arg("wav");
const KEEPALIVE_MS = Number(arg("keepalive-ms") ?? 2000);

const SAMPLE_RATE = 16000;
const PACKET_MS = 100;
const SAMPLES_PER_PACKET = (SAMPLE_RATE * PACKET_MS) / 1000; // 1600
const BYTES_PER_PACKET = SAMPLES_PER_PACKET * 2; // 3200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string, data?: unknown) =>
  console.log(`${new Date().toISOString()} [fake-zoom] ${msg}${data === undefined ? "" : " " + JSON.stringify(data)}`);

// ---- 音声 ----

/** 会議っぽい合成音: 2.2 秒の音（周波数は 3 秒ごとに変わる）＋ 0.8 秒の無音。文字起こしは意味を成さないが配管の確認には足りる */
function synthPacket(index: number): Buffer {
  const b = Buffer.alloc(BYTES_PER_PACKET);
  const base = index * SAMPLES_PER_PACKET;
  for (let i = 0; i < SAMPLES_PER_PACKET; i++) {
    const n = base + i;
    const t = n / SAMPLE_RATE;
    const cycle = t % 3;
    if (cycle > 2.2) continue; // 無音
    const seg = Math.floor(t / 3);
    const f = 180 + 40 * (seg % 9);
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t); // 4 Hz の抑揚
    const v = Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 2.01 * t) * 0.3;
    b.writeInt16LE(Math.round(v * env * 9000), i * 2);
  }
  return b;
}

/** 16 kHz mono 16-bit の WAV を読み、PCM を 3200 byte ずつに割る */
function packetsFromWav(file: string): Buffer[] {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("WAV でない");
  let pos = 12;
  let fmtOk = false;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);
    if (id === "fmt ") {
      const format = body.readUInt16LE(0);
      const channels = body.readUInt16LE(2);
      const rate = body.readUInt32LE(4);
      const bits = body.readUInt16LE(14);
      if (format !== 1 || channels !== 1 || rate !== 16000 || bits !== 16) {
        throw new Error(`16 kHz mono 16-bit PCM の WAV が必要（受け取った: format=${format} ch=${channels} rate=${rate} bits=${bits}）`);
      }
      fmtOk = true;
    } else if (id === "data") {
      data = body;
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmtOk || !data) throw new Error("fmt / data チャンクが無い");
  const packets: Buffer[] = [];
  for (let o = 0; o < data.length; o += BYTES_PER_PACKET) {
    const p = Buffer.alloc(BYTES_PER_PACKET);
    data.copy(p, 0, o, Math.min(o + BYTES_PER_PACKET, data.length));
    packets.push(p);
  }
  return packets;
}

// ---- 本体 ----

async function main(): Promise<number> {
  loadDotEnv();
  const config = loadConfig();
  const base = `http://127.0.0.1:${config.port}`;

  const packets = WAV ? packetsFromWav(path.resolve(WAV)) : Array.from({ length: Math.round(SECONDS * 10) }, (_, i) => synthPacket(i));
  const totalSeconds = (packets.length * PACKET_MS) / 1000;
  log("音声", { source: WAV ?? "synth", seconds: totalSeconds, packets: packets.length, speed: SPEED });

  // 受信サーバーの疎通
  try {
    const h = await fetch(`${base}/healthz`);
    if (!h.ok) throw new Error(`healthz ${h.status}`);
  } catch (err) {
    log(`受信サーバーに繋がりません（別ターミナルで npm start）: ${(err as Error).message}`);
    return 1;
  }

  // 1. 偽サーバー
  const sigWss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const mediaWss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await Promise.all([once(sigWss, "listening"), once(mediaWss, "listening")]);
  const sigUrl = `ws://127.0.0.1:${(sigWss.address() as AddressInfo).port}/ws`;
  const mediaUrl = `ws://127.0.0.1:${(mediaWss.address() as AddressInfo).port}/media`;
  log("偽サーバー", { signaling: sigUrl, media: mediaUrl });

  const fixture = JSON.parse(readFileSync(path.join(POC_ROOT, "fixtures", "rtms_started.json"), "utf8")) as {
    payload: Record<string, unknown>;
  };
  const stamp = Date.now();
  const meetingUuid = `fake-${stamp}==`;
  const streamId = `rtms_fake_${stamp}`;
  const expectedSig = handshakeSignature({ clientId: config.clientId, clientSecret: config.clientSecret, meetingUuid, streamId });

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => (resolveReady = r));
  let resolveMedia: (ws: WebSocket) => void = () => {};
  const mediaSocket = new Promise<WebSocket>((r) => (resolveMedia = r));
  let sigSocket: WebSocket | null = null;
  let problems = 0;

  const send = (ws: WebSocket, obj: unknown) => ws.send(JSON.stringify(obj));

  sigWss.on("connection", (ws) => {
    sigSocket = ws;
    log("signaling: 接続を受けた");
    ws.on("message", (raw) => {
      const msg = parseRtmsMessage(raw);
      if (!msg) return;
      if (msg.msg_type === MSG.SIGNALING_HAND_SHAKE_REQ) {
        const ok = msg["signature"] === expectedSig && msg["meeting_uuid"] === meetingUuid && msg["rtms_stream_id"] === streamId && msg["protocol_version"] === 1;
        log("signaling: SIGNALING_HAND_SHAKE_REQ", { signatureOk: ok, sequence: msg["sequence"], buffer_data: msg["buffer_data"] });
        if (!ok) {
          problems++;
          send(ws, { msg_type: MSG.SIGNALING_HAND_SHAKE_RESP, protocol_version: 1, sequence: 0, status_code: 3, reason: "invalid signature" });
          return;
        }
        send(ws, {
          msg_type: MSG.SIGNALING_HAND_SHAKE_RESP,
          protocol_version: 1,
          sequence: 0,
          status_code: 0,
          reason: "",
          media_server: { server_urls: { audio: mediaUrl, all: mediaUrl } },
        });
      } else if (msg.msg_type === MSG.CLIENT_READY_ACK) {
        log("signaling: CLIENT_READY_ACK", { rtms_stream_id: msg["rtms_stream_id"] });
        if (msg["rtms_stream_id"] !== streamId) problems++;
        resolveReady();
      } else if (msg.msg_type === MSG.KEEP_ALIVE_RESP) {
        log("signaling: KEEP_ALIVE_RESP", { timestamp: msg["timestamp"] });
      } else {
        log("signaling: 予期しないメッセージ", msg);
      }
    });
  });

  mediaWss.on("connection", (ws) => {
    log("media: 接続を受けた");
    ws.on("message", (raw) => {
      const msg = parseRtmsMessage(raw);
      if (!msg) return;
      if (msg.msg_type === MSG.DATA_HAND_SHAKE_REQ) {
        const params = (msg["media_params"] as Record<string, unknown> | undefined)?.["audio"] as Record<string, unknown> | undefined;
        const ok = msg["signature"] === expectedSig && msg["media_type"] === 1 && params?.["sample_rate"] === 1 && params?.["channel"] === 1 && params?.["codec"] === 1;
        log("media: DATA_HAND_SHAKE_REQ", { signatureOk: msg["signature"] === expectedSig, media_type: msg["media_type"], audio: params });
        if (!ok) {
          problems++;
          send(ws, { msg_type: MSG.DATA_HAND_SHAKE_RESP, protocol_version: 1, status_code: 3, reason: "invalid", sequence: 0 });
          return;
        }
        send(ws, { msg_type: MSG.DATA_HAND_SHAKE_RESP, protocol_version: 1, status_code: 0, reason: "", sequence: 0, payload_encrypted: false, media_params: { audio: params } });
        resolveMedia(ws);
      } else if (msg.msg_type === MSG.KEEP_ALIVE_RESP) {
        log("media: KEEP_ALIVE_RESP", { timestamp: msg["timestamp"] });
      } else {
        log("media: 予期しないメッセージ", msg);
      }
    });
  });

  const postWebhook = async (body: unknown) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${base}${config.webhookPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zm-request-timestamp": ts,
        "x-zm-signature": computeWebhookSignature(raw, ts, config.webhookSecretToken),
      },
      body: raw,
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  // 2. URL 検証
  const plainToken = "qgg8vlvZRS6UYooatFL8Aw";
  const v = await postWebhook({ event: "endpoint.url_validation", event_ts: Date.now(), payload: { plainToken } });
  const validationOk = v.status === 200 && v.json["encryptedToken"] === urlValidationResponse(plainToken, config.webhookSecretToken).encryptedToken;
  log("url_validation", { status: v.status, ok: validationOk });
  if (!validationOk) problems++;

  // 3. rtms_started
  const started = await postWebhook({
    event: "meeting.rtms_started",
    event_ts: Date.now(),
    payload: { ...fixture.payload, meeting_uuid: meetingUuid, rtms_stream_id: streamId, server_urls: sigUrl },
  });
  log("rtms_started", started);
  if (started.status !== 200) {
    problems++;
    return finish(1);
  }

  // 4. ハンドシェイク完了を待つ（5 秒）
  const media = await Promise.race([
    Promise.all([ready, mediaSocket]).then(([, ws]) => ws),
    sleep(5000).then(() => null),
  ]);
  if (!media) {
    log("5 秒待ってもハンドシェイクが完了しない");
    return finish(1);
  }

  const keepAlive = setInterval(() => {
    const ts = Date.now();
    if (sigSocket) send(sigSocket, { msg_type: MSG.KEEP_ALIVE_REQ, timestamp: ts });
    send(media, { msg_type: MSG.KEEP_ALIVE_REQ, timestamp: ts });
  }, KEEPALIVE_MS);

  // 音声を流す
  log("音声を送信", { packets: packets.length, intervalMs: PACKET_MS / SPEED });
  const baseTs = Date.now();
  for (let i = 0; i < packets.length; i++) {
    const pcm = packets[i];
    if (!pcm) break;
    send(media, {
      msg_type: MSG.MEDIA_DATA_AUDIO,
      content: { user_id: 16778240, user_name: "Fake Speaker", data: pcm.toString("base64"), length: pcm.length, timestamp: baseTs + i * PACKET_MS },
    });
    await sleep(PACKET_MS / SPEED);
  }
  clearInterval(keepAlive);
  log("音声を送り終えた");

  // 5. 終了
  if (sigSocket) send(sigSocket, { msg_type: MSG.STREAM_STATE_UPDATE, state: STREAM_STATE.TERMINATED, reason: 6, timestamp: Date.now() });
  await sleep(300);
  const stopped = await postWebhook({ event: "meeting.rtms_stopped", event_ts: Date.now(), payload: { meeting_uuid: meetingUuid, rtms_stream_id: streamId, stop_reason: 6 } });
  log("rtms_stopped", stopped);
  await sleep(500);

  // 結果
  const dir = path.join(config.outDir, safeDirName(meetingUuid, streamId));
  const manifestPath = path.join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    log("manifest.json が無い", { manifestPath });
    return finish(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const expectedChunks = Math.ceil(totalSeconds / config.chunkSeconds);
  log("manifest", {
    path: manifestPath,
    status: manifest.status,
    end_reason: manifest.end_reason,
    total_seconds: manifest.total_seconds,
    chunks: manifest.chunks.map((c) => ({ seq: c.seq, file: c.file, seconds: c.duration_seconds, sha256: c.sha256?.slice(0, 12), transcript: c.transcript?.status ?? "(pending/none)" })),
  });
  const okChunks = manifest.chunks.length === expectedChunks && manifest.chunks.every((c) => c.sha256);
  const okSeconds = Math.abs(manifest.total_seconds - totalSeconds) < 0.001;
  if (manifest.status !== "closed" || !okChunks || !okSeconds) {
    log("期待と違う", { expectedChunks, expectedSeconds: totalSeconds, status: manifest.status });
    problems++;
  }
  if (config.sttPython) log("文字起こしは受信サーバー側で順に走る。終わると manifest の chunks[].transcript と <seq>.txt に出る");
  return finish(problems === 0 ? 0 : 1);

  function finish(code: number): number {
    for (const c of sigWss.clients) c.terminate();
    for (const c of mediaWss.clients) c.terminate();
    sigWss.close();
    mediaWss.close();
    log(code === 0 ? "OK: 端から端まで通った" : `NG: 問題 ${problems} 件`);
    return code;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
