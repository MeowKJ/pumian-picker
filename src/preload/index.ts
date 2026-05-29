import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pumian', {
  fetchCharts: (args: unknown) => ipcRenderer.invoke('charts:fetch', args),
  chooseOutputDir: () => ipcRenderer.invoke('dialog:output-dir'),
  startDownload: (args: unknown) => ipcRenderer.invoke('downloads:start', args),
  detectMacSigning: () => ipcRenderer.invoke('signing:detect'),
  onDownloadEvent: (callback: (event: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('download:event', listener);
    return () => ipcRenderer.removeListener('download:event', listener);
  },
});
