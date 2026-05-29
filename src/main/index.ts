import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
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

type DownloadEvent = {
  id: string;
  title: string;
  status: 'queued' | 'downloading' | 'done' | 'skipped' | 'failed';
  message?: string;
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: '铺面拔取器',
    backgroundColor: '#111318',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
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
  const order = String(index + 1).padStart(4, '0');
  const title = sanitizePathName(song.title || song.id);
  const maker = sanitizePathName(song.designer || song.uploader || 'unknown');
  return `${order}_${title}_${maker}`;
}

async function fetchBinary(url: string): Promise<Buffer | undefined> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'pumian-picker/0.1.0',
      Accept: '*/*',
    },
  });
  if (!res.ok) return undefined;
  const bytes = await res.arrayBuffer();
  return Buffer.from(bytes);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'pumian-picker/0.1.0',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`MajdataNet 返回 ${res.status}`);
  }
  return (await res.json()) as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
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

async function downloadOne(song: MajdataSong, args: DownloadArgs, index: number): Promise<DownloadEvent> {
  const dir = join(args.outputDir, folderName(song, index));
  const metaPath = join(dir, 'meta.json');
  if (args.skipExisting && (await exists(metaPath))) {
    return { id: song.id, title: song.title, status: 'skipped', message: '已存在 meta.json' };
  }

  await mkdir(dir, { recursive: true });
  const prefix = apiUrl(`/maichart/${song.id}`);
  const [maidata, track, image, video] = await Promise.all([
    fetchBinary(`${prefix}/chart`),
    fetchBinary(`${prefix}/track`),
    fetchBinary(`${prefix}/image?fullImage=true`),
    args.includeVideo ? fetchBinary(`${prefix}/video`) : Promise.resolve(undefined),
  ]);

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
        const result = await downloadOne(song, args, index);
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
  if (process.platform !== 'darwin') app.quit();
});
