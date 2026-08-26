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

const SHIFT_DETAIL_JOIN = `
  FROM ops.shifts sh
  LEFT JOIN ops.shift_plans sp ON sh.plan_id = sp.plan_id
  LEFT JOIN core.stores st ON sh.store_id = st.store_id
  LEFT JOIN hr.staff staff ON sh.staff_id = staff.staff_id
  LEFT JOIN core.roles r ON staff.role_id = r.role_id
  LEFT JOIN core.shift_patterns pat ON sh.pattern_id = pat.pattern_id
`

const SHIFT_DETAIL_SELECT = `
  SELECT
    sh.*,
    st.store_name,
    st.store_code,
    sp.plan_name,
    sp.status as plan_status,
    staff.name as staff_name,
    staff.staff_code,
    staff.email as staff_email,
    r.role_name,
    pat.pattern_name,
    pat.pattern_code
  ${SHIFT_DETAIL_JOIN}
`

const SHIFT_LIST_SELECT = `
  SELECT
    sh.shift_id,
    sh.tenant_id,
    sh.store_id,
    st.store_name,
    sh.plan_id,
    sp.plan_name,
    sp.plan_type,
    sp.status as plan_status,
    sh.staff_id,
    staff.name as staff_name,
    staff.staff_code,
    r.role_name,
    TO_CHAR(sh.shift_date, 'YYYY-MM-DD') as shift_date,
    sh.pattern_id,
    pat.pattern_name,
    pat.pattern_code,
    sh.start_time,
    sh.end_time,
    sh.break_minutes,
    sh.total_hours,
    sh.labor_cost,
    sh.assigned_skills,
    sh.is_preferred,
    sh.is_modified,
    sh.notes,
    sh.created_at,
    sh.updated_at,
    EXTRACT(DOW FROM sh.shift_date) as day_of_week
  ${SHIFT_DETAIL_JOIN}
`

/**
 * シフト一覧（絞り込み）
 */
export async function searchShifts({
  tenantId, planId, storeId, staffId, year, month,
  dateFrom, dateTo, isModified, planType,
}) {
  let sql = `${SHIFT_LIST_SELECT} WHERE sh.tenant_id = $1`
  const params = [tenantId]
  let idx = 2

  if (planId) {
    sql += ` AND sh.plan_id = $${idx++}`
    params.push(planId)
  }
  if (storeId) {
    sql += ` AND sh.store_id = $${idx++}`
    params.push(storeId)
  }
  if (staffId) {
    sql += ` AND sh.staff_id = $${idx++}`
    params.push(staffId)
  }
  if (year && month) {
    sql += ` AND EXTRACT(YEAR FROM sh.shift_date) = $${idx++}`
    params.push(year)
    sql += ` AND EXTRACT(MONTH FROM sh.shift_date) = $${idx++}`
    params.push(month)
  } else if (year) {
    sql += ` AND EXTRACT(YEAR FROM sh.shift_date) = $${idx++}`
    params.push(year)
  }
  if (dateFrom) {
    sql += ` AND sh.shift_date >= $${idx++}`
    params.push(dateFrom)
  }
  if (dateTo) {
    sql += ` AND sh.shift_date <= $${idx++}`
    params.push(dateTo)
  }
  if (isModified !== undefined) {
    sql += ` AND sh.is_modified = $${idx++}`
    params.push(isModified === 'true' || isModified === true)
  }
  if (planType) {
    sql += ` AND sp.plan_type = $${idx}`
    params.push(planType)
  }

  sql += ` ORDER BY sh.shift_date, sh.start_time, staff.name`

  const result = await poolQuery(sql, params)
  return result.rows
}

/**
 * ID + tenant で詳細取得
 */
