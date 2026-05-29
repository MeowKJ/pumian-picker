import type { DownloadEvent, FolderSummary, Song, TransferSession } from './types';

type PumianApi = {
  fetchCharts: (args: { search?: string; sort?: string; pages?: number }) => Promise<Song[]>;
  chooseOutputDir: () => Promise<string | undefined>;
  startDownload: (args: {
    songs: Song[];
    outputDir: string;
    includeVideo: boolean;
    skipExisting: boolean;
    concurrency: number;
  }) => Promise<DownloadEvent[]>;
  getExistingIds: (args: { outputDir: string }) => Promise<string[]>;
  scanFolder: (args: { outputDir: string }) => Promise<FolderSummary>;
  prepareTransfer: (args: { outputDir: string }) => Promise<TransferSession>;
  stopTransfer: () => Promise<void>;
  detectMacSigning: () => Promise<string[]>;
  onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
};

declare global {
  interface Window {
    pumian: PumianApi;
  }
}

const fallbackApi: PumianApi = {
  fetchCharts: async () => {
    const response = await fetch('https://majdata.net/api3/api/maichart/list?sort=&page=0');
    return response.json();
  },
  chooseOutputDir: async () => undefined,
  startDownload: async () => [],
  getExistingIds: async () => [],
  scanFolder: async () => ({ total: 0, complete: 0, incomplete: 0, size: 0, recent: [] }),
  prepareTransfer: async () => {
    throw new Error('当前环境不支持传输');
  },
  stopTransfer: async () => undefined,
  detectMacSigning: async () => [],
  onDownloadEvent: () => () => undefined,
};

export function api(): PumianApi {
  return window.pumian || fallbackApi;
}
