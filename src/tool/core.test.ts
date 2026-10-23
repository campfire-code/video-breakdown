import { describe, expect, it } from 'vitest';
import {
  MAX_CHARS, analyze, buildMessages, computeStats, countWords, exportBase, fmtTime, loadScript, normTime, paceSeries, paceWindow, parseBreakdown, parseSrt, parseTime, scriptForLlm,
} from './core';
import { SAMPLE_SRT, SAMPLE_TXT } from './sample';

describe('时间', () => {
  it('parseTime 支持 SRT、VTT、省略小时和毫秒', () => {
    expect(parseTime('00:01:02,500')).toBe(62500);
    expect(parseTime('01:02.5')).toBe(62500);
    expect(parseTime('1:00:00.000')).toBe(3600000);
    expect(parseTime('00:00:03')).toBe(3000);
    expect(parseTime('abc')).toBeNull();
  });
  it('fmtTime', () => {
    expect(fmtTime(0)).toBe('00:00');
    expect(fmtTime(65_900)).toBe('01:05');
    expect(fmtTime(3_661_000)).toBe('1:01:01');
  });
  it('normTime 统一时间段写法', () => {
    expect(normTime('[00:01 ~ 00:05]')).toBe('00:01-00:05');
    expect(normTime('00:01至00:05')).toBe('00:01-00:05');
    expect(normTime(' - ')).toBe('');
  });
});

describe('parseSrt', () => {
  it('标准 SRT：序号、多行、CRLF、BOM、样式标签', () => {
    const raw = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>第一行</i>\r\n第二行\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}你好\r\n';
    expect(parseSrt(raw)).toEqual([
      { start: 1000, end: 2500, text: '第一行 第二行' },
      { start: 3000, end: 4000, text: '你好' },
    ]);
  });
  it('VTT 写法、没有序号、乱序时按时间排序，空字幕跳过', () => {
    const raw = 'WEBVTT\n\n00:05.000 --> 00:06.000 align:start\n后\n\n00:01.000 --> 00:02.000\n前\n\n00:03.000 --> 00:04.000\n\n';
    expect(parseSrt(raw).map((c) => c.text)).toEqual(['前', '后']);
  });
  it('示例字幕 12 条，时长 42 秒', () => {
    const cues = parseSrt(SAMPLE_SRT);
    expect(cues).toHaveLength(12);
    expect(cues[11].end).toBe(42000);
  });
});

describe('loadScript', () => {
  it('自动识别字幕', () => {
    const s = loadScript(SAMPLE_SRT);
    expect(s.kind).toBe('srt');
    expect(s.durationMs).toBe(42000);
  });
  it('纯文案去掉空行', () => {
    const s = loadScript('  第一句 \n\n\n第二句\r\n');
    expect(s).toEqual({ kind: 'text', cues: [], text: '第一句\n第二句', durationMs: null });
  });
  it('空内容和只有时间轴的字幕报错', () => {
    expect(() => loadScript(' \n ')).toThrow('文案是空的');
    expect(() => loadScript('1\n00:00:01,000 --> 00:00:02,000\n\n')).toThrow('没有读到任何字幕内容');
  });
});

describe('本地统计', () => {
  it('countWords：汉字逐个、英文数字按词，标点不算', () => {
    expect(countWords('今天 OK，买 3 个！')).toBe(6);
    expect(countWords("it's 12.5kg")).toBe(2);
  });
  it('paceSeries 把字数按时长比例分到窗口', () => {
    // 0-10 秒说 10 个字，横跨两个 5 秒窗口；10-15 秒说 10 个字
    const p = paceSeries([{ start: 0, end: 10000, text: '一二三四五六七八九十' }, { start: 10000, end: 15000, text: '一二三四五六七八九十' }], 5000);
    expect(p).toEqual([{ start: 0, perMinute: 60 }, { start: 5000, perMinute: 60 }, { start: 10000, perMinute: 120 }]);
  });
  it('paceWindow 让窗口数不超过 20', () => {
    expect(paceWindow(42000)).toBe(5000);
    expect(paceWindow(180000)).toBe(10000);
    expect(paceWindow(3600000)).toBe(120000);
  });
  it('示例字幕：字数、语速、开头 3 秒', () => {
    const st = computeStats(loadScript(SAMPLE_SRT));
    expect(st.durationMs).toBe(42000);
    expect(st.perMinute).toBe(Math.round((st.words * 60000) / 42000));
    expect(st.pace).toHaveLength(9);
    expect(st.opening).toBe('你家衣柜是不是一打开，衣服就往下掉？ 我以前也是，直到换了这个折叠收纳箱');
  });
  it('纯文案不算语速', () => {
    const st = computeStats(loadScript(SAMPLE_TXT));
    expect(st.perMinute).toBeNull();
    expect(st.pace).toEqual([]);
  });
});

