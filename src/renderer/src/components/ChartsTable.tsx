import type { DownloadEvent, Song } from '../types';
import { formatDate, hasLocalChart, primaryLevel, tags } from '../utils';

type ChartsTableProps = {
  filtered: Song[];
  selected: Set<string>;
  events: Record<string, DownloadEvent>;
  existingIds: Set<string>;
  toggle: (id: string) => void;
};

export function ChartsTable({ filtered, selected, events, existingIds, toggle }: ChartsTableProps) {
  return (
    <div className="table">
      <div className="row head">
        <span></span><span>谱面</span><span>难度</span><span>上传者</span><span>时间</span><span>状态</span>
      </div>
      {filtered.map((song) => {
        const event = events[song.id];
        return (
          <button className={`row ${event?.status || ''} ${hasLocalChart(song, existingIds) ? 'local' : ''}`} key={song.id} onClick={() => toggle(song.id)}>
            <span className="row-wave" />
            <input type="checkbox" checked={selected.has(song.id)} readOnly />
            <span>
              <strong>{song.title}</strong>
              <small>{song.artist || '未知曲师'} · {song.designer || '未知谱师'} {tags(song) && `· ${tags(song)}`}</small>
            </span>
            <b>{primaryLevel(song)}</b>
            <span>{song.uploader || '未知'}</span>
            <span>{formatDate(song.timestamp)}</span>
            <span className={`badge ${event?.status || ''}`}>{event?.message || event?.status || '待命'}</span>
          </button>
        );
      })}
    </div>
  );
}
