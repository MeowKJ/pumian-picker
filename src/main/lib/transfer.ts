import { app } from 'electron';
import * as archiverModule from 'archiver';
import { readFile, rm, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { Archiver, ArchiverOptions } from 'archiver';
import type { MajdataSong, TransferSession } from './types';
import { completeChartFolders } from './folder';
import { fileSize, sanitizePathName } from './paths';

const { ZipArchive } = archiverModule as unknown as {
  ZipArchive: new (options?: ArchiverOptions) => Archiver;
};

let transferServer: Server | undefined;
let transferFilePath = '';

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function interfacePriority(name: string, address: string): number {
  const [, , , lastOctet] = address.split('.').map(Number);
  const gatewayLikePenalty = lastOctet === 1 ? 2 : 0;
  if (/^(en|eth|wlan|wi-?fi|ethernet)/i.test(name)) return gatewayLikePenalty;
  if (/^(bridge|utun|awdl|llw|docker|veth|vmnet|tailscale|zt)/i.test(name)) return 4;
  return 2 + gatewayLikePenalty;
}

function localAddress(): string {
  const candidates: Array<{ name: string; address: string; priority: number }> = [];
  for (const [name, items] of Object.entries(networkInterfaces())) {
    for (const item of items || []) {
      if (item.family !== 'IPv4' || item.internal || item.address.startsWith('169.254.')) continue;
      if (!isPrivateIpv4(item.address)) continue;
      candidates.push({ name, address: item.address, priority: interfacePriority(name, item.address) });
    }
  }
  candidates.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  return candidates[0]?.address || '127.0.0.1';
}

async function levelFolderName(outputDir: string, folder: string): Promise<string> {
  try {
    const meta = JSON.parse(await readFile(join(outputDir, folder, 'meta.json'), 'utf8')) as Pick<MajdataSong, 'levels'>;
    const level = (meta.levels || []).find(Boolean) || '未知难度';
    return sanitizePathName(level);
  } catch {
    return '未知难度';
  }
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
  const levelByFolder = new Map(await Promise.all(
    completeFolders.map(async (folder) => [folder, await levelFolderName(outputDir, folder)] as const),
  ));

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    completeFolders.sort().forEach((folder) => {
      archive.directory(join(outputDir, folder), false, (entry) => {
        const level = levelByFolder.get(folder) || '未知难度';
        return { ...entry, name: `levels/${level}/${folder}/${entry.name}` };
      });
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
