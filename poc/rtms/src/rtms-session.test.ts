// Zoom に繋がずに、メモリ上の偽 WebSocket でハンドシェイク〜音声〜終了の一連を通す。
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AUDIO_PARAMS, STREAM_STATE, handshakeSignature } from "./rtms-protocol";
import { RtmsSession, type SessionEndInfo, type WebSocketLike } from "./rtms-session";

// WebSocketLike の on はイベントごとに引数型が違うオーバーロードなので、偽物は any で受けて 1 本にまとめる
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void;

class FakeWs implements WebSocketLike {
  sent: Record<string, unknown>[] = [];
  readyState = 0;
  closed = false;
  private handlers = new Map<string, Handler[]>();
  constructor(readonly url: string) {}
  on(event: string, cb: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
  open(): void {
    this.readyState = 1;
    this.emit("open");
  }
  receive(obj: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(obj)));
  }
}

class RecordingSink {
  writes: Array<{ pcm: Buffer; ts?: number }> = [];
  closedWith: string | null = null;
  write(pcm: Buffer, ts?: number): void {
    this.writes.push({ pcm, ts });
  }
  close(reason: string): void {
    this.closedWith = reason;
  }
}

const CRED = {
  clientId: "XkWfgHHASGOQC9b95AkIxB",
  clientSecret: "YZnKVUufg7N18Oej6gHHqNWc7CG5jQ6N",
  meetingUuid: "TNhvT3WEBT6Srse3TgWRGr",
  streamId: "rtms_TN3WEBT6SrTgWRGr_001",
};

function setup(overrides: Partial<ConstructorParameters<typeof RtmsSession>[0]> = {}) {
  const sockets: FakeWs[] = [];
  const sink = new RecordingSink();
  const ends: SessionEndInfo[] = [];
  const session = new RtmsSession({
    ...CRED,
    signalingUrl: "wss://rtms-sjc.zoom.us/ws",
    sink,
    wsFactory: (url) => {
      const w = new FakeWs(url);
      sockets.push(w);
      return w;
    },
    onEnd: (info) => ends.push(info),
    keepAliveTimeoutMs: 60_000,
    ...overrides,
  });
  return { session, sockets, sink, ends };
}

test("正常系: 署名付きハンドシェイク → メディア接続 → ACK → 音声 → keep-alive → TERMINATED で閉じる", () => {
  const { session, sockets, sink, ends } = setup();
  session.start();
  assert.equal(session.state, "signaling");
  assert.equal(sockets.length, 1);
  const sig = sockets[0];
  assert.ok(sig);
  assert.equal(sig.url, "wss://rtms-sjc.zoom.us/ws");

  sig.open();
  const hs = sig.sent[0];
  assert.ok(hs);
  assert.equal(hs["msg_type"], 1);
  assert.equal(hs["protocol_version"], 1);
  assert.equal(hs["sequence"], 1);
  assert.equal(hs["meeting_uuid"], CRED.meetingUuid);
  assert.equal(hs["rtms_stream_id"], CRED.streamId);
  assert.equal(hs["signature"], handshakeSignature(CRED));
  assert.equal(hs["buffer_data"], true);

  // シグナリング応答 → audio の URL に 2 本目を開く
  sig.receive({
    msg_type: 2,
    protocol_version: 1,
    sequence: 0,
    status_code: 0,
    reason: "",
    media_server: { server_urls: { audio: "wss://rtms-media.zoom.us/audio", all: "wss://rtms-media.zoom.us/all" } },
  });
  assert.equal(session.state, "media");
  assert.equal(sockets.length, 2);
  const media = sockets[1];
  assert.ok(media);
  assert.equal(media.url, "wss://rtms-media.zoom.us/audio");

  media.open();
  const mh = media.sent[0];
  assert.ok(mh);
  assert.equal(mh["msg_type"], 3);
  assert.equal(mh["media_type"], 1);
  assert.equal(mh["signature"], hs["signature"]);
  assert.deepEqual(mh["media_params"], { audio: DEFAULT_AUDIO_PARAMS });

  // メディア応答 OK → CLIENT_READY_ACK は **シグナリング側** へ
  media.receive({ msg_type: 4, protocol_version: 1, status_code: 0, reason: "", sequence: 0, payload_encrypted: false, media_params: { audio: DEFAULT_AUDIO_PARAMS } });
  assert.equal(session.state, "streaming");
  assert.deepEqual(sig.sent[1], { msg_type: 7, rtms_stream_id: CRED.streamId });
  assert.equal(media.sent.length, 1, "ACK をメディア側に送らない");
  assert.deepEqual(session.confirmedAudio, DEFAULT_AUDIO_PARAMS);

  // keep-alive は来た接続に同じ timestamp で返す
  media.receive({ msg_type: 12, timestamp: 1727384349123 });
  assert.deepEqual(media.sent[1], { msg_type: 13, timestamp: 1727384349123 });
  sig.receive({ msg_type: 12, timestamp: 42 });
  assert.deepEqual(sig.sent[2], { msg_type: 13, timestamp: 42 });

  // 音声 100 ms ぶん（3200 byte）
  const pcm = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) pcm.writeInt16LE(((i * 37) % 2000) - 1000, i * 2);
  media.receive({ msg_type: 14, content: { user_id: 16778240, user_name: "John Smith", data: pcm.toString("base64"), length: 3200, timestamp: 1738392033699 } });
  assert.equal(sink.writes.length, 1);
  assert.ok(sink.writes[0]?.pcm.equals(pcm));
  assert.equal(sink.writes[0]?.ts, 1738392033699);
  assert.equal(session.audioPackets, 1);
  assert.equal(session.audioBytes, 3200);
  // length の食い違いは捨てる
  media.receive({ msg_type: 14, content: { data: pcm.toString("base64"), length: 10 } });
  assert.equal(sink.writes.length, 1);

  // 会議終了
  sig.receive({ msg_type: 8, state: STREAM_STATE.TERMINATED, reason: 6, timestamp: 1727384349123 });
  assert.equal(session.state, "ended");
  assert.equal(ends.length, 1);
  assert.match(ends[0]?.reason ?? "", /TERMINATED/);
  assert.match(ends[0]?.reason ?? "", /MEETING_ENDED/);
  assert.equal(sink.closedWith, ends[0]?.reason);
  assert.ok(sig.closed && media.closed);
  assert.deepEqual({ p: ends[0]?.audioPackets, b: ends[0]?.audioBytes }, { p: 1, b: 3200 });

  // その後に close が来ても二重に終わらない
  sig.emit("close", 1000, "");
  media.emit("close", 1000, "");
  assert.equal(ends.length, 1);
});

