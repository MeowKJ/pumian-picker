import type { DownloadEvent, Song } from './types';

export const difficultyOptions = ['12', '12+', '13', '13+', '14', '14+', '15'];

export function primaryLevel(song: Song): string {
  return (song.levels || []).find(Boolean) || '未知';
}

export function formatDate(value?: string): string {
  if (!value) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatBytes(value: number): string {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

export function tags(song: Song): string {
  return [...(song.tags || []), ...(song.publicTags || [])].slice(0, 3).join(' / ');
}

export function sortRecent(a: Song, b: Song): number {
  return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
}

export function hasLocalChart(song: Song, existingIds: Set<string>): boolean {
  return existingIds.has(song.id) || existingIds.has(song.id.slice(0, 8));
}

export function taskPercent(event: DownloadEvent): number {
  if (event.status === 'queued') return 8;
  if (event.status === 'done' || event.status === 'skipped' || event.status === 'failed') return 100;
  if (event.message?.includes('谱面')) return 24;
  if (event.message?.includes('音频')) return 48;
  if (event.message?.includes('封面')) return 72;
  if (event.message?.includes('PV')) return 86;
  if (event.message?.includes('写入')) return 94;
  return 18;
}
