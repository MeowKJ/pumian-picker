import { Ban, RotateCcw } from 'lucide-react';
import type { DownloadEvent, Song } from '../types';
import { formatDate, hasLocalChart, primaryLevel, tags } from '../utils';

type ChartsTableProps = {
  filtered: Song[];
  blockedIds: Set<string>;
  events: Record<string, DownloadEvent>;
  existingIds: Set<string>;
  toggleBlocked: (id: string) => void;
};

export function ChartsTable({ filtered, blockedIds, events, existingIds, toggleBlocked }: ChartsTableProps) {
  return (
    <div className="table">
      <div className="row head">
        <span></span><span>谱面</span><span>难度</span><span>上传者</span><span>时间</span><span>状态</span>
      </div>
      {filtered.map((song) => {
        const event = events[song.id];
        const blocked = blockedIds.has(song.id);
        return (
          <div className={`row ${event?.status || ''} ${hasLocalChart(song, existingIds) ? 'local' : ''} ${blocked ? 'excluded' : ''}`} key={song.id}>
            <span className="row-wave" />
            <button className="exclude-toggle" onClick={() => toggleBlocked(song.id)} title={blocked ? '恢复纳入下载' : '排除这首'}>
              {blocked ? <RotateCcw size={14} /> : <Ban size={14} />}
            </button>
            <span>
              <strong>{song.title}</strong>
              <small>{song.artist || '未知曲师'} · {song.designer || '未知谱师'} {tags(song) && `· ${tags(song)}`}</small>
            </span>
            <b>{primaryLevel(song)}</b>
            <span>{song.uploader || '未知'}</span>
            <span>{formatDate(song.timestamp)}</span>
            <span className={`badge ${event?.status || ''}`}>{blocked ? '已排除' : event?.message || event?.status || '待命'}</span>
          </div>
        );
      })}
    </div>
  );
}
