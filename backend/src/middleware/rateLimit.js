import rateLimit from 'express-rate-limit'

/**
 * レート制限ミドルウェア
 *
 * OpenAI API プロキシ（/api/openai）への大量リクエストによる利用料急増を防ぐ。
 * 制限超過時は 429 Too Many Requests を返す。
 *
 * - /api/openai: 1分あたり10リクエスト（OpenAI 利用料保護のため厳しめ）
 * - その他 API: 1分あたり100リクエスト
 * - 認証失敗（401）: 15分あたり10回（APIキーへのブルートフォース対策）
 *
 * カウントはクライアントIP単位（Railway のプロキシ配下でも実IPを使うため
 * server.js 側で trust proxy を設定している）。
 */

const WINDOW_MS = 60 * 1000

export const OPENAI_RATE_LIMIT = 10
export const GENERAL_RATE_LIMIT = 100

export const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000
export const AUTH_FAILURE_LIMIT = 10

function createLimiter(limit) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      error: 'リクエストが多すぎます。しばらく待ってから再度お試しください。'
    }
  })
}

export function createOpenaiLimiter() {
  return createLimiter(OPENAI_RATE_LIMIT)
}

export function createGeneralLimiter() {
  return createLimiter(GENERAL_RATE_LIMIT)
}

/**
 * 認証失敗（401）だけを IP 単位でカウントするレート制限。
 *
 * APIキーに対するブルートフォース攻撃を防ぐため、authenticate ミドルウェアの
 * 前段に配置し、401 応答が窓内で閾値を超えた IP は authenticate 実行前に 429
 * で弾く。正常な認証リクエスト（2xx）や 5xx はカウント対象外。
 *
 * 429 のボディは他リミッターと同一文言にすることで「認証失敗が原因」と明示せず、
 * 攻撃者に情報を与えないようにしている。
 */
export function createAuthFailureLimiter() {
  return rateLimit({
    windowMs: AUTH_FAILURE_WINDOW_MS,
    limit: AUTH_FAILURE_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode !== 401,
    message: {
      success: false,
      error: 'リクエストが多すぎます。しばらく待ってから再度お試しください。'
    }
  })
}
