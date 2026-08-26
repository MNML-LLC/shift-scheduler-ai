import { query as poolQuery } from '../config/database.js'

/**
 * hr.staff に対する必要最小限のリポジトリ。
 * shifts.js から寄せられていた ad-hoc な staff クエリを集約する。
 */

const defaultExecutor = { query: poolQuery }

function pickExecutor(executor) {
  return executor && typeof executor.query === 'function' ? executor : defaultExecutor
}

/**
 * staff_id + tenant_id で staff の時給を取得
 */
export async function findHourlyRate({ staffId, tenantId }, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    'SELECT hourly_rate FROM hr.staff WHERE staff_id = $1 AND tenant_id = $2',
    [staffId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * copy-from-previous 用: staff の存在確認と時給取得（tenant + is_active）
 */
export async function findActiveWithRate({ staffId, tenantId }, executor) {
  const ex = pickExecutor(executor)
  const result = await ex.query(
    'SELECT staff_id, hourly_rate FROM hr.staff WHERE staff_id = $1 AND tenant_id = $2 AND is_active = true',
    [staffId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * approve-second 用: 名前 → staff_id 変換
 */
export async function findIdByName({ name, tenantId }) {
  const result = await poolQuery(
    `SELECT staff_id FROM hr.staff WHERE name = $1 AND tenant_id = $2 LIMIT 1`,
    [name, tenantId]
  )
  return result.rows[0]?.staff_id ?? null
}

/**
 * approve-second 用: hourly_wage を取得
 */
export async function findHourlyWageById(staffId) {
  const result = await poolQuery(
    `SELECT hourly_wage FROM hr.staff WHERE staff_id = $1`,
    [staffId]
  )
  return result.rows[0]?.hourly_wage ?? 0
}

/**
 * copy-from-previous 用: 店舗のアクティブスタッフを取得（バリデーション用）
 */
export async function findActiveByStore({ tenantId, storeId }) {
  const result = await poolQuery(
    `SELECT
       staff.staff_id,
       staff.name,
       staff.employment_type,
       staff.hourly_rate,
       r.role_name
     FROM hr.staff staff
     LEFT JOIN core.roles r ON staff.role_id = r.role_id
     WHERE staff.tenant_id = $1 AND staff.store_id = $2 AND staff.is_active = true`,
    [tenantId, storeId]
  )
  return result.rows
}

/**
 * fetch-previous-data-all-stores 用: tenant のアクティブスタッフ ID 一覧
 */
export async function findActiveStaffIds({ tenantId }) {
  const result = await poolQuery(
    'SELECT staff_id FROM hr.staff WHERE tenant_id = $1 AND is_active = true',
    [tenantId]
  )
  return result.rows.map((r) => r.staff_id)
}

export default {
  findHourlyRate,
  findActiveWithRate,
  findIdByName,
  findHourlyWageById,
  findActiveByStore,
  findActiveStaffIds,
}
