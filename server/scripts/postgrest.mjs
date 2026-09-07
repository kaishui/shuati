/**
 * PostgREST 后端迁移：在 Supabase PostgreSQL 中创建 RPC 函数与安全边界。
 *
 * 前端（GitHub Pages）经 PostgREST 直连这些函数，无需自建后端服务。
 * 脚本幂等，可重复执行。
 *
 * 安全模型：三张表对 anon/authenticated 完全关闭（开 RLS + 无策略 +
 * REVOKE 默认权限），所有读写只经 SECURITY DEFINER 函数
 * （owner 为 postgres，自动绕过 RLS）。答案列绝不直接暴露。
 *
 * 用法：npm run postgrest -w server
 */
import pool from '../src/db.js';

/** 每条语句单独执行（事务池逐条提交，避免多语句事务语义问题）。 */
const STATEMENTS = [
  // ---- 组 A0：清理旧版 public/api schema 中的旧签名函数 ----
  // 本项目 PostgREST 暴露的是 api schema，函数必须建在 api 下。
  `DROP FUNCTION IF EXISTS public.practice_questions(integer, text);
   DROP FUNCTION IF EXISTS public.submit_answer(bigint, text, text);
   DROP FUNCTION IF EXISTS public.mistake_list();
   DROP FUNCTION IF EXISTS public.resolve_mistake(bigint);
   DROP FUNCTION IF EXISTS public.stats();
   DROP FUNCTION IF EXISTS api.practice_questions(integer, text);`,

  // ---- 组 A：表级安全边界 ----
  // Supabase 默认把三张表的 ALL 授给 anon/authenticated；若不撤销，
  // 任何拿到公开 anon key 的人可经 PostgREST 直读 questions.answer 泄题。
  `ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
   DROP POLICY IF EXISTS questions_anon_read ON questions;
   ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;
   DROP POLICY IF EXISTS attempts_anon_insert ON attempts;
   ALTER TABLE mistakes ENABLE ROW LEVEL SECURITY;

   REVOKE ALL ON questions FROM anon, authenticated;
   REVOKE ALL ON attempts FROM anon, authenticated;
   REVOKE ALL ON mistakes FROM anon, authenticated;`,

  // ---- 组 A1：错题表加「隔天两次答对」追踪列 ----
  `ALTER TABLE mistakes
     ADD COLUMN IF NOT EXISTS correct_streak integer NOT NULL DEFAULT 0;
   ALTER TABLE mistakes
     ADD COLUMN IF NOT EXISTS last_correct_date date;`,

  // ---- 组 A2：每题掌握/斩状态表（记录做对、手动斩掉不再出现）----
  `CREATE TABLE IF NOT EXISTS progress (
     question_id BIGINT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
     mastered BOOLEAN NOT NULL DEFAULT FALSE,
     mastered_at TIMESTAMPTZ,
     slain BOOLEAN NOT NULL DEFAULT FALSE,
     slain_at TIMESTAMPTZ
   );
   CREATE INDEX IF NOT EXISTS progress_mastered_idx
     ON progress (mastered_at DESC) WHERE mastered;
   CREATE INDEX IF NOT EXISTS progress_slain_idx
     ON progress (slain_at DESC) WHERE slain;`,

  // ---- 组 B：出题函数 ----
  // 各模式出题规则：
  //   practice（常规）：新题优先，混入最多 5 道未解决错题；已掌握题仅
  //     在题目不足时补齐；排除已斩。
  //   mistakes：只出未解决错题；排除已斩。
  //   endless（无限）：全部随机，排除已掌握题与已斩题（本轮不重复）。
  //   exam（考试）：全部随机，排除已斩题（含已掌握题，考全部）。
  // p_exclude 排除已作答题目（无限/考试本轮不重复）。
  // 含 random()，声明 VOLATILE；search_path 置空 + 全限定表名防劫持。
  `CREATE OR REPLACE FUNCTION api.practice_questions(
     p_count int, p_mode text, p_exclude bigint[] DEFAULT NULL)
   RETURNS json
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = ''
   VOLATILE
   AS $$
     WITH candidate AS (
       SELECT
         q.id,
         q.source_no,
         q.stem,
         q.options,
         COALESCE(m.wrong_count, 0) AS wrong_count,
         CASE
           WHEN p_mode = 'mistakes' THEN 0
           WHEN m.question_id IS NOT NULL THEN 0
           WHEN p.mastered THEN 2
           ELSE 1
         END AS bucket
       FROM public.questions q
       LEFT JOIN public.mistakes m
         ON m.question_id = q.id AND m.resolved = FALSE
       LEFT JOIN public.progress p
         ON p.question_id = q.id
       WHERE NOT (p.question_id IS NOT NULL AND p.slain)
         AND (p_mode <> 'mistakes' OR m.question_id IS NOT NULL)
         AND NOT (q.id = ANY(COALESCE(p_exclude, ARRAY[]::bigint[])))
     ),
     -- 随机池：endless（排除已掌握）与 exam（含已掌握）全随机抽取。
     random_pool AS (
       SELECT * FROM candidate
       WHERE p_mode IN ('endless', 'exam')
         AND (p_mode = 'exam' OR bucket <> 2)
       ORDER BY random()
       LIMIT LEAST(GREATEST(p_count, 1), 100)
     ),
     -- 错题池：常规模式最多抽 5 道；mistakes 模式抽满 p_count。
     mistake_pool AS (
       SELECT * FROM candidate
       WHERE bucket = 0
         AND p_mode NOT IN ('endless', 'exam')
       ORDER BY random()
       LIMIT CASE WHEN p_mode = 'mistakes'
                  THEN LEAST(GREATEST(p_count, 1), 100)
                  ELSE 5 END
     ),
     -- 新题池（未掌握、非错题）。
     fresh_pool AS (
       SELECT * FROM candidate
       WHERE bucket = 1
         AND p_mode NOT IN ('endless', 'exam')
       ORDER BY random()
       LIMIT LEAST(GREATEST(p_count, 1), 100)
     ),
     -- 已掌握题池：仅在错题+新题不足时补齐。
     mastered_pool AS (
       SELECT * FROM candidate
       WHERE bucket = 2
         AND p_mode NOT IN ('endless', 'exam')
       ORDER BY random()
       LIMIT LEAST(GREATEST(p_count, 1), 100)
     ),
     combined AS (
       SELECT * FROM random_pool
       UNION ALL
       SELECT * FROM mistake_pool
       UNION ALL
       SELECT * FROM fresh_pool
       UNION ALL
       SELECT * FROM mastered_pool
     ),
     -- 先按优先级排序并截断到目标题数，再聚合。
     -- endless/exam 全随机不按 bucket 排序；常规模式错题优先。
     limited AS (
       SELECT * FROM combined
       ORDER BY
         CASE WHEN p_mode IN ('endless', 'exam') THEN 0 ELSE bucket END,
         random()
       LIMIT LEAST(GREATEST(p_count, 1), 100)
     )
     SELECT COALESCE(
       json_agg(
         json_build_object(
           'id', c.id,
           'sourceNo', c.source_no,
           'stem', c.stem,
           'options', c.options,
           'wrongCount', c.wrong_count
         )
       ),
       '[]'::json
     )
     FROM limited c;
   $$;`,

  // ---- 组 C：提交答案 ----
  // 记录作答、维护错题集、返回带证据的判定结果。
  // plpgsql 函数体本身即事务，保证 attempts/mistakes 写入原子。
  `CREATE OR REPLACE FUNCTION api.submit_answer(
     p_question_id bigint, p_selected text, p_mode text)
   RETURNS json
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = ''
   AS $$
   DECLARE
     v_question public.questions%ROWTYPE;
     v_correct boolean;
     v_answer_text text;
     v_selected_text text;
     v_mistake_updated boolean := FALSE;
     v_mistake_resolved boolean := FALSE;
     v_mistake_advanced boolean := FALSE;
     v_streak integer := 0;
     v_last_date date;
   BEGIN
     IF p_question_id IS NULL THEN
       RAISE EXCEPTION 'questionId 必须为整数' USING ERRCODE = '22023';
     END IF;
     IF p_selected IS NULL OR p_selected !~ '^[A-E]$' THEN
       RAISE EXCEPTION 'selected 必须为 A-E 之一' USING ERRCODE = '22023';
     END IF;

     SELECT * INTO v_question FROM public.questions WHERE id = p_question_id;
     IF NOT FOUND THEN
       RAISE EXCEPTION '题目不存在' USING ERRCODE = 'P0002';
     END IF;

     v_correct := v_question.answer = p_selected;

     -- 证据：正确选项原文。
     SELECT option.value ->> 'text' INTO v_answer_text
     FROM jsonb_array_elements(v_question.options) AS option
     WHERE option.value ->> 'key' = v_question.answer;

     SELECT option.value ->> 'text' INTO v_selected_text
     FROM jsonb_array_elements(v_question.options) AS option
     WHERE option.value ->> 'key' = p_selected;

     INSERT INTO public.attempts (question_id, selected, is_correct)
     VALUES (p_question_id, p_selected, v_correct);

    IF NOT v_correct THEN
      -- 答错：进入错题集、累计错误次数并清零答对进度。
      INSERT INTO public.mistakes
        (question_id, wrong_count, last_wrong_at, resolved)
      VALUES (p_question_id, 1, now(), FALSE)
      ON CONFLICT (question_id) DO UPDATE SET
        wrong_count = public.mistakes.wrong_count + 1,
        last_wrong_at = now(),
        resolved = FALSE,
        resolved_at = NULL,
        correct_streak = 0,
        last_correct_date = NULL;
      v_mistake_updated := TRUE;
    ELSE
      -- 答对：记录为「已掌握」，之后常规刷题减少出现该题。
      INSERT INTO public.progress (question_id, mastered, mastered_at)
      VALUES (p_question_id, TRUE, now())
      ON CONFLICT (question_id) DO UPDATE SET
        mastered = TRUE, mastered_at = now();

      -- 答对：需「隔天答对两次」才移出错题集；当天重复答对不计次。
       SELECT m.correct_streak, m.last_correct_date
         INTO v_streak, v_last_date
       FROM public.mistakes m
       WHERE m.question_id = p_question_id AND m.resolved = FALSE;
       IF FOUND THEN
         IF v_last_date IS NULL OR v_last_date < CURRENT_DATE THEN
           v_streak := v_streak + 1;
         END IF;
         IF v_streak >= 2 THEN
           UPDATE public.mistakes
           SET resolved = TRUE, resolved_at = now()
           WHERE question_id = p_question_id AND resolved = FALSE;
           v_mistake_resolved := TRUE;
         ELSE
           UPDATE public.mistakes
           SET correct_streak = v_streak, last_correct_date = CURRENT_DATE
           WHERE question_id = p_question_id AND resolved = FALSE;
           v_mistake_advanced := TRUE;
         END IF;
       END IF;
     END IF;

     RETURN json_build_object(
       'correct', v_correct,
       'selected', p_selected,
       'answer', v_question.answer,
       'answerText', COALESCE(v_answer_text, ''),
       'selectedText', COALESCE(v_selected_text, ''),
       'stem', v_question.stem,
       'sourceNo', v_question.source_no,
       'mistakeUpdated', v_mistake_updated,
       'mistakeResolved', v_mistake_resolved,
       'mistakeAdvanced', v_mistake_advanced,
       'correctStreak', v_streak
     );
   END;
   $$;`,

  // ---- 组 D：错题列表 / 手动移出 / 统计 ----
  `CREATE OR REPLACE FUNCTION api.mistake_list()
   RETURNS json
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = ''
   STABLE
   AS $$
     SELECT COALESCE(
       json_agg(x.question ORDER BY x.last_wrong DESC),
       '[]'::json
     )
     FROM (
       SELECT
         json_build_object(
           'id', q.id,
           'sourceNo', q.source_no,
           'stem', q.stem,
           'options', q.options,
           'wrongCount', m.wrong_count,
           'lastWrongAt', m.last_wrong_at,
           'correctStreak', m.correct_streak
         ) AS question,
         m.last_wrong_at AS last_wrong
       FROM public.mistakes m
       JOIN public.questions q ON q.id = m.question_id
       WHERE m.resolved = FALSE
         AND NOT EXISTS (
           SELECT 1 FROM public.progress p
           WHERE p.question_id = q.id AND p.slain
         )
     ) x;
   $$;`,

  `CREATE OR REPLACE FUNCTION api.resolve_mistake(p_question_id bigint)
   RETURNS json
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = ''
   AS $$
   BEGIN
     IF p_question_id IS NULL THEN
       RAISE EXCEPTION 'id 必须为整数' USING ERRCODE = '22023';
     END IF;
     UPDATE public.mistakes
     SET resolved = TRUE, resolved_at = now()
     WHERE question_id = p_question_id AND resolved = FALSE;
     RETURN json_build_object('resolved', FOUND);
   END;
   $$;`,

  // ---- 组 D2：已斩 / 已掌握历史列表 ----
  `CREATE OR REPLACE FUNCTION api.slain_list()
   RETURNS json
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = ''
   STABLE
   AS $$
     SELECT COALESCE(
       json_agg(x.question ORDER BY x.slain_at DESC),
       '[]'::json
     )
     FROM (
       SELECT
         json_build_object(
           'id', q.id,
           'sourceNo', q.source_no,
           'stem', q.stem,
           'slainAt', p.slain_at
         ) AS question,
         p.slain_at
       FROM public.progress p
       JOIN public.questions q ON q.id = p.question_id
       WHERE p.slain
       ORDER BY p.slain_at DESC
       LIMIT 200
     ) x;
   $$;`,

  `CREATE OR REPLACE FUNCTION api.mastered_list()
   RETURNS json
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = ''
   STABLE
   AS $$
     SELECT COALESCE(
       json_agg(x.question ORDER BY x.mastered_at DESC),
       '[]'::json
     )
     FROM (
       SELECT
         json_build_object(
           'id', q.id,
           'sourceNo', q.source_no,
           'stem', q.stem,
           'masteredAt', p.mastered_at
         ) AS question,
         p.mastered_at
       FROM public.progress p
       JOIN public.questions q ON q.id = p.question_id
       WHERE p.mastered
       ORDER BY p.mastered_at DESC
       LIMIT 200
     ) x;
   $$;`,

  // 斩掉一道题：标记为不再出现，并同步移出错题集。
  `CREATE OR REPLACE FUNCTION api.slay_question(p_question_id bigint)
   RETURNS json
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = ''
   AS $$
   BEGIN
     IF p_question_id IS NULL THEN
       RAISE EXCEPTION 'id 必须为整数' USING ERRCODE = '22023';
     END IF;
     INSERT INTO public.progress (question_id, slain, slain_at)
     VALUES (p_question_id, TRUE, now())
     ON CONFLICT (question_id) DO UPDATE SET
       slain = TRUE, slain_at = now();
     UPDATE public.mistakes
     SET resolved = TRUE, resolved_at = now()
     WHERE question_id = p_question_id AND resolved = FALSE;
     RETURN json_build_object('slain', TRUE);
   END;
   $$;`,

  `CREATE OR REPLACE FUNCTION api.stats()
   RETURNS json
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = ''
   STABLE
   AS $$
     SELECT json_build_object(
       'questions', (SELECT count(*)::int FROM public.questions),
       'attempts', (SELECT count(*)::int FROM public.attempts),
       'correct', (SELECT count(*)::int FROM public.attempts
                   WHERE is_correct),
       'mistakes', (SELECT count(*)::int FROM public.mistakes
                    WHERE resolved = FALSE),
       'mastered', (SELECT count(*)::int FROM public.progress
                    WHERE mastered),
       'slain', (SELECT count(*)::int FROM public.progress
                 WHERE slain)
     );
   $$;`,

  // ---- 组 E：函数执行权限 + 刷新 PostgREST schema 缓存 ----
  `GRANT EXECUTE ON FUNCTION api.practice_questions(integer, text, bigint[])
     TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.submit_answer(bigint, text, text)
     TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.mistake_list() TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.resolve_mistake(bigint)
     TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.slay_question(bigint)
     TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.slain_list() TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.mastered_list() TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.stats() TO anon, authenticated;

   NOTIFY pgrst, 'reload schema';`,
];

/** 主流程。 */
async function main() {
  for (const sql of STATEMENTS) {
    await pool.query(sql);
  }
  console.log(`postgrest migration done (${STATEMENTS.length} statements)`);
}

main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
