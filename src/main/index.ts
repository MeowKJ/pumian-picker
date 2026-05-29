import { app, BrowserWindow, dialog, ipcMain, net } from 'electron';
import { mkdir, writeFile, access, readdir, readFile, stat, rm } from 'node:fs/promises';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import type { Archiver, ArchiverOptions } from 'archiver';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const createArchive = require('archiver') as (format: 'zip', options?: ArchiverOptions) => Archiver;
const MAJDATA_API = 'https://majdata.net/api3/api';

type MajdataSong = {
  id: string;
  title: string;
  artist?: string;
  designer?: string;
  description?: string;
  levels?: string[];
  uploader?: string;
  timestamp?: string;
  hash?: string;
  tags?: string[];
  publicTags?: string[];
};

type FetchChartsArgs = {
  search?: string;
  sort?: string;
  pages?: number;
};

type DownloadArgs = {
  songs: MajdataSong[];
  outputDir: string;
  includeVideo: boolean;
  skipExisting: boolean;
  concurrency: number;
};

type ExistingIdsArgs = {
  outputDir: string;
};

type DownloadEvent = {
  id: string;
  title: string;
  status: 'queued' | 'downloading' | 'done' | 'skipped' | 'failed';
  message?: string;
};

type FolderStatus = {
  folder: string;
  title: string;
  id?: string;
  complete: boolean;
  missing: string[];
  size: number;
  updatedAt?: string;
};

type FolderSummary = {
  total: number;
  complete: number;
  incomplete: number;
  size: number;
  recent: FolderStatus[];
};

type TransferSession = {
  url: string;
  filename: string;
  size: number;
  completeCount: number;
  address: string;
  port: number;
};

let transferServer: Server | undefined;
let transferFilePath = '';
let transferSession: TransferSession | undefined;

function createWindow(): void {
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

function apiUrl(path: string): string {
  return `${MAJDATA_API}${path}`;
}

function sanitizePathName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function folderName(song: MajdataSong, index: number): string {
  const date = song.timestamp ? song.timestamp.slice(0, 10).replace(/-/g, '') : String(index + 1).padStart(4, '0');
  const title = sanitizePathName(song.title || song.id);
  const maker = sanitizePathName(song.designer || song.uploader || 'unknown');
  return `${title}_${maker}_${date}_${song.id.slice(0, 8)}`;
}

async function withRetry<T>(task: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (index + 1)));
    }
  }
  throw lastError;
}

