import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export function createWindow(): void {
  const win = new BrowserWindow({
    width: 1120,
    height: 690,
    minWidth: 920,
    minHeight: 560,
    title: '铺面拔取器',
    backgroundColor: '#111318',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
}
