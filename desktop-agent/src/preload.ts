import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rasqDesktop", {
  getState: () => ipcRenderer.invoke("rasq:state"),
  enroll: (input: { controlUrl: string; enrollmentToken: string; name: string }) => ipcRenderer.invoke("rasq:enroll", input),
  stop: () => ipcRenderer.invoke("rasq:stop"),
  onUpdate: (callback: (state: unknown) => void) => ipcRenderer.on("rasq:update", (_event, state) => callback(state)),
});