describe('提示词', () => {
  it('字幕每行带时间段，写明平台和语速', () => {
    const s = loadScript(SAMPLE_SRT);
    const m = buildMessages(s, computeStats(s), { note: '同行视频', platform: 'douyin' });
    expect(m[1].content).toContain('[00:00-00:02] 你家衣柜是不是一打开');
    expect(m[1].content).toContain('发布平台：抖音');
    expect(m[1].content).toContain('视频标题或备注：同行视频');
    expect(m[0].content).toContain('只输出 JSON');
  });
  it('纯文案要求 time 留空；不指定平台不写平台', () => {
    const s = loadScript(SAMPLE_TXT);
    const m = buildMessages(s, computeStats(s), { note: '', platform: 'auto' });
    expect(m[1].content).toContain('time 字段填空字符串');
    expect(m[1].content).not.toContain('发布平台');
  });
  it('超长正文截断', () => {
    const long = loadScript(Array.from({ length: 2000 }, (_, i) => `第${i}句话，这是比较长的一句文案`).join('\n'));
    const r = scriptForLlm(long);
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(scriptForLlm(loadScript('短文案')).truncated).toBe(false);
  });
});

const REPLY = {
  title: '收纳箱带货', genre: '带货',
  hook: { time: '[00:00 ~ 00:02]', text: '衣服往下掉？', type: '痛点提问', why: '对号入座' },
  shots: [{ time: '00:00-00:05', stage: '钩子', content: '提问痛点', line: '衣服往下掉', technique: '提问', purpose: '留人', visual: '近景' }, { foo: 1 }],
  rhythm: { structure: '钩子 → 促单', summary: '紧凑', notes: ['1. 前 5 秒出产品', '- 卖点一句话'] },
  conversions: [{ time: '00:31-00:35', type: '引导下单', line: '点链接', tip: '给出位置' }],
  takeaways: ['开头提问', '用数字'],
};

describe('parseBreakdown 容错', () => {
  it('标准 JSON，空分镜被过滤，要点去掉编号', () => {
    const bd = parseBreakdown('```json\n' + JSON.stringify(REPLY) + '\n```');
    expect(bd.hook.time).toBe('00:00-00:02');
    expect(bd.shots).toHaveLength(1);
    expect(bd.rhythm.notes).toEqual(['前 5 秒出产品', '卖点一句话']);
    expect(bd.conversions[0].tip).toBe('给出位置');
  });
  it('中文键名、钩子和节奏写成字符串', () => {
    const bd = parseBreakdown(JSON.stringify({ 标题: '测试', 开头钩子: '你知道吗', 分镜: [{ 时间: '0-5', 阶段: '开场', 内容: '介绍' }], 节奏: '偏快', 转化点: [], 可借鉴: '第一条\n第二条' }));
    expect(bd.title).toBe('测试');
    expect(bd.hook.text).toBe('你知道吗');
    expect(bd.shots[0]).toMatchObject({ time: '0-5', stage: '开场', content: '介绍' });
    expect(bd.rhythm.summary).toBe('偏快');
    expect(bd.takeaways).toEqual(['第一条', '第二条']);
  });
  it('没有分镜也没有钩子时报错', () => {
    expect(() => parseBreakdown('{"title":"x"}')).toThrow('没有给出分镜');
    expect(() => parseBreakdown('抱歉')).toThrow('不是有效的 JSON');
  });
});

describe('analyze', () => {
  const s = loadScript(SAMPLE_SRT);
  it('第一次格式不对时重试一次', async () => {
    const replies = ['我来分析一下……', JSON.stringify(REPLY)];
    const seen: unknown[] = [];
    const r = await analyze(s, { note: '', platform: 'auto' }, async (_m, o) => { seen.push(o); return replies.shift()!; });
    expect(r.calls).toBe(2);
    expect(r.breakdown.title).toBe('收纳箱带货');
    expect(r.stats.durationMs).toBe(42000);
    expect(seen[0]).toMatchObject({ json: true });
  });
  it('两次都失败时报最后的错误', async () => {
    await expect(analyze(s, { note: '', platform: 'auto' }, async () => '{"title":"x"}')).rejects.toThrow('没有给出分镜');
  });
  it('密钥错误这类错误不重试', async () => {
    let n = 0;
    await expect(analyze(s, { note: '', platform: 'auto' }, async () => { n++; throw new Error('大模型调用失败（401，密钥不对或已过期）'); })).rejects.toThrow('401');
    expect(n).toBe(1);
  });
});

it('exportBase：备注 → 文件名 → 概括', () => {
  expect(exportBase(' 我的备注 ', 'a.srt', null)).toBe('我的备注');
  expect(exportBase('', '同行视频.srt', null)).toBe('同行视频');
  expect(exportBase('', '', parseBreakdown(JSON.stringify(REPLY)))).toBe('收纳箱带货');
  expect(exportBase('', '', null)).toBe('视频拆解');
});
