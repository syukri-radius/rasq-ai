import { NextResponse } from "next/server";

export const ok = (data: unknown = { ok: true }, status = 200) => NextResponse.json(data, { status });
/** Error envelope: `{ error: string, code?: string }`. `code` is machine-readable for external agents; `error` stays human-readable and backward compatible. */
export const fail = (message: string, status = 400, code?: string) => NextResponse.json(code ? { error: message, code } : { error: message }, { status });
export type Params<T extends string> = { params: Promise<Record<T, string>> };
/**
 * Default JSON body cap. Callers with large payloads (screenshots, AI scan images) pass an
 * explicit higher limit. When the raw body exceeds the limit we refuse to parse it and
 * return the same empty-object fallback as a malformed body — every route then fails its
 * normal validation instead of crashing or buffering gigabytes into memory.
 * (A missing/lying content-length is covered by measuring the decoded text as well.)
 */
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
export async function body<T = Record<string, unknown>>(req: Request, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<T> {
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
/** Early 413 helper for routes that should reject by content-length before reading anything. */
export function contentLengthExceeds(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers.get("content-length") ?? 0);
  return Number.isFinite(len) && len > maxBytes;
}
