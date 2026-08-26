import { query as poolQuery } from '../../config/database.js'

/**
 * ops.shift_preferences に対する共通 SQL を集約するリポジトリ。
 *
 * 各関数は第一引数で「executor」オブジェクト（`{ query }` を持つもの）を受け取れる。
 * トランザクション内では transaction コールバックの client を渡し、
 * 通常呼び出しでは省略（＝プール経由の query が使われる）。
 */

const defaultExecutor = { query: poolQuery }

function pickExecutor(executor) {
  return executor && typeof executor.query === 'function' ? executor : defaultExecutor
}

const DETAIL_SELECT = `
  SELECT
    pref.preference_id,
    pref.tenant_id,
    pref.store_id,
    pref.staff_id,
    pref.preference_date,
    pref.is_ng,
    pref.start_time,
    pref.end_time,
    pref.notes,
    pref.created_at,
    pref.updated_at,
    s.store_name,
    s.store_code,
    staff.name as staff_name,
    staff.staff_code,
    staff.email as staff_email,
    staff.employment_type,
    r.role_name
  FROM ops.shift_preferences pref
  LEFT JOIN core.stores s ON pref.store_id = s.store_id
  LEFT JOIN hr.staff staff ON pref.staff_id = staff.staff_id
  LEFT JOIN core.roles r ON staff.role_id = r.role_id
`

export async function search({ tenantId, storeId, staffId, dateFrom, dateTo, isNg }) {
  let sql = `
    SELECT
      pref.preference_id,
      pref.tenant_id,
      pref.store_id,
      s.store_name,
      pref.staff_id,
      staff.name as staff_name,
      staff.staff_code,
      staff.email as staff_email,
      staff.employment_type,
      r.role_name,
      pref.preference_date,
      pref.is_ng,
      pref.start_time,
      pref.end_time,
      pref.notes,
      pref.created_at,
      pref.updated_at
    FROM ops.shift_preferences pref
    LEFT JOIN core.stores s ON pref.store_id = s.store_id
    LEFT JOIN hr.staff staff ON pref.staff_id = staff.staff_id
    LEFT JOIN core.roles r ON staff.role_id = r.role_id
    WHERE pref.tenant_id = $1
  `
  const params = [tenantId]
  let idx = 2

  if (storeId) {
    sql += ` AND pref.store_id = $${idx++}`
    params.push(storeId)
  }
  if (staffId) {
    sql += ` AND pref.staff_id = $${idx++}`
    params.push(staffId)
  }
  if (dateFrom) {
    sql += ` AND pref.preference_date >= $${idx++}`
    params.push(dateFrom)
  }
  if (dateTo) {
    sql += ` AND pref.preference_date <= $${idx++}`
    params.push(dateTo)
  }
  if (isNg !== undefined) {
    sql += ` AND pref.is_ng = $${idx}`
    params.push(isNg === 'true' || isNg === true)
  }

  sql += ` ORDER BY pref.preference_date ASC, staff.name ASC`

  const result = await poolQuery(sql, params)
  return result.rows
}

export async function findById(id, tenantId) {
  const result = await poolQuery(
    `${DETAIL_SELECT} WHERE pref.preference_id = $1 AND pref.tenant_id = $2`,
    [id, tenantId]
  )
  return result.rows[0] || null
}

export async function findExistingRaw(id, tenantId) {
  const result = await poolQuery(
    'SELECT * FROM ops.shift_preferences WHERE preference_id = $1 AND tenant_id = $2',
    [id, tenantId]
  )
  return result.rows[0] || null
}

export async function insert({ tenantId, storeId, staffId, preferenceDate, isNg, startTime, endTime, notes }, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `INSERT INTO ops.shift_preferences (
       tenant_id, store_id, staff_id, preference_date,
       is_ng, start_time, end_time, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING preference_id`,
    [tenantId, storeId, staffId, preferenceDate, isNg, startTime, endTime, notes]
  )
  return result.rows[0].preference_id
}

export async function updateById({ id, tenantId, isNg, startTime, endTime, notes }) {
  await poolQuery(
    `UPDATE ops.shift_preferences
     SET is_ng = $1, start_time = $2, end_time = $3, notes = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE preference_id = $5 AND tenant_id = $6`,
    [isNg, startTime, endTime, notes, id, tenantId]
  )
}

export async function deleteById(id, tenantId) {
  await poolQuery(
    'DELETE FROM ops.shift_preferences WHERE preference_id = $1 AND tenant_id = $2',
    [id, tenantId]
  )
}

export async function deleteByStaffAndPeriod({ tenantId, staffId, startDate, endDate }, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    `DELETE FROM ops.shift_preferences
     WHERE tenant_id = $1 AND staff_id = $2
       AND preference_date >= $3 AND preference_date < $4`,
    [tenantId, staffId, startDate, endDate]
  )
  return result.rowCount
}

export async function findDetailById(id) {
  const result = await poolQuery(`${DETAIL_SELECT} WHERE pref.preference_id = $1`, [id])
  return result.rows[0] || null
}

export default {
  search,
  findById,
  findExistingRaw,
  insert,
  updateById,
  deleteById,
  deleteByStaffAndPeriod,
  findDetailById,
}
