// 拆解卡片的排版（纯函数）：把拆解结果排成若干张 1080×1440 的卡片。量字宽的函数从外面传入，便于测试。
import { fmtTime, type Breakdown, type Stats } from './core';

export const W = 1080;
export const H = 1440;
export const PAD = 72;
/** 页眉（工具名 + 视频概括）占的高度 */
export const HEAD_H = 210;
/** 页脚占的高度 */
export const FOOT_H = 90;
export const BODY_TOP = HEAD_H + 36;
export const BODY_BOTTOM = H - FOOT_H - 20;

export type Style = 'section' | 'tag' | 'quote' | 'body' | 'muted' | 'bullet' | 'bars';
export const SIZE: Record<Style, number> = { section: 42, tag: 28, quote: 34, body: 31, muted: 28, bullet: 31, bars: 0 };
export const LH: Record<Style, number> = { section: 64, tag: 48, quote: 52, body: 47, muted: 42, bullet: 47, bars: 190 };
/** 粗体的样式 */
export const BOLD: Style[] = ['section', 'tag', 'quote'];

export interface Row {
  style: Style;
  text: string;
  /** 只有每段的第一行画项目符号 */
  first?: boolean;
  /** 和上一行的额外间距 */
  gap: number;
  /** 节奏柱状图的数据（style=bars） */
  bars?: { label: string; value: number }[];
}
export interface PlacedRow extends Row {
  y: number;
}
export interface Page {
  rows: PlacedRow[];
}

/** 量字宽：按样式返回该行文字的像素宽度 */
export type Measure = (style: Style, text: string) => number;

/** 按宽度折行：中文逐字断，英文单词和数字不拆开，显式换行保留 */
export function wrap(text: string, maxW: number, width: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const tokens = para.match(/[A-Za-z0-9.%'’+\-/:]+|\s+|./gu) ?? [];
    let line = '';
    for (const tk of tokens) {
      const next = line + tk;
      if (line && width(next) > maxW) {
        out.push(line.trimEnd());
        line = tk.trimStart();
      } else line = next;
      // 单个超长单词：硬拆
      while (line && width(line) > maxW && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && width(line.slice(0, k)) > maxW) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    if (line.trim() || !out.length) out.push(line.trimEnd());
  }
  return out.filter((l, i, a) => l || (i > 0 && i < a.length - 1));
}

const CONTENT_W = W - PAD * 2;
const INDENT = 40;

/** 把拆解结果变成「段落组」：同一组尽量不跨页 */
export function buildUnits(bd: Breakdown, stats: Stats, measure: Measure): Row[][] {
  const units: Row[][] = [];
  const lines = (style: Style, text: string, indent = 0, gap = 0): Row[] =>
    text.trim() ? wrap(text.trim(), CONTENT_W - indent, (s) => measure(style, s)).map((t, i) => ({ style, text: t, gap: i ? 0 : gap, first: i === 0 })) : [];
  let pendingSection: Row[] = [];
  const section = (title: string) => { pendingSection = [{ style: 'section', text: title, gap: 28 }]; };
  const push = (rows: Row[]) => {
    if (!rows.length) return;
    units.push([...pendingSection, ...rows]);
    pendingSection = [];
  };

  section('开头钩子');
  push([
    ...lines('quote', bd.hook.text ? `「${bd.hook.text}」` : '（没有识别到明显的开头钩子）', 0, 6),
    ...lines('tag', [bd.hook.time, bd.hook.type].filter(Boolean).join(' · '), 0, 4),
    ...lines('body', bd.hook.why, 0, 0),
  ]);

  if (bd.shots.length) {
    section(`分镜结构（${bd.shots.length} 段）`);
    bd.shots.forEach((s, i) => push([
      ...lines('tag', [`${String(i + 1).padStart(2, '0')}`, s.time, s.stage].filter(Boolean).join('  '), 0, i ? 18 : 6),
      ...lines('body', s.content),
      ...lines('muted', s.line ? `原话：${s.line}` : ''),
      ...lines('muted', [s.technique && `手法：${s.technique}`, s.purpose && `作用：${s.purpose}`].filter(Boolean).join('；')),
      ...lines('muted', s.visual ? `画面建议：${s.visual}` : ''),
    ]));
  }

  section('话术节奏');
  const statLine = stats.durationMs ? `时长 ${fmtTime(stats.durationMs)} · ${stats.words} 字 · 平均 ${stats.perMinute} 字/分钟` : `${stats.words} 字（纯文案，没有时间轴，不计算语速）`;
  push([...lines('tag', statLine, 0, 6), ...lines('body', bd.rhythm.structure ? `结构：${bd.rhythm.structure}` : ''), ...lines('body', bd.rhythm.summary)]);
  if (stats.pace.length > 1) push([{ style: 'bars', text: '每段时间的语速（字/分钟）', gap: 10, bars: stats.pace.map((p) => ({ label: fmtTime(p.start), value: p.perMinute })) }]);
  bd.rhythm.notes.forEach((n, i) => push(lines('bullet', n, INDENT, i ? 4 : 10)));

  if (bd.conversions.length) {
    section(`转化点（${bd.conversions.length} 处）`);
    bd.conversions.forEach((c, i) => push([
      ...lines('tag', [c.time, c.type].filter(Boolean).join(' · ') || `第 ${i + 1} 处`, 0, i ? 16 : 6),
      ...lines('body', c.line ? `「${c.line}」` : ''),
      ...lines('muted', c.tip),
    ]));
  }

  if (bd.takeaways.length) {
    section('可以借鉴');
    bd.takeaways.forEach((t, i) => push(lines('bullet', t, INDENT, i ? 6 : 10)));
  }
  return units;
}

const rowH = (r: Row) => r.gap + LH[r.style];

/** 分页：一组放得下就整组放；整组比一页还高时逐行排；小节标题不单独留在页底 */
export function paginate(units: Row[][]): Page[] {
  const pages: Page[] = [{ rows: [] }];
  let y = BODY_TOP;
  const newPage = () => { pages.push({ rows: [] }); y = BODY_TOP; };
  const place = (r: Row) => {
    const gap = pages[pages.length - 1].rows.length ? r.gap : 0;
    pages[pages.length - 1].rows.push({ ...r, gap, y: y + gap });
    y += gap + LH[r.style];
  };
  for (const u of units) {
    const h = u.reduce((a, r) => a + rowH(r), 0);
    if (y + h > BODY_BOTTOM && pages[pages.length - 1].rows.length && h <= BODY_BOTTOM - BODY_TOP) newPage();
    u.forEach((r, i) => {
      // 小节标题至少要和后面一行在同一页
      const need = r.style === 'section' && u[i + 1] ? rowH(r) + rowH(u[i + 1]) : rowH(r);
      if (y + need > BODY_BOTTOM && pages[pages.length - 1].rows.length) newPage();
      place(r);
    });
  }
  return pages.filter((p) => p.rows.length);
}

export function layoutCards(bd: Breakdown, stats: Stats, measure: Measure): Page[] {
  return paginate(buildUnits(bd, stats, measure));
}
