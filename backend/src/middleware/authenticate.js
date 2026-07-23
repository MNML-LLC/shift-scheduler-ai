import crypto from 'crypto'

/**
 * API Key認証ミドルウェア
 *
 * `/api/health`・`/api/liff`（LINE ID Tokenで独自認証済み）等を除く
 * 全APIルートに適用する共有シークレット方式の認証。
 *
 * Environment Variables:
 * - API_AUTH_ENABLED: 'true' で認証を有効化（未設定/false の場合は無効 = 全リクエスト許可）
 * - API_AUTH_KEYS: カンマ区切りの有効なAPIキー一覧（ローテーション用に複数設定可）
 *
 * リクエストは `x-api-key` ヘッダーに有効なキーを含める必要がある。
 * 認証失敗時は 401 を返す。
 */

let disabledWarned = false
let noKeysWarned = false

function getConfiguredKeys() {
  return (process.env.API_AUTH_KEYS || '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean)
}

function timingSafeEqual(provided, expected) {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)

  if (providedBuffer.length !== expectedBuffer.length) {
    // 長さの違いによるタイミング差を防ぐため、ダミー比較を実行してから false を返す
    crypto.timingSafeEqual(providedBuffer, providedBuffer)
    return false
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer)
}

export function authenticate(req, res, next) {
  const isEnabled = process.env.API_AUTH_ENABLED === 'true'

  if (!isEnabled) {
    if (!disabledWarned) {
      console.warn(
        '[Auth] API_AUTH_ENABLED is not "true". API authentication is disabled and all requests are allowed through unauthenticated.'
      )
      disabledWarned = true
    }
    return next()
  }

  const configuredKeys = getConfiguredKeys()

  if (configuredKeys.length === 0) {
    if (!noKeysWarned) {
      console.error(
        '[Auth] API_AUTH_ENABLED is "true" but API_AUTH_KEYS is not configured. Rejecting all requests.'
      )
      noKeysWarned = true
    }
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    })
  }

  const providedKey = req.headers['x-api-key'] || ''

  const isValid =
    providedKey.length > 0 &&
    configuredKeys.some(key => timingSafeEqual(providedKey, key))

  if (!isValid) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    })
  }

  next()
}

/**
 * 認証を必須としないパスの一覧（前方一致）
 */
export const PUBLIC_PATH_PREFIXES = [
  '/api/health',
  '/api/liff',
  '/api/shifts/plans/monthly-first-plan-batch'
]

export function isPublicPath(path) {
  return PUBLIC_PATH_PREFIXES.some(
    prefix => path === prefix || path.startsWith(`${prefix}/`)
  )
}
