import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Check, Download, FolderOpen, RefreshCw, Search, Settings, ShieldCheck, SkipForward, StepForward } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Song = {
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

type DownloadEvent = {
  id: string;
  title: string;
  status: 'queued' | 'downloading' | 'done' | 'skipped' | 'failed';
  message?: string;
};

declare global {
  interface Window {
    pumian: {
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
      detectMacSigning: () => Promise<string[]>;
      onDownloadEvent: (callback: (event: DownloadEvent) => void) => () => void;
    };
  }
}

const fallbackApi: Window['pumian'] = {
  fetchCharts: async () => {
    const response = await fetch('https://majdata.net/api3/api/maichart/list?sort=&page=0');
    return response.json();
  },
  chooseOutputDir: async () => undefined,
  startDownload: async () => [],
  getExistingIds: async () => [],
  detectMacSigning: async () => [],
  onDownloadEvent: () => () => {},
};

function api(): Window['pumian'] {
  return window.pumian || fallbackApi;
}

const difficultyOptions = ['12', '12+', '13', '13+', '14', '14+', '15'];

function primaryLevel(song: Song): string {
  return (song.levels || []).find(Boolean) || '未知';
}

function levelNumber(level: string): number {
  const value = level.replace('+', '.7');
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value?: string): string {
  if (!value) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function tags(song: Song): string {
  return [...(song.tags || []), ...(song.publicTags || [])].slice(0, 3).join(' / ');
}

function sortRecent(a: Song, b: Song): number {
  return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
}

function hasLocalChart(song: Song, existingIds: Set<string>): boolean {
  return existingIds.has(song.id) || existingIds.has(song.id.slice(0, 8));
}

function taskPercent(event: DownloadEvent): number {
  if (event.status === 'queued') return 8;
  if (event.status === 'done' || event.status === 'skipped' || event.status === 'failed') return 100;
  if (event.message?.includes('谱面')) return 24;
  if (event.message?.includes('音频')) return 48;
  if (event.message?.includes('封面')) return 72;
  if (event.message?.includes('PV')) return 86;
  if (event.message?.includes('写入')) return 94;
  return 18;
}

function App() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('等待拉取近期谱面');
  const [searchText, setSearchText] = useState('');
  const [difficulties, setDifficulties] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState(3);
  const [batchSize, setBatchSize] = useState(30);
  const [outputDir, setOutputDir] = useState('');
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [includeVideo, setIncludeVideo] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);
  const [concurrency, setConcurrency] = useState(3);
  const [downloading, setDownloading] = useState(false);
  const [events, setEvents] = useState<Record<string, DownloadEvent>>({});
  const [signing, setSigning] = useState<string[]>([]);

  useEffect(() => api().onDownloadEvent((event) => {
    setEvents((prev) => ({ ...prev, [event.id]: event }));
  }), []);

  useEffect(() => {
    api().detectMacSigning().then(setSigning).catch(() => setSigning([]));
  }, []);

  useEffect(() => {
    if (!outputDir) {
      setExistingIds(new Set());
      return;
    }
    api().getExistingIds({ outputDir }).then((ids) => setExistingIds(new Set(ids))).catch(() => setExistingIds(new Set()));
  }, [outputDir]);

  function filterSongs(source: Song[]): Song[] {
    const keyword = searchText.trim().toLowerCase();
    return [...source].filter((song) => {
      const level = primaryLevel(song);
      const hitDifficulty = difficulties.size === 0 || difficulties.has(level);
      const text = `${song.title} ${song.artist || ''} ${song.designer || ''} ${song.uploader || ''} ${tags(song)}`.toLowerCase();
      return hitDifficulty && (!keyword || text.includes(keyword));
    }).sort(sortRecent);
  }

  const filtered = useMemo(() => {
    return filterSongs(songs);
  }, [songs, searchText, difficulties]);

  const coverageIndex = filtered.findIndex((song) => !hasLocalChart(song, existingIds));
  const coveredCount = coverageIndex === -1 ? filtered.length : coverageIndex;
  const coveragePercent = filtered.length ? Math.min(100, Math.round((coveredCount / filtered.length) * 100)) : 0;
  const latestWindowEnd = Math.min(batchSize, filtered.length);
  const oldestLoaded = filtered.at(-1);
  const newestLoaded = filtered.at(0);
  const selectedCount = filtered.filter((song) => selected.has(song.id)).length;
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
      const data = await api().fetchCharts({ pages, sort: '' });
      setSongs(data);
      setSelected(new Set(data.map((song) => song.id)));
      setStatus(`已拉取 ${data.length} 个近期谱面，默认全选`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setStatus(`拉取失败：${message}`);
    }
  }

  async function chooseDir() {
    const dir = await api().chooseOutputDir();
    if (dir) {
      setOutputDir(dir);
      const ids = await api().getExistingIds({ outputDir: dir });
      setExistingIds(new Set(ids));
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFiltered() {
    setSelected(new Set(filtered.map((song) => song.id)));
  }

  function toggleDifficulty(level: string) {
    setDifficulties((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  async function ensureWindow(offset: number, count: number): Promise<Song[]> {
    let nextPages = pages;
    let source = songs;
    let scoped = filterSongs(source);
    while (scoped.length < offset + count && nextPages < 50) {
      nextPages = Math.min(50, nextPages + Math.max(1, Math.ceil((offset + count - scoped.length) / 30)));
      setStatus(`正在往前拉取更多谱面，第 ${nextPages} 页以内...`);
      source = await api().fetchCharts({ pages: nextPages, sort: '' });
      setPages(nextPages);
      setSongs(source);
      scoped = filterSongs(source);
      if (source.length === songs.length) break;
    }
    return scoped.slice(offset, offset + count);
  }

  async function ensureIncremental(count: number): Promise<Song[]> {
    if (!outputDir) return [];
    let nextPages = pages;
    let source = songs;
    let known = existingIds;
    let scoped = filterSongs(source);
    let missing = scoped.filter((song) => !hasLocalChart(song, known));
    while (missing.length < count && nextPages < 50) {
      nextPages = Math.min(50, nextPages + Math.max(1, Math.ceil((count - missing.length) / 30)));
      setStatus(`增量扫描中，正在继续往前拉取到第 ${nextPages} 页...`);
      source = await api().fetchCharts({ pages: nextPages, sort: '' });
      known = new Set(await api().getExistingIds({ outputDir }));
      setPages(nextPages);
      setSongs(source);
      setExistingIds(known);
      scoped = filterSongs(source);
      missing = scoped.filter((song) => !hasLocalChart(song, known));
      if (source.length === songs.length) break;
    }
    return missing.slice(0, count);
  }

  async function downloadSongs(picked: Song[]) {
    if (!outputDir || picked.length === 0) {
      setStatus('请先选择输出目录和要下载的谱面');
      return;
    }
    setDownloading(true);
    setEvents(Object.fromEntries(picked.map((song) => [song.id, { id: song.id, title: song.title, status: 'queued' as const }])));
    setStatus(`开始下载 ${picked.length} 个谱面`);
    try {
      const result = await api().startDownload({
        songs: picked,
        outputDir,
        includeVideo,
        skipExisting,
        concurrency,
      });
      const failed = result.filter((event) => event.status === 'failed').length;
      if (outputDir) {
        const ids = await api().getExistingIds({ outputDir });
        setExistingIds(new Set(ids));
      }
      setStatus(failed ? `下载完成，${failed} 个失败，可调整后重试` : '下载完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setStatus(`下载任务失败：${message}`);
    } finally {
      setDownloading(false);
    }
  }

  async function startDownload() {
    const picked = filtered.filter((song) => selected.has(song.id));
    await downloadSongs(picked);
  }

  async function downloadLatestBatch() {
    const picked = await ensureWindow(0, batchSize);
    setSelected(new Set(picked.map((song) => song.id)));
    await downloadSongs(picked);
  }

  async function continueBatch() {
    const picked = await ensureIncremental(batchSize);
    setSelected(new Set(picked.map((song) => song.id)));
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
            下载选中
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="filters">
          <div className="section-title"><Settings size={17} />筛选与输出</div>
          <label>
            搜索
            <span className="input-wrap">
              <Search size={16} />
              <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="标题 / 作者 / 标签" />
            </span>
          </label>
          <label>
            拉取页数
            <input type="number" min={1} max={50} value={pages} onChange={(event) => setPages(Number(event.target.value))} />
          </label>
          <label>
            每批数量
            <input type="number" min={1} max={500} value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} />
          </label>
          <label>
            难度
            <div className="chips">
              <button className={difficulties.size === 0 ? 'active' : ''} onClick={() => setDifficulties(new Set())}>全部</button>
              {difficultyOptions.map((item) => (
                <button key={item} className={difficulties.has(item) ? 'active' : ''} onClick={() => toggleDifficulty(item)}>{item}</button>
              ))}
            </div>
          </label>
          <label>
            并发数
            <input type="range" min={1} max={8} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} />
            <span className="range-value">{concurrency}</span>
          </label>
          <button className="wide tool-button" onClick={chooseDir} title="选择下载总文件夹">
            <FolderOpen size={18} />
            选择输出目录
          </button>
          <div className="output-path">{outputDir || '未选择目录'}</div>
          <label className="toggle">
            <input type="checkbox" checked={skipExisting} onChange={(event) => setSkipExisting(event.target.checked)} />
            <SkipForward size={16} /> 跳过已下载
          </label>
          <label className="toggle">
            <input type="checkbox" checked={includeVideo} onChange={(event) => setIncludeVideo(event.target.checked)} />
            <Check size={16} /> 尝试下载 PV
          </label>
          <div className="signing">
            <ShieldCheck size={17} />
            {signing.length ? `检测到 ${signing.length} 个 Mac 签名` : '本机未检测到 Mac 签名'}
          </div>
        </aside>

        <section className="content">
          <section className="command-deck">
            <div className="position-card">
              <div className="position-head">
                <span><Activity size={15} />下载位置图</span>
                <strong>{coveredCount} / {filtered.length}</strong>
              </div>
              <div className="position-stats">
                <div><span>连续覆盖</span><strong>{coveragePercent}%</strong></div>
                <div><span>本地已有</span><strong>{localCount}</strong></div>
                <div><span>待补齐</span><strong>{missingCount}</strong></div>
                <div><span>选中</span><strong>{selectedCount}</strong></div>
              </div>
              <div className="position-rail">
                <span className="position-fill" style={{ width: `${coveragePercent}%` }} />
                <span className="position-window" style={{ left: '0%', width: `${filtered.length ? Math.max(6, (latestWindowEnd / filtered.length) * 100) : 6}%` }} />
              </div>
              <div className="position-meta">
                <span>最新窗口 1-{latestWindowEnd}</span>
                <span>最新 {newestLoaded ? formatDate(newestLoaded.timestamp) : '未加载'}</span>
                <span>最旧 {oldestLoaded ? formatDate(oldestLoaded.timestamp) : '未加载'}</span>
              </div>
              <div className="download-rail">
                <span className="download-fill" style={{ width: `${downloadPercent}%` }} />
                <strong>{downloadTotal ? `${downloadDone}/${downloadTotal}` : '等待任务'}</strong>
              </div>
            </div>
            <div className="batch-panel">
              <button className="batch-action" onClick={downloadLatestBatch} disabled={downloading}>
                <Download size={17} />
                下载最新 {batchSize} 个
              </button>
              <button className="batch-action alt" onClick={continueBatch} disabled={downloading}>
                <StepForward size={17} />
                增量下载 {batchSize} 个
              </button>
            </div>
          </section>
          <div className="toolbar">
            <span>近期 {songs.length} 个 / 筛选 {filtered.length} 个 / 选中 {selectedCount} 个</span>
            <button onClick={selectFiltered}>全选筛选结果</button>
            <button onClick={() => setSelected(new Set())}>清空</button>
          </div>

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
        </section>

        <aside className="queue">
          <div className="section-title"><Download size={17} />下载队列</div>
          <div className="metric"><span>进行中</span><strong>{stats.active}</strong></div>
          <div className="metric"><span>完成</span><strong>{stats.done}</strong></div>
          <div className="metric"><span>跳过</span><strong>{stats.skipped}</strong></div>
          <div className="metric danger"><span>失败</span><strong>{stats.failed}</strong></div>
          <div className="log">
            {Object.values(events).slice(-18).reverse().map((event) => (
              <div key={`${event.id}-${event.status}`} className={`task-card ${event.status}`}>
                <span className="task-wave" />
                <span className="task-progress" style={{ width: `${taskPercent(event)}%` }} />
                <strong>{event.title}</strong>
                <span>{event.message || event.status}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
