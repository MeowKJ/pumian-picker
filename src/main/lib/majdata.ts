import { net } from 'electron';
import type { FetchChartsArgs, MajdataSong } from './types';

const MAJDATA_API = 'https://majdata.net/api3/api';

function apiUrl(path: string): string {
  return `${MAJDATA_API}${path}`;
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

export async function fetchBinary(path: string): Promise<Buffer | undefined> {
  const url = path.startsWith('http') ? path : apiUrl(path);
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

export async function fetchCharts(args: FetchChartsArgs): Promise<MajdataSong[]> {
  const pages = Math.max(1, Math.min(args.pages || 1, 500));
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

export function chartPath(songId: string, suffix: string): string {
  return apiUrl(`/maichart/${songId}${suffix}`);
}
