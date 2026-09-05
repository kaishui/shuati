/**
 * Supabase PostgREST 直连客户端。
 *
 * 业务逻辑在 PostgreSQL RPC 函数中（server/scripts/postgrest.mjs），
 * 前端经 Supabase REST 网关调用，无需自建后端服务。
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 缺失配置时尽早失败，避免生成相对路径请求后难排查。
if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error(
      '缺少 Supabase 配置：请在 web/.env 设置 VITE_SUPABASE_URL ' +
      '与 VITE_SUPABASE_ANON_KEY');
}

const REST_URL = `${SUPABASE_URL}/rest/v1`;

/**
 * 调用 PostgREST RPC 函数。
 * @param {string} name 函数名。
 * @param {Object} params 函数参数。
 * @return {Promise<Object>} 函数返回的 JSON。
 */
async function rpc(name, params) {
  const response = await fetch(`${REST_URL}/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    // PostgREST 错误体为 {code, message, details, hint}。
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? body.error ?? `请求失败 (${response.status})`);
  }
  return response.json();
}

export const api = {
  /** 获取全局统计。 */
  stats: () => rpc('stats', {}),

  /**
   * 开始一轮刷题。
   * @param {number} count 题目数量。
   * @param {string} mode 'practice' 常规（错题优先）| 'mistakes' 只练错题。
   * @param {Array<number>} exclude 本轮已出过的题目 id（无限模式不重复）。
   * @return {Promise<Object>} {questions: Array}。
   */
  practice: async (count, mode, exclude = []) => ({
    questions: await rpc('practice_questions', {
      p_count: count,
      p_mode: mode,
      p_exclude: exclude,
    }),
  }),

  /**
   * 提交答案。
   * @param {Object} answer {questionId, selected, mode}。
   * @return {Promise<Object>} 判定结果与证据。
   */
  answer: (answer) => rpc('submit_answer', {
    p_question_id: answer.questionId,
    p_selected: answer.selected,
    p_mode: answer.mode,
  }),

  /** 获取未解决的错题列表。 */
  mistakes: async () => ({
    questions: await rpc('mistake_list', {}),
  }),

  /**
   * 手动将错题移出错题集。
   * @param {number} id 题目 id。
   * @return {Promise<Object>} {resolved: boolean}。
   */
  resolveMistake: (id) => rpc('resolve_mistake', {
    p_question_id: id,
  }),
};
