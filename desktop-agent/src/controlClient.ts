import type { DesktopAgentPoll, DesktopAssignment, DesktopCapabilities, DesktopDisplay, DesktopEvent, DesktopPermissions } from "../../src/lib/desktopContract";
import type { DesktopDriver } from "./driver";

export function normalizeControlUrl(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Control plane must use HTTP(S).");
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) throw new Error("Plain HTTP is allowed only for local development.");
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export type EnrollmentResult = { agent: { id: string }; deviceToken: string; controlPlane: string };

export class ControlClient {
  constructor(readonly baseUrl: string, private readonly deviceToken = "") {
    this.baseUrl = normalizeControlUrl(baseUrl);
  }

  static async enroll(controlUrl: string, enrollmentToken: string, name: string, driver: DesktopDriver): Promise<EnrollmentResult> {
    const client = new ControlClient(controlUrl);
    return client.request<EnrollmentResult>("/api/desktop/agents/enroll", {
      method: "POST",
      token: enrollmentToken,
      body: {
        name,
        os: process.platform,
        arch: process.arch,
        agentVersion: "0.1.0",
        capabilities: driver.capabilities(),
        displays: await driver.displays(),
        permissions: await driver.permissions(),
      },
    });
  }

  poll(input: DesktopAgentPoll): Promise<{ pollAfterMs: number; assignment: DesktopAssignment | null; serverTime: string }> {
    return this.request("/api/desktop/agents/poll", { method: "POST", body: input });
  }

  async bundle(runId: string): Promise<Buffer> {
    return this.request<Buffer>(`/api/desktop/runs/${runId}/bundle`, { binary: true });
  }

  event(runId: string, event: DesktopEvent): Promise<{ accepted: number; nextSequence: number }> {
    return this.request(`/api/desktop/runs/${runId}/events`, { method: "POST", body: { events: [event] } });
  }

  evidence(runId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`/api/desktop/runs/${runId}/evidence`, { method: "POST", body: input });
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown; token?: string; binary?: boolean } = {}): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...((options.token ?? this.deviceToken) ? { authorization: `Bearer ${options.token ?? this.deviceToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 26 * 1024 * 1024) throw new Error("Control-plane response exceeds the agent size limit.");
    if (!response.ok) {
      let message = `Control plane returned HTTP ${response.status}.`;
      try { message = (JSON.parse(bytes.toString("utf8")) as { error?: string }).error ?? message; } catch { /* sanitized HTTP fallback */ }
      throw new Error(message.slice(0, 1000));
    }
    return (options.binary ? bytes : JSON.parse(bytes.toString("utf8"))) as T;
  }
}

export async function pollPayload(driver: DesktopDriver, currentRunId: string | null): Promise<DesktopAgentPoll> {
  return {
    agentVersion: "0.1.0",
    capabilities: driver.capabilities() as DesktopCapabilities,
    displays: await driver.displays() as DesktopDisplay[],
    permissions: await driver.permissions() as DesktopPermissions,
    currentRunId,
  };
}
