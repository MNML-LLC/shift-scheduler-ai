import pkg from 'pg'
const { Pool } = pkg
import './env.js' // 環境変数を読み込む

/**
 * リトライ枯渇時に throw される専用エラー。
 * グローバルエラーハンドラで捕捉し HTTP 503 に変換する。
 */
export class DatabaseUnavailableError extends Error {
  constructor(cause) {
    super('Database temporarily unavailable after retries')
    this.name = 'DatabaseUnavailableError'
    this.status = 503
    this.cause = cause
  }
}

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
 *
 * リトライは接続系エラー（ECONNREFUSED / ECONNRESET / ETIMEDOUT / 57P01 等）にのみ適用。
 * 非冪等クエリ（INSERT/UPDATE/DELETE 等）はネットワーク応答喪失時に二重適用の恐れがあるため、
 * 書き込みは transaction() 経由（リトライなし）で呼び出すこと。
 */
export async function query(text, params) {
  const start = Date.now();
  const maxRetries = RETRY_DELAYS_MS.length;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      console.log('Executed query', { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      // リトライ対象外のエラー（構文エラー等）はそのまま呼び出し側に伝搬
      if (!isRetriableError(error)) {
        console.error('Database query error:', error);
        throw error;
      }

      // リトライ対象エラーだがリトライ上限に達した場合は 503 に変換
      if (attempt >= maxRetries) {
        console.error('Database query error (retries exhausted):', error);
        throw new DatabaseUnavailableError(error);
      }

      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `Database query failed with ${error.code}, retrying ${attempt + 1}/${maxRetries} after ${delay}ms`
      );
      await sleep(delay);
    }
  }
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
