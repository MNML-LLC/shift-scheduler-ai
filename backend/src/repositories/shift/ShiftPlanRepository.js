import { query as poolQuery } from '../../config/database.js'

/**
 * ops.shift_plans に対する共通 SQL を集約するリポジトリ。
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
 * plan_id に対する status を返す（存在しなければ null）
 */
export async function getStatusById(planId, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    'SELECT status FROM ops.shift_plans WHERE plan_id = $1',
    [planId]
  )
  if (result.rows.length === 0) return null
  return result.rows[0].status
}

/**
 * (tenant_id, store_id, year, month) でプラン検索（排他ロック付き）
 */
export async function findByStoreMonthForUpdate(
  { tenantId, storeId, year, month },
  executor
) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT plan_id, status FROM ops.shift_plans
     WHERE tenant_id = $1 AND store_id = $2 AND plan_year = $3 AND plan_month = $4
     FOR UPDATE`,
    [tenantId, storeId, year, month]
  )
  return result.rows
}

/**
 * (tenant_id, store_id, year, month, planType) でプラン検索
 */
export async function findByStoreMonthAndType(
  { tenantId, storeId, year, month, planType },
  executor
) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT plan_id, status, plan_type FROM ops.shift_plans
     WHERE tenant_id = $1 AND store_id = $2
       AND plan_year = $3 AND plan_month = $4
       AND plan_type = $5`,
    [tenantId, storeId, year, month, planType]
  )
  return result.rows
}

/**
 * plan_id + tenant_id でプラン取得
 */
export async function findByIdAndTenant(planId, tenantId, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT plan_id, status, plan_year, plan_month, store_id
     FROM ops.shift_plans
     WHERE plan_id = $1 AND tenant_id = $2`,
    [planId, tenantId]
  )
  if (result.rows.length === 0) return null
  return result.rows[0]
}

/**
 * plan_id + tenant_id でプラン削除
 */
export async function deleteByIdAndTenant(planId, tenantId, executor) {
  const ex = pickExecutor(executor)
  await ex.query(
    `DELETE FROM ops.shift_plans WHERE plan_id = $1 AND tenant_id = $2`,
    [planId, tenantId]
  )
}

/**
 * FIRST 案の複数プラン削除（copy-from-previous 用）
 */
export async function deleteByPlanIds(planIds, tenantId, executor) {
  const ex = pickExecutor(executor)
  await ex.query(
    `DELETE FROM ops.shift_plans WHERE plan_id = ANY($1::int[]) AND tenant_id = $2`,
    [planIds, tenantId]
  )
}

/**
 * プランの集計値（total_labor_hours / total_labor_cost / constraint_violations）を更新
 */
export async function updateAggregates(
  planId,
  { totalLaborHours, totalLaborCost, constraintViolations = null },
  executor
) {
  const ex = pickExecutor(executor)
  if (constraintViolations != null) {
    await ex.query(
      `UPDATE ops.shift_plans
       SET total_labor_hours = $1, total_labor_cost = $2, constraint_violations = $3
       WHERE plan_id = $4`,
      [totalLaborHours, totalLaborCost, constraintViolations, planId]
    )
  } else {
    await ex.query(
      `UPDATE ops.shift_plans
       SET total_labor_hours = $1, total_labor_cost = $2
       WHERE plan_id = $3`,
      [totalLaborHours, totalLaborCost, planId]
    )
  }
}

/**
 * 新規プランを INSERT して plan_id を返す
 */
export async function insertPlan(planData, executor) {
  const ex = pickExecutor(executor)
  const {
    tenantId, storeId, year, month,
    planCode, planName, periodStart, periodEnd,
    planType = null, status = 'DRAFT',
    generationType, aiModelVersion = null, createdBy = null,
  } = planData

  if (planType) {
    const result = await ex.query(
      `INSERT INTO ops.shift_plans (
         tenant_id, store_id, plan_year, plan_month,
         plan_code, plan_name, period_start, period_end,
         plan_type, status, generation_type, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING plan_id, store_id, plan_year, plan_month, plan_type, status`,
      [
        tenantId, storeId, year, month,
        planCode, planName, periodStart, periodEnd,
        planType, status, generationType, createdBy,
      ]
    )
    return result.rows[0]
  }

  const result = await ex.query(
    `INSERT INTO ops.shift_plans (
       tenant_id, store_id, plan_year, plan_month,
       plan_code, plan_name, period_start, period_end,
       status, generation_type, ai_model_version, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING plan_id`,
    [
      tenantId, storeId, year, month,
      planCode, planName, periodStart, periodEnd,
      status, generationType, aiModelVersion, createdBy,
    ]
  )
  return result.rows[0]
}

export default {
  getStatusById,
  findByStoreMonthForUpdate,
  findByStoreMonthAndType,
  findByIdAndTenant,
  deleteByIdAndTenant,
  deleteByPlanIds,
  updateAggregates,
  insertPlan,
}
