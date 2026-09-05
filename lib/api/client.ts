import type { ZodType } from "zod";

// クライアントから既存 API（/api/* ＝ Netlify Functions）を呼ぶための薄い層（規約 5 章）。
// - 同一オリジン固定・JSON・Cookie 同送（credentials: same-origin）
// - 応答は Zod で検証してから返す（外から来る値は境界で検証する・規約 3 章）
// - 失敗は ApiError（status・code・message）。画面は code/message を i18n キーに引く
// 書き込みの責任は Functions 側にある（並行稼働ルール）。ここでは呼ぶだけで、業務ロジックを持たない。

export type ApiPath = `/api/${string}`;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, fallbackMessage: string) {
    // Functions は失敗時に { error: "…" } を返す慣習。無ければ呼び出し側の既定文言
    const fromBody =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "";
    super(fromBody || fallbackMessage);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiOptions = {
  /** テストで差し替えるため。省略時は globalThis.fetch */
  fetchImpl?: FetchLike;
  /** 応答本文に error が無いときの文言（i18n 済みの文字列を渡す） */
  fallbackMessage?: string;
};

const DEFAULT_FALLBACK = "リクエストに失敗しました。";

async function handle<T>(res: Response, schema: ZodType<T>, fallbackMessage: string): Promise<T> {
  // 本文が JSON でない（HTML のエラーページ等）場合も落とさず、空として扱う
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data, fallbackMessage);
  return schema.parse(data);
}

export async function apiGet<T>(
  path: ApiPath,
  schema: ZodType<T>,
  options: ApiOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const res = await fetchImpl(path, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  return handle(res, schema, options.fallbackMessage ?? DEFAULT_FALLBACK);
}

export async function apiPost<T>(
  path: ApiPath,
  body: unknown,
  schema: ZodType<T>,
  options: ApiOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const res = await fetchImpl(path, {
    method: "POST",
    credentials: "same-origin",
    // Functions の readJson は content-type を application/json に限定している（ログイン CSRF 対策・#266）
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  return handle(res, schema, options.fallbackMessage ?? DEFAULT_FALLBACK);
}
