import { app, BrowserWindow } from 'electron';
import { registerIpc } from './lib/ipc';
import { stopTransfer } from './lib/transfer';
import { createWindow } from './lib/window';

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void stopTransfer();
  if (process.platform !== 'darwin') app.quit();
});
