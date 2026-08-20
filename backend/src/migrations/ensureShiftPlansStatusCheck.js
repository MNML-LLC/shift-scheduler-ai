import { query } from '../config/database.js'
import { appendLog } from '../utils/logger.js'

const CONSTRAINT_NAME = 'shift_plans_status_check'
const REQUIRED_VALUES = ['DRAFT', 'APPROVED', 'CONFIRMED']

/**
 * ops.shift_plans.status の CHECK 制約に 'CONFIRMED' を含めた形で冪等に補完する。
 * 旧環境では CHECK (status IN ('DRAFT', 'APPROVED')) のままドリフトしており、
 * PUT /api/shifts/plans/:id/status で CONFIRMED を書き込むと 500 になる（Issue #278）。
 * 手動マイグレーション（scripts/migrations/add_shift_plan_confirmed_status.mjs）を
 * 起動時に自動実行する形に再実装し、staging / production の再デプロイで自然に復旧させる。
 *
 * すでに CONFIRMED を含む場合はスキップ。実行時エラーはログのみで、サーバー起動は継続する。
 */
export async function ensureShiftPlansStatusCheck() {
  try {
    const current = await query(
      `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       JOIN pg_namespace n ON t.relnamespace = n.oid
       WHERE n.nspname = 'ops'
         AND t.relname = 'shift_plans'
         AND c.conname = $1`,
      [CONSTRAINT_NAME]
    )

    const definition = current.rows[0]?.definition || null

    if (definition && REQUIRED_VALUES.every((v) => definition.includes(`'${v}'`))) {
      appendLog(`✅ [migration] constraint "${CONSTRAINT_NAME}" already includes CONFIRMED (skip)`)
      return
    }

    await query(`ALTER TABLE ops.shift_plans DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`)
    await query(
      `ALTER TABLE ops.shift_plans
       ADD CONSTRAINT ${CONSTRAINT_NAME}
       CHECK (status IN ('DRAFT', 'APPROVED', 'CONFIRMED'))`
    )

    appendLog(`✅ [migration] constraint "${CONSTRAINT_NAME}" updated to include CONFIRMED`)
  } catch (error) {
    console.error(`❌ [migration] Failed to ensure constraint "${CONSTRAINT_NAME}":`, error)
    appendLog(
      `❌ [migration] Failed to ensure constraint "${CONSTRAINT_NAME}": ${error.message}`
    )
  }
}
