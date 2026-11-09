import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, globalShortcut, ipcMain, safeStorage } from "electron";
import { AgentController, type AgentViewState } from "./controller";
import { ControlClient } from "./controlClient";
import { createDriver } from "./factory";
import type { DesktopDriver } from "./driver";

type DeviceConfig = { controlUrl: string; name: string };
let window: BrowserWindow | null = null;
let controller: AgentController | null = null;
let driver: DesktopDriver;
let configured = false;
const configPath = () => path.join(app.getPath("userData"), "device.json");

function publish(state?: AgentViewState) {
  window?.webContents.send("rasq:update", state ?? { ...(controller?.state ?? { connected: false, currentRunId: null, message: "Enrollment required.", automationActive: false }), configured });
}
function saveDevice(config: DeviceConfig & { deviceToken: string }) {
  const secret = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(config.deviceToken).toString("base64") : config.deviceToken;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), JSON.stringify({ controlUrl: config.controlUrl, name: config.name, secret, encrypted: safeStorage.isEncryptionAvailable() }), { mode: 0o600 });
}
function loadDevice(): (DeviceConfig & { deviceToken: string; encrypted?: boolean }) | null {
  try {
    const value = JSON.parse(fs.readFileSync(configPath(), "utf8")) as DeviceConfig & { secret: string; deviceToken: string; encrypted?: boolean };
    return { ...value, deviceToken: value.encrypted && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value.secret, "base64")) : value.secret };
  } catch { return null; }
}
async function connect(config: DeviceConfig & { deviceToken: string }) {
  controller?.stopPolling();
  controller = new AgentController(new ControlClient(config.controlUrl, config.deviceToken), driver, publish);
  configured = true;
  controller.start();
  publish();
}

app.whenReady().then(async () => {
  driver = await createDriver();
  window = new BrowserWindow({
    width: 520,
    height: 680,
    minWidth: 440,
    minHeight: 560,
    title: "RASQ-Ai Desktop Agent",
    backgroundColor: "#f8fafc",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  await window.loadFile(path.join(__dirname, "..", "renderer.html"));
  ipcMain.handle("rasq:state", () => ({ ...controller?.state, configured }));
  ipcMain.handle("rasq:enroll", async (_event, input: { controlUrl?: string; enrollmentToken?: string; name?: string }) => {
    const controlUrl = String(input.controlUrl ?? "");
    const enrollmentToken = String(input.enrollmentToken ?? "");
    const name = String(input.name ?? "").trim().slice(0, 120);
    if (!name || enrollmentToken.length < 16) throw new Error("Agent name and enrollment token are required.");
    const result = await ControlClient.enroll(controlUrl, enrollmentToken, name, driver);
    saveDevice({ controlUrl, name, deviceToken: result.deviceToken });
    await connect({ controlUrl, name, deviceToken: result.deviceToken });
    return { enrolled: true, agentId: result.agent.id };
  });
  ipcMain.handle("rasq:stop", async () => { await controller?.emergencyStop(); publish(); return { stopping: true }; });
  globalShortcut.register("CommandOrControl+Alt+Shift+F12", () => { void controller?.emergencyStop(); publish(); });
  const existing = loadDevice();
  if (existing) await connect(existing);
  publish();
}).catch((e) => {
  console.error(e);
  app.quit();
});

app.on("window-all-closed", () => { controller?.stopPolling(); app.quit(); });
app.on("will-quit", () => { globalShortcut.unregisterAll(); controller?.stopPolling(); });
