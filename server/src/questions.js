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
 * 随机抽取 count 道未解决的错题（带错误次数），排除已斩的题。
 * @param {number} count 数量。
 * @return {Promise<Array<Object>>} 题目行数组。
 */
async function pickMistakes(count) {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, q.options, m.wrong_count
    FROM questions q
    JOIN mistakes m ON m.question_id = q.id AND m.resolved = FALSE
    LEFT JOIN progress p ON p.question_id = q.id
    WHERE NOT (p.question_id IS NOT NULL AND p.slain)
    ORDER BY random()
    LIMIT $1`, [count]);
  return rows;
}

/**
 * 随机抽取 count 道「新题」（未掌握、非错题、未斩、不在排除列表）。
 * @param {number} count 数量。
 * @param {Array<number>} exclude 已选题目 id。
 * @return {Promise<Array<Object>>} 题目行数组。
 */
async function pickFresh(count, exclude) {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, q.options
    FROM questions q
    LEFT JOIN progress p ON p.question_id = q.id
    WHERE NOT (p.question_id IS NOT NULL AND p.slain)
      AND NOT (p.question_id IS NOT NULL AND p.mastered)
      AND NOT EXISTS (
        SELECT 1 FROM mistakes m
        WHERE m.question_id = q.id AND m.resolved = FALSE)
      AND NOT (q.id = ANY($1::bigint[]))
    ORDER BY random()
    LIMIT $2`, [exclude, count]);
  return rows;
}

/**
 * 随机抽取 count 道「已掌握」题（仅在题目不足时补齐，减少会的题）。
 * @param {number} count 数量。
 * @param {Array<number>} exclude 已选题目 id。
 * @return {Promise<Array<Object>>} 题目行数组。
 */
async function pickMastered(count, exclude) {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, q.options
    FROM questions q
    JOIN progress p ON p.question_id = q.id AND p.mastered
    WHERE NOT (p.slain)
      AND NOT EXISTS (
        SELECT 1 FROM mistakes m
        WHERE m.question_id = q.id AND m.resolved = FALSE)
      AND NOT (q.id = ANY($1::bigint[]))
    ORDER BY random()
    LIMIT $2`, [exclude, count]);
  return rows;
}

/**
 * 全随机抽取 count 道题（无限/考试模式）。
 * @param {number} count 数量。
 * @param {Array<number>} exclude 已选题目 id。
 * @param {boolean} excludeMastered 是否排除已掌握题（无限模式排除，考试不排除）。
 * @return {Promise<Array<Object>>} 题目行数组。
 */
async function pickRandom(count, exclude, excludeMastered) {
  const masteredFilter = excludeMastered ?
      'AND NOT (p.question_id IS NOT NULL AND p.mastered)' : '';
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, q.options, m.wrong_count
    FROM questions q
    LEFT JOIN progress p ON p.question_id = q.id
    LEFT JOIN mistakes m ON m.question_id = q.id AND m.resolved = FALSE
    WHERE NOT (p.question_id IS NOT NULL AND p.slain)
      ${masteredFilter}
      AND NOT (q.id = ANY($1::bigint[]))
    ORDER BY random()
    LIMIT $2`, [exclude, count]);
  return rows;
}

/**
 * 出题接口。
 *   practice：新题优先 + 混入最多 5 道错题。
 *   mistakes：只出错题。
 *   endless：全随机，排除已掌握与已斩。
 *   exam：全随机，排除已斩（含已掌握）。
 */
