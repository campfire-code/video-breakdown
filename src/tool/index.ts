// 工具声明：竞品视频拆解卡（自定义界面：左边粘贴文案 / 导入字幕，右边显示拆解卡片并导出）。
import { Clapperboard as ClapperboardAsIcon } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'c21',
  name: '竞品视频拆解卡',
  tagline: '粘贴同行视频的文案或导入字幕（.srt / .txt），AI 拆出分镜结构、开头钩子、话术节奏和转化点，生成拆解卡片，导出 Excel 或 PNG 图片。',
  icon: ClapperboardAsIcon,
  category: '内容生产',
  type: 'text',
  mode: 'custom',
  mainLabel: '拆解',
  needsLLM: true,
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
