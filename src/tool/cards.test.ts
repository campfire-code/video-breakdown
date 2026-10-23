import { describe, expect, it } from 'vitest';
import { BODY_BOTTOM, BODY_TOP, LH, SIZE, buildUnits, layoutCards, paginate, wrap, type Measure, type Row } from './cards';
import { computeStats, loadScript } from './core';
import { SAMPLE_RESULT, SAMPLE_SRT, SAMPLE_TXT } from './sample';

// 假量宽：中文按字号宽，其他字符按半宽
const width = (size: number) => (s: string) => [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? size : size / 2), 0);
const measure: Measure = (style, s) => width(SIZE[style] || 30)(s);

describe('wrap', () => {
  const w = width(10);
  it('中文按宽度逐字断行', () => expect(wrap('一二三四五六七', 30, w)).toEqual(['一二三', '四五六', '七']));
  it('英文单词和数字不拆开', () => expect(wrap('买 12345 个', 40, w)).toEqual(['买 12345', '个']));
  it('超长单词硬拆', () => expect(wrap('abcdefghij', 20, w)).toEqual(['abcd', 'efgh', 'ij']));
  it('保留显式换行', () => expect(wrap('甲\n乙', 100, w)).toEqual(['甲', '乙']));
});

describe('卡片排版', () => {
  const stats = computeStats(loadScript(SAMPLE_SRT));
  it('示例结果：包含各小节，带节奏柱状图', () => {
    const units = buildUnits(SAMPLE_RESULT, stats, measure);
    const sections = units.flat().filter((r) => r.style === 'section').map((r) => r.text);
    expect(sections).toEqual(['开头钩子', '分镜结构（7 段）', '话术节奏', '转化点（3 处）', '可以借鉴']);
    const bars = units.flat().find((r) => r.style === 'bars');
    expect(bars?.bars).toHaveLength(9);
  });
  it('每页内容不超出版心，行从上到下排列', () => {
    const pages = layoutCards(SAMPLE_RESULT, stats, measure);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const p of pages) {
      expect(p.rows[0].y).toBe(BODY_TOP);
      for (const r of p.rows) expect(r.y + LH[r.style]).toBeLessThanOrEqual(BODY_BOTTOM);
      p.rows.forEach((r, i) => i && expect(r.y).toBeGreaterThan(p.rows[i - 1].y));
      // 小节标题不会是一页的最后一行
      expect(p.rows[p.rows.length - 1].style).not.toBe('section');
    }
  });
  it('纯文案没有柱状图，写明不计算语速', () => {
    const units = buildUnits(SAMPLE_RESULT, computeStats(loadScript(SAMPLE_TXT)), measure).flat();
    expect(units.some((r) => r.style === 'bars')).toBe(false);
    expect(units.some((r) => r.text.includes('不计算语速'))).toBe(true);
  });
  it('一组比整页还高时逐行分到多页', () => {
    const tall: Row[] = Array.from({ length: 60 }, (_, i) => ({ style: 'body', text: `行${i}`, gap: 0 }));
    const pages = paginate([tall]);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.rows).map((r) => r.text)).toEqual(tall.map((r) => r.text));
  });
});
