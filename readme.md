# 检验专业刷题

从 `doc/试题.docx` 正则解析 3852 道单选题，存入 Supabase PostgreSQL，
提供移动端适配的 React 刷题界面。

## 功能

- **刷题模式**：错题优先出题 + 随机补齐；答错的题自动重新排到队尾，
  答对为止（错题重复出现）
- **错题集**：答错的题进入错题集并累计错误次数；可一键「重练错题」，
  重练答对后自动移出；也可手动「我会了」移出
- **答案解析证据**：每题答完展示原文题干 + 正确选项原文作为证据
- **统计**：题库总量 / 累计作答 / 累计答对 / 待练错题
- **移动端适配**：viewport + 安全区适配、大触控目标、底部悬浮提交栏

## 技术栈

- 后端：Node.js + Express 5 + pg，Google JS 代码规范（eslint-config-google）
- 前端：React 19 + Vite，Google JS 代码规范 + react/recommended +
  react-hooks/recommended
- 数据库：Supabase PostgreSQL（`server/.env` 中的 `DATABASE_URL`）

## 快速开始

```bash
npm install          # 安装所有依赖（npm workspaces）
npm run seed         # 解析 doc/试题.docx 并灌入数据库（幂等，可重复执行）
npm run dev          # 同时启动后端(:3002)与前端(:5173)
```

打开 http://localhost:5173 即可刷题。

## 其他命令

```bash
npm run lint         # 两个包同时跑 eslint（Google 风格）
npm run build -w web # 前端生产构建
```

## 目录结构

```
doc/试题.docx           原始试题（3852 道单选题）
server/
  src/parser.js         docx 转出文本的正则解析器（题干/选项/答案/上标还原）
  src/db.js             PostgreSQL 连接池与建表
  src/questions.js      API：出题、答题、错题集、统计
  src/index.js          Express 入口
  scripts/seed.mjs      种子脚本：textutil 转 txt → 解析 → 入库
web/
  src/components/       Home / Practice / Mistakes / ResultPanel
  src/api.js           后端接口封装
  src/styles.css       移动优先样式
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（含数据库连通性） |
| GET | `/api/stats` | 题库总量、作答数、答对数、错题数 |
| POST | `/api/practice` | 出题 `{count, mode}`，`mode: 'mistakes'` 只出错题；默认错题优先 |
| POST | `/api/answers` | 提交答案 `{questionId, selected, mode}`，返回判定 + 证据（题干原文、正确选项原文） |
| GET | `/api/mistakes` | 未解决错题列表 |
| POST | `/api/mistakes/:id/resolve` | 手动移出错题集 |

## 试题格式说明

docx 经 macOS `textutil` 转出的纯文本格式为：

```
第1题 题干(P:0)

A、选项一
B、选项二
...
标准答案： C 您的答案：
```

- `(P:0)` 为原考试系统标记，解析时剔除
- `_TagUpStart_..._TagUpEnd_` 为上标标记（如 `10_TagUpStart_9_TagUpEnd_`
  → `10⁹`），入库前还原为 Unicode 上标
- 原文有 4 道题选项残缺（第 261/440/478/1212 题，源文档即如此），
  按实际选项数入库，界面支持 2~5 个选项
