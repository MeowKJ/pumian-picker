import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pumian', {
  fetchCharts: (args: unknown) => ipcRenderer.invoke('charts:fetch', args),
  chooseOutputDir: () => ipcRenderer.invoke('dialog:output-dir'),
  startDownload: (args: unknown) => ipcRenderer.invoke('downloads:start', args),
  getExistingIds: (args: unknown) => ipcRenderer.invoke('downloads:existing-ids', args),
  deleteLocalChart: (args: unknown) => ipcRenderer.invoke('downloads:delete-local', args),
  scanFolder: (args: unknown) => ipcRenderer.invoke('folder:scan', args),
  prepareTransfer: (args: unknown) => ipcRenderer.invoke('transfer:prepare', args),
  stopTransfer: () => ipcRenderer.invoke('transfer:stop'),
  detectMacSigning: () => ipcRenderer.invoke('signing:detect'),
  onDownloadEvent: (callback: (event: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('download:event', listener);
    return () => ipcRenderer.removeListener('download:event', listener);
  },
});
