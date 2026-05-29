import React, { useEffect, useMemo, useState } from 'react';
import { Check, Download, FolderOpen, RefreshCw, Search, Settings, ShieldCheck, SkipForward } from 'lucide-react';
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
  detectMacSigning: async () => [],
  onDownloadEvent: () => () => {},
};

function api(): Window['pumian'] {
  return window.pumian || fallbackApi;
}

const difficultyOptions = ['全部', '12', '12+', '13', '13+', '14', '14+', '15'];

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

function App() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('等待拉取近期谱面');
  const [searchText, setSearchText] = useState('');
  const [difficulty, setDifficulty] = useState('全部');
  const [pages, setPages] = useState(3);
  const [outputDir, setOutputDir] = useState('');
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

  const filtered = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return songs.filter((song) => {
      const level = primaryLevel(song);
      const hitDifficulty = difficulty === '全部' || level === difficulty;
      const text = `${song.title} ${song.artist || ''} ${song.designer || ''} ${song.uploader || ''} ${tags(song)}`.toLowerCase();
      return hitDifficulty && (!keyword || text.includes(keyword));
    });
  }, [songs, searchText, difficulty]);

  const stats = useMemo(() => {
    const list = Object.values(events);
    return {
      done: list.filter((event) => event.status === 'done').length,
      failed: list.filter((event) => event.status === 'failed').length,
      skipped: list.filter((event) => event.status === 'skipped').length,
      active: list.filter((event) => event.status === 'downloading').length,
    };
  }, [events]);

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
    if (dir) setOutputDir(dir);
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

  async function startDownload() {
    const picked = filtered.filter((song) => selected.has(song.id));
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
      setStatus(failed ? `下载完成，${failed} 个失败，可调整后重试` : '下载完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setStatus(`下载任务失败：${message}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="app-shell">
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
          <button className="primary" onClick={startDownload} disabled={downloading} title="开始批量下载">
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
            难度
            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              {difficultyOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            并发数
            <input type="range" min={1} max={8} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} />
            <span className="range-value">{concurrency}</span>
          </label>
          <button className="wide" onClick={chooseDir} title="选择下载总文件夹">
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
          <div className="toolbar">
            <span>近期 {songs.length} 个 / 筛选 {filtered.length} 个 / 选中 {filtered.filter((song) => selected.has(song.id)).length} 个</span>
            <button onClick={selectFiltered}>全选筛选结果</button>
            <button onClick={() => setSelected(new Set())}>清空</button>
          </div>

          <div className="table">
            <div className="row head">
              <span></span><span>谱面</span><span>难度</span><span>上传者</span><span>时间</span><span>状态</span>
            </div>
            {filtered.sort((a, b) => levelNumber(primaryLevel(b)) - levelNumber(primaryLevel(a))).map((song) => {
              const event = events[song.id];
              return (
                <button className="row" key={song.id} onClick={() => toggle(song.id)}>
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
              <div key={`${event.id}-${event.status}`} className={event.status}>
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
