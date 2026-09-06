// 進行中の RTMS セッションの台帳。webhook の started/stopped とセッションの終了を突き合わせる。
//
// なぜ要るか: Zoom は同じ webhook を再送することがある（5xx を返すと 3 回・#…docs/api/webhooks）し、
// 1 会議で RTMS が止まって再開すると rtms_stream_id が変わる。「stream_id ごとに 1 セッション」を守り、
// 二重接続（同じ音声を 2 回保存・クレジットの二重消費）を避ける。

export interface ManagedSession {
  stop(reason: string): void;
}

export interface SessionKey {
  meetingUuid: string;
  streamId: string;
}

export type SessionFactory<S extends ManagedSession, I extends SessionKey> = (
  info: I,
  /** セッションが自分で終わったときに台帳から外すために呼ぶ */
  onEnd: () => void,
) => S;

export class SessionManager<S extends ManagedSession, I extends SessionKey> {
  private readonly sessions = new Map<string, S>();
  constructor(
    private readonly factory: SessionFactory<S, I>,
    private readonly log: (message: string, data?: unknown) => void = () => {},
  ) {}

  get size(): number {
    return this.sessions.size;
  }

  has(streamId: string): boolean {
    return this.sessions.has(streamId);
  }

  /** 新規なら作って "started"、同じ stream_id が進行中なら "duplicate" */
  start(info: I): "started" | "duplicate" {
    if (this.sessions.has(info.streamId)) {
      this.log("duplicate rtms_started（無視）", { streamId: info.streamId });
      return "duplicate";
    }
    const session = this.factory(info, () => {
      // 自分が終わったら台帳から外す。ただし同じ id で別のセッションに差し替わっていたら触らない
      if (this.sessions.get(info.streamId) === session) this.sessions.delete(info.streamId);
    });
    this.sessions.set(info.streamId, session);
    return "started";
  }

  /** rtms_stopped から。知らない stream_id なら false（既に終わっている・別プロセス宛て） */
  stop(streamId: string, reason: string): boolean {
    const s = this.sessions.get(streamId);
    if (!s) return false;
    this.sessions.delete(streamId);
    s.stop(reason);
    return true;
  }

  stopAll(reason: string): number {
    const n = this.sessions.size;
    for (const [id, s] of [...this.sessions]) {
      this.sessions.delete(id);
      s.stop(reason);
    }
    return n;
  }
}