router.post('/practice', async (req, res) => {
  const count = clampCount(req.body?.count);
  const mode = req.body?.mode ?? 'practice';
  const exclude = Array.isArray(req.body?.exclude) ? req.body.exclude : [];

  let questions = [];

  if (mode === 'endless' || mode === 'exam') {
    const rows = await pickRandom(count, exclude, mode === 'endless');
    questions = rows.map((row) => ({
      ...toQuestion(row),
      wrongCount: row.wrong_count ?? 0,
    }));
  } else if (mode === 'mistakes') {
    questions = (await pickMistakes(count)).map((row) => ({
      ...toQuestion(row),
      wrongCount: row.wrong_count ?? 0,
    }));
  } else {
    const mistakeRows = await pickMistakes(Math.min(5, count));
    const excludeIds = mistakeRows.map((row) => row.id);
    let freshRows = [];
    let masteredRows = [];
    const rest = count - mistakeRows.length;
    if (rest > 0) {
      freshRows = await pickFresh(rest, excludeIds);
      excludeIds.push(...freshRows.map((row) => row.id));
      const stillRest = rest - freshRows.length;
      if (stillRest > 0) {
        masteredRows = await pickMastered(stillRest, excludeIds);
      }
    }
    questions = [
      ...mistakeRows.map((row) => ({...row, bucket: 0})),
      ...freshRows.map((row) => ({...row, bucket: 1})),
      ...masteredRows.map((row) => ({...row, bucket: 2})),
    ].sort((a, b) => a.bucket - b.bucket).map((row) => ({
      ...toQuestion(row),
      wrongCount: row.wrong_count ?? 0,
    }));
  }

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
    } else {
      // 答对：记录为「已掌握」，常规刷题减少出现。
      await client.query(`
        INSERT INTO progress (question_id, mastered, mastered_at)
        VALUES ($1, TRUE, now())
        ON CONFLICT (question_id) DO UPDATE SET
          mastered = TRUE, mastered_at = now()`, [questionId]);

      if (mode === 'mistakes') {
        // 错题重练中答对：移出错题集。
        const {rowCount} = await client.query(`
          UPDATE mistakes SET resolved = TRUE, resolved_at = now()
          WHERE question_id = $1 AND resolved = FALSE`, [questionId]);
        mistakeResolved = rowCount > 0;
      }
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

/** 错题集：列出未解决的错题，按最近答错时间倒序，排除已斩。 */
router.get('/mistakes', async (req, res) => {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, q.options,
           m.wrong_count, m.last_wrong_at
    FROM mistakes m
    JOIN questions q ON q.id = m.question_id
    LEFT JOIN progress p ON p.question_id = q.id
    WHERE m.resolved = FALSE
      AND NOT (p.question_id IS NOT NULL AND p.slain)
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

/** 斩掉一道题：标记为不再出现，并同步移出错题集。 */
router.post('/questions/:id/slay', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({error: 'id 必须为整数'});
    return;
  }
  await pool.query(`
    INSERT INTO progress (question_id, slain, slain_at)
    VALUES ($1, TRUE, now())
    ON CONFLICT (question_id) DO UPDATE SET
      slain = TRUE, slain_at = now()`, [id]);
  await pool.query(`
    UPDATE mistakes SET resolved = TRUE, resolved_at = now()
    WHERE question_id = $1 AND resolved = FALSE`, [id]);
  res.json({slain: true});
});

/** 已斩历史：列出所有被斩掉的题，按斩掉时间倒序。 */
router.get('/slain', async (req, res) => {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, p.slain_at
    FROM progress p
    JOIN questions q ON q.id = p.question_id
    WHERE p.slain
    ORDER BY p.slain_at DESC
    LIMIT 200`);
  res.json({
    questions: rows.map((row) => ({
      id: Number(row.id),
      sourceNo: row.source_no,
      stem: row.stem,
      slainAt: row.slain_at,
    })),
  });
});

/** 已掌握历史：列出所有已掌握的题，按掌握时间倒序。 */
router.get('/mastered', async (req, res) => {
  const {rows} = await pool.query(`
    SELECT q.id, q.source_no, q.stem, p.mastered_at
    FROM progress p
    JOIN questions q ON q.id = p.question_id
    WHERE p.mastered
    ORDER BY p.mastered_at DESC
    LIMIT 200`);
  res.json({
    questions: rows.map((row) => ({
      id: Number(row.id),
      sourceNo: row.source_no,
      stem: row.stem,
      masteredAt: row.mastered_at,
    })),
  });
});

/** 统计：题库总量、作答次数、答对次数、未解决错题数、已掌握、已斩。 */
router.get('/stats', async (req, res) => {
  const [questionRows, attemptRows, mistakeRows, progressRows] =
    await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM questions'),
      pool.query(`
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE is_correct)::int AS correct
        FROM attempts`),
      pool.query(`
        SELECT count(*)::int AS n FROM mistakes WHERE resolved = FALSE`),
      pool.query(`
        SELECT count(*) FILTER (WHERE mastered)::int AS mastered,
               count(*) FILTER (WHERE slain)::int AS slain
        FROM progress`),
    ]);
  res.json({
    questions: questionRows.rows[0].n,
    attempts: attemptRows.rows[0].n,
    correct: attemptRows.rows[0].correct,
    mistakes: mistakeRows.rows[0].n,
    mastered: progressRows.rows[0].mastered,
    slain: progressRows.rows[0].slain,
  });
});

export default router;
