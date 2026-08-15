import axios from 'axios'

const SLACK_TIMEOUT_MS = 5000

// PostgreSQL の SQLSTATE コード（例: 23505, 42P01）
const PG_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/

export const SHIFT_GENERATION_ERROR_TYPES = {
  OPENAI: 'OpenAI API エラー',
  DATABASE: 'DB エラー',
  UNEXPECTED: '予期しない例外'
}

/**
 * シフト生成時のエラーを通知用に分類する
 *
 * - ShiftGenerationService が throw するオブジェクト（success: false, phase 付き）は
 *   phase === 'ai_generation' のとき OpenAI API エラーとみなす
 * - SQLSTATE コード（error.code）または severity（node-postgres）を持つものは DB エラー
 * - それ以外は予期しない例外
 *
 * @param {Object} error - catch したエラー
 * @returns {string} - SHIFT_GENERATION_ERROR_TYPES のいずれか
 */
export function classifyShiftGenerationError(error) {
  if (!error) {
    return SHIFT_GENERATION_ERROR_TYPES.UNEXPECTED
  }

  if (error.success === false) {
    return error.phase === 'ai_generation'
      ? SHIFT_GENERATION_ERROR_TYPES.OPENAI
      : SHIFT_GENERATION_ERROR_TYPES.UNEXPECTED
  }

  if (
    (typeof error.code === 'string' && PG_SQLSTATE_PATTERN.test(error.code)) ||
    error.severity !== undefined
  ) {
    return SHIFT_GENERATION_ERROR_TYPES.DATABASE
  }

  return SHIFT_GENERATION_ERROR_TYPES.UNEXPECTED
}

/**
 * シフト生成 API のエラーを Slack webhook に通知する
 *
 * - SLACK_WEBHOOK_URL 未設定の場合は通知をスキップする（サーバーはエラーにしない）
 * - 通知の失敗は内部でログに残すのみで、この関数は決して throw しない
 *
 * @param {string} endpoint - エラーが発生したエンドポイント（例: 'POST /api/shifts/plans/generate-ai'）
 * @param {Object} error - catch したエラー
 * @param {Object} [params] - リクエストパラメータ（tenant_id / store_id / year / month）
 * @returns {Promise<boolean>} - 通知を送信できた場合 true
 */
export async function notifyShiftGenerationError(endpoint, error, params = {}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL

  if (!webhookUrl) {
    console.log('[SlackNotifier] SLACK_WEBHOOK_URL 未設定のため通知をスキップします')
    return false
  }

  const { tenant_id, store_id, year, month } = params
  const errorType = classifyShiftGenerationError(error)
  const errorMessage = (error && (error.error || error.message)) || String(error)
  const logUrl = process.env.RAILWAY_LOG_URL

  const lines = [
    ':rotating_light: *シフト生成 API エラー*',
    `*エラー種別*: ${errorType}`,
    `*エンドポイント*: ${endpoint}`,
    `*対象*: tenant_id=${tenant_id ?? '不明'} / store_id=${store_id ?? '不明'} / ${year ?? '?'}年${month ?? '?'}月`,
    error?.phase ? `*フェーズ*: ${error.phase}` : null,
    `*エラーメッセージ*: ${errorMessage}`,
    logUrl ? `*Railway ログ*: ${logUrl}` : '*Railway ログ*: RAILWAY_LOG_URL 未設定'
  ].filter(Boolean)

  try {
    await axios.post(webhookUrl, { text: lines.join('\n') }, { timeout: SLACK_TIMEOUT_MS })
    return true
  } catch (notifyError) {
    console.error('[SlackNotifier] Slack通知の送信に失敗しました:', notifyError.message)
    return false
  }
}

/**
 * バックエンド全般の 5xx エラーを Slack webhook に通知する（汎用）
 *
 * - webhook URL は SLACK_ERROR_WEBHOOK_URL を優先し、無ければ SLACK_WEBHOOK_URL にフォールバック
 * - 両方未設定の場合は通知をスキップする（サーバーはエラーにしない）
 * - リクエストボディ・トークン・PII は載せない。スタックは先頭3行のみ
 * - 通知の失敗は内部でログに残すのみで、この関数は決して throw しない
 *
 * @param {Object} params
 * @param {string} params.endpoint - 例: 'GET /api/foo/:id'
 * @param {number} params.statusCode - HTTP ステータスコード
 * @param {string} params.message - エラーメッセージ
 * @param {string} [params.stack] - エラースタック（先頭3行のみ通知に載せる）
 * @param {string} [params.timestamp] - ISO 形式の時刻文字列
 * @returns {Promise<boolean>} - 通知を送信できた場合 true
 */
export async function notifyServerError({ endpoint, statusCode, message, stack, timestamp } = {}) {
  const webhookUrl = process.env.SLACK_ERROR_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL

  if (!webhookUrl) {
    console.log('[SlackNotifier] SLACK_ERROR_WEBHOOK_URL / SLACK_WEBHOOK_URL 未設定のため通知をスキップします')
    return false
  }

  const ts = timestamp || new Date().toISOString()
  const stackHead = typeof stack === 'string' && stack.length > 0
    ? stack.split('\n').slice(0, 3).join('\n')
    : null

  const lines = [
    ':rotating_light: *バックエンド 5xx エラー*',
    `*エンドポイント*: ${endpoint ?? '不明'}`,
    `*ステータス*: ${statusCode ?? '不明'}`,
    `*時刻*: ${ts}`,
    `*エラーメッセージ*: ${message ?? '(なし)'}`,
    stackHead ? `*スタック(先頭3行)*:\n\`\`\`\n${stackHead}\n\`\`\`` : null
  ].filter(Boolean)

  try {
    await axios.post(webhookUrl, { text: lines.join('\n') }, { timeout: SLACK_TIMEOUT_MS })
    return true
  } catch (notifyError) {
    console.error('[SlackNotifier] サーバーエラー通知の送信に失敗しました:', notifyError.message)
    return false
  }
}
