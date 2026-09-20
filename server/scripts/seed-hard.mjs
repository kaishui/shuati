/**
 * 难题标记种子脚本：解析 doc/难题.txt 中的题号，把主库里对应题目
 * 标记为「难题」（is_hard = TRUE）。
 *
 * 难题清单是主题库（doc/试题.docx 的 3852 题）的子集，按 source_no 对应，
 * 因此只需打标记、无需重复存题。答题记录/错题集/掌握状态仍复用
 * attempts/mistakes/progress 三张表。
 *
 * 用法：
 *   npm run seed:hard            # 打标记（幂等）
 *   npm run seed:hard -- --clear # 清空所有难题标记
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import pool, {initSchema} from '../src/db.js';

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '../..');
const hardTxtPath = path.join(rootDir, 'doc', '难题.txt');

/** 从难题清单提取全部题号（去重、升序）。 */
function extractHardNos(text) {
  const matches = text.matchAll(/第?(\d+)题/g);
  const nos = new Set();
  for (const match of matches) {
    nos.add(Number(match[1]));
  }
  return [...nos].sort((a, b) => a - b);
}

/** 主流程。 */
async function main() {
  const clear = process.argv.includes('--clear');
  const text = fs.readFileSync(hardTxtPath, 'utf8');
  const nos = extractHardNos(text);
  console.log(`难题清单题号数（去重）：${nos.length}`);

  await initSchema();

  if (clear) {
    await pool.query('UPDATE questions SET is_hard = FALSE');
    console.log('已清空所有难题标记');
    return;
  }

  const {rowCount} = await pool.query(
      'UPDATE questions SET is_hard = TRUE WHERE source_no = ANY($1::int[])',
      [nos]);
  console.log(`已标记难题：${rowCount} 题`);

  const {rows} = await pool.query(
      'SELECT count(*)::int AS n FROM questions WHERE is_hard');
  console.log(`当前难题总数：${rows[0].n}`);
}

main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
