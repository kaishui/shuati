/**
 * 种子脚本：把 doc/试题.docx 转成纯文本，正则解析后灌入 PostgreSQL。
 *
 * 用法：npm run seed（幂等，重复执行按 source_no 覆盖更新）。
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import pool, {initSchema} from '../src/db.js';
import {parseQuestions} from '../src/parser.js';

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '../..');
const docxPath = path.join(rootDir, 'doc', '试题.docx');
const txtPath = path.join(rootDir, 'doc', '试题.txt');

const CHUNK_SIZE = 200;

/**
 * 若纯文本缓存不存在，则用 macOS textutil 从 docx 生成。
 * @return {string} 试题纯文本。
 */
function loadText() {
  if (!fs.existsSync(txtPath)) {
    console.log('converting docx to txt...');
    execFileSync(
        'textutil', ['-convert', 'txt', '-output', txtPath, docxPath]);
  }
  return fs.readFileSync(txtPath, 'utf8');
}

/**
 * 分批 upsert 题目。
 * @param {Array<Object>} questions 解析出的题目。
 */
async function upsertQuestions(questions) {
  for (let i = 0; i < questions.length; i += CHUNK_SIZE) {
    const chunk = questions.slice(i, i + CHUNK_SIZE);
    const values = [];
    const params = [];
    chunk.forEach((question, index) => {
      const base = index * 4;
      params.push(
          question.sourceNo,
          question.stem,
          JSON.stringify(question.options),
          question.answer);
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    });
    await pool.query(`
      INSERT INTO questions (source_no, stem, options, answer)
      VALUES ${values.join(', ')}
      ON CONFLICT (source_no) DO UPDATE SET
        stem = EXCLUDED.stem,
        options = EXCLUDED.options,
        answer = EXCLUDED.answer`, params);
    console.log(
        `seeded ${Math.min(i + CHUNK_SIZE, questions.length)}/${questions.length}`);
  }
}

/** 主流程。 */
async function main() {
  const questions = parseQuestions(loadText());
  console.log(`parsed ${questions.length} questions`);

  await initSchema();
  await upsertQuestions(questions);

  const {rows} = await pool.query(
      'SELECT count(*)::int AS n FROM questions');
  console.log(`questions in db: ${rows[0].n}`);
}

main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
