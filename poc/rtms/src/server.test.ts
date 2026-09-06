// HTTP の受け口を実際に立てて（port 0）、URL 検証・署名・started/stopped の配線・停止の扱いを確かめる。
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createWebhookServer } from "./server";
import { SessionManager } from "./session-manager";
import { computeWebhookSignature, urlValidationResponse, type RtmsStartedInfo, type RtmsStoppedInfo } from "./zoom-webhook";

const SECRET = "test-secret-token";

async function withServer(fn: (ctx: { port: number; started: RtmsStartedInfo[]; stopped: RtmsStoppedInfo[] }) => Promise<void>) {
  const started: RtmsStartedInfo[] = [];
  const stopped: RtmsStoppedInfo[] = [];
  const server = createWebhookServer({
    webhookPath: "/webhook",
    secretToken: SECRET,
    onStarted: (i) => started.push(i),
    onStopped: (i) => stopped.push(i),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn({ port, started, stopped });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function post(port: number, body: unknown, opts: { ts?: string; sig?: string; raw?: string; path?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const sig = opts.sig ?? computeWebhookSignature(raw, ts, SECRET);
  const res = await fetch(`http://127.0.0.1:${port}${opts.path ?? "/webhook"}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-zm-request-timestamp": ts, "x-zm-signature": sig },
    body: raw,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const flush = () => new Promise<void>((r) => setImmediate(() => setImmediate(r)));

const STARTED = {
  event: "meeting.rtms_started",
  event_ts: 1757030400000,
  payload: {
    meeting_uuid: "TNhvT3WEBT6Srse3TgWRGr==",
    meeting_id: "81234567890",
    account_id: "B7Q4Y2M8X5L",
    operator_id: "P3Q8W2X9Y5",
    is_original_host: true,
    rtms_stream_id: "rtms_TN3WEBT6SrTgWRGr_001",
    server_urls: "wss://rtms-sjc.zoom.us/ws",
  },
};

test("URL 検証: Zoom のチャレンジに encryptedToken を返す", async () => {
  await withServer(async ({ port }) => {
    const r = await post(port, { event: "endpoint.url_validation", payload: { plainToken: "qgg8vlvZRS6UYooatFL8Aw" } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, urlValidationResponse("qgg8vlvZRS6UYooatFL8Aw", SECRET));
    assert.equal(r.json["encryptedToken"], "9c8ad56737c19db2904b301c0781e86857e999f39f07727668cf62a5e7e298c8");
  });
});

test("署名が合わない・古い・無い webhook は 401 で、中身を見ない", async () => {
  await withServer(async ({ port, started }) => {
    const bad = await post(port, STARTED, { sig: "v0=" + "0".repeat(64) });
    assert.equal(bad.status, 401);
    assert.equal(bad.json["error"], "invalid_signature");

    const stale = await post(port, STARTED, { ts: String(Math.floor(Date.now() / 1000) - 600) });
    assert.equal(stale.status, 401);
    assert.equal(stale.json["error"], "stale_timestamp");

    const res = await fetch(`http://127.0.0.1:${port}/webhook`, { method: "POST", body: JSON.stringify(STARTED) });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as Record<string, unknown>)["error"], "missing_signature");

    await flush();
    assert.equal(started.length, 0);
  });
});

test("rtms_started → onStarted、rtms_stopped → onStopped（200 を先に返す）", async () => {
  await withServer(async ({ port, started, stopped }) => {
    const r = await post(port, STARTED);
    assert.equal(r.status, 200);
    await flush();
    assert.equal(started.length, 1);
    assert.equal(started[0]?.meetingUuid, "TNhvT3WEBT6Srse3TgWRGr==");
    assert.equal(started[0]?.streamId, "rtms_TN3WEBT6SrTgWRGr_001");
    assert.equal(started[0]?.signalingUrl, "wss://rtms-sjc.zoom.us/ws");

    // payload.object の形でも同じ
    await post(port, { ...STARTED, payload: { account_id: "x", object: STARTED.payload } });
    await flush();
    assert.equal(started.length, 2);

    const s = await post(port, { event: "meeting.rtms_stopped", event_ts: 1, payload: { meeting_uuid: "TNhvT3WEBT6Srse3TgWRGr==", rtms_stream_id: "rtms_TN3WEBT6SrTgWRGr_001", stop_reason: 6 } });
    assert.equal(s.status, 200);
    await flush();
    assert.deepEqual(stopped, [{ meetingUuid: "TNhvT3WEBT6Srse3TgWRGr==", streamId: "rtms_TN3WEBT6SrTgWRGr_001", stopReason: 6 }]);
  });
});

test("読めない payload・未対応イベントは 200 で無視、壊れた JSON は 400、他のパスは 404", async () => {
  await withServer(async ({ port, started }) => {
    const unreadable = await post(port, { event: "meeting.rtms_started", payload: { meeting_uuid: "a" } });
    assert.equal(unreadable.status, 200);
    assert.equal(unreadable.json["ignored"], "unreadable_payload");

    const other = await post(port, { event: "meeting.participant_joined", payload: {} });
    assert.equal(other.status, 200);
    assert.equal(other.json["ignored"], "meeting.participant_joined");

    const broken = await post(port, null, { raw: "{not json" });
    assert.equal(broken.status, 400);

    const nf = await post(port, STARTED, { path: "/other" });
    assert.equal(nf.status, 404);

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);

    await flush();
    assert.equal(started.length, 0);
  });
});

// ---- 停止の扱い（SessionManager） ----

interface FakeSession {
  stopped: string[];
  stop(reason: string): void;
}

test("SessionManager: 同じ stream_id の rtms_started は 1 回だけ起動し、rtms_stopped で止めて台帳から外す", () => {
  const created: FakeSession[] = [];
  const mgr = new SessionManager<FakeSession, RtmsStartedInfo>(() => {
    const s: FakeSession = {
      stopped: [],
      stop(reason) {
        this.stopped.push(reason);
      },
    };
    created.push(s);
    return s;
  });
  const info: RtmsStartedInfo = { meetingUuid: "m", streamId: "s1", signalingUrl: "wss://x" };
  assert.equal(mgr.start(info), "started");
  assert.equal(mgr.start(info), "duplicate");
  assert.equal(created.length, 1);
  assert.equal(mgr.size, 1);

  assert.equal(mgr.stop("unknown", "x"), false);
  assert.equal(mgr.stop("s1", "webhook_stopped:MEETING_ENDED"), true);
  assert.deepEqual(created[0]?.stopped, ["webhook_stopped:MEETING_ENDED"]);
  assert.equal(mgr.size, 0);
  // 止めた後は同じ id でもう一度始められる（RTMS の再開）
  assert.equal(mgr.start(info), "started");
  assert.equal(created.length, 2);
});

test("SessionManager: セッションが自分で終わったら台帳から消え、stopAll は残り全部を止める", () => {
  const ends: Array<() => void> = [];
  const created: FakeSession[] = [];
  const mgr = new SessionManager<FakeSession, RtmsStartedInfo>((_info, onEnd) => {
    ends.push(onEnd);
    const s: FakeSession = {
      stopped: [],
      stop(reason) {
        this.stopped.push(reason);
      },
    };
    created.push(s);
    return s;
  });
  mgr.start({ meetingUuid: "m", streamId: "a", signalingUrl: "wss://x" });
  mgr.start({ meetingUuid: "m", streamId: "b", signalingUrl: "wss://x" });
  assert.equal(mgr.size, 2);
  ends[0]?.(); // a が自分で終わった
  assert.equal(mgr.size, 1);
  assert.equal(mgr.has("a"), false);
  assert.equal(mgr.stopAll("process_SIGINT"), 1);
  assert.deepEqual(created[1]?.stopped, ["process_SIGINT"]);
  assert.deepEqual(created[0]?.stopped, []);
  assert.equal(mgr.size, 0);
});
