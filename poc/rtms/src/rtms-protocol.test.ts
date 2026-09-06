// ハンドシェイク署名とメッセージの形を、公式ドキュメントの記述どおりに固定する。
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  AUDIO,
  DEFAULT_AUDIO_PARAMS,
  MEDIA_TYPE,
  MSG,
  buildClientReadyAck,
  buildKeepAliveResponse,
  buildMediaHandshake,
  buildSignalingHandshake,
  decodeAudioPacket,
  handshakeSignature,
  parseRtmsMessage,
  pickAudioMediaUrl,
  sampleRateHz,
  statusName,
  stopReasonName,
  streamStateName,
} from "./rtms-protocol";

// Zoom の rtms-mock-server-sample（github.com/zoom/rtms-mock-server-sample data/rtms_credentials.json）に入っている
// テスト用の資格情報と会議。実物ではない
const CRED = {
  clientId: "XkWfgHHASGOQC9b95AkIxB",
  clientSecret: "YZnKVUufg7N18Oej6gHHqNWc7CG5jQ6N",
  meetingUuid: "TNhvT3WEBT6Srse3TgWRGr",
  streamId: "rtms_TN3WEBT6SrTgWRGr_001",
};

test("署名: `${client_id},${meeting_uuid},${rtms_stream_id}` を client_secret で HMAC-SHA256（hex）", () => {
  const sig = handshakeSignature(CRED);
  assert.equal(sig, "8da2206b6a3679c74cdc454b6c44d002ef5c717e899e9d830ef4a9546cd23daf");
  // 公式サンプル（rtms-samples RTMS_CONNECTION_FLOW.md）の式をそのまま書いた値と一致する
  const doc = createHmac("sha256", CRED.clientSecret)
    .update(`${CRED.clientId},${CRED.meetingUuid},${CRED.streamId}`)
    .digest("hex");
  assert.equal(sig, doc);
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test("署名: 並び順を変えると別の値になる（順序が仕様）", () => {
  const swapped = createHmac("sha256", CRED.clientSecret)
    .update(`${CRED.meetingUuid},${CRED.clientId},${CRED.streamId}`)
    .digest("hex");
  assert.notEqual(handshakeSignature(CRED), swapped);
});

test("署名: 資格情報が空なら投げる（黙って空文字で署名しない）", () => {
  assert.throws(() => handshakeSignature({ ...CRED, clientSecret: "" }));
  assert.throws(() => handshakeSignature({ ...CRED, clientId: "" }));
});

test("SIGNALING_HAND_SHAKE_REQ: msg_type 1・protocol_version 1・sequence 1 から・buffer_data", () => {
  const m = buildSignalingHandshake(CRED);
  assert.deepEqual(m, {
    msg_type: 1,
    protocol_version: 1,
    sequence: 1,
    meeting_uuid: CRED.meetingUuid,
    rtms_stream_id: CRED.streamId,
    signature: handshakeSignature(CRED),
    buffer_data: true,
  });
  assert.equal(buildSignalingHandshake({ ...CRED, bufferData: false }).buffer_data, false);
});

test("DATA_HAND_SHAKE_REQ: 音声だけ（media_type 1）・16k mono L16 mixed 100ms", () => {
  const m = buildMediaHandshake(CRED);
  assert.equal(m.msg_type, MSG.DATA_HAND_SHAKE_REQ);
  assert.equal(m.media_type, MEDIA_TYPE.AUDIO);
  assert.equal(m.signature, handshakeSignature(CRED));
  assert.deepEqual(m.media_params, {
    audio: {
      content_type: 2, // RAW_AUDIO
      sample_rate: 1, // SR_16K
      channel: 1, // MONO
      codec: 1, // L16
      data_opt: 1, // AUDIO_MIXED_STREAM
      send_rate: 100,
    },
  });
  assert.deepEqual(m.media_params.audio, DEFAULT_AUDIO_PARAMS);
  assert.equal(DEFAULT_AUDIO_PARAMS.send_rate % 20, 0, "send_rate は 20 の倍数");
  assert.equal(sampleRateHz(AUDIO.SAMPLE_RATE.SR_16K), 16000);
  assert.equal(sampleRateHz(AUDIO.SAMPLE_RATE.SR_48K), 48000);
});

test("CLIENT_READY_ACK / KEEP_ALIVE_RESP の形", () => {
  assert.deepEqual(buildClientReadyAck("s1"), { msg_type: 7, rtms_stream_id: "s1" });
  assert.deepEqual(buildKeepAliveResponse(1727384349123), { msg_type: 13, timestamp: 1727384349123 });
});

test("media_server.server_urls: audio を優先し、無ければ all", () => {
  assert.equal(pickAudioMediaUrl({ audio: "wss://a", all: "wss://all" }), "wss://a");
  assert.equal(pickAudioMediaUrl({ transcript: "wss://t", all: "wss://all" }), "wss://all");
  assert.equal(pickAudioMediaUrl({ transcript: "wss://t" }), undefined);
  assert.equal(pickAudioMediaUrl(undefined), undefined);
  assert.equal(pickAudioMediaUrl({ audio: "http://not-ws" }), undefined);
});

test("MEDIA_DATA_AUDIO: base64 を戻し length と照合する", () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
  const ok = decodeAudioPacket({ msg_type: 14, content: { user_id: 7, user_name: "A", data: pcm.toString("base64"), length: 6, timestamp: 99 } });
  assert.ok(ok);
  assert.ok(ok.pcm.equals(pcm));
  assert.equal(ok.timestamp, 99);
  assert.equal(ok.userId, 7);
  assert.equal(ok.userName, "A");
  // length が無いサンプルも公式にある → 受ける
  assert.ok(decodeAudioPacket({ msg_type: 14, content: { data: pcm.toString("base64") } }));
  // length が食い違う → 捨てる
  assert.equal(decodeAudioPacket({ msg_type: 14, content: { data: pcm.toString("base64"), length: 5 } }), null);
  assert.equal(decodeAudioPacket({ msg_type: 14, content: {} }), null);
  assert.equal(decodeAudioPacket({ msg_type: 14 }), null);
});

test("parseRtmsMessage: string / Buffer を読み、msg_type の無いものは null", () => {
  assert.deepEqual(parseRtmsMessage('{"msg_type":12,"timestamp":1}'), { msg_type: 12, timestamp: 1 });
  assert.deepEqual(parseRtmsMessage(Buffer.from('{"msg_type":2}')), { msg_type: 2 });
  assert.equal(parseRtmsMessage("not json"), null);
  assert.equal(parseRtmsMessage('{"foo":1}'), null);
  assert.equal(parseRtmsMessage(123), null);
});

test("名前の解決（ログ用）", () => {
  assert.equal(statusName(0), "OK");
  assert.equal(statusName(3), "INVALID_SIGNATURE");
  assert.equal(statusName(99), "STATUS_99");
  assert.equal(stopReasonName(6), "MEETING_ENDED");
  assert.equal(stopReasonName(undefined), "REASON_UNKNOWN");
  assert.equal(streamStateName(4), "TERMINATED");
});
