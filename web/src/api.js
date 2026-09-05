/**
 * 后端 API 封装。所有接口返回 Promise<Object>，失败时抛出 Error。
 *
 * API 前缀通过 VITE_API_BASE 注入：本地开发走 Vite 代理（相对路径），
 * GitHub Pages 构建时指向 http://localhost:3002（本机后端）。
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/**
 * 发起 JSON 请求并解析响应。
 * @param {string} path 请求路径。
 * @param {Object} options fetch 选项。
 * @return {Promise<Object>} 响应 JSON。
 */
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {'Content-Type': 'application/json'},
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `请求失败 (${response.status})`);
  }
  return response.json();
}

export const api = {
  /** 获取全局统计。 */
  stats: () => request('/api/stats'),

  /**
   * 开始一轮刷题。
   * @param {number} count 题目数量。
   * @param {string} mode 'practice' 常规（错题优先）| 'mistakes' 只练错题。
   * @return {Promise<Object>} {questions: Array}。
   */
  practice: (count, mode) => request('/api/practice', {
    method: 'POST',
    body: JSON.stringify({count, mode}),
  }),

  /**
   * 提交答案。
   * @param {Object} answer {questionId, selected, mode}。
   * @return {Promise<Object>} 判定结果与证据。
   */
  answer: (answer) => request('/api/answers', {
    method: 'POST',
    body: JSON.stringify(answer),
  }),

  /** 获取未解决的错题列表。 */
  mistakes: () => request('/api/mistakes'),

  /**
   * 手动将错题移出错题集。
   * @param {number} id 题目 id。
   * @return {Promise<Object>} {resolved: boolean}。
   */
  resolveMistake: (id) => request(`/api/mistakes/${id}/resolve`, {
    method: 'POST',
  }),
};
