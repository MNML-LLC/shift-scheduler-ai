import { query } from '../config/database.js'
import { appendLog } from '../utils/logger.js'

const CONSTRAINT_NAME = 'unique_plan_per_store_month_type'

/**
 * ops.shift_plans に unique_plan_per_store_month_type 制約を冪等に補完する。
 * 本番DBへのスキーマ適用漏れ（ドリフト）を起動時に自動復旧するためのワークアラウンド。
 * 重複行が存在する場合や実行時エラーはログのみ出力し、サーバー起動は継続する。
 */
export async function ensureShiftPlansUniqueConstraint() {
  try {
    const existing = await query('SELECT 1 FROM pg_constraint WHERE conname = $1', [
      CONSTRAINT_NAME,
    ])

    if (existing.rows.length > 0) {
      appendLog(`✅ [migration] constraint "${CONSTRAINT_NAME}" already exists (skip)`)
      return
    }

    const duplicates = await query(`
      SELECT tenant_id, store_id, plan_year, plan_month, plan_type, COUNT(*) AS cnt
      FROM ops.shift_plans
      GROUP BY tenant_id, store_id, plan_year, plan_month, plan_type
      HAVING COUNT(*) > 1
    `)

    if (duplicates.rows.length > 0) {
      appendLog(
        `❌ [migration] cannot add constraint "${CONSTRAINT_NAME}": ${duplicates.rows.length} duplicate group(s) found in ops.shift_plans. Constraint NOT added; resolve duplicates manually.`
      )
      return
    }

    await query(`
      ALTER TABLE ops.shift_plans
      ADD CONSTRAINT ${CONSTRAINT_NAME}
      UNIQUE (tenant_id, store_id, plan_year, plan_month, plan_type)
    `)

    appendLog(`✅ [migration] constraint "${CONSTRAINT_NAME}" added successfully`)
  } catch (error) {
    console.error(`❌ [migration] Failed to ensure constraint "${CONSTRAINT_NAME}":`, error)
    appendLog(
      `❌ [migration] Failed to ensure constraint "${CONSTRAINT_NAME}": ${error.message}`
    )
  }
}
