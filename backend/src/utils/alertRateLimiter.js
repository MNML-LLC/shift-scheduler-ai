/**
 * サーバーエラー通知の重複抑止用レート制限
 *
 * 同一シグネチャ（method + routePattern + errorKey）のエラーが
 * 短時間に連続発生した場合、Slack への通知を1回に絞る。
 *
 * - メモリ内 Map で管理（単一プロセス前提）
 * - MAX_KEYS を超えた場合は最も古いエントリから削除して上限を守る
 * - `now` / `windowMs` はテスト容易性のため注入可能
 */

const DEFAULT_WINDOW_MS = 60 * 1000
const MAX_KEYS = 500

const lastNotifiedAt = new Map()

/**
 * このシグネチャで通知して良いかを判定する。
 * true を返した瞬間に「通知済み」として記録する（副作用あり）。
 *
 * @param {string} signature - 例: 'GET /api/foo::TypeError: boom'
 * @param {Object} [options]
 * @param {number} [options.now] - 現在時刻（ms）
 * @param {number} [options.windowMs] - 抑止ウィンドウ（ms）
 * @returns {boolean} - 通知を送るべきなら true
 */
export function shouldNotify(signature, { now = Date.now(), windowMs = DEFAULT_WINDOW_MS } = {}) {
  if (!signature || typeof signature !== 'string') {
    return false
  }

  const last = lastNotifiedAt.get(signature)
  if (last !== undefined && now - last < windowMs) {
    return false
  }

  lastNotifiedAt.set(signature, now)

  if (lastNotifiedAt.size > MAX_KEYS) {
    const oldestKey = lastNotifiedAt.keys().next().value
    if (oldestKey !== undefined) {
      lastNotifiedAt.delete(oldestKey)
    }
  }

  return true
}

/**
 * テスト用: 内部の Map をクリアする。
 */
export function _resetRateLimiter() {
  lastNotifiedAt.clear()
}
