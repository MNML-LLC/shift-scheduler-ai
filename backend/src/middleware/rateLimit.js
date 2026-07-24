import rateLimit from 'express-rate-limit'

/**
 * レート制限ミドルウェア
 *
 * OpenAI API プロキシ（/api/openai）への大量リクエストによる利用料急増を防ぐ。
 * 制限超過時は 429 Too Many Requests を返す。
 *
 * - /api/openai: 1分あたり10リクエスト（OpenAI 利用料保護のため厳しめ）
 * - その他 API: 1分あたり100リクエスト
 *
 * カウントはクライアントIP単位（Railway のプロキシ配下でも実IPを使うため
 * server.js 側で trust proxy を設定している）。
 */

const WINDOW_MS = 60 * 1000

export const OPENAI_RATE_LIMIT = 10
export const GENERAL_RATE_LIMIT = 100

function createLimiter(limit) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      error: 'Too many requests, please try again later.'
    }
  })
}

export function createOpenaiLimiter() {
  return createLimiter(OPENAI_RATE_LIMIT)
}

export function createGeneralLimiter() {
  return createLimiter(GENERAL_RATE_LIMIT)
}
