// 起動口。設定を読み、webhook サーバー → セッション台帳 → RTMS 接続 → WAV 保存 → 文字起こし受け渡し をつなぐ。
//   npm start（= tsx src/main.ts）

import path from "node:path";
import { loadConfig, loadDotEnv } from "./config";
import { RtmsSession } from "./rtms-session";
import { createWebhookServer } from "./server";
import { SessionManager } from "./session-manager";
import { createTranscribeHandoff } from "./transcribe-handoff";
import { WavChunkWriter, safeDirName } from "./wav-chunk-writer";
import { stopReasonName } from "./rtms-protocol";
import type { RtmsStartedInfo } from "./zoom-webhook";

function log(scope: string) {
  return (message: string, data?: unknown) => {
    const ts = new Date().toISOString();
    if (data === undefined) console.log(`${ts} [${scope}] ${message}`);
    else console.log(`${ts} [${scope}] ${message} ${JSON.stringify(data)}`);
  };
}

loadDotEnv();
const config = loadConfig();
const rootLog = log("rtms");

const handoff = createTranscribeHandoff({
  python: config.sttPython,
  scriptPath: config.sttScript,
  model: config.sttModel,
  log: log("stt"),
});
rootLog(handoff.isAvailable() ? "文字起こし: 有効" : "文字起こし: 無効（保存のみ）", {
  python: config.sttPython || "(未設定)",
  script: config.sttScript,
});

const sessions = new SessionManager<RtmsSession, RtmsStartedInfo>((info, onEnd) => {
  const dir = path.join(config.outDir, safeDirName(info.meetingUuid, info.streamId));
  const slog = log(`session ${info.streamId.slice(0, 12)}`);
  const writer = new WavChunkWriter({
    dir,
    meetingUuid: info.meetingUuid,
    streamId: info.streamId,
    chunkSeconds: config.chunkSeconds,
    onChunkClosed: (chunk) => {
      slog("chunk closed", { seq: chunk.seq, file: chunk.file, seconds: chunk.duration_seconds, sha256: chunk.sha256 });
      const wavPath = path.join(dir, chunk.file);
      void handoff.enqueue(wavPath).then((result) => {
        const finished_at = new Date().toISOString();
        if (result.status === "done") {
          slog("stt done", { seq: chunk.seq, rtf: result.rtf, chars: result.text.length });
          writer.updateChunk(chunk.seq, {
            transcript: { status: "done", text_file: path.basename(result.textPath), segments_file: path.basename(result.segmentsPath), rtf: result.rtf, finished_at },
          });
        } else {
          slog(`stt ${result.status}`, { seq: chunk.seq, reason: result.reason });
          writer.updateChunk(chunk.seq, { transcript: { status: result.status, reason: result.reason, finished_at } });
        }
      });
    },
  });
  slog("保存先", { dir });
  const session = new RtmsSession({
    meetingUuid: info.meetingUuid,
    streamId: info.streamId,
    signalingUrl: info.signalingUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    sink: writer,
    bufferData: config.bufferData,
    log: slog,
    onError: (err) => slog("error", { message: err.message }),
    onEnd: (end) => {
      slog("ended", end);
      onEnd();
    },
  });
  session.start();
  return session;
}, rootLog);

const server = createWebhookServer({
  webhookPath: config.webhookPath,
  secretToken: config.webhookSecretToken,
  toleranceSec: config.webhookTimestampToleranceSec,
  log: log("webhook"),
  onStarted: (info) => sessions.start(info),
  onStopped: (info) => {
    const stopped = sessions.stop(info.streamId, `webhook_stopped:${stopReasonName(info.stopReason)}`);
    if (!stopped) rootLog("rtms_stopped: 該当セッションなし（既に終了）", { streamId: info.streamId });
  },
});

server.listen(config.port, () => {
  rootLog(`listening http://localhost:${config.port}${config.webhookPath}`, {
    outDir: config.outDir,
    chunkSeconds: config.chunkSeconds,
  });
  rootLog("Zoom 側の Event notification endpoint URL には、トンネルの https URL + このパスを登録する");
});

let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const n = sessions.stopAll(`process_${sig}`);
    rootLog(`終了します（進行中のセッション ${n} 件を閉じました）`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
