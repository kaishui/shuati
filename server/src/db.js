import {Pool} from 'pg';

/**
 * 全局 PostgreSQL 连接池（Supabase 事务池需要 SSL）。
 *
 * 跨境到 Supabase 的冷连接约需 4s，设置超时避免死连接让请求永久挂起。
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {rejectUnauthorized: false},
  max: 10,
  connectionTimeoutMillis: 15000,
  query_timeout: 15000,
  idleTimeoutMillis: 10000,
});

/** 建表语句：questions 题库、attempts 作答记录、mistakes 错题集。 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS questions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_no INTEGER NOT NULL UNIQUE,
    stem TEXT NOT NULL,
    options JSONB NOT NULL,
    answer CHAR(1) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    selected CHAR(1),
    is_correct BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS attempts_question_idx
    ON attempts(question_id);

  CREATE TABLE IF NOT EXISTS mistakes (
    question_id BIGINT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
    wrong_count INTEGER NOT NULL DEFAULT 1,
    last_wrong_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ
  );
`;

/** 初始化表结构（幂等）。 */
export async function initSchema() {
  await pool.query(SCHEMA_SQL);
}

export default pool;
