// コマンドライン入口。
//   npx tsx src/cli.ts login                      人が Google にログインするための Chromium を開く（自動入力はしない）
//   npx tsx src/cli.ts status                     プロファイルがログイン済みかを見る
//   npx tsx src/cli.ts join --url <meet-url> --invited|--uninvited [--guest-name 名] [--out dir] [--headed] [--no-stt]
//   npx tsx src/cli.ts selftest [--seconds 5] [--wav path]   擬似ページで録音の自己診断
//   npx tsx src/cli.ts fake-meet [--media-dir dir] [--port n] 擬似ページを配って待つ（手で眺める用）
//   npx tsx src/cli.ts fake-run [--seconds 300] [--out dir]   擬似ページに入室して録音し、会議終了で退出（Fargate の実測用・#485）

import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { loadConfig, loadDotEnv } from "./config.js";
import { PROFILE_ARGS, runBot, type JoinMode } from "./join.js";
import { createLogger } from "./log.js";
import { pcmRms, readWav } from "./pcm-analysis.js";
import { runSelftest } from "./selftest.js";
import { startFakeMeet } from "../test/fake-meet/server.js";
import path from "node:path";

function usage(): never {
  process.stderr.write(
    [
      "使い方:",
      "  tsx src/cli.ts login [--url https://meet.google.com/]",
      "  tsx src/cli.ts status",
      "  tsx src/cli.ts join --url <meet-url> [--invited|--uninvited] [--guest-name 名] [--out dir] [--headed] [--max-seconds n] [--chunk-seconds n] [--no-stt]",
      "  tsx src/cli.ts selftest [--seconds 5] [--wav path] [--late ms] [--out dir]",
      "  tsx src/cli.ts fake-meet [--media-dir dir] [--port n]",
      "  tsx src/cli.ts fake-run [--seconds 300] [--chunk-seconds n] [--out dir]",
      "",
      "設定は .env（.env.example を参照）。",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

async function main(): Promise<number> {
  loadDotEnv();
  const cfg = loadConfig();
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage();

  const { values } = parseArgs({
    args: rest,
    options: {
      url: { type: "string" },
      invited: { type: "boolean" },
      uninvited: { type: "boolean" },
      "guest-name": { type: "string" },
      out: { type: "string" },
      headed: { type: "boolean" },
      "max-seconds": { type: "string" },
      "chunk-seconds": { type: "string" },
      "no-stt": { type: "boolean" },
      seconds: { type: "string" },
      wav: { type: "string" },
      late: { type: "string" },
      "media-dir": { type: "string" },
      port: { type: "string" },
    },
    strict: true,
  });

  switch (command) {
    case "login": {
      // 人がログインするための窓を開くだけ。ID・パスワードの入力や「次へ」のクリックはコードに書かない。
      // なぜ: Google の自動ログインは保護措置の回避に当たる（docs/ai-bot/platform-research.md 7.3）。
      // 人が完了したらブラウザを閉じる → プロファイルに Cookie が残り、以後 join が使う。
      //
      // **Playwright で開かない**（2026-09-07・#478 の実機）: Playwright が起動した Chromium は自動操作フラグ
      // （--enable-automation・CDP 接続）が立つため、Google のサインイン画面が
      // 「Couldn't sign you in / This browser or app may not be secure」で必ず弾かれる。
      // ここでは Playwright 同梱の Chromium の実行ファイルを **素のプロセスとして** 起動する。
      // 検知の回避ではない——ログインは実際に人が普通のブラウザ窓で行い、Bot はそのセッション（Cookie）を使うだけ。
      const url = values.url ?? "https://meet.google.com/";
      const exe = chromium.executablePath();
      process.stderr.write(
        [
          `プロファイル: ${cfg.profileDir}`,
          `ブラウザ: ${exe}`,
          "窓が開きます。Bot 用の Google アカウントで手動でログインし、Meet のトップ画面が出たらウィンドウを閉じてください。",
          "（ヘッドレスではないので DISPLAY が必要。WSL2 なら WSLg が :0 を用意する）",
          "",
        ].join("\n"),
      );
      const code = await new Promise<number>((resolve) => {
        const child = spawn(
          exe,
          [
            `--user-data-dir=${cfg.profileDir}`,
            ...PROFILE_ARGS,
            "--no-first-run",
            "--no-default-browser-check",
            url,
          ],
          { stdio: "ignore" },
        );
        child.on("exit", (c) => resolve(c ?? 0));
        child.on("error", () => resolve(1));
      });
      process.stderr.write("ブラウザが閉じられました。`status` でログイン状態を確認できます。\n");
      return code === 0 ? 0 : 0; // 窓の終了コードは問わない（× で閉じても正常）
    }
    case "status": {
      // ログイン済みかの目安。Meet のトップにログイン済みのときだけ出る要素（アカウントボタン／「新しい会議」）を探す
      const context = await chromium.launchPersistentContext(cfg.profileDir, {
        headless: cfg.headless,
        channel: cfg.browserChannel || undefined,
        args: PROFILE_ARGS,
      });
      try {
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto("https://meet.google.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3000);
        const account = page.getByRole("button", { name: /Google アカウント|Google Account/i }).or(page.getByRole("link", { name: /Google アカウント|Google Account/i }));
        const newMeeting = page.getByRole("button", { name: /新しい会議|New meeting/i });
        const signIn = page.getByRole("link", { name: /^(ログイン|Sign in)$/i });
        const [hasAccount, hasNew, hasSignIn] = await Promise.all([
          account.first().isVisible().catch(() => false),
          newMeeting.first().isVisible().catch(() => false),
          signIn.first().isVisible().catch(() => false),
        ]);
        const signedIn = hasAccount || hasNew;
        process.stdout.write(
          JSON.stringify({ profile_dir: cfg.profileDir, url: page.url(), signed_in: signedIn, has_account_button: hasAccount, has_new_meeting: hasNew, has_sign_in_link: hasSignIn }, null, 2) + "\n",
        );
        return signedIn ? 0 : 1;
      } finally {
        await context.close().catch(() => {});
      }
    }
    case "join": {
      if (!values.url) usage();
      const mode: JoinMode = values["guest-name"] ? "guest" : values.invited ? "invited" : values.uninvited ? "uninvited" : "unknown";
      const result = await runBot(
        { ...cfg, outDir: values.out ? path.resolve(values.out) : cfg.outDir },
        {
          url: values.url,
          mode,
          guestName: values["guest-name"],
          headless: values.headed ? false : undefined,
          maxSeconds: values["max-seconds"] ? Number(values["max-seconds"]) : undefined,
          chunkSeconds: values["chunk-seconds"] ? Number(values["chunk-seconds"]) : undefined,
          stt: values["no-stt"] ? false : true,
        },
      );
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return result.final_state === "left" || result.final_state === "meeting_ended" ? 0 : 1;
    }
    case "selftest": {
      const logger = createLogger(null);
      const r = await runSelftest({
        seconds: values.seconds ? Number(values.seconds) : 5,
        wavFile: values.wav ? path.resolve(values.wav) : undefined,
        lateMs: values.late ? Number(values.late) : 0,
        outDir: values.out ? path.resolve(values.out) : undefined,
        channel: cfg.browserChannel,
        log: logger.log,
      });
      // 正弦波なら 440 Hz が立つこと、WAV 再生なら音が入っていることを合格条件にする
      const ok =
        r.wav.length > 0 &&
        r.wav.every((w) => w.sampleRate === 16000) &&
        r.wav.some((w) => (values.wav ? w.rms > 500 : w.rms > 1000 && w.tone > 0.05));
      process.stdout.write(
        JSON.stringify(
          {
            ok,
            out_dir: r.outDir,
            audio_mode: r.audioMode,
            ctx_sample_rate: r.ctxSampleRate,
            tracks_seen: r.tracksSeen,
            pcm_bytes: r.pcmBytes,
            pcm_chunks: r.chunksReceived,
            wav: r.wav.map((w) => ({ ...w, rms: Math.round(w.rms), tone: +w.tone.toFixed(3), tone660: +w.tone660.toFixed(3), durationSeconds: +w.durationSeconds.toFixed(2) })),
          },
          null,
          2,
        ) + "\n",
      );
      return ok ? 0 : 1;
    }
    case "fake-meet": {
      const server = await startFakeMeet({
        mediaDir: values["media-dir"] ? path.resolve(values["media-dir"]) : undefined,
        port: values.port ? Number(values.port) : 0,
      });
      process.stderr.write(`擬似 Meet: ${server.url}  （例: ${server.url}?tone=440&participants=2&end=alone&after=20000）Ctrl+C で終了\n`);
      await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
      await server.close();
      return 0;
    }
    case "fake-run": {
      // Fargate 上で「Chromium ＋ 音声取り込み」の CPU/メモリと課金秒を実測するための腕（#485）。
      // 擬似 Meet を同じプロセスの 127.0.0.1 に配り、本物と同じ runBot（入室 → 録音 → 終了検知 → 退出）を通す。
      // --seconds 後に擬似ページが「会議は終了しました」を出し、Bot は meeting_ended で退出する。
      // 文字起こしは呼ばない（別タスク stt の仕事。Chromium と faster-whisper を同居させて測ると値が混ざる）。
      const seconds = values.seconds ? Number(values.seconds) : 300;
      const server = await startFakeMeet();
      try {
        const q = new URLSearchParams({ tone: "440", participants: "2", end: "ended", after: String(seconds * 1000) });
        const result = await runBot(
          { ...cfg, outDir: values.out ? path.resolve(values.out) : cfg.outDir },
          {
            url: `${server.url}?${q.toString()}`,
            mode: "invited",
            stt: false,
            chunkSeconds: values["chunk-seconds"] ? Number(values["chunk-seconds"]) : undefined,
          },
        );
        // 録れているか（RMS が 0 なら無音＝取り込みが死んでいる）を WAV ごとに数える
        const wav = (result.manifest?.chunks ?? [])
          .filter((c) => c.sha256)
          .map((c) => {
            const info = readWav(path.join(result.out_dir, c.file));
            return { file: c.file, seconds: +info.durationSeconds.toFixed(2), rms: Math.round(pcmRms(info.pcm)) };
          });
        const summary = {
          final_state: result.final_state,
          end_reason: result.end_reason,
          in_meeting_seconds: result.in_meeting_seconds,
          audio_mode: result.audio.mode,
          sample_rate: result.audio.sample_rate,
          pcm_bytes: result.audio.bytes,
          total_seconds: result.manifest?.total_seconds ?? 0,
          chunks: wav.length,
          silent_chunks: wav.filter((w) => w.rms === 0).length,
          wav,
          out_dir: result.out_dir,
          errors: result.errors,
        };
        // CloudWatch Logs から 1 行で拾う
        process.stdout.write("MEET_RESULT " + JSON.stringify(summary) + "\n");
        const ok = (result.final_state === "meeting_ended" || result.final_state === "left") && wav.length > 0 && summary.silent_chunks === 0;
        return ok ? 0 : 1;
      } finally {
        await server.close();
      }
    }
    default:
      usage();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(1);
  },
);
