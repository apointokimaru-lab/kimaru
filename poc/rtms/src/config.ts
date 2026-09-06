// 設定の読み取り（1 か所に集約）。
//
// なぜ: リポジトリの規約は「process.env を散らさない」（CLAUDE.md・docs/frontend-conventions.md）。
// この PoC は eslint の対象外だが、同じ精神で env を読む場所をここだけにする。
// 何を: poc/rtms/.env を読み（無ければ無視）、必須値の欠けを起動時に一度で報告し、型の付いた設定を返す。

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RtmsPocConfig {
  /** Zoom アプリの Client ID。RTMS ハンドシェイクの署名に使う */
  clientId: string;
  /** Zoom アプリの Client Secret。RTMS ハンドシェイクの署名鍵 */
  clientSecret: string;
  /** Event Subscription の Secret Token。webhook の署名検証と URL 検証に使う */
  webhookSecretToken: string;
  port: number;
  webhookPath: string;
  /** x-zm-request-timestamp の許容ずれ（秒） */
  webhookTimestampToleranceSec: number;
  /** 音声の保存先（絶対パス） */
  outDir: string;
  /** 1 チャンクの長さ（秒） */
  chunkSeconds: number;
  /** シグナリング接続までの音声を Zoom に溜めてもらうか */
  bufferData: boolean;
  /** 文字起こし PoC の Python。空なら受け渡しをしない */
  sttPython: string;
  /** transcribe.py の絶対パス */
  sttScript: string;
  sttModel: string;
}

/** poc/rtms ディレクトリ（このファイルの 1 つ上） */
export const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Env = Record<string, string | undefined>;

/**
 * poc/rtms/.env を process.env に読み込む。dotenv を入れずに Node 22 の loadEnvFile を使う。
 * 既に設定済みの変数は上書きしない（Node の仕様）。ファイルが無ければ何もしない。
 */
export function loadDotEnv(file = path.join(POC_ROOT, ".env")): boolean {
  if (!existsSync(file)) return false;
  try {
    process.loadEnvFile(file);
    return true;
  } catch {
    return false;
  }
}

function str(env: Env, name: string, fallback = ""): string {
  const v = env[name];
  return v === undefined || v === "" ? fallback : v;
}

function int(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} は正の数にする（受け取った値: ${JSON.stringify(raw)}）`);
  }
  return n;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

/**
 * env から設定を組み立てる。必須 3 つ（Client ID / Client Secret / Secret Token）が欠けていれば
 * まとめて 1 つのエラーにする（1 つずつ直させると 3 回起動し直すことになるため）。
 */
export function loadConfig(env: Env = process.env): RtmsPocConfig {
  const required = ["ZOOM_RTMS_CLIENT_ID", "ZOOM_RTMS_CLIENT_SECRET", "ZOOM_WEBHOOK_SECRET_TOKEN"] as const;
  const missing = required.filter((k) => !str(env, k));
  if (missing.length > 0) {
    throw new Error(
      `環境変数が足りません: ${missing.join(", ")}（poc/rtms/.env.example を .env にコピーして埋める）`,
    );
  }
  return {
    clientId: str(env, "ZOOM_RTMS_CLIENT_ID"),
    clientSecret: str(env, "ZOOM_RTMS_CLIENT_SECRET"),
    webhookSecretToken: str(env, "ZOOM_WEBHOOK_SECRET_TOKEN"),
    port: int(env, "PORT", 3400),
    webhookPath: str(env, "WEBHOOK_PATH", "/webhook"),
    webhookTimestampToleranceSec: int(env, "WEBHOOK_TIMESTAMP_TOLERANCE_SEC", 300),
    outDir: path.resolve(POC_ROOT, str(env, "RTMS_OUT_DIR", "./out")),
    chunkSeconds: int(env, "RTMS_CHUNK_SECONDS", 900),
    bufferData: bool(env, "RTMS_BUFFER_DATA", true),
    sttPython: str(env, "STT_PYTHON"),
    sttScript: path.resolve(POC_ROOT, str(env, "STT_SCRIPT", "../stt/transcribe.py")),
    sttModel: str(env, "STT_MODEL", "small"),
  };
}
