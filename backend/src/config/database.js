import pkg from 'pg'
const { Pool } = pkg
import './env.js' // 環境変数を読み込む

// Railway PostgreSQL接続設定
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 接続テスト
pool.on('connect', async (client) => {
  // タイムゾーンをJST（日本標準時）に設定
  await client.query("SET timezone = 'Asia/Tokyo'");
  console.log('✅ Database connected successfully (timezone: Asia/Tokyo)');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

// リトライ対象の一時的なエラーコード
// - ECONNREFUSED / ECONNRESET / ETIMEDOUT: ネットワーク層の一時的障害
// - 57P01: PostgreSQL admin_shutdown（Railway のメンテナンス再起動などで発生）
const RETRIABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  '57P01'
])

// 指数バックオフの待機時間（ms）。要素数 = リトライ回数。
export const RETRY_DELAYS_MS = [1000, 2000, 4000]

function isRetriableError(error) {
  return error != null && RETRIABLE_ERROR_CODES.has(error.code)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * クエリ実行（一時的なDB接続エラーは指数バックオフでリトライ）
 */
export async function query(text, params) {
  const start = Date.now();
  const maxRetries = RETRY_DELAYS_MS.length;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      console.log('Executed query', { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries && isRetriableError(error)) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(
          `Database query failed with ${error.code}, retrying ${attempt + 1}/${maxRetries} after ${delay}ms`
        );
        await sleep(delay);
        continue;
      }

      console.error('Database query error:', error);
      throw error;
    }
  }

  // ループを抜けるのは全リトライがリトライ対象エラーで失敗した場合のみ
  throw lastError;
}

/**
 * トランザクション実行
 */
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 接続プール取得
 */
export function getPool() {
  return pool;
}

export default { query, transaction, getPool };
