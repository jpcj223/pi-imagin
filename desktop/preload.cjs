/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

// 只暴露目录选择与启动页状态，不向页面提供文件系统、进程或任意 IPC。
contextBridge.exposeInMainWorld("piImaginDesktop", {
  chooseDirectory: () => ipcRenderer.invoke("pi-imagin:choose-directory"),
  retryStartup: () => ipcRenderer.invoke("pi-imagin:retry-startup"),
  onStartupStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("pi-imagin:startup-status", listener);
    return () => ipcRenderer.removeListener("pi-imagin:startup-status", listener);
  },
});
