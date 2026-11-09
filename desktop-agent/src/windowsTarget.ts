import { spawn } from "node:child_process";
import type { DesktopTarget } from "../../src/lib/desktopContract";
import type { TargetValidation } from "./driver";

const SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RasqWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public static string Title(IntPtr handle) { var b = new StringBuilder(1024); GetWindowText(handle, b, b.Capacity); return b.ToString(); }
}
"@
$expected = [Environment]::GetEnvironmentVariable("RASQ_TARGET_TITLE")
$focus = [Environment]::GetEnvironmentVariable("RASQ_TARGET_FOCUS") -eq "1"
$handle = [RasqWindow]::GetForegroundWindow()
$actual = [RasqWindow]::Title($handle)
if ($focus -and $actual -cne $expected) {
  $process = Get-Process | Where-Object { $_.MainWindowTitle -ceq $expected -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($null -ne $process) {
    [void][RasqWindow]::SetForegroundWindow($process.MainWindowHandle)
    Start-Sleep -Milliseconds 250
    $handle = [RasqWindow]::GetForegroundWindow()
    $actual = [RasqWindow]::Title($handle)
  }
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
@{ expected = $expected; actual = $actual; matched = ($actual -ceq $expected); handle = $handle.ToInt64() } | ConvertTo-Json -Compress
`;

export async function validateWindowsTarget(target: DesktopTarget, allowFocus: boolean): Promise<TargetValidation> {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("The real RobotJS MVP driver supports only Windows x64; use the mock driver for cross-platform tests.");
  if (!target.requireFocus) return { verified: false, message: "Target focus verification disabled; operator confirmation is required." };
  if (!target.windowTitle) throw new Error("An exact target window title is required for attended Windows execution.");
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", SCRIPT], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, RASQ_TARGET_TITLE: target.windowTitle, RASQ_TARGET_FOCUS: allowFocus ? "1" : "0" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { if (stdout.length < 16_384) stdout += chunk; });
    child.stderr.on("data", (chunk) => { if (stderr.length < 2000) stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Windows target adapter failed (${code}): ${stderr.slice(0, 500)}`)));
  });
  const result = JSON.parse(output) as { actual?: string; matched?: boolean };
  return result.matched
    ? { verified: true, message: allowFocus ? `Windows foreground target verified: ${result.actual}` : `Windows foreground target matched without focus change: ${result.actual}` }
    : { verified: false, message: `Expected foreground window "${target.windowTitle}", observed "${result.actual ?? ""}".` };
}
