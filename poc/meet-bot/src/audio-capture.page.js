// @ts-check
// ブラウザに注入する側のスクリプト（プレーン JS）。Node 側は audio-capture.ts。
//
// なぜ .ts の関数ではなく別ファイルの JS か: tsx（esbuild）は関数を変換するときに `__name(...)` という補助関数を
// 差し込む。Playwright の addInitScript は関数を toString() してページに送るので、ページ側で `__name` が未定義になり
// 初期化スクリプトが黙って失敗する（実際に起きた）。文字列として読んで送れば変換を受けない。
// 型検査は // @ts-check と JSDoc で受ける（tsconfig の checkJs）。
//
// 役割: RTCPeerConnection と <audio>/<video>.srcObject をフックして受信音声トラックを集め、AudioContext（16 kHz）で
// 1 本に合成 → AudioWorklet で Int16 PCM → base64 → Node のバインディング（cfg.pcmBinding）へ渡す。
// 設計の理由は audio-capture.ts の冒頭コメントを参照。

/**
 * @typedef {{ sampleRate: number, chunkFrames: number, pcmBinding: string, eventBinding: string }} PageScriptConfig
 * @typedef {{ track: MediaStreamTrack, origin: string, source: MediaStreamAudioSourceNode | null }} Entry
 */

