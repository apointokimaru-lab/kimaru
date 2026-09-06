// Bot の本体: 入室 → 録音 → 終了検知 → 退出。状態遷移を events.jsonl と result.json に残す。
//
// 状態: launching → joining → (waiting_room →) in_meeting → leaving → left
//       途中終了: denied / removed / meeting_ended / timeout / not_logged_in / error
// 名前は本番設計（docs/ai-bot/system-spec.md 2.4）の Bot 状態と揃えている。
//
// ここで「しないこと」（規約上の線引き・docs/ai-bot/platform-research.md 7.3〜7.4）:
//  - Google アカウントの自動ログイン。人が `login` で一度ログインしたプロファイルを使うだけ。
//    ログイン画面に飛ばされたら not_logged_in で止まる（ID・パスワードを入れる経路はコードに存在しない）
//  - Bot 検知の回避（UA 偽装・navigator.webdriver の隠蔽・人間らしい操作の模倣）。Meet が拒否したら denied として記録する
//  - 名前欄への自動入力は --guest-name を明示したときだけ（匿名で入る試験の腕。既定では未ログイン＝停止）

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { AudioCapture, type AudioStats } from "./audio-capture.js";
import type { BotConfig } from "./config.js";
import { EndDetector, type EndReason } from "./end-detect.js";
import { createLogger, type Logger } from "./log.js";
import { classifyText, inMeeting, isVisible, preJoin, readPageText, readParticipantCount } from "./selectors.js";
import { TranscribeHandoff } from "./transcribe-handoff.js";
import { buildWavHeader, meetingCodeFromUrl, WavChunkWriter, type Manifest } from "./wav-writer.js";

export type BotState =
  | "launching"
  | "joining"
  | "waiting_room"
  | "in_meeting"
  | "leaving"
  | "left"
  | "denied"
  | "removed"
  | "meeting_ended"
  | "timeout"
  | "not_logged_in"
  | "error";

/** 試験の腕。結果の記録用で、Bot の動きは guest（名前を入れる）以外は変えない */
export type JoinMode = "invited" | "uninvited" | "guest" | "unknown";
export type JoinButton = "join_now" | "ask_to_join" | "none";

export interface JoinOptions {
  url: string;
  mode: JoinMode;
  /** 未ログインの名前欄に入れる名前。無ければ名前欄が出た時点で not_logged_in で止まる */
  guestName?: string;
  headless?: boolean;
  /** 会議ディレクトリを固定したいとき（省略時は <outDir>/<日時>-<会議コード>） */
  meetingDir?: string;
  maxSeconds?: number;
  aloneSeconds?: number;
  inactivitySeconds?: number;
  waitingRoomSeconds?: number;
  chunkSeconds?: number;
  /** 会議中の観測間隔（ms） */
  pollMs?: number;
  /** 文字起こしへ渡すか（既定 true。STT_PYTHON が無ければどちらでも skipped） */
  stt?: boolean;
  screenshots?: boolean;
  /** 入室前画面を待つ上限（ms） */
  preJoinTimeoutMs?: number;
  /** Chromium に足す引数（試験用） */
  browserArgs?: string[];
}

export interface Transition {
  state: BotState;
  at: string;
  detail?: string;
}

export interface JoinResult {
  meeting_url: string;
  meeting_code: string;
  mode: JoinMode;
  guest_name: string | null;
  out_dir: string;
  started_at: string;
  finished_at: string;
  transitions: Transition[];
  /** 入室前画面でどのボタンが出たか。#478 の仮説（招待済みなら join_now）の判定 */
  join_button_seen: JoinButton;
  waiting_room_seconds: number | null;
  in_meeting_seconds: number | null;
  final_state: BotState;
  end_reason: EndReason | string | null;
  audio: {
    bytes: number;
    chunks_received: number;
    mode: AudioStats["mode"];
    sample_rate: number | null;
    tracks_seen: number;
  };
  manifest: Manifest | null;
  errors: string[];
}

