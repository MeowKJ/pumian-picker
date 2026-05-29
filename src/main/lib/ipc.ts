import { dialog, ipcMain } from 'electron';
import { fetchCharts } from './majdata';
import { runQueue } from './downloads';
import { readExistingIds, scanOutputDir } from './folder';
import { createTransferZip, stopTransfer } from './transfer';
import { detectMacSigning } from './signing';
import type { DownloadArgs, ExistingIdsArgs, FetchChartsArgs } from './types';

export function registerIpc(): void {
  ipcMain.handle('charts:fetch', (_event, args: FetchChartsArgs) => fetchCharts(args));
  ipcMain.handle('downloads:start', (event, args: DownloadArgs) => runQueue(args, event.sender));
  ipcMain.handle('downloads:existing-ids', (_event, args: ExistingIdsArgs) => readExistingIds(args.outputDir));
  ipcMain.handle('folder:scan', (_event, args: ExistingIdsArgs) => scanOutputDir(args.outputDir));
  ipcMain.handle('transfer:prepare', (_event, args: ExistingIdsArgs) => createTransferZip(args.outputDir));
  ipcMain.handle('transfer:stop', () => stopTransfer());
  ipcMain.handle('dialog:output-dir', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle('signing:detect', () => detectMacSigning());
}
