// 直線補間の簡易リサンプラ（ブラウザ側の AudioContext が 16 kHz で作れなかったときの保険）。
// なぜ必要か: Chromium は AudioContext({sampleRate: 16000}) を受け付けるので通常は使わない。
// ただし ctx.sampleRate が要求と違った場合に無言で 48 kHz を 16 kHz として WAV に書くと、
// 再生速度が 3 倍の音声になり文字起こしが全滅する。要求と違えばここで揃える。
// 品質は直線補間相当（高域の折り返しは残る）。本番で必要になったら sinc 系に替える。

export class LinearResampler {
  private readonly ratio: number;
  private pos = 0; // 入力サンプル単位の読み出し位置（小数）
  private last = 0; // 前回の入力の最後のサンプル（境界をまたぐ補間用）
  private primed = false;

  constructor(
    readonly fromRate: number,
    readonly toRate: number,
  ) {
    if (fromRate <= 0 || toRate <= 0) throw new Error("sample rate must be positive");
    this.ratio = fromRate / toRate;
  }

  /** 入力 Int16 を変換して返す。境界の 1 サンプルは内部に持ち越す */
  process(input: Int16Array): Int16Array {
    if (this.fromRate === this.toRate) return input;
    if (input.length === 0) return new Int16Array(0);
    // 前回の最後のサンプルを先頭に足した配列上で補間する
    const src = new Int16Array(input.length + 1);
    src[0] = this.primed ? this.last : (input[0] ?? 0);
    src.set(input, 1);
    const out: number[] = [];
    // pos は src のインデックス空間（0 = 前回の最後のサンプル）
    while (this.pos + 1 < src.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = src[i] ?? 0;
      const b = src[i + 1] ?? a;
      out.push(Math.round(a + (b - a) * frac));
      this.pos += this.ratio;
    }
    // 次回のために位置を src の末尾基準へ戻す
    this.pos -= src.length - 1;
    this.last = input[input.length - 1] ?? 0;
    this.primed = true;
    return Int16Array.from(out);
  }
}