test("シグナリングのハンドシェイクが status_code 3（署名不正）なら終了し、メディアには繋がない", () => {
  const { session, sockets, sink, ends } = setup();
  session.start();
  const sig = sockets[0];
  assert.ok(sig);
  sig.open();
  sig.receive({ msg_type: 2, status_code: 3, reason: "invalid signature" });
  assert.equal(session.state, "ended");
  assert.equal(sockets.length, 1);
  assert.match(ends[0]?.reason ?? "", /INVALID_SIGNATURE/);
  assert.equal(sink.closedWith, ends[0]?.reason);
});

test("audio も all も無い応答なら終了する", () => {
  const { session, sockets, ends } = setup();
  session.start();
  sockets[0]?.open();
  sockets[0]?.receive({ msg_type: 2, status_code: 0, media_server: { server_urls: { transcript: "wss://t" } } });
  assert.equal(session.state, "ended");
  assert.equal(ends[0]?.reason, "signaling_handshake_ok_but_no_audio_url");
});

test("stop()（webhook の rtms_stopped）で両接続を閉じ sink を閉じる", () => {
  const { session, sockets, sink, ends } = setup();
  session.start();
  const sig = sockets[0];
  assert.ok(sig);
  sig.open();
  sig.receive({ msg_type: 2, status_code: 0, media_server: { server_urls: { all: "wss://all" } } });
  const media = sockets[1];
  assert.ok(media);
  media.open();
  session.stop("webhook_stopped:MEETING_ENDED");
  assert.equal(session.state, "ended");
  assert.ok(sig.closed && media.closed);
  assert.equal(sink.closedWith, "webhook_stopped:MEETING_ENDED");
  assert.equal(ends.length, 1);
  // 遅れて届いたメッセージは無視される（例外にならない）
  media.receive({ msg_type: 14, content: { data: "AAAA" } });
  assert.equal(sink.writes.length, 0);
});

test("keep-alive が途絶えたら keepalive_timeout で終了する", async () => {
  const { session, sockets, ends } = setup({ keepAliveTimeoutMs: 20 });
  session.start();
  sockets[0]?.open();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(session.state, "ended");
  assert.equal(ends[0]?.reason, "keepalive_timeout");
});

test("開始前に stop しても安全・start は 1 回だけ", () => {
  const { session, sockets, sink } = setup();
  session.stop("early");
  assert.equal(session.state, "ended");
  assert.equal(sink.closedWith, "early");
  session.start();
  assert.equal(sockets.length, 0);
});
