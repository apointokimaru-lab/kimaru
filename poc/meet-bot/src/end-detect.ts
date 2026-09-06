// 終了検知の状態機械。DOM や時計に触らない純ロジックにして node:test で固定する。
//
// なぜ純ロジックに分けるか: 本物の Meet を相手にした試験は 1 回ごとに人が会議を開く必要があり、
// 「参加者が 5 分いなかったら退出」のような条件を実機で何度も再現するのは現実的でない。
// 判定だけを切り出せば、時刻を進めた入力を並べて全経路を秒で確認できる。
//
// 入力は join.ts が数秒おきに集める観測値（画面文言・参加者数・音の有無）。出力は「続ける」か「退出（理由）」。

import { classifyText } from "./selectors.js";

export type EndReason =
  | "removed" // ホストに退出させられた
  | "meeting_ended" // 会議が終わった（画面文言）
  | "denied" // 参加を拒否された（待機室から）
  | "everyone_left" // 参加者が Bot だけになって aloneSeconds 経過
  | "inactivity" // 参加者数が読めず、音も無い状態が inactivitySeconds 続いた（DOM 変更時の保険）
  | "max_seconds"; // 安全タイムアウト

export interface Signals {
  nowMs: number;
  /** DOM から読んだ参加者数（Bot 自身を含む）。読めなければ null */
  participantCount: number | null;
  /** 画面の見える文言 */
  text: string;
  /** 直近の観測窓で無音でない音が来たか */
  audioActive: boolean;
}

export type Decision = { leave: false } | { leave: true; reason: EndReason; detail: string };

export interface EndDetectorOptions {
  startedAtMs: number;
  maxSeconds: number;
  aloneSeconds: number;
  inactivitySeconds: number;
}

export class EndDetector {
  private readonly opts: EndDetectorOptions;
  private aloneSinceMs: number | null = null;
  private quietSinceMs: number | null = null;

  constructor(opts: EndDetectorOptions) {
    this.opts = opts;
  }

  observe(s: Signals): Decision {
    // 1. 画面文言。Meet が「削除された／終了した／拒否された」と言っているなら他の条件より優先する
    const cls = classifyText(s.text);
    if (cls === "removed") return { leave: true, reason: "removed", detail: "画面に削除の文言" };
    if (cls === "ended") return { leave: true, reason: "meeting_ended", detail: "画面に終了の文言" };
    if (cls === "denied") return { leave: true, reason: "denied", detail: "画面に拒否の文言" };

    // 2. 安全タイムアウト。会議が続いていても退出する（同意した範囲を越えて録り続けない）
    const elapsed = (s.nowMs - this.opts.startedAtMs) / 1000;
    if (elapsed >= this.opts.maxSeconds) {
      return { leave: true, reason: "max_seconds", detail: `${Math.floor(elapsed)} 秒経過` };
    }

    // 3. 参加者数。1 人以下（＝Bot だけ）が aloneSeconds 続いたら「全員退出」。
    //    一瞬 1 人になっただけ（相手の再接続）で出ないように、連続時間で見る。
    if (s.participantCount !== null) {
      this.quietSinceMs = null; // 参加者数が読めているなら無音判定は使わない
      if (s.participantCount <= 1) {
        this.aloneSinceMs ??= s.nowMs;
        const alone = (s.nowMs - this.aloneSinceMs) / 1000;
        if (alone >= this.opts.aloneSeconds) {
          return { leave: true, reason: "everyone_left", detail: `参加者 ${s.participantCount} 人が ${Math.floor(alone)} 秒` };
        }
      } else {
        this.aloneSinceMs = null;
      }
      return { leave: false };
    }

    // 4. 参加者数が読めない（Meet の DOM が変わった）。音も無い状態が続くなら諦めて退出する。
    //    会議中の無音は普通にあるので、参加者数が読めているときはこの判定を使わない（上で quietSince を消している）。
    this.aloneSinceMs = null;
    if (s.audioActive) {
      this.quietSinceMs = null;
      return { leave: false };
    }
    this.quietSinceMs ??= s.nowMs;
    const quiet = (s.nowMs - this.quietSinceMs) / 1000;
    if (quiet >= this.opts.inactivitySeconds) {
      return { leave: true, reason: "inactivity", detail: `参加者数が読めず無音が ${Math.floor(quiet)} 秒` };
    }
    return { leave: false };
  }
}
