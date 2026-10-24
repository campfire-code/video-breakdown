// 主界面：左边粘贴文案 / 导入字幕，右边显示拆解卡片，可导出 Excel 和 PNG 图片。
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FolderOpen, ImageDown, Sparkles, Upload, X } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { useDroppedFiles } from '../kit/parts';
import { defaultOutputDir, ensureDir, openFolder, pickFiles, pickFolder, reveal, settingsStore } from '../kit/platform';
import { decodeText, errText } from './common';
import { PLATFORMS, analyze, computeStats, exportBase, fmtTime, loadScript, type Breakdown, type Script, type Stats } from './core';
import { exportExcel, exportPngs } from './flow';
import { drawCard, layout, renderAll } from './render';
import type { Page } from './cards';
import { W } from './cards';
import { SAMPLE_NAME, SAMPLE_RESULT, SAMPLE_SRT } from './sample';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
const TOOL_NAME = '竞品视频拆解卡';
const PREFS_KEY = 'c21.prefs';
const EXT = ['srt', 'txt', 'vtt'];

interface Result {
  bd: Breakdown;
  stats: Stats;
  script: Script;
  /** 拆解时用的原文，用来提示「文案已修改」 */
  source: string;
  sample?: boolean;
  calls?: number;
  truncated?: boolean;
}

function sampleResult(): Result {
  const script = loadScript(SAMPLE_SRT);
  return { bd: SAMPLE_RESULT, stats: computeStats(script), script, source: SAMPLE_SRT, sample: true };
}

