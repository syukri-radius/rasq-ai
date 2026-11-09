const { app, BrowserWindow } = require("electron");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 900,
    height: 650,
    title: "RASQ Synthetic Desktop Target",
    backgroundColor: "#f8fafc",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.loadFile("synthetic-target.html");
});
app.on("window-all-closed", () => app.quit());
