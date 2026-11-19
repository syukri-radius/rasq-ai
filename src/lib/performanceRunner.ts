import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { checkTarget, parseJtl, renderJmx, type PerformancePlan, type Sample } from "./performance";

// Single-operator, single-process capacity guard; not a distributed job queue.
let active: { id: string; controller: AbortController } | null = null;
export function cancelPerformanceRun(id: string): boolean {
  if (active?.id !== id) return false;
  active.controller.abort();
  return true;
}
export function allowedOrigins(): string[] {
  return (process.env.RASQ_JMETER_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const url = new URL(s);
    if (!/^https?:$/.test(url.protocol) || url.origin !== s || url.username || url.password) throw new Error("Invalid RASQ_JMETER_ALLOWED_ORIGINS entry; use exact origins.");
    return url.origin;
  });
}

export async function runJmeter(id: string, plan: PerformancePlan, command = "jmeter"): Promise<Sample[]> {
  if (active) throw new Error("A JMeter run is already active on this server.");
  checkTarget(plan.url, allowedOrigins());
  const controller = new AbortController();
  active = { id, controller };
  const dir = path.join(process.cwd(), "data", "jmeter", id);
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const jmx = path.join(dir, "plan.jmx");
    const jtl = path.join(dir, "results.jtl");
    await fs.writeFile(jmx, renderJmx(plan), { mode: 0o600 });
    if (controller.signal.aborted) throw new Error("JMeter run cancelled or timed out.");
    const flags = [
      "-Jjmeter.save.saveservice.output_format=csv",
      "-Jjmeter.save.saveservice.print_field_names=true",
      "-Jjmeter.save.saveservice.timestamp_format=ms",
      "-Jjmeter.save.saveservice.response_data=false",
      "-Jjmeter.save.saveservice.response_message=false",
      "-Jjmeter.save.saveservice.assertion_results_failure_message=false",
      "-Jjmeter.save.saveservice.samplerData=false",
      "-Jjmeter.save.saveservice.url=false",
    ];
    const exit = await new Promise<number>((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ command, ["-n", "-t", jmx, "-l", jtl, ...flags], {
        stdio: "ignore", shell: false, cwd: dir, detached: process.platform !== "win32",
        env: { NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(["PATH", "HOME", "JAVA_HOME", "JMETER_HOME"].filter((k) => process.env[k]).map((k) => [k, process.env[k]!])), HEAP: "-Xms64m -Xmx512m" },
      });
      const stop = () => {
        if (!child.pid) return;
        try { if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already exited */ }
      };
      controller.signal.addEventListener("abort", stop, { once: true });
      const timeout = setTimeout(() => controller.abort(), (plan.durationSeconds + 25) * 1000);
      const sizeCheck = setInterval(() => { void fs.stat(jtl).then((s) => { if (s.size > 5 * 1024 * 1024) controller.abort(); }).catch(() => {}); }, 1000);
      const cleanup = () => { clearTimeout(timeout); clearInterval(sizeCheck); controller.signal.removeEventListener("abort", stop); };
      child.once("error", (e) => { cleanup(); reject(e); });
      child.once("close", (code) => { cleanup(); resolve(code ?? -1); });
    });
    if (exit !== 0) throw new Error(`JMeter exited with code ${exit}.`);
    const stat = await fs.stat(jtl);
    if (stat.size > 5 * 1024 * 1024) throw new Error("JMeter result exceeds 5 MB.");
    return parseJtl(await fs.readFile(jtl, "utf8"));
  } catch (e) {
    if (controller.signal.aborted) throw new Error("JMeter run cancelled or timed out.");
    if (e instanceof Error && "code" in e && e.code === "ENOENT") throw new Error("JMeter CLI is not installed or produced no result file.");
    throw e;
  } finally {
    active = null;
    await fs.rm(dir, { recursive: true, force: true });
  }
}
