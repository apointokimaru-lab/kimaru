// 設定はここ 1 か所で env から読む（他のファイルは process.env を直接読まない）。
// なぜ: 本番設計（docs/ai-bot/system-spec.md）では Bot は Fargate タスクとして env で設定を受け取るので、
// PoC の時点から「設定は env・コードは既定値だけ持つ」形にしておくと、そのまま持ち上げられる。
// .env は dotenv を入れずに自前で読む（この PoC は依存を増やさない方針。`KEY=value` の行だけの最小構文）。

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** poc/meet-bot/ の絶対パス（cwd がどこでも同じ場所を指すため） */
export const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 安全タイムアウトの上限（4 時間）。env で何を指定してもこれより長くはしない。
 * なぜ: 終了検知に失敗した Bot が会議室に居座り続けると、録音し続ける＝参加者の同意範囲を越える。
 * 4 時間は 1 on 1 面談としては十分に長く、暴走の被害も 1 会議分で止まる。
 */
export const MAX_SECONDS_HARD_LIMIT = 4 * 60 * 60;

export interface BotConfig {
  /** 人がログインした Chromium プロファイル。Bot は絶対に自分でログインしない */
  profileDir: string;
  /** 会議ごとのディレクトリを作る親 */
  outDir: string;
  /** 安全タイムアウト（秒）。MAX_SECONDS_HARD_LIMIT で丸めた後の値 */
  maxSeconds: number;
  /** 待機室で承認を待つ上限（秒） */
  waitingRoomSeconds: number;
  /** 参加者が 1 人以下（Bot だけ）になってから退出するまで（秒） */
  aloneSeconds: number;
  /** 参加者数が読めず、音も無いときに諦めるまで（秒） */
  inactivitySeconds: number;
  /** WAV 1 本の長さ（秒） */
  chunkSeconds: number;
  /** 文字起こしを呼ぶ Python。空なら飛ばす */
  sttPython: string;
  /** transcribe.py の絶対パス */
  sttScript: string;
  /** transcribe.py に足す引数 */
  sttArgs: string[];
  /**
   * 文字起こしをいつ回すか。after（既定）＝退出してブラウザを閉じてから。during＝チャンクが閉じるたび会議中に。
   * なぜ after が既定か: この PC で during にしたところ、faster-whisper（4 スレッド）が回っている間に擬似ページ側の
   * 音声が途切れた（送信側の WebRTC が CPU を取られて止まり、復帰しなかった）。会議中に CPU を奪うと録音そのものを
   * 危うくするので、同じ機械で回すなら会議の後にする。別の機械で回す本番（STT ワーカーは別タスク）では during 相当になる。
   */
  sttWhen: "after" | "during";
  headless: boolean;
  /** Playwright の channel。chromium（新ヘッドレス）が既定。空なら Playwright 同梱の headless shell */
  browserChannel: string;
  /**
   * Chromium に「無音のマイク」を持たせるか。既定 false（端末にデバイス無し。Meet は「マイクが見つかりません」と
   * 出すが参加はできる想定）。true にすると --use-fake-device-for-media-stream と、無音 WAV を入力にする
   * --use-file-for-fake-audio-capture を渡す。Chromium 既定のフェイク音源はビープ音を出すので、
   * マイクがオンのまま入室すると会議にビープが流れる。無音ファイルを必ず添える。
   */
  fakeDevices: boolean;
}

/** `.env` を読んで、まだ無いキーだけ process.env に入れる（既にある env が勝つ） */
export function loadDotEnv(file = path.join(POC_ROOT, ".env")): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function intEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

function resolveFromPoc(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(POC_ROOT, p);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const maxRequested = intEnv("MEET_MAX_SECONDS", MAX_SECONDS_HARD_LIMIT);
  return {
    profileDir: resolveFromPoc(env.MEET_PROFILE_DIR || "./profile"),
    outDir: resolveFromPoc(env.MEET_OUT_DIR || "./out"),
    maxSeconds: Math.min(maxRequested, MAX_SECONDS_HARD_LIMIT),
    waitingRoomSeconds: intEnv("MEET_WAITING_ROOM_SECONDS", 15 * 60),
    aloneSeconds: intEnv("MEET_ALONE_SECONDS", 5 * 60),
    inactivitySeconds: intEnv("MEET_INACTIVITY_SECONDS", 20 * 60),
    chunkSeconds: intEnv("MEET_CHUNK_SECONDS", 15 * 60),
    sttPython: env.STT_PYTHON || "",
    sttScript: resolveFromPoc(env.STT_SCRIPT || "../stt/transcribe.py"),
    sttArgs: (env.STT_ARGS ?? "--model small --threads 4").split(/\s+/).filter(Boolean),
    sttWhen: env.STT_WHEN === "during" ? "during" : "after",
    headless: (env.MEET_HEADLESS ?? "1") !== "0",
    browserChannel: env.MEET_BROWSER_CHANNEL ?? "chromium",
    fakeDevices: env.MEET_FAKE_DEVICES === "1",
  };
}
