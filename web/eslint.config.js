import {FlatCompat} from '@eslint/eslintrc';
import googleConfig from 'eslint-config-google';
import globals from 'globals';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
});

// valid-jsdoc / require-jsdoc 已在 ESLint 9 核心移除，此处过滤掉；
// JSDoc 规范靠人工评审保证。
const REMOVED_RULES = new Set(['valid-jsdoc', 'require-jsdoc']);
const googleRules = Object.fromEntries(
    Object.entries(googleConfig.rules)
        .filter(([name]) => !REMOVED_RULES.has(name)));

export default [
  {ignores: ['dist/**', 'node_modules/**']},
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {ecmaFeatures: {jsx: true}},
    },
    rules: {
      ...googleRules,
      'max-len': ['error', {code: 80, ignoreUrls: true}],
      // Google 风格指南未定义 JSX；indent 规则无法解析 JSX 语法，
      // 与常见 JSX 排版冲突，故关闭（JSX 排版靠人工评审）。
      'indent': 'off',
      'react/jsx-indent': 'off',
      'react/jsx-indent-props': 'off',
    },
  },
  ...compat.extends('plugin:react/recommended'),
  ...compat.extends('plugin:react-hooks/recommended'),
  {
    settings: {react: {version: 'detect'}},
    rules: {
      // React 19 的 JSX 转换不再需要显式引入 React。
      'react/react-in-jsx-scope': 'off',
      // 内部工具项目，组件不做 PropTypes 运行时校验。
      'react/prop-types': 'off',
    },
  },
];
