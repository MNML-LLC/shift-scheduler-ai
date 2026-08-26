import crypto from 'crypto'
import ShiftPlanRepository from '../../repositories/shift/ShiftPlanRepository.js'
import StoreRepository from '../../repositories/StoreRepository.js'
import NotificationService from './NotificationService.js'
import { GENERATION_TYPE } from '../../config/constants.js'
import { getLastDayOfMonth } from '../../utils/monthUtils.js'

/**
 * 月次第1案バッチ（空プランを一括作成 + 承認 + LINE 通知）を集約するサービス。
 *
 * GitHub Actions から x-batch-api-key ヘッダーで叩かれる想定。
 * 実際の認証チェックはルート層で行い、本サービスは業務ロジックのみに責務を絞る。
 */

export class ValidationError extends Error {}

/**
 * リクエストヘッダーの API キー検証（timing-safe 比較）
 */
export function verifyBatchApiKey(providedKey) {
  const expected = process.env.BATCH_API_KEY || ''
  const provided = providedKey || ''
  if (!expected) return false

  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)
  return providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf)
}

/**
 * target_year / target_month の妥当性チェック
 */
export function validateTarget({ targetYear, targetMonth, currentYear }) {
  if (
    !Number.isInteger(targetYear) ||
    !Number.isInteger(targetMonth) ||
    targetYear < currentYear - 1 ||
    targetYear > currentYear + 5 ||
    targetMonth < 1 ||
    targetMonth > 12
  ) {
    throw new ValidationError('target_year, target_month (1-12) は必須です')
  }
}

/**
 * 全アクティブテナント × 全アクティブ店舗に FIRST 空プランを upsert し、
 * 新規挿入行のみ LINE 通知する。
 */
export async function runMonthlyFirstPlanBatch({ targetYear, targetMonth }) {
  const stores = await StoreRepository.findActiveStoresForBatch()

  const monthStr = String(targetMonth).padStart(2, '0')
  const periodStart = `${targetYear}-${monthStr}-01`
  const periodEnd = `${targetYear}-${monthStr}-${String(getLastDayOfMonth(targetYear, targetMonth)).padStart(2, '0')}`
  const planName = `${targetYear}年${targetMonth}月シフト（第1案）`

  const created = []
  const skippedAlready = []
  const failed = []
  const failedNotification = []

  const shouldNotify = NotificationService.isEnabled() && !!process.env.LIFF_BACKEND_URL

  for (const { tenant_id, store_id } of stores) {
    try {
      const planCode = `FIRST-${targetYear}${monthStr}-${store_id}`
      const { plan_id, inserted } = await ShiftPlanRepository.upsertEmptyFirstPlan({
        tenantId: tenant_id,
        storeId: store_id,
        year: targetYear,
        month: targetMonth,
        planCode,
        planName,
        periodStart,
        periodEnd,
        generationType: GENERATION_TYPE.BATCH,
      })

      if (!inserted) {
        skippedAlready.push({ tenant_id, store_id })
        continue
      }

      created.push({ tenant_id, store_id, plan_id })

      if (shouldNotify) {
        try {
          await NotificationService.notifyFirstPlanApproved({
            tenant_id,
            store_id,
            plan_id,
            year: targetYear,
            month: targetMonth,
          })
        } catch (notifyErr) {
          console.error(`Failed to send LINE notification (tenant=${tenant_id}, store=${store_id}):`, notifyErr.message)
          failedNotification.push({ tenant_id, store_id, error: notifyErr.message })
        }
      }
    } catch (storeErr) {
      console.error(`Error in monthly first plan batch (tenant=${tenant_id}, store=${store_id}):`, storeErr)
      failed.push({ tenant_id, store_id, error: storeErr.message })
    }
  }

  return { created, skippedAlready, failed, failedNotification }
}

export default {
  ValidationError,
  verifyBatchApiKey,
  validateTarget,
  runMonthlyFirstPlanBatch,
}
