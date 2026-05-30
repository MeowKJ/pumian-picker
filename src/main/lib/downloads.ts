import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DownloadArgs, DownloadEvent, MajdataSong } from './types';
import { REQUIRED_CHART_FILES } from './folder';
import { chartPath, fetchBinary } from './majdata';
import { exists, sanitizePathName } from './paths';

function folderName(song: MajdataSong, index: number): string {
  const date = song.timestamp ? song.timestamp.slice(0, 10).replace(/-/g, '') : String(index + 1).padStart(4, '0');
  const title = sanitizePathName(song.title || song.id);
  const maker = sanitizePathName(song.designer || song.uploader || 'unknown');
  return `${title}_${maker}_${date}_${song.id.slice(0, 8)}`;
}

async function downloadOne(
  song: MajdataSong,
  args: DownloadArgs,
  index: number,
  emit: (event: DownloadEvent) => void,
): Promise<DownloadEvent> {
  const dir = join(args.outputDir, folderName(song, index));
  if (args.skipExisting) {
    const complete = await Promise.all(REQUIRED_CHART_FILES.map((file) => exists(join(dir, file))));
    if (complete.every(Boolean)) {
      return { id: song.id, title: song.title, status: 'skipped', message: '本地完整' };
    }
  }

  await mkdir(dir, { recursive: true });
  emit({ id: song.id, title: song.title, status: 'downloading', message: '下载谱面' });
  const maidata = await fetchBinary(chartPath(song.id, '/chart'));
  emit({ id: song.id, title: song.title, status: 'downloading', message: '下载音频' });
  const track = await fetchBinary(chartPath(song.id, '/track'));
  emit({ id: song.id, title: song.title, status: 'downloading', message: '下载封面' });
  const image = await fetchBinary(chartPath(song.id, '/image?fullImage=true'));
  emit({ id: song.id, title: song.title, status: 'downloading', message: args.includeVideo ? '下载 PV' : '写入文件' });
  const video = args.includeVideo ? await fetchBinary(chartPath(song.id, '/video')) : undefined;

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

export async function runQueue(args: DownloadArgs, sender: Electron.WebContents): Promise<DownloadEvent[]> {
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
