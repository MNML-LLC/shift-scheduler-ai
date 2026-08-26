import axios from 'axios'

/**
 * LINE通知サービス
 *
 * LIFF backend の通知エンドポイントを叩く共通ヘルパー群。
 * 呼び出し側は isEnabled() と process.env.LIFF_BACKEND_URL の有無を確認してから利用する。
 *
 * 詳細な運用手順は docs/operations/monthly-first-plan-batch.md を参照。
 */

const DEFAULT_TIMEOUT_MS = 10000

/**
 * LINE通知が有効かを判定する。
 *
 * `NOTIFICATION_ENABLED` 環境変数が文字列 `'true'` の場合のみ有効。
 * 未設定・空文字・その他の値はすべて `false`（安全側フォールバック）として扱う。
 */
export function isEnabled() {
  return process.env.NOTIFICATION_ENABLED === 'true'
}

/**
 * LIFF backend URL が設定されているかを判定する。
 */
export function hasBackendUrl() {
  return typeof process.env.LIFF_BACKEND_URL === 'string' && process.env.LIFF_BACKEND_URL.length > 0
}

/**
 * LINE通知: 第1案承認
 */
export async function notifyFirstPlanApproved({ tenant_id, store_id, plan_id, year, month }) {
  await axios.post(
    `${process.env.LIFF_BACKEND_URL}/api/notification/first-plan-approved`,
    { tenant_id, store_id, plan_id, year, month },
    { timeout: DEFAULT_TIMEOUT_MS }
  )
}

/**
 * LINE通知: シフト確定
 */
export async function notifyShiftConfirmed({ tenant_id, store_id, plan_id, year, month }) {
  await axios.post(
    `${process.env.LIFF_BACKEND_URL}/api/notification/shift-confirmed`,
    { tenant_id, store_id, plan_id, year, month },
    { timeout: DEFAULT_TIMEOUT_MS }
  )
}

export default {
  isEnabled,
  hasBackendUrl,
  notifyFirstPlanApproved,
  notifyShiftConfirmed,
}
