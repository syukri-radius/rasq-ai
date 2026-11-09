import { AgentController } from "./controller";
import { ControlClient } from "./controlClient";
import { createDriver } from "./factory";

async function main() {
  const controlUrl = process.env.RASQ_CONTROL_URL;
  if (!controlUrl) throw new Error("RASQ_CONTROL_URL is required for the headless mock agent.");
  const driver = await createDriver();
  if (driver.capabilities().driver !== "mock") throw new Error("Headless mode is restricted to RASQ_DESKTOP_DRIVER=mock.");
  let token = process.env.RASQ_DEVICE_TOKEN ?? "";
  if (!token) {
    const enrollment = process.env.RASQ_DESKTOP_ENROLLMENT_TOKEN;
    if (!enrollment) throw new Error("Set RASQ_DEVICE_TOKEN or RASQ_DESKTOP_ENROLLMENT_TOKEN for mock enrollment.");
    const result = await ControlClient.enroll(controlUrl, enrollment, process.env.RASQ_AGENT_NAME ?? "RASQ Headless Mock", driver);
    token = result.deviceToken;
    console.log(`Enrolled headless mock agent ${result.agent.id}; device token remains in process memory.`);
  }
  const controller = new AgentController(new ControlClient(controlUrl, token), driver, (state) => console.log(JSON.stringify({ component: "mock-agent", ...state })));
  controller.start();
  const stop = () => { controller.stopPolling(); setTimeout(() => process.exit(0), 100); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
