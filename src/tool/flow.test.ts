import { describe, expect, it } from 'vitest';
import { computeStats, loadScript } from './core';
import { excelSheets, exportExcel, exportPngs, stamp } from './flow';
import { readSheets } from './xlsx';
import { SAMPLE_RESULT, SAMPLE_SRT, SAMPLE_TXT } from './sample';

function memIO() {
  const files = new Map<string, Uint8Array>();
  const dirs: string[] = [];
  return { files, dirs, io: { join: async (...p: string[]) => p.join('/'), writeFile: async (p: string, d: Uint8Array) => void files.set(p, d), ensureDir: async (p: string) => void dirs.push(p) } };
}

describe('导出 Excel', () => {
  it('示例字幕导出 5 个工作表，内容可读回', async () => {
    const s = loadScript(SAMPLE_SRT);
    const m = memIO();
    const path = await exportExcel(m.io, '/out', '示例:收纳箱', SAMPLE_RESULT, computeStats(s), s);
    expect(path).toBe('/out/示例_收纳箱-拆解.xlsx');
    const sheets = await readSheets(m.files.get(path)!, 'x.xlsx');
    expect(sheets.map((x) => x.name)).toEqual(['概览', '分镜', '转化点', '语速', '原文']);
    expect(sheets[1].grid[0]).toEqual(['序号', '时间', '阶段', '内容', '关键原话', '话术手法', '作用', '画面建议（AI 建议）']);
    expect(sheets[1].grid).toHaveLength(8);
    expect(sheets[1].grid[1].slice(0, 3)).toEqual([1, '00:00-00:05', '钩子']);
    expect(sheets[4].grid[1]).toEqual(['00:00', '00:02', '你家衣柜是不是一打开，衣服就往下掉？']);
    expect(sheets[0].grid).toContainEqual(['时长', '00:42']);
  });
  it('纯文案没有语速表，原文按段落', () => {
    const s = loadScript(SAMPLE_TXT);
    const sheets = excelSheets(SAMPLE_RESULT, computeStats(s), s);
    expect(sheets.map((x) => x.name)).toEqual(['概览', '分镜', '转化点', '原文']);
    expect(sheets[3].header).toEqual(['段落', '文案']);
    expect(sheets[0].rows).toContainEqual(['平均语速（字/分钟）', '—']);
  });
  it('没选保存位置时报错', async () => {
    const s = loadScript(SAMPLE_TXT);
    await expect(exportExcel(memIO().io, '', 'a', SAMPLE_RESULT, computeStats(s), s)).rejects.toThrow('还没有选择保存位置');
  });
});

describe('导出图片', () => {
  it('新建带时间的文件夹，按顺序存', async () => {
    const m = memIO();
    const r = await exportPngs(m.io, '/out', '示例', new Date(2026, 9, 23, 9, 5), [new Uint8Array([1]), new Uint8Array([2])]);
    expect(r.dir).toBe('/out/示例-拆解卡-20261023-0905');
    expect(r.files).toEqual(['/out/示例-拆解卡-20261023-0905/01.png', '/out/示例-拆解卡-20261023-0905/02.png']);
    expect(m.dirs).toEqual([r.dir]);
  });
  it('没有卡片时报错', async () => {
    await expect(exportPngs(memIO().io, '/out', 'a', new Date(), [])).rejects.toThrow('没有可以导出的卡片');
  });
  it('stamp', () => expect(stamp(new Date(2026, 0, 2, 3, 4))).toBe('20260102-0304'));
});
