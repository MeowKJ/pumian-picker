import { Check, FolderOpen, Search, Settings, ShieldCheck, SkipForward } from 'lucide-react';
import { difficultyOptions } from '../utils';

type FiltersPanelProps = {
  searchText: string;
  setSearchText: (value: string) => void;
  batchSize: number;
  setBatchSize: (value: number) => void;
  maxScanPages: number;
  setMaxScanPages: (value: number) => void;
  difficulties: Set<string>;
  setDifficulties: (value: Set<string>) => void;
  concurrency: number;
  setConcurrency: (value: number) => void;
  outputDir: string;
  chooseDir: () => void;
  skipExisting: boolean;
  setSkipExisting: (value: boolean) => void;
  includeVideo: boolean;
  setIncludeVideo: (value: boolean) => void;
  signing: string[];
};

export function FiltersPanel(props: FiltersPanelProps) {
  function toggleDifficulty(level: string) {
    const next = new Set(props.difficulties);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    props.setDifficulties(next);
  }

  return (
    <aside className="filters">
      <div className="section-title"><Settings size={17} />筛选与输出</div>
      <label>
        搜索
        <span className="input-wrap">
          <Search size={16} />
          <input value={props.searchText} onChange={(event) => props.setSearchText(event.target.value)} placeholder="标题 / 作者 / 标签" />
        </span>
      </label>
      <label>
        每次下载数量
        <input type="number" min={1} max={500} value={props.batchSize} onChange={(event) => props.setBatchSize(Number(event.target.value))} />
      </label>
      <details className="advanced-options">
        <summary>高级扫描</summary>
        <label>
          最大扫描页数
          <input type="number" min={1} max={50} value={props.maxScanPages} onChange={(event) => props.setMaxScanPages(Number(event.target.value))} />
        </label>
      </details>
      <label>
        难度
        <div className="chips">
          <button className={props.difficulties.size === 0 ? 'active' : ''} onClick={() => props.setDifficulties(new Set())}>全部</button>
          {difficultyOptions.map((item) => (
            <button key={item} className={props.difficulties.has(item) ? 'active' : ''} onClick={() => toggleDifficulty(item)}>{item}</button>
          ))}
        </div>
      </label>
      <label>
        并发数
        <input type="range" min={1} max={8} value={props.concurrency} onChange={(event) => props.setConcurrency(Number(event.target.value))} />
        <span className="range-value">{props.concurrency}</span>
      </label>
      <button className="wide tool-button" onClick={props.chooseDir} title="选择下载总文件夹">
        <FolderOpen size={18} />
        选择输出目录
      </button>
      <div className="output-path">{props.outputDir || '未选择目录'}</div>
      <label className="toggle">
        <input type="checkbox" checked={props.skipExisting} onChange={(event) => props.setSkipExisting(event.target.checked)} />
        <SkipForward size={16} /> 跳过已下载
      </label>
      <label className="toggle">
        <input type="checkbox" checked={props.includeVideo} onChange={(event) => props.setIncludeVideo(event.target.checked)} />
        <Check size={16} /> 尝试下载 PV
      </label>
      <div className="signing">
        <ShieldCheck size={17} />
        {props.signing.length ? `检测到 ${props.signing.length} 个 Mac 签名` : '本机未检测到 Mac 签名'}
      </div>
    </aside>
  );
}
