import googleConfig from 'eslint-config-google';
import globals from 'globals';

// valid-jsdoc / require-jsdoc 已在 ESLint 9 核心移除，此处过滤掉；
// JSDoc 规范靠人工评审保证。
const REMOVED_RULES = new Set(['valid-jsdoc', 'require-jsdoc']);
const googleRules = Object.fromEntries(
    Object.entries(googleConfig.rules)
        .filter(([name]) => !REMOVED_RULES.has(name)));

export default [
  {ignores: ['node_modules/**']},
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      ...googleRules,
      // Express 的 Router 是工厂函数，不需要 new。
      'new-cap': ['error', {capIsNewExceptions: ['Router']}],
      // SQL 模板字符串按行宽拆分会破坏可读性，仅对模板字符串放宽。
      'max-len': [
        'error',
        {code: 80, ignoreUrls: true, ignoreTemplateLiterals: true},
      ],
    },
  },
];
