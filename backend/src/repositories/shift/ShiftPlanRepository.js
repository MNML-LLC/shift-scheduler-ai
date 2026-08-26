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

/**
 * 一覧取得（フィルタ付き）
 */
export async function findList({ tenantId, storeId, year, month, status }) {
  let sql = `
    SELECT
      sp.plan_id,
      sp.tenant_id,
      sp.store_id,
      s.store_name,
      sp.plan_year,
      sp.plan_month,
      sp.plan_code,
      sp.plan_name,
      sp.period_start,
      sp.period_end,
      sp.status,
      sp.plan_type,
      sp.generation_type,
      sp.ai_model_version,
      sp.total_labor_hours,
      sp.total_labor_cost,
      sp.coverage_score,
      sp.constraint_violations,
      sp.created_by,
      sp.approved_by,
      sp.approved_at,
      sp.created_at,
      sp.updated_at,
      (SELECT COUNT(*) FROM ops.shifts WHERE plan_id = sp.plan_id) as shift_count,
      (SELECT COUNT(DISTINCT staff_id) FROM ops.shifts WHERE plan_id = sp.plan_id) as staff_count
    FROM ops.shift_plans sp
    LEFT JOIN core.stores s ON sp.store_id = s.store_id
    WHERE sp.tenant_id = $1
  `
  const params = [tenantId]
  let idx = 2

  if (storeId) {
    sql += ` AND sp.store_id = $${idx++}`
    params.push(storeId)
  }
  if (year) {
    sql += ` AND sp.plan_year = $${idx++}`
    params.push(year)
  }
  if (month) {
    sql += ` AND sp.plan_month = $${idx++}`
    params.push(month)
  }
  if (status) {
    sql += ` AND sp.status = $${idx}`
    params.push(status)
  }

  sql += ` ORDER BY sp.plan_year DESC, sp.plan_month DESC, sp.created_at DESC`

  const result = await poolQuery(sql, params)
  return result.rows
}

/**
 * 月別サマリー（plan_id 単位）
 */
export async function findSummary({ tenantId, year, storeId, month, planType }) {
  let sql = `
    SELECT
      sp.plan_year as year,
      sp.plan_month as month,
      sp.plan_type,
      LOWER(sp.status) as status,
      sp.plan_id,
      sp.store_id,
      st.store_name,
      COUNT(sh.shift_id)::int as shift_count,
      COUNT(DISTINCT sh.staff_id)::int as staff_count,
      ROUND(SUM(COALESCE(sh.total_hours, 0))::numeric, 2) as total_hours,
      ROUND(SUM(COALESCE(sh.labor_cost, 0))::numeric, 2) as total_labor_cost,
      ROUND(AVG(NULLIF(sh.total_hours, NULL))::numeric, 2) as avg_hours_per_shift,
      COUNT(CASE WHEN sh.is_modified = true THEN 1 END)::int as modified_count
    FROM ops.shift_plans sp
    LEFT JOIN ops.shifts sh ON sp.plan_id = sh.plan_id AND sp.tenant_id = sh.tenant_id
    LEFT JOIN core.stores st ON sp.store_id = st.store_id
    WHERE sp.tenant_id = $1
      AND sp.plan_year = $2
  `
  const params = [tenantId, year]
  let idx = 3

  if (storeId) {
    sql += ` AND sp.store_id = $${idx++}`
    params.push(storeId)
  }
  if (month) {
    sql += ` AND sp.plan_month = $${idx++}`
    params.push(month)
  }
  if (planType) {
    sql += ` AND sp.plan_type = $${idx}`
    params.push(planType)
  }

  sql += ` GROUP BY sp.plan_year, sp.plan_month, sp.plan_type, sp.status, sp.plan_id, sp.store_id, st.store_name`
  sql += ` ORDER BY year DESC, month DESC, sp.store_id`

  const result = await poolQuery(sql, params)
  return result.rows
}

/**
 * 詳細取得（承認者・作成者名 + シフト集計）
 */
