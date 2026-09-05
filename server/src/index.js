import express from 'express';
import pool, {initSchema} from './db.js';
import questionsRouter from './questions.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

// 允许 GitHub Pages 静态站点跨域调用本机后端（含 OPTIONS 预检）。
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

/** 健康检查：确认服务与数据库均可用。 */
app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({status: 'ok', db: true});
});

app.use('/api', questionsRouter);

// Express 5 会把异步处理器抛出的错误转发到该中间件。
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({error: '服务器内部错误'});
});

await initSchema();
app.listen(port, () => {
  console.log(`shuati server listening on http://localhost:${port}`);
});
