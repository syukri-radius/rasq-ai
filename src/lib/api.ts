import { NextResponse } from "next/server";

export const ok = (data: unknown = { ok: true }, status = 200) => NextResponse.json(data, { status });
/** Error envelope: `{ error: string, code?: string }`. `code` is machine-readable for external agents; `error` stays human-readable and backward compatible. */
export const fail = (message: string, status = 400, code?: string) => NextResponse.json(code ? { error: message, code } : { error: message }, { status });
export type Params<T extends string> = { params: Promise<Record<T, string>> };
export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
