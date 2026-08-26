import { query as poolQuery } from '../../config/database.js'

/**
 * ops.shifts に対する共通 SQL を集約するリポジトリ。
 *
 * 各関数は第一引数で「executor」オブジェクト（`{ query }` を持つもの）を受け取れる。
 * トランザクション内では transaction コールバックの client を渡し、
 * 通常呼び出しでは省略（＝プール経由の query が使われる）。
 */

const defaultExecutor = { query: poolQuery }

function pickExecutor(executor) {
  return executor && typeof executor.query === 'function' ? executor : defaultExecutor
}

/**
 * plan_id に紐づくシフトを全件削除
 */
export async function deleteByPlanId(planId, executor) {
  const ex = pickExecutor(executor)
  await ex.query('DELETE FROM ops.shifts WHERE plan_id = $1', [planId])
}

/**
 * plan_id + tenant_id でシフトを全件削除し、削除された shift_id を返す
 */
export async function deleteByPlanIdAndTenant(planId, tenantId, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `DELETE FROM ops.shifts WHERE plan_id = $1 AND tenant_id = $2 RETURNING shift_id`,
    [planId, tenantId]
  )
  return result.rows
}

/**
 * 複数プラン ID に紐づくシフトを一括削除
 */
export async function deleteByPlanIds(planIds, tenantId, executor) {
  const ex = pickExecutor(executor)
  await ex.query(
    `DELETE FROM ops.shifts WHERE plan_id = ANY($1::int[]) AND tenant_id = $2`,
    [planIds, tenantId]
  )
}

/**
 * plan_id 配下のシフト集計値を返す（shift_count / total_hours / total_cost）
 */
export async function sumByPlanId(planId, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT
       COUNT(*) as shift_count,
       SUM(total_hours) as total_hours,
       SUM(labor_cost) as total_cost
     FROM ops.shifts
     WHERE plan_id = $1`,
    [planId]
  )
  return result.rows[0]
}

/**
 * plan_id に紐づくシフトを全件取得
 */
export async function findByPlanId(planId, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT *
     FROM ops.shifts
     WHERE plan_id = $1
     ORDER BY shift_date, start_time`,
    [planId]
  )
  return result.rows
}

/**
 * 単一シフトを INSERT（AI 生成用の最小フィールド版）
 */
export async function insertAiGeneratedShift(shiftData, executor) {
  const ex = pickExecutor(executor)
  const {
    tenantId, storeId, planId, staffId, shiftDate, patternId,
    startTime, endTime, breakMinutes,
  } = shiftData
  await ex.query(
    `INSERT INTO ops.shifts (
       tenant_id, store_id, plan_id, staff_id, shift_date, pattern_id,
       start_time, end_time, break_minutes, total_hours, labor_cost,
       is_preferred, is_modified, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, false, 'AI自動生成')`,
    [
      tenantId, storeId, planId, staffId, shiftDate, patternId,
      startTime, endTime, breakMinutes,
      null, null,
    ]
  )
}

/**
 * シフトの bulk INSERT
 * shifts の各要素は { tenant_id, store_id, plan_id, staff_id, shift_date, pattern_id,
 *                   start_time, end_time, break_minutes } を持つ
 */
export async function insertBulk(shifts, executor) {
  if (!shifts || shifts.length === 0) return
  const ex = pickExecutor(executor)
  const values = shifts.map((_, idx) => {
    const base = idx * 9
    return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9})`
  }).join(',')
  const params = shifts.flatMap(s => [
    s.tenant_id, s.store_id, s.plan_id, s.staff_id, s.shift_date,
    s.pattern_id, s.start_time, s.end_time, s.break_minutes,
  ])
  await ex.query(
    `INSERT INTO ops.shifts (
       tenant_id, store_id, plan_id, staff_id, shift_date,
       pattern_id, start_time, end_time, break_minutes
     ) VALUES ${values}`,
    params
  )
}

export default {
  deleteByPlanId,
  deleteByPlanIdAndTenant,
  deleteByPlanIds,
  sumByPlanId,
  findByPlanId,
  insertAiGeneratedShift,
  insertBulk,
}