function CardCanvas({ page, index, total, bd, onOpen }: { page: Page; index: number; total: number; bd: Breakdown; onOpen?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const thumb = !!onOpen;
  useEffect(() => {
    const scale = thumb ? Math.min(1, Math.max(0.3, ((ref.current?.clientWidth || 200) * (devicePixelRatio || 1)) / W)) : 1;
    if (ref.current) drawCard(ref.current, page, index, total, { title: bd.title, genre: bd.genre }, scale);
  }, [page, index, total, bd, thumb]);
  return onOpen ? (
    <button className="vb-thumb" onClick={onOpen} title="点击放大">
      <canvas ref={ref} aria-label={`第 ${index + 1} 张卡片`} />
      <span className="k-muted k-num">第 {index + 1} 张</span>
    </button>
  ) : <canvas ref={ref} aria-label={`第 ${index + 1} 张卡片`} />;
}

export function Main({ ctx }: { ctx?: Ctx }) {
  const [text, setText] = useState(SAMPLE_SRT);
  const [fileName, setFileName] = useState(SAMPLE_NAME);
  const [note, setNote] = useState('');
  const [platform, setPlatform] = useState('auto');
  const [outDir, setOutDir] = useState('');
  const [defaultDir, setDefaultDir] = useState('');
  const [result, setResult] = useState<Result | null>(sampleResult);
  const [busy, setBusy] = useState<'' | 'ai' | 'xlsx' | 'png'>('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string; path?: string; dir?: boolean } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const p = (await (await settingsStore()).get<{ outDir?: string; platform?: string }>(PREFS_KEY)) ?? {};
        if (typeof p.outDir === 'string') setOutDir(p.outDir);
        if (typeof p.platform === 'string') setPlatform(p.platform);
      } catch { /* 预览页或首次打开 */ }
      try { setDefaultDir((await defaultOutputDir(TOOL_NAME)) || ''); } catch { /* 预览页没有本机路径 */ }
      loaded.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    (async () => { try { await (await settingsStore()).set(PREFS_KEY, { outDir, platform }); } catch { /* 预览页不保存 */ } })();
  }, [outDir, platform]);

  const deferred = useDeferredValue(text);
  const parsed = useMemo(() => {
    try { const s = loadScript(deferred); return { s, stats: computeStats(s) }; } catch (e) { return { err: errText(e) }; }
  }, [deferred]);
  const pages = useMemo(() => (result ? layout(result.bd, result.stats) : []), [result]);
  const dir = outDir || defaultDir;

  useEffect(() => {
    if (zoom == null) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null);
      else if (e.key === 'ArrowRight') setZoom((z) => Math.min(pages.length - 1, (z ?? 0) + 1));
      else if (e.key === 'ArrowLeft') setZoom((z) => Math.max(0, (z ?? 0) - 1));
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [zoom, pages.length]);

  async function importPath(path: string) {
    if (!ctx) return;
    const name = path.split(/[\\/]/).pop() ?? path;
    if (!EXT.some((e) => name.toLowerCase().endsWith('.' + e))) return setMsg({ kind: 'err', text: `「${name}」不是 .srt / .vtt / .txt 文件。桌面端暂不直接处理视频，请先转成字幕或文案` });
    try {
      setText(decodeText(await ctx.readFile(path)));
      setFileName(name);
      setMsg({ kind: 'ok', text: `已导入 ${name}` });
    } catch (e) {
      setMsg({ kind: 'err', text: `导入失败：${errText(e)}` });
    }
  }
  const hover = useDroppedFiles((paths) => { if (paths[0]) void importPath(paths[0]); });

  async function runAi() {
    if (!ctx || !parsed.s) return;
    setBusy('ai');
    setMsg(null);
    try {
      const r = await analyze(parsed.s, { note, platform }, (m, o) => ctx.llm(m, o));
      setResult({ bd: r.breakdown, stats: r.stats, script: parsed.s, source: text, calls: r.calls, truncated: r.truncated });
      setMsg({ kind: 'ok', text: `拆解完成：${r.breakdown.shots.length} 段分镜、${r.breakdown.conversions.length} 个转化点，调用大模型 ${r.calls} 次${r.truncated ? '。正文太长，只拆解了前面部分' : ''}` });
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e) });
    }
    setBusy('');
  }

  const io = ctx ? { join: ctx.join, writeFile: ctx.writeFile, ensureDir } : null;
  const base = () => exportBase(note, result?.sample ? SAMPLE_NAME : fileName, result?.bd ?? null);

  async function saveXlsx() {
    if (!io || !result) return;
    setBusy('xlsx');
    try {
      const path = await exportExcel(io, dir, base(), result.bd, result.stats, result.script);
      setMsg({ kind: 'ok', text: `已导出 Excel：${path}`, path });
    } catch (e) {
      setMsg({ kind: 'err', text: `导出失败：${errText(e)}` });
    }
    setBusy('');
  }
  async function savePng() {
    if (!io || !result) return;
    setBusy('png');
    try {
      const r = await exportPngs(io, dir, base(), new Date(), await renderAll(result.bd, result.stats));
      setMsg({ kind: 'ok', text: `已导出 ${r.files.length} 张 PNG（1080×1440）到 ${r.dir}`, path: r.dir, dir: true });
    } catch (e) {
      setMsg({ kind: 'err', text: `导出失败：${errText(e)}` });
    }
    setBusy('');
  }

  const bd = result?.bd;
  const stale = result && !result.sample && result.source !== text;

  return (
    <div className={`vb${hover ? ' vb-hover' : ''}`}>
      <section className="vb-edit k-panel">
        <div className="k-field vb-grow">
          <div className="vb-row">
            <label className="k-label" htmlFor="vb-text">文案或字幕</label>
            <span className="b-sp" />
            <button className="k-btn" onClick={async () => { const [p] = await pickFiles(EXT, '字幕或文案').catch(() => [] as string[]); if (p) void importPath(p); }}><Upload size={14} />导入 .srt / .txt</button>
          </div>
          <textarea id="vb-text" className="k-input k-textarea vb-text" value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); setFileName(''); }}
            placeholder={'把视频文案或字幕粘贴到这里，或把 .srt / .txt 文件拖进窗口。\n带时间轴的字幕可以拆出每段的时间和语速。'} />
          <span className={`k-help${parsed.err ? ' k-err-text' : ''}`}>
            {parsed.err ?? (parsed.s!.kind === 'srt'
              ? `识别为字幕：${parsed.s!.cues.length} 条 · 时长 ${fmtTime(parsed.s!.durationMs ?? 0)} · ${parsed.stats!.words} 字 · 平均 ${parsed.stats!.perMinute} 字/分钟`
              : `识别为纯文案：${parsed.stats!.words} 字，没有时间轴，分镜不带时间`)}
            {fileName && !parsed.err ? `（${fileName}）` : ''}
          </span>
        </div>
        <div className="k-field">
          <label className="k-label" htmlFor="vb-note">视频标题或备注（可不填）</label>
          <input id="vb-note" className="k-input" value={note} maxLength={60} placeholder="例如：同行收纳箱爆款视频" onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="k-field">
          <label className="k-label" htmlFor="vb-platform">发布平台</label>
          <select id="vb-platform" className="k-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <button className="k-btn primary vb-go" disabled={!!busy || !parsed.s} onClick={runAi}><Sparkles size={15} />{busy === 'ai' ? 'AI 正在拆解…' : 'AI 拆解'}</button>
        <span className="k-help">桌面端暂不直接处理视频文件：先用「离线视频转字幕」等工具拿到字幕或文案再来拆解。需要先在「设置」里填自己的大模型接口。</span>
      </section>

      <section className="vb-view">
        <div className="vb-row vb-bar">
          <b>拆解卡</b>
          {result?.sample && <span className="vb-badge">示例</span>}
          {stale && <span className="k-muted">文案已修改，点「AI 拆解」更新</span>}
          <span className="b-sp" />
          <button className="k-btn vb-dir" title={dir || '选择保存位置'} onClick={async () => { const p = await pickFolder().catch(() => null); if (p) setOutDir(p); }}>
            <FolderOpen size={15} /><span className="k-ellipsis">{dir ? `保存到 ${dir}` : '选择保存位置'}</span>
          </button>
          <button className="k-btn" disabled={!!busy || !result} onClick={saveXlsx}><FileSpreadsheet size={15} />{busy === 'xlsx' ? '正在导出…' : '导出 Excel'}</button>
          <button className="k-btn primary" disabled={!!busy || !result} onClick={savePng}><ImageDown size={15} />{busy === 'png' ? '正在导出…' : `导出图片（${pages.length} 张）`}</button>
        </div>
        {msg && (
          <div className={`k-notice ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
            <span>{msg.text}</span>
            {msg.path && <button className="k-link" onClick={() => (msg.dir ? openFolder(msg.path!) : reveal(msg.path!))}>{msg.dir ? '打开文件夹' : '在文件夹中显示'}</button>}
            <button className="k-icon-btn" aria-label="关闭提示" onClick={() => setMsg(null)}><X size={14} /></button>
          </div>
        )}
        {!bd ? <div className="k-panel vb-empty k-muted">粘贴文案或导入字幕后，点「AI 拆解」</div> : (
          <>
            <Timeline bd={bd} stats={result!.stats} />

            <div className="vb-cols">
              <div className="k-panel vb-card vb-shotcard">
                <div className="vb-h">分镜结构 <span className="k-muted k-num">{bd.shots.length} 段</span></div>
                <ol className="vb-shots">
                  {bd.shots.map((s, i) => (
                    <li key={i} className="vb-shot">
                      <span className="vb-dot" aria-hidden>{i + 1}</span>
                      <div className="vb-shot-body">
                        <div className="vb-shot-head"><span className="k-num k-muted">{s.time || `第 ${i + 1} 段`}</span>{s.stage && <span className="vb-tag">{s.stage}</span>}</div>
                        <div>{s.content}</div>
                        {s.line && <div className="vb-line">「{s.line}」</div>}
                        {(s.technique || s.purpose) && <div className="k-muted">{[s.technique && `手法：${s.technique}`, s.purpose && `作用：${s.purpose}`].filter(Boolean).join('；')}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="vb-side">
                <div className="k-panel vb-card vb-hook">
                  <div className="vb-h">开头钩子 {bd.hook.type && <span className="vb-tag">{bd.hook.type}</span>}{bd.hook.time && <span className="k-muted k-num">{bd.hook.time}</span>}</div>
                  <p className="vb-quote">「{bd.hook.text || '没有识别到明显的开头钩子'}」</p>
                  {bd.hook.why && <p className="k-muted">{bd.hook.why}</p>}
                  <div className="vb-title k-muted">{bd.genre && <span className="vb-tag soft">{bd.genre}</span>}{bd.title}</div>
                </div>

                <div className="k-panel vb-card">
                  <div className="vb-h">话术节奏</div>
                  {bd.rhythm.structure && <p><b>{bd.rhythm.structure}</b></p>}
                  {bd.rhythm.summary && <p>{bd.rhythm.summary}</p>}
                  {bd.rhythm.notes.length > 0 && <ul className="vb-list">{bd.rhythm.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                </div>

                <div className="k-panel vb-card">
                  <div className="vb-h">转化点 <span className="k-muted k-num">{bd.conversions.length} 处</span></div>
                  {bd.conversions.length ? bd.conversions.map((c, i) => (
                    <div key={i} className="vb-conv">
                      <div><span className="vb-tag warm">{c.type || '转化'}</span> <span className="k-muted k-num">{c.time}</span></div>
                      <div>「{c.line}」</div>
                      {c.tip && <div className="k-muted">{c.tip}</div>}
                    </div>
                  )) : <p className="k-muted">没有明显的转化点</p>}
                </div>

                {bd.takeaways.length > 0 && (
                  <div className="k-panel vb-card">
                    <div className="vb-h">可以借鉴</div>
                    <ol className="vb-list">{bd.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ol>
                  </div>
                )}
              </div>
            </div>

            <div className="vb-h">图片预览 <span className="k-muted k-num">{pages.length} 张 · 1080×1440</span></div>
            <div className="vb-grid">
              {pages.map((p, i) => <CardCanvas key={i} page={p} index={i} total={pages.length} bd={bd} onOpen={() => setZoom(i)} />)}
            </div>
          </>
        )}
      </section>

      {zoom != null && bd && pages[zoom] && (
        <div className="vb-zoom" role="dialog" aria-label="放大预览" onClick={() => setZoom(null)}>
          <div className="vb-zoom-box k-panel" onClick={(e) => e.stopPropagation()}>
            <CardCanvas page={pages[zoom]} index={zoom} total={pages.length} bd={bd} />
            <div className="vb-row vb-zoom-bar">
              <button className="k-btn" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}><ChevronLeft size={15} />上一张</button>
              <span className="k-muted k-num">{zoom + 1} / {pages.length}</span>
              <button className="k-btn" disabled={zoom === pages.length - 1} onClick={() => setZoom(zoom + 1)}>下一张<ChevronRight size={15} /></button>
              <button className="k-btn" onClick={() => setZoom(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 把「00:05-00:12」这类时间段转成秒；读不出来返回 null */
function parseRange(t: string): [number, number] | null {
  const m = t.match(/(\d+):(\d+)(?::(\d+))?\s*[-–—~～]\s*(\d+):(\d+)(?::(\d+))?/);
  if (!m) return null;
  const sec = (a: string, b: string, c?: string) => (c == null ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c));
  return [sec(m[1], m[2], m[3]), sec(m[4], m[5], m[6])];
}

/** 整条视频一条时间轴：上面是分镜段，中间是语速，下面标出转化点 */
function Timeline({ bd, stats }: { bd: Breakdown; stats: Stats }) {
  const segs = bd.shots.map((s) => parseRange(s.time));
  if (!bd.shots.length || segs.some((x) => !x)) return null;
  const ranges = segs as [number, number][];
  const total = Math.max(1, stats.durationMs ? stats.durationMs / 1000 : 0, ...ranges.map((r) => r[1]));
  const pct = (v: number) => `${Math.min(100, (v / total) * 100)}%`;
  const pins = bd.conversions.map((c) => ({ c, at: parseRange(c.time)?.[0] })).filter((x): x is { c: Breakdown['conversions'][number]; at: number } => x.at != null);
  return (
    <section className="k-panel vb-tl" aria-label="视频时间轴">
      <div className="vb-tl-hd">
        <b>一条时间轴看完整个视频</b>
        <span className="k-muted k-num">{stats.durationMs ? `时长 ${fmtTime(stats.durationMs)} · ${stats.words} 字 · 平均 ${stats.perMinute} 字/分钟` : `${stats.words} 字`}</span>
      </div>
      <div className="vb-tl-track">
        {ranges.map(([from, to], i) => (
          <div key={i} className={`vb-seg${i === 0 ? ' first' : ''}`} style={{ left: pct(from), width: pct(Math.max(0, to - from)) }} title={`${bd.shots[i].time} ${bd.shots[i].stage}`}>
            <span>{bd.shots[i].stage || i + 1}</span>
          </div>
        ))}
      </div>
      {stats.pace.length > 1 && <PaceBars pace={stats.pace} />}
      {pins.length > 0 && (
        <div className="vb-tl-pins">
          {pins.map(({ c, at }, i) => <span key={i} className={`vb-pin${at / total > 0.95 ? ' end' : ''}`} style={{ left: pct(at), top: (i % 2) * 22 }} title={`${c.time} ${c.line}`}><i />{c.type || '转化'}</span>)}
        </div>
      )}
      <div className="vb-tl-axis k-num k-muted"><span>0:00</span><span>{fmtTime(total * 1000)}</span></div>
    </section>
  );
}

function PaceBars({ pace }: { pace: Stats['pace'] }) {
  const max = Math.max(1, ...pace.map((p) => p.perMinute));
  const avg = pace.reduce((a, p) => a + p.perMinute, 0) / pace.length;
  return (
    <div className="vb-pace" role="img" aria-label="每段时间的语速">
      {pace.map((p, i) => (
        <div key={i} className="vb-pace-col" title={`${fmtTime(p.start)} 起：${p.perMinute} 字/分钟`}>
          <i className={p.perMinute >= avg * 1.2 ? 'hi' : ''} style={{ height: `${Math.max(3, (p.perMinute / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
