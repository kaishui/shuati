import {Router} from 'express';
import pool from './db.js';

const router = Router();

const DEFAULT_COUNT = 10;
const MAX_COUNT = 50;
const OPTION_RE = /^[A-E]$/;

/**
 * 将请求中的数量收敛到 [1, MAX_COUNT]。
 * @param {*} raw 请求传入的 count。
 * @return {number} 合法数量。
 */
function clampCount(raw) {
  const count = Number(raw);
  if (!Number.isInteger(count)) return DEFAULT_COUNT;
  return Math.min(Math.max(count, 1), MAX_COUNT);
}

/**
 * 将数据库行转为对外的题目 JSON。
 * @param {Object} row questions 表行。
 * @return {Object} 题目对象（不含答案，答案由服务端判定）。
 */
function toQuestion(row) {
  return {
    id: Number(row.id),
    sourceNo: row.source_no,
    stem: row.stem,
    options: row.options,
  };
}

/**
 * 随机抽取 count 道未解决的错题（带错误次数）。
 * @param {number} count 数量。
 * @return {Promise<Array<Object>>} 题目行数组。
 */
async function pickMistakes(count) {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, q.options, m.wrong_count
    FROM questions q
    JOIN mistakes m ON m.question_id = q.id AND m.resolved = FALSE
    ORDER BY random()
    LIMIT $1`, [count]);
  return rows;
}

/**
 * 随机抽取 count 道不在排除列表中的题目。
 * @param {number} count 数量。
 * @param {Array<number>} exclude 已选题目 id。
 * @return {Promise<Array<Object>>} 题目行数组。
 */
async function pickOthers(count, exclude) {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, q.options
    FROM questions q
    WHERE NOT (q.id = ANY($1::bigint[]))
    ORDER BY random()
    LIMIT $2`, [exclude, count]);
  return rows;
}

/** 出题接口：错题优先，再随机补齐；mode=mistakes 时只出错题。 */
router.post('/practice', async (req, res) => {
  const count = clampCount(req.body?.count);
  const mistakesOnly = req.body?.mode === 'mistakes';

  const mistakeRows = await pickMistakes(count);
  let regularRows = [];
  if (!mistakesOnly) {
    const rest = count - mistakeRows.length;
    if (rest > 0) {
      regularRows = await pickOthers(
          rest, mistakeRows.map((row) => row.id));
    }
  }

  const questions = [...mistakeRows, ...regularRows].map((row) => ({
    ...toQuestion(row),
    wrongCount: row.wrong_count,
  }));
  res.json({questions});
});

/** 提交答案：记录作答、维护错题集，返回带证据的判定结果。 */
router.post('/answers', async (req, res) => {
  const {questionId, selected} = req.body ?? {};
  const mode = req.body?.mode ?? 'practice';
  if (!Number.isInteger(questionId)) {
    res.status(400).json({error: 'questionId 必须为整数'});
    return;
  }
  if (typeof selected !== 'string' || !OPTION_RE.test(selected)) {
    res.status(400).json({error: 'selected 必须为 A-E 之一'});
    return;
  }

  const client = await pool.connect();
  try {
    const {rows} = await client.query(
        'SELECT * FROM questions WHERE id = $1', [questionId]);
    if (rows.length === 0) {
      res.status(404).json({error: '题目不存在'});
      return;
    }
    const question = rows[0];
    const correct = question.answer === selected;
    let mistakeUpdated = false;
    let mistakeResolved = false;

    await client.query('BEGIN');
    await client.query(`
      INSERT INTO attempts (question_id, selected, is_correct)
      VALUES ($1, $2, $3)`, [questionId, selected, correct]);

    if (!correct) {
      // 答错：进入错题集并累计错误次数（错题在后续轮次重复出现）。
      await client.query(`
        INSERT INTO mistakes
          (question_id, wrong_count, last_wrong_at, resolved)
        VALUES ($1, 1, now(), FALSE)
        ON CONFLICT (question_id) DO UPDATE SET
          wrong_count = mistakes.wrong_count + 1,
          last_wrong_at = now(),
          resolved = FALSE,
          resolved_at = NULL`, [questionId]);
      mistakeUpdated = true;
    } else if (mode === 'mistakes') {
      // 错题重练中答对：移出错题集。
      const {rowCount} = await client.query(`
        UPDATE mistakes SET resolved = TRUE, resolved_at = now()
        WHERE question_id = $1 AND resolved = FALSE`, [questionId]);
      mistakeResolved = rowCount > 0;
    }
    await client.query('COMMIT');

    const answerOption = question.options.find(
        (option) => option.key === question.answer);
    const selectedOption = question.options.find(
        (option) => option.key === selected);
    res.json({
      correct,
      selected,
      answer: question.answer,
      // 证据：正确答案选项原文。
      answerText: answerOption?.text ?? '',
      selectedText: selectedOption?.text ?? '',
      // 证据：原文题干。
      stem: question.stem,
      sourceNo: question.source_no,
      mistakeUpdated,
      mistakeResolved,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/** 错题集：列出未解决的错题，按最近答错时间倒序。 */
router.get('/mistakes', async (req, res) => {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, q.options,
           m.wrong_count, m.last_wrong_at
    FROM mistakes m
    JOIN questions q ON q.id = m.question_id
    WHERE m.resolved = FALSE
    ORDER BY m.last_wrong_at DESC`);
  res.json({
    questions: rows.map((row) => ({
      ...toQuestion(row),
      wrongCount: row.wrong_count,
      lastWrongAt: row.last_wrong_at,
    })),
  });
});

/** 手动将错题移出错题集（「我会了」）。 */
router.post('/mistakes/:id/resolve', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({error: 'id 必须为整数'});
    return;
  }
  const {rowCount} = await pool.query(`
    UPDATE mistakes SET resolved = TRUE, resolved_at = now()
    WHERE question_id = $1 AND resolved = FALSE`, [id]);
  res.json({resolved: rowCount > 0});
});

/** 统计：题库总量、作答次数、答对次数、未解决错题数。 */
router.get('/stats', async (req, res) => {
  const [questionRows, attemptRows, mistakeRows] = await Promise.all([
    pool.query('SELECT count(*)::int AS n FROM questions'),
    pool.query(`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE is_correct)::int AS correct
      FROM attempts`),
    pool.query(`
      SELECT count(*)::int AS n FROM mistakes WHERE resolved = FALSE`),
  ]);
  res.json({
    questions: questionRows.rows[0].n,
    attempts: attemptRows.rows[0].n,
    correct: attemptRows.rows[0].correct,
    mistakes: mistakeRows.rows[0].n,
  });
});

export default router;
