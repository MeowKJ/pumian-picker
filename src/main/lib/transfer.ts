import { app } from 'electron';
import { rm, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { Archiver, ArchiverOptions } from 'archiver';
import type { TransferSession } from './types';
import { completeChartFolders } from './folder';
import { fileSize } from './paths';

const require = createRequire(import.meta.url);
const createArchive = require('archiver') as (format: 'zip', options?: ArchiverOptions) => Archiver;

let transferServer: Server | undefined;
let transferFilePath = '';

function localAddress(): string {
  for (const items of Object.values(networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return '127.0.0.1';
}

export async function stopTransfer(): Promise<void> {
  if (transferServer) {
    await new Promise<void>((resolve) => transferServer?.close(() => resolve()));
  }
  transferServer = undefined;
  if (transferFilePath) {
    await rm(transferFilePath, { force: true }).catch(() => undefined);
  }
  transferFilePath = '';
}

export async function createTransferZip(outputDir: string): Promise<TransferSession> {
  await stopTransfer();
  await readdir(outputDir, { withFileTypes: true });
  const completeFolders = await completeChartFolders(outputDir);
  if (completeFolders.length === 0) throw new Error('当前文件夹没有完整歌曲可打包');

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const filename = `铺面拔取器_${stamp}_${completeFolders.length}首.zip`;
  const zipPath = join(app.getPath('temp'), filename);
  await rm(zipPath, { force: true }).catch(() => undefined);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = createArchive('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    completeFolders.sort().forEach((folder) => {
      archive.directory(join(outputDir, folder), folder);
    });
    archive.finalize().catch(reject);
  });

  transferFilePath = zipPath;
  const address = localAddress();
  const size = await fileSize(zipPath);
  transferServer = createServer((request, response) => {
    if (request.url !== '/download') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<a href="/download">下载 ${filename}</a>`);
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    });
    createReadStream(zipPath).pipe(response);
  });
  await new Promise<void>((resolve) => transferServer?.listen(0, '0.0.0.0', () => resolve()));
  const port = (transferServer.address() as { port: number }).port;
  return {
    url: `http://${address}:${port}/download`,
    filename,
    size,
    completeCount: completeFolders.length,
    address,
    port,
  };
}
