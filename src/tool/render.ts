// 拆解卡片绘制：用页面里的 canvas（兼容 macOS 系统网页引擎与 Windows WebView2），不用 OffscreenCanvas。
// 颜色是画进图片里的，所以这里写死。
import { BOLD, FOOT_H, H, HEAD_H, LH, PAD, SIZE, W, layoutCards, type Measure, type Page, type PlacedRow, type Style } from './cards';
import type { Breakdown, Stats } from './core';

const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Microsoft YaHei UI","Noto Sans CJK SC","Source Han Sans SC",sans-serif';
const C = { bg: '#F4F7FC', paper: '#FFFFFF', head: '#163A7A', headSub: '#B9CCF2', ink: '#14213D', text: '#2B3A55', muted: '#6B7A94', accent: '#2F6FEB', tagBg: '#E7EFFE', line: '#DCE4F2', bar: '#7EA6F4', barHi: '#2F6FEB' };

type G = CanvasRenderingContext2D;
const font = (style: Style) => `${BOLD.includes(style) ? 700 : 400} ${SIZE[style]}px ${SANS}`;

let measureCtx: G | null = null;
export const measure: Measure = (style, text) => {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = font(style);
  // tag 画在胶囊里，左右各留 18
  return measureCtx.measureText(text).width + (style === 'tag' ? 36 : 0);
};

export interface CardHead {
  title: string;
  genre: string;
}

function ellipsis(g: G, s: string, maxW: number) {
  if (g.measureText(s).width <= maxW) return s;
  let t = s;
  while (t && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function drawBars(g: G, r: PlacedRow) {
  const bars = r.bars ?? [];
  const x0 = PAD;
  const top = r.y;
  g.font = `400 24px ${SANS}`;
  g.fillStyle = C.muted;
  g.fillText(r.text, x0, top + 14);
  const chartTop = top + 40;
  const chartH = LH.bars - 90;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const avg = bars.reduce((a, b) => a + b.value, 0) / Math.max(1, bars.length);
  const step = (W - PAD * 2) / bars.length;
  const bw = Math.max(6, Math.min(48, step * 0.62));
  bars.forEach((b, i) => {
    const h = Math.max(3, (b.value / max) * chartH);
    const x = x0 + step * i + (step - bw) / 2;
    g.fillStyle = b.value >= avg * 1.2 ? C.barHi : C.bar;
    g.beginPath();
    g.roundRect(x, chartTop + chartH - h, bw, h, [6, 6, 0, 0]);
    g.fill();
  });
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0, chartTop + chartH + 1); g.lineTo(W - PAD, chartTop + chartH + 1); g.stroke();
  // 横轴只标首、中、尾，避免挤在一起
  g.font = `400 22px ${SANS}`;
  g.fillStyle = C.muted;
  const marks = [...new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1])];
  for (const i of marks) {
    const label = bars[i].label;
    const cx = x0 + step * i + step / 2;
    const w = g.measureText(label).width;
    g.fillText(label, Math.min(W - PAD - w, Math.max(x0, cx - w / 2)), chartTop + chartH + 26);
  }
}

/** 在 canvas 上画一张卡片。scale=1 时为 1080×1440（导出用），缩略图用小的 scale */
export function drawCard(canvas: HTMLCanvasElement, page: Page, index: number, total: number, head: CardHead, scale = 1) {
  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  const g = canvas.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cw, ch);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.textBaseline = 'middle';
  g.textAlign = 'left';

  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  // 页眉
  g.fillStyle = C.head;
  g.fillRect(0, 0, W, HEAD_H);
  g.fillStyle = C.accent;
  g.fillRect(0, HEAD_H - 8, W, 8);
  g.font = `600 26px ${SANS}`;
  g.fillStyle = C.headSub;
  g.fillText(`竞品视频拆解卡${head.genre ? ' · ' + head.genre : ''}`, PAD, 62);
  g.font = `800 48px ${SANS}`;
  g.fillStyle = '#FFFFFF';
  g.fillText(ellipsis(g, head.title || '视频拆解', W - PAD * 2), PAD, 132);

  for (const r of page.rows) {
    const cy = r.y + LH[r.style] / 2;
    if (r.style === 'bars') { drawBars(g, r); continue; }
    g.font = font(r.style);
    if (r.style === 'section') {
      g.fillStyle = C.accent;
      g.fillRect(PAD, cy - 18, 8, 36);
      g.fillStyle = C.ink;
      g.fillText(r.text, PAD + 24, cy);
    } else if (r.style === 'tag') {
      const w = g.measureText(r.text).width + 36;
      g.fillStyle = C.tagBg;
      g.beginPath();
      g.roundRect(PAD, cy - 20, w, 40, 20);
      g.fill();
      g.fillStyle = C.accent;
      g.fillText(r.text, PAD + 18, cy + 1);
    } else if (r.style === 'bullet') {
      if (r.first) {
        g.fillStyle = C.accent;
        g.beginPath();
        g.arc(PAD + 12, cy, 6, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = C.text;
      g.fillText(r.text, PAD + 40, cy);
    } else {
      g.fillStyle = r.style === 'quote' ? C.ink : r.style === 'muted' ? C.muted : C.text;
      g.fillText(r.text, PAD, cy);
    }
  }

  // 页脚
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(PAD, H - FOOT_H); g.lineTo(W - PAD, H - FOOT_H); g.stroke();
  g.font = `400 24px ${SANS}`;
  g.fillStyle = C.muted;
  g.fillText('依据文案 / 字幕由 AI 拆解，仅供参考', PAD, H - FOOT_H / 2);
  const pg = `${index + 1} / ${total}`;
  g.fillText(pg, W - PAD - g.measureText(pg).width, H - FOOT_H / 2);
}

export async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('生成图片失败');
  return new Uint8Array(await blob.arrayBuffer());
}

export const layout = (bd: Breakdown, stats: Stats) => layoutCards(bd, stats, measure);

/** 画出全部卡片并编成 PNG */
export async function renderAll(bd: Breakdown, stats: Stats): Promise<Uint8Array[]> {
  const pages = layout(bd, stats);
  const canvas = document.createElement('canvas');
  const head = { title: bd.title, genre: bd.genre };
  const out: Uint8Array[] = [];
  for (let i = 0; i < pages.length; i++) {
    drawCard(canvas, pages[i], i, pages.length, head);
    out.push(await canvasPng(canvas));
  }
  return out;
}