export async function findDetailById({ planId, tenantId }) {
  const result = await poolQuery(
    `SELECT
       sp.*,
       s.store_name,
       s.store_code,
       creator.name as creator_name,
       approver.name as approver_name,
       (SELECT COUNT(*) FROM ops.shifts WHERE plan_id = sp.plan_id) as shift_count,
       (SELECT COUNT(DISTINCT staff_id) FROM ops.shifts WHERE plan_id = sp.plan_id) as staff_count,
       (SELECT SUM(total_hours) FROM ops.shifts WHERE plan_id = sp.plan_id) as actual_total_hours,
       (SELECT SUM(labor_cost) FROM ops.shifts WHERE plan_id = sp.plan_id) as actual_total_cost
     FROM ops.shift_plans sp
     LEFT JOIN core.stores s ON sp.store_id = s.store_id
     LEFT JOIN hr.staff creator ON sp.created_by = creator.staff_id
     LEFT JOIN hr.staff approver ON sp.approved_by = approver.staff_id
     WHERE sp.plan_id = $1 AND sp.tenant_id = $2`,
    [planId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * 詳細取得（承認者名なし・作成者名 + 集計）
 */
export async function findDetailWithCreator({ planId }, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT
       sp.*,
       s.store_name,
       s.store_code,
       creator.name as creator_name,
       (SELECT COUNT(*) FROM ops.shifts WHERE plan_id = sp.plan_id) as shift_count,
       (SELECT COUNT(DISTINCT staff_id) FROM ops.shifts WHERE plan_id = sp.plan_id) as staff_count
     FROM ops.shift_plans sp
     LEFT JOIN core.stores s ON sp.store_id = s.store_id
     LEFT JOIN hr.staff creator ON sp.created_by = creator.staff_id
     WHERE sp.plan_id = $1`,
    [planId]
  )
  return result.rows[0] || null
}

/**
 * plan_id + tenant_id の存在確認（通知用に store/plan_year/plan_month/status を返す）
 */
export async function findApprovalTargetById(planId, tenantId) {
  const result = await poolQuery(
    `SELECT plan_id, tenant_id, store_id, plan_year, plan_month, plan_type, status
     FROM ops.shift_plans
     WHERE plan_id = $1 AND tenant_id = $2`,
    [planId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * plan_id からステータス変更対象の詳細を取得（tenant フィルタなし）
 */
export async function findStatusChangeTargetById(planId) {
  const result = await poolQuery(
    `SELECT plan_id, tenant_id, store_id, plan_year, plan_month, plan_type, status
     FROM ops.shift_plans
     WHERE plan_id = $1`,
    [planId]
  )
  return result.rows[0] || null
}

/**
 * ステータスを更新する（updated_at も CURRENT_TIMESTAMP）
 */
export async function updateStatus(planId, status) {
  await poolQuery(
    `UPDATE ops.shift_plans
     SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE plan_id = $2`,
    [status, planId]
  )
}

/**
 * approved_by（NULL 許可）付きで CONFIRMED に更新する
 */
export async function updateStatusWithApprover(planId, status, approvedBy) {
  await poolQuery(
    `UPDATE ops.shift_plans
     SET status = $1,
         approved_by = COALESCE($2, approved_by),
         updated_at = CURRENT_TIMESTAMP
     WHERE plan_id = $3`,
    [status, approvedBy, planId]
  )
}

/**
 * (tenant, store, year, month, planType) で FIRST/SECOND 案を検索（tx 内でも使う）
 */
export async function findByStoreMonthTypeWithClient({ tenantId, storeId, year, month, planType }, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT plan_id FROM ops.shift_plans
     WHERE tenant_id = $1 AND store_id = $2
       AND plan_year = $3 AND plan_month = $4
       AND plan_type = $5`,
    [tenantId, storeId, year, month, planType]
  )
  return result.rows
}

/**
 * ステータス=APPROVED/CONFIRMED の店舗を検索（一括生成のスキップ判定用）
 */
export async function findExistingApprovedStoreIds({ tenantId, year, month, storeIds }) {
  const result = await poolQuery(
    `SELECT DISTINCT store_id FROM ops.shift_plans
     WHERE tenant_id = $1 AND plan_year = $2 AND plan_month = $3
       AND status IN ('APPROVED', 'CONFIRMED')
       AND store_id = ANY($4::int[])`,
    [tenantId, year, month, storeIds]
  )
  return result.rows.map((r) => Number(r.store_id))
}

/**
 * 月次一括バッチ用の空プラン upsert
 * 一意制約 (tenant, store, year, month, plan_type) を利用し
 * ON CONFLICT DO UPDATE SET plan_id = shift_plans.plan_id で新規判定できる
 */
export async function upsertEmptyFirstPlan({
  tenantId, storeId, year, month,
  planCode, planName, periodStart, periodEnd, generationType,
}) {
  const result = await poolQuery(
    `INSERT INTO ops.shift_plans (
       tenant_id, store_id, plan_year, plan_month, plan_type, status,
       plan_code, plan_name, period_start, period_end, generation_type,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, 'FIRST', 'APPROVED',
       $5, $6, $7, $8, $9,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )
     ON CONFLICT (tenant_id, store_id, plan_year, plan_month, plan_type)
     DO UPDATE SET plan_id = shift_plans.plan_id
     RETURNING plan_id, (xmax = 0) AS inserted`,
    [tenantId, storeId, year, month, planCode, planName, periodStart, periodEnd, generationType]
  )
  return result.rows[0]
}

/**
 * 前月 SECOND 案のみをシンプルに検索（copy-from-previous 用）
 */
export async function findLatestSecondPlan({ tenantId, storeId, year, month }, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT plan_id
     FROM ops.shift_plans
     WHERE tenant_id = $1 AND store_id = $2
       AND plan_year = $3 AND plan_month = $4
       AND plan_type = 'SECOND'
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, storeId, year, month]
  )
  return result.rows[0] || null
}

