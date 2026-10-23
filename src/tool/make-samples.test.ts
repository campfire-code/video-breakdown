// 生成 samples/ 里的示例文件（只在设置了 MAKE_SAMPLES=1 时运行）
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { SAMPLE_NAME, SAMPLE_SRT, SAMPLE_TXT } from './sample';

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例文件', () => {
  writeFileSync(`samples/${SAMPLE_NAME}`, SAMPLE_SRT.replace(/\n/g, '\r\n'));
  writeFileSync('samples/示例-带饭口播文案.txt', SAMPLE_TXT + '\n');
  writeFileSync('samples/示例-只有时间轴.srt', '1\r\n00:00:01,000 --> 00:00:02,000\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n\r\n');
});
