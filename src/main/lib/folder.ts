import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FolderStatus, FolderSummary, MajdataSong } from './types';
import { exists, fileSize } from './paths';

export const REQUIRED_CHART_FILES = ['maidata.txt', 'track.mp3', 'bg.jpg', 'meta.json'];

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

export async function completeChartFolders(outputDir: string): Promise<string[]> {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const completeFolders: string[] = [];
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const folderPath = join(outputDir, entry.name);
    const ok = await Promise.all(REQUIRED_CHART_FILES.map((file) => exists(join(folderPath, file))));
    if (ok.every(Boolean)) completeFolders.push(entry.name);
  }));
  return completeFolders;
}

export async function scanOutputDir(outputDir: string): Promise<FolderSummary> {
  const folders: FolderStatus[] = [];
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const folderPath = join(outputDir, entry.name);
      const present = await Promise.all(REQUIRED_CHART_FILES.map((file) => exists(join(folderPath, file))));
      const missing = REQUIRED_CHART_FILES.filter((_, index) => !present[index]);
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

export async function readExistingIds(outputDir: string): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const folder = entry.name;
      const folderPath = join(outputDir, folder);
      const present = await Promise.all(REQUIRED_CHART_FILES.map((file) => exists(join(folderPath, file))));
      if (!present.every(Boolean)) return;
      const idSuffix = folder.match(/_([0-9a-f]{8})$/i)?.[1];
      if (idSuffix) ids.add(idSuffix);
      try {
        const meta = JSON.parse(await readFile(join(folderPath, 'meta.json'), 'utf8')) as { id?: string };
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

export async function deleteChartFolder(outputDir: string, songId: string): Promise<string | undefined> {
  const entries = await readdir(outputDir, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const folderPath = join(outputDir, entry.name);
    const idSuffix = entry.name.match(/_([0-9a-f]{8})$/i)?.[1];
    try {
      const meta = JSON.parse(await readFile(join(folderPath, 'meta.json'), 'utf8')) as { id?: string };
      if (meta.id === songId || meta.id?.slice(0, 8) === songId.slice(0, 8)) {
        await rm(folderPath, { recursive: true, force: true });
        return entry.name;
      }
    } catch {
      // Fall back to the generated folder id suffix for older or partial folders.
    }
    if (idSuffix && idSuffix === songId.slice(0, 8)) {
      await rm(folderPath, { recursive: true, force: true });
      return entry.name;
    }
  }
  return undefined;
}