async function fetchBinary(url: string): Promise<Buffer | undefined> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await net.fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'pumian-picker/0.1.0',
          Accept: '*/*',
        },
      });
      if (!res.ok) return undefined;
      const bytes = await res.arrayBuffer();
      return Buffer.from(bytes);
    } finally {
      clearTimeout(timer);
    }
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await net.fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'pumian-picker/0.1.0',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`MajdataNet 返回 ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(path, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) total += await directorySize(child);
      else total += await fileSize(child);
    }));
  } catch {
    return 0;
  }
  return total;
}

async function scanOutputDir(outputDir: string): Promise<FolderSummary> {
  const folders: FolderStatus[] = [];
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const folderPath = join(outputDir, entry.name);
      const required = ['maidata.txt', 'track.mp3', 'bg.jpg', 'meta.json'];
      const present = await Promise.all(required.map((file) => exists(join(folderPath, file))));
      const missing = required.filter((_, index) => !present[index]);
      let meta: Partial<MajdataSong> = {};
      try {
        meta = JSON.parse(await readFile(join(folderPath, 'meta.json'), 'utf8')) as Partial<MajdataSong>;
      } catch {
        // Folders without app metadata are still shown as incomplete.
      }
      const stats = await stat(folderPath).catch(() => undefined);
      folders.push({
        folder: entry.name,
        title: meta.title || entry.name,
        id: meta.id,
        complete: missing.length === 0,
        missing,
        size: await directorySize(folderPath),
        updatedAt: stats?.mtime.toISOString(),
      });
    }));
  } catch {
    return { total: 0, complete: 0, incomplete: 0, size: 0, recent: [] };
  }

  folders.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  const complete = folders.filter((folder) => folder.complete).length;
  return {
    total: folders.length,
    complete,
    incomplete: folders.length - complete,
    size: folders.reduce((sum, folder) => sum + folder.size, 0),
    recent: folders.slice(0, 24),
  };
}

async function readExistingIds(outputDir: string): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const folder = entry.name;
      const idSuffix = folder.match(/_([0-9a-f]{8})$/i)?.[1];
      if (idSuffix) ids.add(idSuffix);
      try {
        const meta = JSON.parse(await readFile(join(outputDir, folder, 'meta.json'), 'utf8')) as { id?: string };
        if (meta.id) ids.add(meta.id);
        if (meta.id) ids.add(meta.id.slice(0, 8));
      } catch {
        // Ignore folders that are not created by this app.
      }
    }));
  } catch {
    return [];
  }
  return [...ids];
}

async function fetchCharts(args: FetchChartsArgs): Promise<MajdataSong[]> {
  const pages = Math.max(1, Math.min(args.pages || 1, 50));
  const sort = args.sort || '';
  const search = encodeURIComponent(args.search || '');
  const all: MajdataSong[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < pages; page += 1) {
    const url = apiUrl(`/maichart/list?sort=${sort}&page=${page}&search=${search}`);
    const pageSongs = await fetchJson<MajdataSong[]>(url);
    for (const song of pageSongs) {
      if (!song.id || seen.has(song.id)) continue;
      seen.add(song.id);
      all.push(song);
    }
    if (pageSongs.length === 0) break;
  }

  return all;
}

async function downloadOne(
  song: MajdataSong,
  args: DownloadArgs,
  index: number,
  emit: (event: DownloadEvent) => void,
): Promise<DownloadEvent> {
  const dir = join(args.outputDir, folderName(song, index));
  const metaPath = join(dir, 'meta.json');
  if (args.skipExisting && (await exists(metaPath))) {
    return { id: song.id, title: song.title, status: 'skipped', message: '已存在 meta.json' };
  }

  await mkdir(dir, { recursive: true });
  const prefix = apiUrl(`/maichart/${song.id}`);
  emit({ id: song.id, title: song.title, status: 'downloading', message: '下载谱面' });
  const maidata = await fetchBinary(`${prefix}/chart`);
  emit({ id: song.id, title: song.title, status: 'downloading', message: '下载音频' });
  const track = await fetchBinary(`${prefix}/track`);
  emit({ id: song.id, title: song.title, status: 'downloading', message: '下载封面' });
  const image = await fetchBinary(`${prefix}/image?fullImage=true`);
  emit({ id: song.id, title: song.title, status: 'downloading', message: args.includeVideo ? '下载 PV' : '写入文件' });
  const video = args.includeVideo ? await fetchBinary(`${prefix}/video`) : undefined;

  if (!maidata || !track || !image) {
    throw new Error('必要文件不完整');
  }

  await Promise.all([
    writeFile(join(dir, 'maidata.txt'), maidata),
    writeFile(join(dir, 'track.mp3'), track),
    writeFile(join(dir, 'bg.jpg'), image),
    video ? writeFile(join(dir, 'pv.mp4'), video) : Promise.resolve(),
    writeFile(join(dir, 'meta.json'), JSON.stringify({ ...song, downloadedAt: new Date().toISOString() }, null, 2)),
  ]);

  return { id: song.id, title: song.title, status: 'done', message: '完成' };
}

async function runQueue(args: DownloadArgs, sender: Electron.WebContents): Promise<DownloadEvent[]> {
  const results: DownloadEvent[] = [];
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(args.concurrency || 3, 8));

  async function worker(): Promise<void> {
    while (cursor < args.songs.length) {
      const index = cursor;
      cursor += 1;
      const song = args.songs[index];
      sender.send('download:event', { id: song.id, title: song.title, status: 'downloading' } satisfies DownloadEvent);
      try {
        const result = await downloadOne(song, args, index, (event) => sender.send('download:event', event));
        results.push(result);
        sender.send('download:event', result);
      } catch (error) {
        const failed: DownloadEvent = {
          id: song.id,
          title: song.title,
          status: 'failed',
          message: error instanceof Error ? error.message : '未知错误',
        };
        results.push(failed);
        sender.send('download:event', failed);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function localAddress(): string {
  for (const items of Object.values(networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return '127.0.0.1';
}

async function stopTransfer(): Promise<void> {
  if (transferServer) {
    await new Promise<void>((resolve) => transferServer?.close(() => resolve()));
  }
  transferServer = undefined;
  transferSession = undefined;
  if (transferFilePath) {
    await rm(transferFilePath, { force: true }).catch(() => undefined);
  }
  transferFilePath = '';
}

async function createTransferZip(outputDir: string): Promise<TransferSession> {
  await stopTransfer();
  const entries = await readdir(outputDir, { withFileTypes: true });
  const completeFolders: string[] = [];
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const folderPath = join(outputDir, entry.name);
    const ok = await Promise.all(['maidata.txt', 'track.mp3', 'bg.jpg', 'meta.json'].map((file) => exists(join(folderPath, file))));
    if (ok.every(Boolean)) completeFolders.push(entry.name);
  }));
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
  transferSession = {
    url: `http://${address}:${port}/download`,
    filename,
    size,
    completeCount: completeFolders.length,
    address,
    port,
  };
  return transferSession;
}

async function detectMacSigning(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  const { stdout } = await execFileAsync('security', ['find-identity', '-v', '-p', 'codesigning']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /"[^"]+"/.test(line) && !line.includes('0 valid identities'));
}

app.whenReady().then(() => {
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

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void stopTransfer();
  if (process.platform !== 'darwin') app.quit();
});
