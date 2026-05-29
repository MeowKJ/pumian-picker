import { Activity, Download, StepForward } from 'lucide-react';
import type { Song } from '../types';
import { formatDate } from '../utils';

type DashboardProps = {
  coveredCount: number;
  filteredCount: number;
  coveragePercent: number;
  batchSize: number;
  localCount: number;
  missingCount: number;
  selectedCount: number;
  newestLoaded?: Song;
  oldestLoaded?: Song;
  downloadDone: number;
  downloadTotal: number;
  downloadPercent: number;
  downloading: boolean;
  downloadLatestBatch: () => void;
  continueBatch: () => void;
};

export function Dashboard(props: DashboardProps) {
  const latestWindowEnd = Math.min(props.batchSize, props.filteredCount);
  return (
    <section className="command-deck">
      <div className="position-card">
        <div className="position-head">
          <span><Activity size={15} />下载位置图</span>
          <strong>{props.coveredCount} / {props.filteredCount}</strong>
        </div>
        <div className="position-stats">
          <div><span>连续覆盖</span><strong>{props.coveragePercent}%</strong></div>
          <div><span>本地已有</span><strong>{props.localCount}</strong></div>
          <div><span>待补齐</span><strong>{props.missingCount}</strong></div>
          <div><span>可下载</span><strong>{props.selectedCount}</strong></div>
        </div>
        <div className="position-rail">
          <span className="position-fill" style={{ width: `${props.coveragePercent}%` }} />
          <span className="position-window" style={{ left: '0%', width: `${props.filteredCount ? Math.max(6, (latestWindowEnd / props.filteredCount) * 100) : 6}%` }} />
        </div>
        <div className="position-meta">
          <span>最新窗口 1-{latestWindowEnd}</span>
          <span>最新 {props.newestLoaded ? formatDate(props.newestLoaded.timestamp) : '未加载'}</span>
          <span>最旧 {props.oldestLoaded ? formatDate(props.oldestLoaded.timestamp) : '未加载'}</span>
        </div>
        <div className="download-rail">
          <span className="download-fill" style={{ width: `${props.downloadPercent}%` }} />
          <strong>{props.downloadTotal ? `${props.downloadDone}/${props.downloadTotal}` : '等待任务'}</strong>
        </div>
      </div>
      <div className="batch-panel">
        <button className="batch-action" onClick={props.downloadLatestBatch} disabled={props.downloading}>
          <Download size={17} />
          下载最新 {props.batchSize} 个
        </button>
        <button className="batch-action alt" onClick={props.continueBatch} disabled={props.downloading}>
          <StepForward size={17} />
          增量下载 {props.batchSize} 个
        </button>
      </div>
    </section>
  );
}
