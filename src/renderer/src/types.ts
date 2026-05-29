export type Song = {
  id: string;
  title: string;
  artist?: string;
  designer?: string;
  levels?: string[];
  uploader?: string;
  timestamp?: string;
  tags?: string[];
  publicTags?: string[];
};

export type DownloadEvent = {
  id: string;
  title: string;
  status: 'queued' | 'downloading' | 'done' | 'skipped' | 'failed';
  message?: string;
};

export type FolderStatus = {
  folder: string;
  title: string;
  id?: string;
  complete: boolean;
  missing: string[];
  size: number;
  updatedAt?: string;
};

export type FolderSummary = {
  total: number;
  complete: number;
  incomplete: number;
  size: number;
  recent: FolderStatus[];
};

export type TransferSession = {
  url: string;
  filename: string;
  size: number;
  completeCount: number;
  address: string;
  port: number;
};

export type QueueMode = 'tasks' | 'folder' | 'transfer';
