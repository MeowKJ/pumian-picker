import { AlertTriangle, Download, RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { ChartsTable } from './components/ChartsTable';
import { Dashboard } from './components/Dashboard';
import { FiltersPanel } from './components/FiltersPanel';
import { QueuePanel } from './components/QueuePanel';
import type { DownloadEvent, FolderSummary, QueueMode, Song, TransferSession } from './types';
import { hasLocalChart, primaryLevel, sortRecent, tags } from './utils';
import './styles.css';

const initialFetchPages = 3;

function App() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('等待拉取近期谱面');
  const [guide, setGuide] = useState<{ title: string; body: string } | undefined>();
  const [searchText, setSearchText] = useState('');
  const [difficulties, setDifficulties] = useState<Set<string>>(new Set());
  const [loadedPages, setLoadedPages] = useState(initialFetchPages);
  const [maxScanPages, setMaxScanPages] = useState(50);
  const [batchSize, setBatchSize] = useState(30);
  const [outputDir, setOutputDir] = useState('');
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [includeVideo, setIncludeVideo] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [concurrency, setConcurrency] = useState(3);
  const [downloading, setDownloading] = useState(false);
  const [events, setEvents] = useState<Record<string, DownloadEvent>>({});
  const [signing, setSigning] = useState<string[]>([]);
  const [queueMode, setQueueMode] = useState<QueueMode>('tasks');
  const [folderSummary, setFolderSummary] = useState<FolderSummary>({ total: 0, complete: 0, incomplete: 0, size: 0, recent: [] });
  const [transfer, setTransfer] = useState<TransferSession | undefined>();
  const [transferQr, setTransferQr] = useState('');
  const [transferStatus, setTransferStatus] = useState('等待打包');

  useEffect(() => api().onDownloadEvent((event) => {
    setEvents((prev) => ({ ...prev, [event.id]: event }));
  }), []);

  useEffect(() => {
    api().detectMacSigning().then(setSigning).catch(() => setSigning([]));
  }, []);

  useEffect(() => {
    if (!outputDir) {
      setExistingIds(new Set());
      setFolderSummary({ total: 0, complete: 0, incomplete: 0, size: 0, recent: [] });
      return;
    }
    api().getExistingIds({ outputDir }).then((ids) => setExistingIds(new Set(ids))).catch(() => setExistingIds(new Set()));
    void refreshFolderSummary(outputDir);
  }, [outputDir]);

  useEffect(() => {
    if (!transfer?.url) {
      setTransferQr('');
      return;
    }
    QRCode.toDataURL(transfer.url, { margin: 1, width: 156, color: { dark: '#07120f', light: '#f6fffb' } })
      .then(setTransferQr)
      .catch(() => setTransferQr(''));
  }, [transfer]);

  function filterSongs(source: Song[]): Song[] {
    const keyword = searchText.trim().toLowerCase();
    return [...source].filter((song) => {
      const level = primaryLevel(song);
      const hitDifficulty = difficulties.size === 0 || difficulties.has(level);
      const text = `${song.title} ${song.artist || ''} ${song.designer || ''} ${song.uploader || ''} ${tags(song)}`.toLowerCase();
      return hitDifficulty && (!keyword || text.includes(keyword));
    }).sort(sortRecent);
  }

  const filtered = useMemo(() => filterSongs(songs), [songs, searchText, difficulties]);
  const eligible = filtered.filter((song) => !blockedIds.has(song.id));
  const coverageIndex = filtered.findIndex((song) => !hasLocalChart(song, existingIds));
  const coveredCount = coverageIndex === -1 ? filtered.length : coverageIndex;
  const coveragePercent = filtered.length ? Math.min(100, Math.round((coveredCount / filtered.length) * 100)) : 0;
  const oldestLoaded = filtered.at(-1);
  const newestLoaded = filtered.at(0);
  const eligibleCount = eligible.length;
  const blockedCount = filtered.length - eligibleCount;
  const localCount = filtered.filter((song) => hasLocalChart(song, existingIds)).length;
  const missingCount = Math.max(0, filtered.length - localCount);

  const stats = useMemo(() => {
    const list = Object.values(events);
    return {
      done: list.filter((event) => event.status === 'done').length,
      failed: list.filter((event) => event.status === 'failed').length,
      skipped: list.filter((event) => event.status === 'skipped').length,
      active: list.filter((event) => event.status === 'downloading').length,
    };
  }, [events]);

  const downloadTotal = Object.keys(events).length;
  const downloadDone = stats.done + stats.failed + stats.skipped;
  const downloadPercent = downloadTotal ? Math.round((downloadDone / downloadTotal) * 100) : 0;
  const fxDots = useMemo(() => Array.from({ length: 18 }, (_, index) => index), []);

  async function refresh() {
    try {
      setStatus('正在从 MajdataNet 拉取近期谱面...');
      const pagesToLoad = Math.min(initialFetchPages, maxScanPages);
      const data = await api().fetchCharts({ pages: pagesToLoad, sort: '' });
      setLoadedPages(pagesToLoad);
      setSongs(data);
      setBlockedIds(new Set());
      setStatus(`已拉取 ${data.length} 个近期谱面，默认纳入下载`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setGuide({ title: '拉取失败', body: message });
      setStatus(`拉取失败：${message}`);
    }
  }

  async function chooseDir() {
    const dir = await api().chooseOutputDir();
    if (dir) {
      setOutputDir(dir);
      const ids = await api().getExistingIds({ outputDir: dir });
      setExistingIds(new Set(ids));
      await refreshFolderSummary(dir);
    }
  }

  async function refreshFolderSummary(dir = outputDir) {
    if (!dir) return;
    const summary = await api().scanFolder({ outputDir: dir });
    setFolderSummary(summary);
  }

  async function prepareTransfer() {
    if (!outputDir) {
      setGuide({ title: '需要输出目录', body: '先选择一个总文件夹，应用会在里面创建歌曲子文件夹。' });
      setTransferStatus('请先选择输出目录');
      return;
    }
    try {
      setQueueMode('transfer');
      setTransferStatus('正在打包完整歌曲...');
      const session = await api().prepareTransfer({ outputDir });
      setTransfer(session);
      setTransferStatus('iPad 扫码下载');
      await refreshFolderSummary();
    } catch (error) {
      const message = error instanceof Error ? error.message : '打包失败';
      setGuide({ title: '传输还没准备好', body: message });
      setTransferStatus(message);
    }
  }

  function toggleBlocked(id: string) {
    setBlockedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function ensureWindow(offset: number, count: number): Promise<Song[]> {
    let nextPages = loadedPages;
    let source = songs;
    let scoped = filterSongs(source).filter((song) => !blockedIds.has(song.id));
    while (scoped.length < offset + count && nextPages < maxScanPages) {
      nextPages = Math.min(maxScanPages, nextPages + Math.max(1, Math.ceil((offset + count - scoped.length) / 30)));
      setStatus(`自动扩展扫描到第 ${nextPages} 页...`);
      source = await api().fetchCharts({ pages: nextPages, sort: '' });
      setLoadedPages(nextPages);
      setSongs(source);
      scoped = filterSongs(source).filter((song) => !blockedIds.has(song.id));
      if (source.length === songs.length) break;
    }
    return scoped.slice(offset, offset + count);
  }

  async function ensureIncremental(count: number): Promise<Song[]> {
    if (!outputDir) return [];
    let nextPages = loadedPages;
    let source = songs;
    let known = existingIds;
    let scoped = filterSongs(source).filter((song) => !blockedIds.has(song.id));
    let missing = scoped.filter((song) => !hasLocalChart(song, known));
    while (missing.length < count && nextPages < maxScanPages) {
      nextPages = Math.min(maxScanPages, nextPages + Math.max(1, Math.ceil((count - missing.length) / 30)));
      setStatus(`增量扫描中，自动扩展到第 ${nextPages} 页...`);
      source = await api().fetchCharts({ pages: nextPages, sort: '' });
      known = new Set(await api().getExistingIds({ outputDir }));
      setLoadedPages(nextPages);
      setSongs(source);
      setExistingIds(known);
      scoped = filterSongs(source).filter((song) => !blockedIds.has(song.id));
      missing = scoped.filter((song) => !hasLocalChart(song, known));
      if (source.length === songs.length) break;
    }
    return missing.slice(0, count);
  }

  async function downloadSongs(picked: Song[]) {
    if (!outputDir || picked.length === 0) {
      setGuide({
        title: !outputDir ? '还不能开始下载' : '没有可下载谱面',
        body: !outputDir ? '请先选择输出目录。所有歌曲文件夹都会保存到这里。' : '当前筛选结果都被排除，或没有匹配的谱面。',
      });
      setStatus('请先选择输出目录和要下载的谱面');
      return;
    }
    setDownloading(true);
    setEvents(Object.fromEntries(picked.map((song) => [song.id, { id: song.id, title: song.title, status: 'queued' as const }])));
    setStatus(`开始下载 ${picked.length} 个谱面`);
    try {
      const result = await api().startDownload({ songs: picked, outputDir, includeVideo, skipExisting, concurrency });
      const failed = result.filter((event) => event.status === 'failed').length;
      const ids = await api().getExistingIds({ outputDir });
      setExistingIds(new Set(ids));
      await refreshFolderSummary(outputDir);
      setStatus(failed ? `下载完成，${failed} 个失败，可调整后重试` : '下载完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setGuide({ title: '下载任务失败', body: message });
      setStatus(`下载任务失败：${message}`);
    } finally {
      setDownloading(false);
    }
  }

  async function startDownload() {
    await downloadSongs(eligible);
  }

  async function downloadLatestBatch() {
    const picked = await ensureWindow(0, batchSize);
    await downloadSongs(picked);
  }

  async function continueBatch() {
    const picked = await ensureIncremental(batchSize);
    await downloadSongs(picked);
  }

  return (
    <main className={`app-shell ${downloading ? 'is-downloading' : ''}`}>
      <div className="fx-grid" />
      <div className="fx-beams" />
      <div className="fx-dots" aria-hidden="true">
        {fxDots.map((dot) => <span key={dot} style={{ '--i': dot } as React.CSSProperties} />)}
      </div>
      <header className="topbar">
        <div>
          <h1>铺面拔取器</h1>
          <p>{status}</p>
        </div>
        <div className="top-actions">
          <button onClick={refresh} disabled={downloading} title="刷新近期谱面">
            <RefreshCw size={18} />
            刷新
          </button>
          <button className="primary energy-button" onClick={startDownload} disabled={downloading} title="开始批量下载">
            <Download size={18} />
            下载当前筛选
          </button>
        </div>
      </header>
      {guide && <GuideBanner title={guide.title} body={guide.body} onClose={() => setGuide(undefined)} />}

      <section className="workspace">
        <FiltersPanel
          searchText={searchText}
          setSearchText={setSearchText}
          batchSize={batchSize}
          setBatchSize={setBatchSize}
          maxScanPages={maxScanPages}
          setMaxScanPages={setMaxScanPages}
          difficulties={difficulties}
          setDifficulties={setDifficulties}
          concurrency={concurrency}
          setConcurrency={setConcurrency}
          outputDir={outputDir}
          chooseDir={chooseDir}
          skipExisting={skipExisting}
          setSkipExisting={setSkipExisting}
          includeVideo={includeVideo}
          setIncludeVideo={setIncludeVideo}
          signing={signing}
        />

        <section className="content">
          <Dashboard
            coveredCount={coveredCount}
            filteredCount={filtered.length}
            coveragePercent={coveragePercent}
            batchSize={batchSize}
            localCount={localCount}
            missingCount={missingCount}
            selectedCount={eligibleCount}
            newestLoaded={newestLoaded}
            oldestLoaded={oldestLoaded}
            downloadDone={downloadDone}
            downloadTotal={downloadTotal}
            downloadPercent={downloadPercent}
            downloading={downloading}
            downloadLatestBatch={downloadLatestBatch}
            continueBatch={continueBatch}
          />
          <div className="toolbar">
            <span>近期 {songs.length} 个 / 筛选 {filtered.length} 个 / 可下载 {eligibleCount} 个 / 排除 {blockedCount} 个 / 已扫描 {loadedPages} 页</span>
            <button onClick={() => setBlockedIds(new Set())}>清空排除</button>
          </div>
          <ChartsTable filtered={filtered} blockedIds={blockedIds} events={events} existingIds={existingIds} toggleBlocked={toggleBlocked} />
        </section>

        <QueuePanel
          queueMode={queueMode}
          setQueueMode={setQueueMode}
          stats={stats}
          events={events}
          folderSummary={folderSummary}
          refreshFolderSummary={() => void refreshFolderSummary()}
          transfer={transfer}
          transferQr={transferQr}
          transferStatus={transferStatus}
          outputDir={outputDir}
          prepareTransfer={prepareTransfer}
        />
      </section>
    </main>
  );
}

function GuideBanner({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div className="guide-banner">
      <div className="guide-glow" />
      <AlertTriangle size={19} />
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      <button onClick={onClose} title="关闭提示"><X size={16} /></button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