/**
 * copy-from-previous 用の FIRST 案 upsert（新規作成のみ、削除は別関数）
 */
export async function insertCopiedFirstPlan({
  tenantId, storeId, year, month, planCode, planName, periodStart, periodEnd, createdBy,
}, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `INSERT INTO ops.shift_plans (
       tenant_id, store_id, plan_year, plan_month,
       plan_code, plan_name, period_start, period_end,
       status, plan_type, generation_type, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', 'FIRST', 'COPIED_FROM_PREVIOUS', $9)
     RETURNING plan_id`,
    [tenantId, storeId, year, month, planCode, planName, periodStart, periodEnd, createdBy]
  )
  return result.rows[0].plan_id
}

/**
 * store 移動時に対象店舗の同月同 plan_type プランを作成する
 */
export async function insertStoreTransferPlan({
  tenantId, storeId, year, month, planCode, planName, periodStart, periodEnd,
  planType, status,
}) {
  const result = await poolQuery(
    `INSERT INTO ops.shift_plans (
       tenant_id, store_id, plan_year, plan_month,
       plan_code, plan_name, period_start, period_end,
       plan_type, status, generation_type
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'STORE_TRANSFER')
     RETURNING plan_id`,
    [tenantId, storeId, year, month, planCode, planName, periodStart, periodEnd, planType, status]
  )
  return result.rows[0].plan_id
}

/**
 * (tenant, store, year, month, planType) で plan_id を取得（DELETE 前判定など）
 */
export async function findPlanIdByStoreMonthType({ tenantId, storeId, year, month, planType }) {
  const result = await poolQuery(
    `SELECT plan_id FROM ops.shift_plans
     WHERE tenant_id = $1 AND store_id = $2
       AND plan_year = $3 AND plan_month = $4 AND plan_type = $5`,
    [tenantId, storeId, year, month, planType]
  )
  return result.rows[0] || null
}

/**
 * 既存プランの (plan_year, plan_month, plan_type, status) を取得
 */
export async function findMetaById(planId) {
  const result = await poolQuery(
    'SELECT plan_year, plan_month, plan_type, status FROM ops.shift_plans WHERE plan_id = $1',
    [planId]
  )
  return result.rows[0] || null
}

/**
 * approve-second 用: 既存の SECOND 案 plan_id を取得
 */
export async function findSecondPlanId({ tenantId, storeId, year, month }) {
  const result = await poolQuery(
    `SELECT plan_id FROM ops.shift_plans
     WHERE tenant_id = $1 AND store_id = $2
       AND plan_year = $3 AND plan_month = $4
       AND plan_type = 'SECOND'`,
    [tenantId, storeId, year, month]
  )
  return result.rows[0] || null
}

/**
 * approve-second 用: 既存 SECOND 案を DRAFT に戻す
 */
export async function resetSecondPlanToDraft(planId) {
  await poolQuery(
    `UPDATE ops.shift_plans
     SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP
     WHERE plan_id = $1`,
    [planId]
  )
}

/**
 * approve-second 用: 新規 SECOND プランを作成
 */
export async function insertSecondPlan({ tenantId, storeId, year, month, createdBy }) {
  const result = await poolQuery(
    `INSERT INTO ops.shift_plans (
       tenant_id, store_id, plan_year, plan_month,
       plan_type, status, created_by
     ) VALUES ($1, $2, $3, $4, 'SECOND', 'DRAFT', $5)
     RETURNING plan_id`,
    [tenantId, storeId, year, month, createdBy]
  )
  return result.rows[0].plan_id
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
  findList,
  findSummary,
  findDetailById,
  findDetailWithCreator,
  findApprovalTargetById,
  findStatusChangeTargetById,
  updateStatus,
  updateStatusWithApprover,
  findByStoreMonthTypeWithClient,
  findExistingApprovedStoreIds,
  upsertEmptyFirstPlan,
  findLatestSecondPlan,
  insertCopiedFirstPlan,
  insertStoreTransferPlan,
  findPlanIdByStoreMonthType,
  findMetaById,
  findSecondPlanId,
  resetSecondPlanToDraft,
  insertSecondPlan,
}
