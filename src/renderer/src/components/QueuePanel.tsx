import { AlertTriangle, CheckCircle2, Download, RefreshCw } from 'lucide-react';
import type { DownloadEvent, FolderSummary, QueueMode, TransferSession } from '../types';
import { formatBytes, taskPercent } from '../utils';

type QueuePanelProps = {
  queueMode: QueueMode;
  setQueueMode: (mode: QueueMode) => void;
  stats: {
    done: number;
    failed: number;
    skipped: number;
    active: number;
  };
  events: Record<string, DownloadEvent>;
  queueOrder: string[];
  folderSummary: FolderSummary;
  refreshFolderSummary: () => void;
  transfer?: TransferSession;
  transferQr: string;
  transferStatus: string;
  outputDir: string;
  prepareTransfer: () => void;
};

export function QueuePanel(props: QueuePanelProps) {
  return (
    <aside className="queue">
      <div className="section-title"><Download size={17} />下载队列</div>
      <div className="queue-tabs">
        <button className={props.queueMode === 'tasks' ? 'active' : ''} onClick={() => props.setQueueMode('tasks')}>任务</button>
        <button className={props.queueMode === 'folder' ? 'active' : ''} onClick={() => props.setQueueMode('folder')}>文件夹</button>
        <button className={props.queueMode === 'transfer' ? 'active transfer-tab' : 'transfer-tab'} onClick={() => props.setQueueMode('transfer')}>iPad 传输</button>
      </div>
      {props.queueMode === 'tasks' && <TaskList stats={props.stats} events={props.events} queueOrder={props.queueOrder} />}
      {props.queueMode === 'folder' && (
        <FolderList folderSummary={props.folderSummary} refreshFolderSummary={props.refreshFolderSummary} />
      )}
      {props.queueMode === 'transfer' && (
        <TransferBox
          transfer={props.transfer}
          transferQr={props.transferQr}
          transferStatus={props.transferStatus}
          outputDir={props.outputDir}
          prepareTransfer={props.prepareTransfer}
        />
      )}
    </aside>
  );
}

function TaskList({ stats, events, queueOrder }: Pick<QueuePanelProps, 'stats' | 'events' | 'queueOrder'>) {
  const orderedEvents = queueOrder.length
    ? queueOrder.map((id) => events[id]).filter(Boolean)
    : Object.values(events);

  return (
    <>
      <div className="metric"><span>进行中</span><strong>{stats.active}</strong></div>
      <div className="metric"><span>完成</span><strong>{stats.done}</strong></div>
      <div className="metric"><span>跳过</span><strong>{stats.skipped}</strong></div>
      <div className="metric danger"><span>失败</span><strong>{stats.failed}</strong></div>
      <div className="log">
        {orderedEvents.slice(0, 18).map((event, index) => (
          <div key={`${event.id}-${event.status}`} className={`task-card ${event.status}`}>
            <span className="task-wave" />
            <span className="task-progress" style={{ width: `${taskPercent(event)}%` }} />
            <strong>{String(index + 1).padStart(2, '0')} · {event.title}</strong>
            <span>{event.message || event.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function FolderList({ folderSummary, refreshFolderSummary }: {
  folderSummary: FolderSummary;
  refreshFolderSummary: () => void;
}) {
  return (
    <>
      <div className="metric"><span>歌曲文件夹</span><strong>{folderSummary.total}</strong></div>
      <div className="metric"><span>完整</span><strong>{folderSummary.complete}</strong></div>
      <div className="metric danger"><span>缺文件</span><strong>{folderSummary.incomplete}</strong></div>
      <div className="metric"><span>总大小</span><strong>{formatBytes(folderSummary.size)}</strong></div>
      <button className="queue-action folder-scan" onClick={refreshFolderSummary}>
        <RefreshCw size={14} />
        重新扫描
      </button>
      <div className="log folder-log">
        {folderSummary.recent.length === 0 && (
          <div className="folder-empty">当前输出目录还没有歌曲文件夹</div>
        )}
        {folderSummary.recent.map((item) => (
          <div key={item.folder} className={`folder-card ${item.complete ? 'complete' : 'incomplete'}`}>
            <span className="folder-glow" />
            <div className="folder-main">
              <span className="folder-state">
                {item.complete ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              </span>
              <div className="folder-copy">
                <strong>{item.title}</strong>
                <span title={item.folder}>{item.folder}</span>
              </div>
            </div>
            <div className="folder-meta">
              <span>{formatBytes(item.size)}</span>
              <span>{formatFolderDate(item.updatedAt)}</span>
              <span>{item.complete ? '完整' : `缺 ${item.missing.length} 项`}</span>
            </div>
            {!item.complete && (
              <div className="folder-missing" title={item.missing.join(' / ')}>
                {item.missing.join(' / ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function formatFolderDate(value?: string): string {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function TransferBox(props: Pick<QueuePanelProps, 'transfer' | 'transferQr' | 'transferStatus' | 'outputDir' | 'prepareTransfer'>) {
  return (
    <div className="transfer-panel">
      <button className="queue-action primary-action" onClick={props.prepareTransfer} disabled={!props.outputDir}>
        打包 ZIP 并生成 iPad 二维码
      </button>
      <div className={`transfer-card ${props.transferQr ? 'is-ready' : 'is-idle'}`}>
        <div className="qr-orbit" />
        <strong>{props.transferStatus}</strong>
        <span>{props.transfer ? `${props.transfer.completeCount} 首 / ${formatBytes(props.transfer.size)}` : 'ZIP 内会统一放入 levels 文件夹'}</span>
        {props.transferQr && (
          <div className="qr-stage">
            <img src={props.transferQr} alt="iPad 扫码下载二维码" />
            <span className="qr-scanline" />
          </div>
        )}
        {props.transfer && <a href={props.transfer.url}>{props.transfer.url}</a>}
      </div>
    </div>
  );
}
