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

- 前端：React 19 + Vite，Google JS 代码规范 + react/recommended +
  react-hooks/recommended
- 后端：Supabase PostgreSQL 函数（经 PostgREST 直连，无需自建服务），
  见 `server/scripts/postgrest.mjs`
- 数据库：Supabase PostgreSQL（`server/.env` 中的 `DATABASE_URL`）
- 仓库中另保留 Express 5 后端（server/src/）作为本地开发备选，
  线上前端不依赖它

## 快速开始

```bash
npm install          # 安装所有依赖（npm workspaces）
npm run seed         # 解析 doc/试题.docx 并灌入数据库（幂等，可重复执行）
npm run postgrest -w server   # 创建 PostgREST RPC 函数与安全边界（幂等）
cp web/.env.example web/.env  # 填入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev -w web   # 前端 :5173，直连 Supabase
```

打开 http://localhost:5173 即可刷题。

## 其他命令

```bash
npm run lint         # 两个包同时跑 eslint（Google 风格）
npm run build -w web # 前端生产构建
```

## 部署（GitHub Pages）

推送到 main 后，GitHub Actions 自动把前端构建并发布到
https://kaishui.github.io/shuati/ 。构建时从 GitHub Secrets 注入
`SUPABASE_URL` / `SUPABASE_ANON_KEY`（对应 VITE_ 变量）。

前端**直连 Supabase PostgREST**，无自有后端服务：电脑、手机、
任意浏览器打开即用，无权限弹窗。

安全说明：

- 三张业务表对匿名角色完全关闭（RLS + 撤销默认授权），
  所有读写只经 `SECURITY DEFINER` 函数，答案列绝不直接下发
- anon key 是 Supabase 公开设计的访问凭证，可放心放入前端构建
- 已知边界：任何人拿到 anon key 都能调用 `submit_answer` 伪造
  作答记录（个人刷题工具可接受）；后续如需收紧可引入 Supabase Auth

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
