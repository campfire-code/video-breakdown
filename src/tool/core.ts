// 纯函数：字幕解析、本地统计、大模型提示词与回复解析。不依赖界面和本机能力，便于单元测试。
import { extractJson, isFatalLlmError, pick, toStringList } from './common';

export interface Cue {
  /** 开始、结束时间（毫秒） */
  start: number;
  end: number;
  text: string;
}

export interface Script {
  /** srt：带时间轴的字幕；text：纯文案 */
  kind: 'srt' | 'text';
  cues: Cue[];
  /** 纯文案的正文；字幕时是去掉时间轴后的全文 */
  text: string;
  /** 时长（毫秒），只有字幕能算 */
  durationMs: number | null;
}

// ---------------- 字幕解析 ----------------

const TIME_RE = /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/;
const LINE_RE = new RegExp(`^\\s*(${TIME_RE.source})\\s*-->\\s*(${TIME_RE.source})`);

/** 「00:01:02,500」「01:02.5」→ 毫秒；不是时间返回 null */
export function parseTime(s: string): number | null {
  const m = s.trim().match(new RegExp(`^${TIME_RE.source}$`));
  if (!m) return null;
  const [, h, mi, se, ms] = m;
  return ((Number(h ?? 0) * 60 + Number(mi)) * 60 + Number(se)) * 1000 + (ms ? Number(ms.padEnd(3, '0')) : 0);
}

/** 去掉字幕里的样式标签：<i>、<font …>、{\an8} */
const cleanCue = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();

/**
 * 解析 SRT（也兼容 WebVTT 的写法）：块之间空行分隔，序号行可有可无，毫秒用逗号或点，
 * 一条字幕可以有多行。没有时间轴的块会被跳过。返回按开始时间排好序的字幕。
 */
