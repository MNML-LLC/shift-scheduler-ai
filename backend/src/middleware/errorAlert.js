import { notifyServerError } from '../utils/slackNotifier.js'
import { shouldNotify } from '../utils/alertRateLimiter.js'

/**
 * `res.on('finish')` で 5xx を検知し、Slack に fire-and-forget で通知するミドルウェア。
 *
 * 設計上の重要ポイント:
 * - health エンドポイントは通知対象外（ヘルスチェックの一時的な失敗で騒がない）
 * - `res.locals.suppressGenericAlert === true` の場合はスキップ
 *   （個別ルートで既に notifyShiftGenerationError を呼んでいるケースの二重通知抑止）
 * - グローバルエラーハンドラは `res.locals.alertError = err` を設定するだけで通知はしない
 *   → このミドルウェアが `finish` イベント発火時に一括で通知する
 * - fire-and-forget（await しない）でレスポンスレイテンシに加算しない
 * - 同一シグネチャの通知は shouldNotify() でレート制限する
 *
 * @returns {import('express').RequestHandler}
 */
export function createErrorAlertMiddleware() {
  return function errorAlertMiddleware(req, res, next) {
    res.on('finish', () => {
      try {
        if (res.statusCode < 500) return

        if (res.locals && res.locals.suppressGenericAlert === true) return

        const path = (req.baseUrl || '') + (req.path || '')
        if (path.startsWith('/api/health')) return

        const routePattern = (req.baseUrl || '') + ((req.route && req.route.path) || req.path || '')
        const err = (res.locals && res.locals.alertError) || null
        const errorName = (err && err.name) || 'ServerError'
        const errorMessage = (err && (err.message || err.error)) || `HTTP ${res.statusCode}`
        const errorKey = truncate(`${errorName}: ${errorMessage}`, 120)
        const signature = `${req.method} ${routePattern}::${errorKey}`

        if (!shouldNotify(signature)) return

        const endpoint = `${req.method} ${routePattern}`
        const stack = err && typeof err.stack === 'string' ? err.stack : null

        Promise.resolve(
          notifyServerError({
            endpoint,
            statusCode: res.statusCode,
            message: errorMessage,
            stack,
            timestamp: new Date().toISOString()
          })
        ).catch((notifyError) => {
          console.error('[errorAlert] 通知処理で予期しないエラー:', notifyError.message)
        })
      } catch (hookError) {
        console.error('[errorAlert] finish フックで予期しないエラー:', hookError.message)
      }
    })

    next()
  }
}

function truncate(str, maxLen) {
  if (typeof str !== 'string') return ''
  return str.length <= maxLen ? str : str.slice(0, maxLen)
}
