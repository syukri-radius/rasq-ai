import type { DesktopDriver } from "./driver";
import { MockDesktopDriver } from "./mockDriver";

export async function createDriver(): Promise<DesktopDriver> {
  if (process.env.RASQ_DESKTOP_DRIVER === "mock") return new MockDesktopDriver();
  const { RobotDesktopDriver } = await import("./robotDriver");
  return new RobotDesktopDriver();
}