/** @param {PageScriptConfig} cfg */
function kimaruAudioCapture(cfg) {
  /** @type {any} */
  const w = window;
  if (w.__kimaruAudio) return;

  /** @type {Map<string, Entry>} */
  const tracks = new Map();
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {GainNode | null} */
  let mixer = null;
  /** @type {GainNode | null} */
  let sink = null;
  let started = false;
  /** @type {"worklet" | "script_processor" | null} */
  let mode = null;
  let samplesOut = 0;
  let chunksOut = 0;
  /** @type {number | null} */
  let scanTimer = null;
  /** @type {string[]} */
  const errors = [];

  /** @param {Record<string, unknown>} ev */
  function emit(ev) {
    const f = w[cfg.eventBinding];
    if (typeof f !== "function") return;
    try {
      f(JSON.stringify(Object.assign({}, ev, { t: Date.now() })));
    } catch (_e) {
      // Node 側が居なくても録音は続ける
    }
  }

  /** @param {ArrayBuffer} buf */
  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    }
    return btoa(s);
  }

  /** @param {ArrayBuffer} buf */
  function deliver(buf) {
    samplesOut += buf.byteLength / 2;
    chunksOut += 1;
    const f = w[cfg.pcmBinding];
    if (typeof f !== "function") return;
    try {
      f(toBase64(buf));
    } catch (e) {
      errors.push("deliver: " + String(e));
    }
  }

  // AudioWorkletProcessor。音声スレッドで動くので、Meet のメインスレッドが重くても取りこぼしにくい。
  // 入力が無い（トラック未接続）ときも 0 を書いて時間軸を進める（入室〜最初の声までを無音として残す）。
  const workletSource = [
    "class KimaruPcm extends AudioWorkletProcessor {",
    "  constructor(o) {",
    "    super();",
    "    this.n = (o && o.processorOptions && o.processorOptions.chunkFrames) || 4096;",
    "    this.buf = new Int16Array(this.n);",
    "    this.i = 0;",
    "  }",
    "  process(inputs) {",
    "    const ch = inputs[0] && inputs[0][0];",
    "    const frames = ch ? ch.length : 128;",
    "    for (let k = 0; k < frames; k++) {",
    "      let v = ch ? ch[k] : 0;",
    "      if (v > 1) v = 1; else if (v < -1) v = -1;",
    "      this.buf[this.i++] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);",
    "      if (this.i === this.n) {",
    "        const out = this.buf.buffer;",
    "        this.port.postMessage(out, [out]);",
    "        this.buf = new Int16Array(this.n);",
    "        this.i = 0;",
    "      }",
    "    }",
    "    return true;",
    "  }",
    "}",
    'registerProcessor("kimaru-pcm", KimaruPcm);',
  ].join("\n");

  /** @returns {AudioContext} */
  function ensureContext() {
    if (ctx) return ctx;
    const c = new AudioContext({ sampleRate: cfg.sampleRate, latencyHint: "playback" });
    ctx = c;
    mixer = c.createGain();
    // 出力先に繋がないと Chromium はグラフを回さないことがあるので、音量 0 で destination に繋ぐ
    sink = c.createGain();
    sink.gain.value = 0;
    sink.connect(c.destination);
    c.addEventListener("statechange", () => {
      emit({ type: "ctx_state", state: c.state });
      if (started && c.state === "suspended") c.resume().catch(() => {});
    });
    return c;
  }

  /** @param {AudioContext} c */
  async function setupProcessor(c) {
    if (!mixer || !sink) return;
    try {
      const url = URL.createObjectURL(new Blob([workletSource], { type: "application/javascript" }));
      await c.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(c, "kimaru-pcm", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        // 入力をここでモノラルに落とす（複数トラックの合成もこの入口で起きる）
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: { chunkFrames: cfg.chunkFrames },
      });
      node.port.onmessage = (e) => deliver(/** @type {ArrayBuffer} */ (e.data));
      mixer.connect(node);
      node.connect(sink);
      mode = "worklet";
    } catch (e) {
      // ページの CSP が blob: の worker を拒むときの予備。メインスレッドで動くので取りこぼす可能性はある
      errors.push("worklet: " + String(e));
      const sp = c.createScriptProcessor(cfg.chunkFrames, 1, 1);
      sp.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const out = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          let v = input[i] ?? 0;
          if (v > 1) v = 1;
          else if (v < -1) v = -1;
          out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
        }
        deliver(out.buffer);
      };
      mixer.connect(sp);
      sp.connect(sink);
      mode = "script_processor";
    }
  }

  /** @param {Entry} entry */
  function connect(entry) {
    if (!ctx || !mixer || entry.source) return;
    try {
      const ms = new MediaStream([entry.track]);
      entry.source = ctx.createMediaStreamSource(ms);
      entry.source.connect(mixer);
      emit({ type: "track_connected", id: entry.track.id, origin: entry.origin });
    } catch (e) {
      errors.push("connect: " + String(e));
      emit({ type: "track_connect_error", id: entry.track.id, error: String(e) });
    }
  }

  /** @param {string} id @param {string} why */
  function removeTrack(id, why) {
    const e = tracks.get(id);
    if (!e) return;
    try {
      if (e.source) e.source.disconnect();
    } catch (_err) {
      // 既に切れている
    }
    tracks.delete(id);
    emit({ type: "track_removed", id, why });
  }

  /** @param {MediaStreamTrack | null | undefined} track @param {string} origin */
  function addTrack(track, origin) {
    if (!track || track.kind !== "audio") return;
    if (track.readyState === "ended") return;
    if (tracks.has(track.id)) return;
    /** @type {Entry} */
    const entry = { track, origin, source: null };
    tracks.set(track.id, entry);
    emit({ type: "track_added", id: track.id, origin, label: track.label, muted: track.muted });
    track.addEventListener("ended", () => removeTrack(track.id, "ended"));
    if (started) connect(entry);
  }

  /** @param {unknown} stream @param {string} origin */
  function addStream(stream, origin) {
    const ms = /** @type {MediaStream | null} */ (stream);
    if (!ms || typeof ms.getAudioTracks !== "function") return;
    ms.getAudioTracks().forEach((t) => addTrack(t, origin));
    ms.addEventListener("addtrack", (ae) => addTrack(ae.track, origin + "_addtrack"));
  }

  // ---- フック 1: RTCPeerConnection の受信トラック ----
  /** @type {typeof RTCPeerConnection} */
  const OrigPC = w.RTCPeerConnection;
  if (typeof OrigPC === "function") {
    class PatchedPC extends OrigPC {
      /** @param {any[]} args */
      constructor(...args) {
        super(...args);
        emit({ type: "pc_created" });
        this.addEventListener("track", (e) => {
          addTrack(e.track, "rtc_track");
          if (e.streams) e.streams.forEach((s) => addStream(s, "rtc_stream"));
        });
      }
    }
    w.RTCPeerConnection = PatchedPC;
    w.webkitRTCPeerConnection = PatchedPC;
  }

  // ---- フック 2: <audio>/<video>.srcObject（Meet が鳴らしている MediaStream）----
  const proto = HTMLMediaElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "srcObject");
  const getter = desc && desc.get;
  const setter = desc && desc.set;
  if (desc && getter && setter) {
    Object.defineProperty(proto, "srcObject", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return getter.call(this);
      },
      /** @param {unknown} v */
      set(v) {
        try {
          addStream(v, "media_element");
        } catch (e) {
          errors.push("srcObject: " + String(e));
        }
        return setter.call(this, v);
      },
    });
  }

  // ---- フック 3: 既存の <audio>/<video> を定期的に走査（Vexa と同じ保険。フック前に作られた要素を拾う）----
  function scan() {
    document.querySelectorAll("audio, video").forEach((el) => {
      const s = /** @type {HTMLMediaElement} */ (el).srcObject;
      if (s instanceof MediaStream) addStream(s, "scan");
    });
  }

  function stats() {
    return {
      started,
      mode,
      ctxState: ctx ? ctx.state : null,
      sampleRate: ctx ? ctx.sampleRate : null,
      tracks: Array.from(tracks.values()).map((e) => ({
        id: e.track.id,
        origin: e.origin,
        readyState: e.track.readyState,
        muted: e.track.muted,
        connected: e.source !== null,
      })),
      samplesOut,
      chunksOut,
      errors: errors.slice(-5),
    };
  }

  const api = {
    async start() {
      const c = ensureContext();
      if (!started) {
        started = true;
        await setupProcessor(c);
      }
      try {
        await c.resume();
      } catch (e) {
        errors.push("resume: " + String(e));
      }
      tracks.forEach(connect);
      scan();
      if (scanTimer === null) scanTimer = window.setInterval(scan, 5000);
      emit({ type: "started", mode, sampleRate: c.sampleRate, state: c.state, tracks: tracks.size });
      return stats();
    },
    async stop() {
      started = false;
      if (scanTimer !== null) {
        clearInterval(scanTimer);
        scanTimer = null;
      }
      tracks.forEach((e) => {
        try {
          if (e.source) e.source.disconnect();
        } catch (_err) {
          // 既に切れている
        }
        e.source = null;
      });
      if (ctx) {
        try {
          await ctx.close();
        } catch (_err) {
          // 閉じ済み
        }
      }
      emit({ type: "stopped", samplesOut, chunksOut });
    },
    stats,
  };
  w.__kimaruAudio = api;
}