const DEFAULT_ARGS = [
  // AudioContext をユーザー操作なしで走らせる（会議音声の取り込みに必須）
  "--autoplay-policy=no-user-gesture-required",
];

function nowIso(): string {
  return new Date().toISOString();
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
}

/** --use-file-for-fake-audio-capture 用の無音 WAV（1 秒・16 kHz）。ビープを会議に流さないため */
function writeSilenceWav(file: string): void {
  const pcm = Buffer.alloc(16000 * 2);
  writeFileSync(file, Buffer.concat([buildWavHeader(pcm.length), pcm]));
}

export async function runBot(cfg: BotConfig, opts: JoinOptions): Promise<JoinResult> {
  const code = meetingCodeFromUrl(opts.url);
  const meetingDir = opts.meetingDir ?? path.join(cfg.outDir, `${stamp()}-${code}`);
  mkdirSync(meetingDir, { recursive: true });
  const logger: Logger = createLogger(meetingDir);
  const log = logger.log;
  const pollMs = opts.pollMs ?? 5000;
  const takeShots = opts.screenshots ?? true;

  const result: JoinResult = {
    meeting_url: opts.url,
    meeting_code: code,
    mode: opts.mode,
    guest_name: opts.guestName ?? null,
    out_dir: meetingDir,
    started_at: nowIso(),
    finished_at: "",
    transitions: [],
    join_button_seen: "none",
    waiting_room_seconds: null,
    in_meeting_seconds: null,
    final_state: "launching",
    end_reason: null,
    audio: { bytes: 0, chunks_received: 0, mode: null, sample_rate: null, tracks_seen: 0 },
    manifest: null,
    errors: [],
  };
  const saveResult = (): void => {
    result.finished_at = nowIso();
    writeFileSync(path.join(meetingDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  };

  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let shotSeq = 0;

  const transition = async (state: BotState, detail?: string): Promise<void> => {
    result.transitions.push({ state, at: nowIso(), detail });
    result.final_state = state;
    log("state", { state, detail });
    if (takeShots && page && !page.isClosed()) {
      try {
        const file = path.join(meetingDir, "shots", `${String(shotSeq++).padStart(2, "0")}-${state}.png`);
        mkdirSync(path.dirname(file), { recursive: true });
        await page.screenshot({ path: file, timeout: 5000 });
      } catch {
        // スクリーンショットは補助。失敗しても進める
      }
    }
    saveResult();
  };

  const tracksSeen = new Set<string>();
  const audio = new AudioCapture({ log });
  audio.onEvent((ev) => {
    if (ev.type === "track_added" && typeof ev.id === "string") tracksSeen.add(ev.id);
  });

  let writer: WavChunkWriter | null = null;
  let handoff: TranscribeHandoff | null = null;
  let stopRequested: string | null = null;
  const onSigint = (): void => {
    stopRequested = "interrupted";
    log("interrupt", {});
  };
  process.once("SIGINT", onSigint);

  try {
    // ---- 起動 ----
    await transition("launching");
    const args = [...DEFAULT_ARGS, ...(opts.browserArgs ?? [])];
    if (cfg.fakeDevices) {
      const silence = path.join(meetingDir, "silence.wav");
      writeSilenceWav(silence);
      args.push("--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${silence}`);
    }
    const headless = opts.headless ?? cfg.headless;
    log("launch", { profileDir: cfg.profileDir, headless, channel: cfg.browserChannel || "(default)", args });
    context = await chromium.launchPersistentContext(cfg.profileDir, {
      headless,
      channel: cfg.browserChannel || undefined,
      args,
      viewport: { width: 1280, height: 720 },
      // 注入する AudioWorklet（blob:）がページの CSP に弾かれないように。Bot 検知とは無関係の Playwright 標準機能
      bypassCSP: true,
    });
    await audio.install(context);
    page = context.pages()[0] ?? (await context.newPage());
    page.on("console", (m) => {
      if (m.type() === "error") log("page_console_error", { text: m.text().slice(0, 500) });
    });
    page.on("crash", () => {
      result.errors.push("page crashed");
      stopRequested = "page_crashed";
    });

    // ---- 入室前 ----
    await transition("joining");
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const preJoinDeadline = Date.now() + (opts.preJoinTimeoutMs ?? 60000);
    let guestNameFilled = false;
    let clickedAt: number | null = null;
    while (clickedAt === null) {
      if (stopRequested) throw new Error(stopRequested);
      if (Date.now() > preJoinDeadline) {
        const text = await readPageText(page, 2000);
        log("prejoin_timeout", { url: page.url(), page_text: text });
        await transition("error", "入室前画面で参加ボタンが見つからない");
        result.end_reason = "prejoin_timeout";
        return finish();
      }
      const url = page.url();
      if (/accounts\.google\.com/.test(url)) {
        await transition("not_logged_in", "Google のログイン画面に遷移した。login コマンドで人がログインする");
        result.end_reason = "not_logged_in";
        return finish();
      }
      const text = await readPageText(page, 4000);
      const cls = classifyText(text);
      if (cls === "invalid_url") {
        log("page_text", { page_text: text });
        await transition("error", "会議コードが無効");
        result.end_reason = "invalid_url";
        return finish();
      }
      if (cls === "denied") {
        log("page_text", { page_text: text });
        await transition("denied", "入室前画面で拒否の文言");
        result.end_reason = "denied";
        return finish();
      }
      if (cls === "not_logged_in") {
        await transition("not_logged_in", "ログインを促す文言");
        result.end_reason = "not_logged_in";
        return finish();
      }
      if (await isVisible(preJoin.continueWithoutDevices(page))) {
        log("click", { what: "continue_without_devices" });
        await preJoin.continueWithoutDevices(page).click({ timeout: 3000 }).catch(() => {});
      }
      if (!guestNameFilled && (await isVisible(preJoin.nameInput(page)))) {
        if (!opts.guestName) {
          log("page_text", { page_text: text });
          await transition("not_logged_in", "名前欄が出た＝プロファイルが未ログイン。自動ログインはしない");
          result.end_reason = "not_logged_in";
          return finish();
        }
        await preJoin.nameInput(page).fill(opts.guestName, { timeout: 3000 });
        guestNameFilled = true;
        log("guest_name_filled", { name: opts.guestName });
      }
      if (await isVisible(preJoin.joinNow(page))) {
        result.join_button_seen = "join_now";
        await muteDevices(page, log);
        log("click", { what: "join_now" });
        await preJoin.joinNow(page).click({ timeout: 5000 });
        clickedAt = Date.now();
      } else if (await isVisible(preJoin.askToJoin(page))) {
        result.join_button_seen = "ask_to_join";
        await muteDevices(page, log);
        log("click", { what: "ask_to_join" });
        await preJoin.askToJoin(page).click({ timeout: 5000 });
        clickedAt = Date.now();
        await transition("waiting_room", "「参加をリクエスト」を押した");
      } else {
        await page.waitForTimeout(1000);
      }
    }
    log("join_button", { seen: result.join_button_seen, mode: opts.mode });

    // ---- 入室待ち ----
    const waitLimitMs = (result.join_button_seen === "ask_to_join" ? (opts.waitingRoomSeconds ?? cfg.waitingRoomSeconds) : 90) * 1000;
    let inMeetingAt: number | null = null;
    while (inMeetingAt === null) {
      if (stopRequested) throw new Error(stopRequested);
      if (await isVisible(inMeeting.leaveButton(page), 500)) {
        inMeetingAt = Date.now();
        break;
      }
      const text = await readPageText(page, 4000);
      const cls = classifyText(text);
      if (cls === "denied") {
        log("page_text", { page_text: text });
        await transition("denied", "参加リクエストが拒否された");
        result.end_reason = "denied";
        result.waiting_room_seconds = (Date.now() - clickedAt) / 1000;
        return finish();
      }
      if (cls === "ended") {
        log("page_text", { page_text: text });
        await transition("meeting_ended", "入室前に会議が終わった");
        result.end_reason = "meeting_ended";
        return finish();
      }
      if (cls === "waiting" && result.final_state !== "waiting_room") {
        await transition("waiting_room", "待機の文言");
      }
      if (Date.now() - clickedAt > waitLimitMs) {
        log("page_text", { page_text: text });
        await transition("timeout", "待機室で承認されなかった");
        result.end_reason = "waiting_room_timeout";
        result.waiting_room_seconds = (Date.now() - clickedAt) / 1000;
        return finish();
      }
      await page.waitForTimeout(2000);
    }
    if (result.transitions.some((t) => t.state === "waiting_room")) {
      result.waiting_room_seconds = (inMeetingAt - clickedAt) / 1000;
    }
    await transition("in_meeting", result.waiting_room_seconds === null ? "直接入室" : `待機 ${result.waiting_room_seconds.toFixed(0)} 秒後に承認`);

    // ---- 録音 ----
    handoff = new TranscribeHandoff({
      python: opts.stt === false ? "" : cfg.sttPython,
      script: cfg.sttScript,
      extraArgs: cfg.sttArgs,
      deferUntilDrain: cfg.sttWhen !== "during",
      log,
      onResult: (seq, rec) => writer?.setTranscript(seq, rec),
    });
    const handoffRef = handoff;
    writer = new WavChunkWriter({
      dir: meetingDir,
      meetingUrl: opts.url,
      chunkSeconds: opts.chunkSeconds ?? cfg.chunkSeconds,
      onChunkClosed: (chunk, wavPath) => {
        log("chunk_closed", { seq: chunk.seq, bytes: chunk.file_bytes, seconds: chunk.duration_seconds, sha256: chunk.sha256 });
        handoffRef.enqueue(chunk, wavPath);
      },
    });
    const writerRef = writer;
    audio.onPcm((pcm) => writerRef.write(pcm));
    const stats = await audio.start(page);
    result.audio.mode = stats.mode;
    result.audio.sample_rate = stats.sampleRate;

    const detector = new EndDetector({
      startedAtMs: inMeetingAt,
      maxSeconds: Math.min(opts.maxSeconds ?? cfg.maxSeconds, cfg.maxSeconds),
      aloneSeconds: opts.aloneSeconds ?? cfg.aloneSeconds,
      inactivitySeconds: opts.inactivitySeconds ?? cfg.inactivitySeconds,
    });
    let leaveMissing = 0;
    let lastHeartbeat = 0;
    let endReason: string = "unknown";
    let endState: BotState = "left";
    for (;;) {
      if (stopRequested) {
        endReason = stopRequested;
        break;
      }
      if (page.isClosed()) {
        endReason = "page_closed";
        break;
      }
      const now = Date.now();
      const [count, text] = await Promise.all([readParticipantCount(page), readPageText(page)]);
      const decision = detector.observe({
        nowMs: now,
        participantCount: count,
        text,
        audioActive: audio.audioActiveWithin(pollMs * 2, now),
      });
      if (decision.leave) {
        log("page_text", { page_text: text.slice(0, 4000) });
        endReason = decision.reason;
        endState =
          decision.reason === "removed"
            ? "removed"
            : decision.reason === "meeting_ended" || decision.reason === "everyone_left"
              ? "meeting_ended"
              : decision.reason === "denied"
                ? "denied"
                : decision.reason === "max_seconds" || decision.reason === "inactivity"
                  ? "timeout"
                  : "left";
        log("end_detected", { reason: decision.reason, detail: decision.detail });
        break;
      }
      // 退出ボタンが 30 秒以上見つからない＝会議画面ではなくなった（文言で分類できない画面）
      if (await isVisible(inMeeting.leaveButton(page), 300)) {
        leaveMissing = 0;
      } else if (++leaveMissing >= Math.max(1, Math.ceil(30000 / pollMs))) {
        log("page_text", { page_text: text.slice(0, 4000) });
        endReason = "signal_lost";
        endState = "meeting_ended";
        break;
      }
      if (now - lastHeartbeat >= 30000) {
        lastHeartbeat = now;
        log("heartbeat", {
          participants: count,
          pcm_bytes: audio.bytesReceived,
          pcm_chunks: audio.chunksReceived,
          tracks: tracksSeen.size,
          audio_active: audio.audioActiveWithin(pollMs * 2, now),
          chunks_closed: writerRef.manifest.chunks.filter((c) => c.sha256).length,
          elapsed_s: Math.round((now - inMeetingAt) / 1000),
        });
      }
      await page.waitForTimeout(pollMs);
    }

    // ---- 退出 ----
    await transition("leaving", endReason);
    result.in_meeting_seconds = (Date.now() - inMeetingAt) / 1000;
    result.end_reason = endReason;
    await audio.stop(page);
    if (!page.isClosed() && (await isVisible(inMeeting.leaveButton(page), 500))) {
      await inMeeting.leaveButton(page).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
    result.manifest = writer.close(endReason);
    log("manifest_closed", { chunks: result.manifest.chunks.length, total_seconds: result.manifest.total_seconds });
    // 文字起こしを待つ前にブラウザを閉じる。faster-whisper（1.3 GB）と Chromium を同居させない
    await context.close().catch(() => {});
    context = null;
    if (handoff.pendingCount > 0) log("stt_drain_wait", { pending: handoff.pendingCount });
    await handoff.drain();
    result.manifest = writer.manifest;
    await transition(endState === "left" ? "left" : endState, endReason);
    return finish();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(msg);
    log("error", { error: msg });
    if (writer) {
      result.manifest = writer.close(`error: ${msg}`);
    }
    if (result.final_state !== "error") await transition(stopRequested ? "left" : "error", msg);
    result.end_reason ??= stopRequested ?? "error";
    return finish();
  } finally {
    process.removeListener("SIGINT", onSigint);
    if (context) {
      await context.close().catch(() => {});
    }
  }

  function finish(): JoinResult {
    result.audio.bytes = audio.bytesReceived;
    result.audio.chunks_received = audio.chunksReceived;
    result.audio.tracks_seen = tracksSeen.size;
    saveResult();
    log("result", {
      final_state: result.final_state,
      end_reason: result.end_reason,
      join_button_seen: result.join_button_seen,
      audio_bytes: result.audio.bytes,
      chunks: result.manifest?.chunks.length ?? 0,
    });
    return result;
  }
}

/**
 * 入室前にマイクとカメラを切る。
 * 「今オンか」は data-is-muted 属性 → aria-label の順に読む。分からなければ押さない（押すとオンになるかもしれない）。
 */
async function muteDevices(page: Page, log: Logger["log"]): Promise<void> {
  for (const [name, locator] of [
    ["mic", preJoin.micToggle(page)],
    ["cam", preJoin.camToggle(page)],
  ] as const) {
    if (!(await isVisible(locator, 1500))) {
      log("device_toggle", { device: name, result: "not_found" });
      continue;
    }
    const attr = await locator.getAttribute("data-is-muted").catch(() => null);
    const label = await locator.getAttribute("aria-label").catch(() => null);
    const on = attr !== null ? attr !== "true" : preJoin.isDeviceOn(label);
    if (on === true) {
      await locator.click({ timeout: 3000 }).catch((e: unknown) => log("device_toggle", { device: name, result: "click_failed", error: String(e) }));
      log("device_toggle", { device: name, result: "turned_off", label });
    } else {
      log("device_toggle", { device: name, result: on === false ? "already_off" : "unknown_state", label });
    }
  }
}
