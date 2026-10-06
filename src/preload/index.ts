import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});

// What the renderer's FileHost needs; the main process does the work
contextBridge.exposeInMainWorld('files', {
  resolve: (path: string, base?: string) => ipcRenderer.invoke('files:resolve', path, base),
  exists: (path: string) => ipcRenderer.invoke('files:exists', path),
  read: (path: string) => ipcRenderer.invoke('files:read', path),
  write: (path: string, text: string) => ipcRenderer.invoke('files:write', path, text),
  chooseSavePath: (suggested?: string) => ipcRenderer.invoke('files:chooseSave', suggested),
  chooseOpenPath: () => ipcRenderer.invoke('files:chooseOpen'),
  close: () => ipcRenderer.send('window:close'),
  readBinary: (path: string) => ipcRenderer.invoke('files:readBinary', path),
  writeBinary: (path: string, data: Uint8Array) => ipcRenderer.invoke('files:writeBinary', path, data),
  chooseSoundfontPath: () => ipcRenderer.invoke('files:chooseSoundfont'),
});

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
});