export async function findShiftById({ shiftId, tenantId }) {
  const result = await poolQuery(
    `${SHIFT_DETAIL_SELECT} WHERE sh.shift_id = $1 AND sh.tenant_id = $2`,
    [shiftId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * ID で詳細取得（tenant 条件なし・挿入直後の再取得用）
 */
export async function findShiftDetailByPlainId(shiftId) {
  const result = await poolQuery(
    `${SHIFT_DETAIL_SELECT} WHERE sh.shift_id = $1`,
    [shiftId]
  )
  return result.rows[0] || null
}

/**
 * 単一シフトを INSERT（フル項目版・詳細付き取得と組み合わせて使う）
 */
export async function insertOne({
  tenantId, storeId, planId, staffId, shiftDate, patternId,
  startTime, endTime, breakMinutes, totalHours, laborCost,
  assignedSkills, isPreferred, isModified, notes,
}) {
  const result = await poolQuery(
    `INSERT INTO ops.shifts (
       tenant_id, store_id, plan_id, staff_id, shift_date, pattern_id,
       start_time, end_time, break_minutes, total_hours, labor_cost,
       assigned_skills, is_preferred, is_modified, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      tenantId, storeId, planId, staffId, shiftDate, patternId,
      startTime, endTime, breakMinutes, totalHours, laborCost,
      assignedSkills, isPreferred, isModified, notes,
    ]
  )
  return result.rows[0]
}

/**
 * 単一シフトを UPDATE（部分更新は呼び出し側でマージして渡す）
 */
export async function updateOne({
  shiftId, tenantId, shiftDate, patternId, staffId, storeId, planId,
  startTime, endTime, breakMinutes, totalHours, laborCost, assignedSkills,
  isPreferred, isModified, notes,
}) {
  await poolQuery(
    `UPDATE ops.shifts
     SET shift_date = $1, pattern_id = $2, staff_id = $3, store_id = $4, plan_id = $5,
         start_time = $6, end_time = $7, break_minutes = $8, total_hours = $9,
         labor_cost = $10, assigned_skills = $11, is_preferred = $12,
         is_modified = $13, notes = $14, updated_at = CURRENT_TIMESTAMP
     WHERE shift_id = $15 AND tenant_id = $16`,
    [
      shiftDate, patternId, staffId, storeId, planId,
      startTime, endTime, breakMinutes, totalHours, laborCost, assignedSkills,
      isPreferred, isModified, notes, shiftId, tenantId,
    ]
  )
}

/**
 * 既存シフトを取得（更新前の値を全項目で欲しい場合）
 */
export async function findRawById(shiftId, tenantId) {
  const result = await poolQuery(
    'SELECT * FROM ops.shifts WHERE shift_id = $1 AND tenant_id = $2',
    [shiftId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * 単一シフトを削除（tenant セキュリティ付き）
 */
export async function deleteOne(shiftId, tenantId) {
  await poolQuery(
    'DELETE FROM ops.shifts WHERE shift_id = $1 AND tenant_id = $2',
    [shiftId, tenantId]
  )
}

/**
 * 削除前確認用: shift_id, staff_id, shift_date, start_time, end_time, plan_id
 */
export async function findDeleteContextById(shiftId, tenantId) {
  const result = await poolQuery(
    'SELECT shift_id, staff_id, shift_date, start_time, end_time, plan_id FROM ops.shifts WHERE shift_id = $1 AND tenant_id = $2',
    [shiftId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * approve-second 用: 既存シフトを tenant + plan で全消去
 */
export async function deleteByPlanAndTenant(planId, tenantId) {
  await poolQuery(
    'DELETE FROM ops.shifts WHERE plan_id = $1 AND tenant_id = $2',
    [planId, tenantId]
  )
}

/**
 * approve-second 用: 簡易列挙で単一シフトを INSERT
 */
export async function insertSimpleShift({
  tenantId, planId, shiftDate, staffId, startTime, endTime, hours, cost, isPreferred, skillLevel,
}) {
  await poolQuery(
    `INSERT INTO ops.shifts (
       tenant_id, plan_id, shift_date, staff_id,
       start_time, end_time, hours, cost,
       is_preferred, skill_level
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [tenantId, planId, shiftDate, staffId, startTime, endTime, hours, cost, isPreferred, skillLevel]
  )
}

/**
 * approve-second 用: plan_id 配下の統計（total/hours/cost/staff_count）
 */
export async function statsByPlanId(planId) {
  const result = await poolQuery(
    `SELECT
       COUNT(*) as total_shifts,
       SUM(hours) as total_hours,
       SUM(cost) as total_cost,
       COUNT(DISTINCT staff_id) as staff_count
     FROM ops.shifts
     WHERE plan_id = $1`,
    [planId]
  )
  return result.rows[0]
}

/**
 * copy-from-previous 用: 元シフトを assigned_skills 等を含む形式で
 * ソースプランから取得する
 */
export async function findByPlanIdOrdered(planId, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `SELECT * FROM ops.shifts WHERE plan_id = $1 ORDER BY shift_date, start_time`,
    [planId]
  )
  return result.rows
}

/**
 * copy-from-previous 用: 完全な項目でコピー挿入
 */
export async function insertCopiedShift({
  tenantId, storeId, planId, staffId, shiftDate, patternId,
  startTime, endTime, breakMinutes, totalHours, laborCost,
  assignedSkills, isPreferred, notes,
}, executor) {
  const ex = pickExecutor(executor)
  await ex.query(
    `INSERT INTO ops.shifts (
       tenant_id, store_id, plan_id, staff_id, shift_date, pattern_id,
       start_time, end_time, break_minutes, total_hours, labor_cost,
       assigned_skills, is_preferred, is_modified, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, $14)`,
    [
      tenantId, storeId, planId, staffId, shiftDate, patternId,
      startTime, endTime, breakMinutes, totalHours, laborCost,
      assignedSkills, isPreferred, notes,
    ]
  )
}

/**
 * 前月コピー用: マスターデータ・時給を含めてシフトを取得
 */
export async function findWithStaffMetaByPlanId(planId) {
  const result = await poolQuery(
    `SELECT
       s.*,
       staff.name as staff_name,
       staff.employment_type,
       staff.hourly_rate
     FROM ops.shifts s
     LEFT JOIN hr.staff staff ON s.staff_id = staff.staff_id
     WHERE s.plan_id = $1
     ORDER BY s.shift_date, s.staff_id`,
    [planId]
  )
  return result.rows
}

export default {
  deleteByPlanId,
  deleteByPlanIdAndTenant,
  deleteByPlanIds,
  sumByPlanId,
  findByPlanId,
  insertAiGeneratedShift,
  insertBulk,
  searchShifts,
  findShiftById,
  findShiftDetailByPlainId,
  insertOne,
  updateOne,
  findRawById,
  deleteOne,
  findDeleteContextById,
  deleteByPlanAndTenant,
  insertSimpleShift,
  statsByPlanId,
  findByPlanIdOrdered,
  insertCopiedShift,
  findWithStaffMetaByPlanId,
}
