$ErrorActionPreference = "Stop"
if (-not $IsWindows -and $env:OS -ne "Windows_NT") { throw "package:win must run on Windows x64." }
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne "X64") { throw "package:win requires an x64 Windows host." }

$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root "node_modules/electron/dist"
$out = Join-Path $root "out/RASQ-Ai-Desktop-Agent-win-x64"
$app = Join-Path $out "resources/app"
if (-not (Test-Path (Join-Path $electron "electron.exe"))) { throw "Electron binaries are missing. Run a normal npm ci on Windows first; --ignore-scripts is mock-development only." }
$robotPrebuild = Join-Path $root "node_modules/robotjs/prebuilds/win32-x64/node.napi.node"
$robotSourceBuild = Join-Path $root "node_modules/robotjs/build"
if (-not (Test-Path $robotPrebuild) -and -not (Test-Path $robotSourceBuild)) { throw "RobotJS native binaries are missing. Run a normal npm ci / rebuild on Windows first." }
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item -Recurse -Force "$electron/*" $out
Copy-Item -Recurse -Force (Join-Path $root "dist") $app
foreach ($file in @("package.json", "renderer.html", "renderer.js")) { Copy-Item -Force (Join-Path $root $file) $app }
New-Item -ItemType Directory -Force -Path (Join-Path $app "node_modules") | Out-Null
foreach ($module in @("robotjs", "node-addon-api", "node-gyp-build")) {
  $source = Join-Path $root "node_modules/$module"
  if (-not (Test-Path $source)) { throw "Required runtime module $module is missing." }
  Copy-Item -Recurse -Force $source (Join-Path $app "node_modules")
}
$packagedPrebuilds = Join-Path $app "node_modules/robotjs/prebuilds"
if (Test-Path $packagedPrebuilds) {
  Get-ChildItem -Directory $packagedPrebuilds | Where-Object { $_.Name -ne "win32-x64" } | Remove-Item -Recurse -Force
}
Rename-Item (Join-Path $out "electron.exe") "RASQ-Ai-Desktop-Agent.exe"
$zip = "$out.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path "$out/*" -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Unsigned development package created: $zip"
Write-Host "Real attended execution and code signing must be validated separately before distribution."
