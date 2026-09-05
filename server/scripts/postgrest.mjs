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
  // ---- 组 A0：清理旧版 public schema 中的函数（历史版本）----
  // 本项目 PostgREST 暴露的是 api schema，函数必须建在 api 下。
  `DROP FUNCTION IF EXISTS public.practice_questions(integer, text);
   DROP FUNCTION IF EXISTS public.submit_answer(bigint, text, text);
   DROP FUNCTION IF EXISTS public.mistake_list();
   DROP FUNCTION IF EXISTS public.resolve_mistake(bigint);
   DROP FUNCTION IF EXISTS public.stats();`,

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

  // ---- 组 B：出题函数 ----
  // 错题优先（bucket=0），再随机补齐；mode=mistakes 只出错题。
  // 含 random()，声明 VOLATILE；search_path 置空 + 全限定表名防劫持。
  `CREATE OR REPLACE FUNCTION api.practice_questions(
     p_count int, p_mode text)
   RETURNS json
   LANGUAGE sql
   SECURITY DEFINER
   SET search_path = ''
   VOLATILE
   AS $$
     SELECT COALESCE(
       json_agg(t.question ORDER BY t.bucket, t.rnd),
       '[]'::json
     )
     FROM (
       SELECT
         json_build_object(
           'id', q.id,
           'sourceNo', q.source_no,
           'stem', q.stem,
           'options', q.options,
           'wrongCount', COALESCE(m.wrong_count, 0)
         ) AS question,
         CASE WHEN m.question_id IS NULL THEN 1 ELSE 0 END AS bucket,
         random() AS rnd
       FROM public.questions q
       LEFT JOIN public.mistakes m
         ON m.question_id = q.id AND m.resolved = FALSE
       WHERE p_mode <> 'mistakes' OR m.question_id IS NOT NULL
       ORDER BY bucket, random()
       LIMIT LEAST(GREATEST(p_count, 1), 50)
     ) t;
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
       -- 答错：进入错题集并累计错误次数（错题在后续轮次重复出现）。
       INSERT INTO public.mistakes
         (question_id, wrong_count, last_wrong_at, resolved)
       VALUES (p_question_id, 1, now(), FALSE)
       ON CONFLICT (question_id) DO UPDATE SET
         wrong_count = public.mistakes.wrong_count + 1,
         last_wrong_at = now(),
         resolved = FALSE,
         resolved_at = NULL;
       v_mistake_updated := TRUE;
     ELSIF p_mode = 'mistakes' THEN
       -- 错题重练中答对：移出错题集。
       UPDATE public.mistakes
       SET resolved = TRUE, resolved_at = now()
       WHERE question_id = p_question_id AND resolved = FALSE;
       v_mistake_resolved := FOUND;
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
       'mistakeResolved', v_mistake_resolved
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
           'lastWrongAt', m.last_wrong_at
         ) AS question,
         m.last_wrong_at AS last_wrong
       FROM public.mistakes m
       JOIN public.questions q ON q.id = m.question_id
       WHERE m.resolved = FALSE
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
                    WHERE resolved = FALSE)
     );
   $$;`,

  // ---- 组 E：函数执行权限 + 刷新 PostgREST schema 缓存 ----
  `GRANT EXECUTE ON FUNCTION api.practice_questions(integer, text)
     TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.submit_answer(bigint, text, text)
     TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.mistake_list() TO anon, authenticated;
   GRANT EXECUTE ON FUNCTION api.resolve_mistake(bigint)
     TO anon, authenticated;
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
