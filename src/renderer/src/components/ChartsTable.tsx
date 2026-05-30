import { Ban, RotateCcw, Trash2 } from 'lucide-react';
import type { UIEvent } from 'react';
import type { DownloadEvent, Song } from '../types';
import { formatDate, hasLocalChart, primaryLevel, tags } from '../utils';

type ChartsTableProps = {
  filtered: Song[];
  blockedIds: Set<string>;
  events: Record<string, DownloadEvent>;
  existingIds: Set<string>;
  toggleBlocked: (id: string) => void;
  deleteLocalChart: (song: Song) => void;
  onReachEnd: () => void;
  canLoadMore: boolean;
  loadingMore: boolean;
};

export function ChartsTable(props: ChartsTableProps) {
  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 120) {
      props.onReachEnd();
    }
  }

  return (
    <div className="table" onScroll={handleScroll}>
      <div className="row head">
        <span></span><span>谱面</span><span>难度</span><span>上传者</span><span>时间</span><span>状态</span>
      </div>
      {props.filtered.map((song) => {
        const event = props.events[song.id];
        const blocked = props.blockedIds.has(song.id);
        const local = hasLocalChart(song, props.existingIds);
        return (
          <div className={`row ${event?.status || ''} ${local ? 'local' : ''} ${blocked ? 'excluded' : ''}`} key={song.id}>
            <span className="row-wave" />
            <span className="row-actions">
              <button className="exclude-toggle" onClick={() => props.toggleBlocked(song.id)} title={blocked ? '恢复纳入下载' : '排除这首'}>
                {blocked ? <RotateCcw size={14} /> : <Ban size={14} />}
              </button>
              {local && (
                <button className="delete-local" onClick={() => props.deleteLocalChart(song)} title="删除本地歌曲文件夹">
                  <Trash2 size={14} />
                </button>
              )}
            </span>
            <span>
              <strong>{song.title}</strong>
              <small>{song.artist || '未知曲师'} · {song.designer || '未知谱师'} {tags(song) && `· ${tags(song)}`}</small>
            </span>
            <b>{primaryLevel(song)}</b>
            <span>{song.uploader || '未知'}</span>
            <span>{formatDate(song.timestamp)}</span>
            <span className={`badge ${event?.status || ''}`}>{blocked ? '已排除' : event?.message || event?.status || (local ? '本地已有' : '待命')}</span>
          </div>
        );
      })}
      <div className="infinite-sentinel">
        {props.loadingMore ? '继续拉取更早谱面...' : props.canLoadMore ? '滚动到底继续加载更早谱面' : '已到达扫描上限'}
      </div>
    </div>
  );
}
