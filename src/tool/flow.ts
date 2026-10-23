// 导出流程：Excel 表格和 PNG 卡片。读写从外面传进来，方便用内存假文件系统测试。
import { safeName } from './common';
import { fmtTime, type Breakdown, type Script, type Stats } from './core';
import { writeXlsx, type OutSheet } from './xlsx';

export interface ExportIO {
  join(...parts: string[]): Promise<string>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  ensureDir(path: string): Promise<void>;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const stamp = (d: Date) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;

/** 拆解结果 → Excel 的四个工作表：概览、分镜、转化点、原文 */
export function excelSheets(bd: Breakdown, stats: Stats, s: Script): OutSheet[] {
  const ov: [string, string | number][] = [
    ['视频概括', bd.title],
    ['视频类型', bd.genre],
    ['时长', stats.durationMs ? fmtTime(stats.durationMs) : '（纯文案，无时间轴）'],
    ['字数', stats.words],
    ['平均语速（字/分钟）', stats.perMinute ?? '—'],
    ['开头 3 秒原话', stats.opening || '—'],
    ['开头钩子', bd.hook.text],
    ['钩子时间', bd.hook.time || '—'],
    ['钩子类型', bd.hook.type],
    ['为什么留人', bd.hook.why],
    ['整体结构', bd.rhythm.structure],
    ['节奏总评', bd.rhythm.summary],
    ...bd.rhythm.notes.map((n, i) => [`节奏要点 ${i + 1}`, n] as [string, string]),
    ...bd.takeaways.map((t, i) => [`可借鉴 ${i + 1}`, t] as [string, string]),
  ];
  const sheets: OutSheet[] = [
    { name: '概览', header: ['项目', '内容'], rows: ov, wrap: [1] },
    {
      name: '分镜',
      header: ['序号', '时间', '阶段', '内容', '关键原话', '话术手法', '作用', '画面建议（AI 建议）'],
      rows: bd.shots.map((x, i) => [i + 1, x.time, x.stage, x.content, x.line, x.technique, x.purpose, x.visual]),
      wrap: [3, 4, 5, 6, 7],
    },
    { name: '转化点', header: ['序号', '时间', '类型', '原话', '怎么推动转化'], rows: bd.conversions.map((c, i) => [i + 1, c.time, c.type, c.line, c.tip]), wrap: [3, 4] },
  ];
  if (stats.pace.length) sheets.push({ name: '语速', header: ['开始时间', '语速（字/分钟）'], rows: stats.pace.map((p) => [fmtTime(p.start), p.perMinute]) });
  sheets.push(s.kind === 'srt'
    ? { name: '原文', header: ['开始', '结束', '字幕'], rows: s.cues.map((c) => [fmtTime(c.start), fmtTime(c.end), c.text]), wrap: [2] }
    : { name: '原文', header: ['段落', '文案'], rows: s.text.split('\n').map((l, i) => [i + 1, l]), wrap: [1] });
  return sheets;
}

export async function exportExcel(io: ExportIO, baseDir: string, base: string, bd: Breakdown, stats: Stats, s: Script): Promise<string> {
  if (!baseDir) throw new Error('还没有选择保存位置');
  await io.ensureDir(baseDir);
  const path = await io.join(baseDir, `${safeName(base)}-拆解.xlsx`);
  await io.writeFile(path, await writeXlsx(excelSheets(bd, stats, s), '篝火 · 竞品视频拆解卡'));
  return path;
}

/** 在 baseDir 下新建「名称-拆解卡-日期时间」文件夹，按顺序存 PNG */
export async function exportPngs(io: ExportIO, baseDir: string, base: string, now: Date, pngs: Uint8Array[]): Promise<{ dir: string; files: string[] }> {
  if (!baseDir) throw new Error('还没有选择保存位置');
  if (!pngs.length) throw new Error('没有可以导出的卡片');
  const dir = await io.join(baseDir, `${safeName(base)}-拆解卡-${stamp(now)}`);
  await io.ensureDir(dir);
  const files: string[] = [];
  for (let i = 0; i < pngs.length; i++) {
    const p = await io.join(dir, `${pad2(i + 1)}.png`);
    await io.writeFile(p, pngs[i]);
    files.push(p);
  }
  return { dir, files };
}