export function parseSrt(raw: string): Cue[] {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues: Cue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => LINE_RE.test(l));
    if (ti < 0) continue;
    const parts = lines[ti].split('-->');
    const start = parseTime(parts[0].trim().match(TIME_RE)![0]);
    const end = parseTime(parts[1].trim().match(TIME_RE)![0]);
    if (start == null || end == null) continue;
    const body = lines.slice(ti + 1).map(cleanCue).filter(Boolean).join(' ');
    if (body) cues.push({ start, end: Math.max(start, end), text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export const looksLikeSrt = (raw: string) => raw.split(/\r?\n/).some((l) => LINE_RE.test(l));

/** 把导入的文件或粘贴的文字整理成待拆解的脚本；字幕和纯文案自动识别 */
export function loadScript(raw: string): Script {
  const src = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (looksLikeSrt(src)) {
    const cues = parseSrt(src);
    if (!cues.length) throw new Error('看起来是字幕文件，但没有读到任何字幕内容');
    return { kind: 'srt', cues, text: cues.map((c) => c.text).join('\n'), durationMs: cues[cues.length - 1].end };
  }
  const t = src.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  if (!t) throw new Error('文案是空的：请粘贴视频文案或字幕，或导入 .srt / .txt 文件');
  return { kind: 'text', cues: [], text: t, durationMs: null };
}

/** 毫秒 → 「01:05」；超过一小时为「1:01:05」 */
export function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------------- 本地统计（不经过大模型，数字可靠） ----------------

/** 数「字」：汉字、字母数字串各算一个，标点和空格不算 */
export function countWords(s: string): number {
  return (s.match(/[㐀-鿿豈-﫿]|[A-Za-z0-9]+(?:[.'’][A-Za-z0-9]+)*/g) ?? []).length;
}

export interface Stats {
  words: number;
  durationMs: number | null;
  /** 平均语速：字 / 分钟（只有字幕能算） */
  perMinute: number | null;
  /** 每个时间窗口的语速（字 / 分钟），用来看节奏快慢 */
  pace: { start: number; perMinute: number }[];
  /** 开头 3 秒说的话（只有字幕能算） */
  opening: string;
}

/** 按时间窗口统计语速：每条字幕的字数按时长比例分到所覆盖的窗口里 */
export function paceSeries(cues: Cue[], windowMs: number): { start: number; perMinute: number }[] {
  if (!cues.length) return [];
  const total = cues[cues.length - 1].end;
  const n = Math.max(1, Math.ceil(total / windowMs));
  const words = new Array<number>(n).fill(0);
  for (const c of cues) {
    const w = countWords(c.text);
    const span = Math.max(1, c.end - c.start);
    for (let i = Math.floor(c.start / windowMs); i < n && i * windowMs < c.end; i++) {
      const overlap = Math.min(c.end, (i + 1) * windowMs) - Math.max(c.start, i * windowMs);
      words[i] += c.end === c.start ? w : (w * Math.max(0, overlap)) / span;
    }
  }
  return words.map((w, i) => {
    const len = Math.min(windowMs, total - i * windowMs);
    return { start: i * windowMs, perMinute: len > 0 ? Math.round((w * 60000) / len) : 0 };
  });
}

/** 窗口长度：视频越长窗口越大，条数控制在 6～20 之间 */
export const paceWindow = (durationMs: number) => [5000, 10000, 15000, 30000, 60000].find((w) => durationMs / w <= 20) ?? 120000;

export function computeStats(s: Script): Stats {
  const words = countWords(s.text);
  if (s.kind !== 'srt' || !s.durationMs) return { words, durationMs: null, perMinute: null, pace: [], opening: '' };
  const perMinute = Math.round((words * 60000) / s.durationMs);
  const opening = s.cues.filter((c) => c.start < 3000).map((c) => c.text).join(' ');
  return { words, durationMs: s.durationMs, perMinute, pace: paceSeries(s.cues, paceWindow(s.durationMs)), opening };
}

// ---------------- 大模型 ----------------

/** 交给大模型的正文最多这么多字，超出部分截掉并提示 */
export const MAX_CHARS = 12000;

export const PLATFORMS: [string, string][] = [['auto', '不指定'], ['douyin', '抖音'], ['kuaishou', '快手'], ['channels', '视频号'], ['xhs', '小红书'], ['bilibili', 'B 站']];

/** 给大模型看的正文：字幕每条前面带时间段；超长时截断 */
export function scriptForLlm(s: Script): { body: string; truncated: boolean } {
  const lines = s.kind === 'srt' ? s.cues.map((c) => `[${fmtTime(c.start)}-${fmtTime(c.end)}] ${c.text}`) : s.text.split('\n');
  const out: string[] = [];
  let len = 0;
  for (const l of lines) {
    if (len + l.length + 1 > MAX_CHARS) {
      if (!out.length) out.push(l.slice(0, MAX_CHARS));
      return { body: out.join('\n'), truncated: true };
    }
    out.push(l);
    len += l.length + 1;
  }
  return { body: out.join('\n'), truncated: false };
}

export interface Shot {
  time: string;
  stage: string;
  content: string;
  line: string;
  technique: string;
  purpose: string;
  visual: string;
}
export interface Conversion {
  time: string;
  type: string;
  line: string;
  tip: string;
}
export interface Breakdown {
  title: string;
  genre: string;
  hook: { time: string; text: string; type: string; why: string };
  shots: Shot[];
  rhythm: { structure: string; summary: string; notes: string[] };
  conversions: Conversion[];
  takeaways: string[];
}

const SCHEMA = `{
  "title": "一句话概括这条视频讲什么（20 字以内）",
  "genre": "视频类型：带货 / 口播知识 / 测评 / 教程 / 剧情 / Vlog / 其他",
  "hook": { "time": "开头钩子所在时间段，没有时间轴填空字符串", "text": "开头钩子的原话", "type": "钩子类型：提问 / 反常识 / 痛点 / 结果前置 / 悬念 / 利益承诺 / 身份代入 / 其他", "why": "为什么能让人停下来看（40 字以内）" },
  "shots": [ { "time": "00:00-00:05", "stage": "所处阶段，例如 钩子 / 痛点 / 引出产品 / 卖点演示 / 信任背书 / 促单 / 结尾互动", "content": "这一段在讲什么（30 字以内）", "line": "这一段的关键原话", "technique": "用了什么话术手法", "purpose": "这一段起什么作用", "visual": "建议配什么画面（只是建议）" } ],
  "rhythm": { "structure": "整体结构，用 → 连接，例如 钩子 → 痛点 → 产品 → 证明 → 促单", "summary": "节奏总评（60 字以内）", "notes": ["节奏上值得注意的点，2～4 条"] },
  "conversions": [ { "time": "时间段", "type": "引导下单 / 引导关注 / 评论互动 / 私信咨询 / 领券优惠 / 其他", "line": "原话", "tip": "这句是怎么推动转化的" } ],
  "takeaways": ["可以借鉴到自己视频里的做法，3～5 条，写成可以直接照做的句子"]
}`;

export interface AnalyzeOpts {
  /** 用户填的视频标题或备注，可空 */
  note: string;
  platform: string;
}

export function buildMessages(s: Script, stats: Stats, opts: AnalyzeOpts) {
  const { body, truncated } = scriptForLlm(s);
  const platform = PLATFORMS.find(([k]) => k === opts.platform && k !== 'auto')?.[1];
  const meta = [
    opts.note.trim() ? `视频标题或备注：${opts.note.trim()}` : '',
    platform ? `发布平台：${platform}` : '',
    s.kind === 'srt' ? `输入是带时间轴的字幕，时长 ${fmtTime(s.durationMs ?? 0)}，每行前面是时间段` : '输入是没有时间轴的文案，所有 time 字段填空字符串',
    stats.perMinute ? `本地统计的平均语速：约 ${stats.perMinute} 字/分钟` : '',
    truncated ? `正文太长，只给出前 ${MAX_CHARS} 字左右` : '',
  ].filter(Boolean).join('\n');
  return [
    {
      role: 'system' as const,
      content: `你是短视频内容分析师，帮创作者拆解同类视频的结构和话术。只依据给出的文案或字幕分析，不要编造文案里没有的内容；画面无法从文字得知，visual 只写建议。
分镜按内容自然分段，一般 4～12 段，按时间顺序，时间段尽量用字幕里的时间。没有明显转化点时 conversions 返回空数组。
只输出 JSON，不要任何其他文字，格式：
${SCHEMA}`,
    },
    { role: 'user' as const, content: `${meta}\n\n正文：\n${body}` },
  ];
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(str).filter(Boolean).join('；') : '');
const field = (o: unknown, keys: string[]) => str(pick(o, keys));

/** 时间段统一成「00:05-00:12」：去掉方括号、中文横线、空格 */
export function normTime(v: string): string {
  const t = v.replace(/[[\]【】\s]/g, '').replace(/[~～—–至到]+/g, '-');
  return t === '-' ? '' : t;
}

/** 解析大模型的拆解结果，字段名容错（中英文、大小写），缺的字段补空 */
export function parseBreakdown(reply: string): Breakdown {
  const j = extractJson(reply);
  const o = (Array.isArray(j) ? j[0] : j) as Record<string, unknown>;
  const hookRaw = pick(o, ['hook', '开头钩子', '钩子']);
  const hook = typeof hookRaw === 'string'
    ? { time: '', text: hookRaw.trim(), type: '', why: '' }
    : { time: normTime(field(hookRaw, ['time', '时间', '时间段'])), text: field(hookRaw, ['text', 'line', '原话', '内容']), type: field(hookRaw, ['type', '类型']), why: field(hookRaw, ['why', 'reason', '原因', '为什么']) };
  const list = (keys: string[]) => {
    const v = pick(o, keys);
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
  };
  const shots: Shot[] = list(['shots', 'storyboard', 'scenes', '分镜', '分镜结构']).map((x) => ({
    time: normTime(field(x, ['time', '时间', '时间段'])),
    stage: field(x, ['stage', 'section', '阶段', '环节']),
    content: field(x, ['content', 'summary', '内容']),
    line: field(x, ['line', 'quote', 'text', '台词', '原话', '关键台词']),
    technique: field(x, ['technique', 'skill', '手法', '话术手法']),
    purpose: field(x, ['purpose', 'goal', '作用', '目的']),
    visual: field(x, ['visual', 'scene', '画面', '画面建议']),
  })).filter((x) => x.content || x.line);
  const rhythmRaw = pick(o, ['rhythm', 'pace', '话术节奏', '节奏']);
  const rhythm = typeof rhythmRaw === 'string'
    ? { structure: '', summary: rhythmRaw.trim(), notes: [] }
    : { structure: field(rhythmRaw, ['structure', '结构']), summary: field(rhythmRaw, ['summary', '总评', '评价']), notes: toStringList(pick(rhythmRaw, ['notes', 'points', '要点'])) };
  const conversions: Conversion[] = list(['conversions', 'conversion', 'cta', '转化点']).map((x) => ({
    time: normTime(field(x, ['time', '时间', '时间段'])),
    type: field(x, ['type', '类型']),
    line: field(x, ['line', 'text', 'quote', '原话']),
    tip: field(x, ['tip', 'how', 'why', '说明', '手法']),
  })).filter((x) => x.line || x.tip);
  const bd: Breakdown = {
    title: field(o, ['title', '标题', '概括']),
    genre: field(o, ['genre', 'type', '类型']),
    hook,
    shots,
    rhythm,
    conversions,
    takeaways: toStringList(pick(o, ['takeaways', 'learn', '可借鉴', '借鉴'])),
  };
  if (!bd.shots.length && !bd.hook.text) throw new Error('大模型没有给出分镜和开头钩子');
  return bd;
}

type Llm = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[], opts?: { json?: boolean; temperature?: number }) => Promise<string>;

/** 调大模型拆解；回复格式不对时再试一次。返回结果和调用次数 */
export async function analyze(s: Script, opts: AnalyzeOpts, llm: Llm): Promise<{ breakdown: Breakdown; stats: Stats; calls: number; truncated: boolean }> {
  const stats = computeStats(s);
  const messages = buildMessages(s, stats, opts);
  let lastErr: unknown;
  for (let calls = 1; calls <= 2; calls++) {
    try {
      const breakdown = parseBreakdown(await llm(messages, { json: true, temperature: 0.4 }));
      return { breakdown, stats, calls, truncated: scriptForLlm(s).truncated };
    } catch (e) {
      if (isFatalLlmError(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 导出文件用的名字：用户备注 → 导入的文件名 → 大模型概括 */
export function exportBase(note: string, fileName: string, bd: Breakdown | null): string {
  return note.trim() || fileName.replace(/\.[^.]+$/, '').trim() || bd?.title || '视频拆解';
}
