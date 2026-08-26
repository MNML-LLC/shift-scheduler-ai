import { query as poolQuery } from '../../config/database.js'

/**
 * ops.staff_monthly_submissions と、staff LEFT JOIN で提出状況を計算するクエリを
 * 集約するリポジトリ。ルート層はこの関数に委譲する。
 */

const defaultExecutor = { query: poolQuery }

function pickExecutor(executor) {
  return executor && typeof executor.query === 'function' ? executor : defaultExecutor
}

/**
 * 月次コメント一覧を取得する（コメント本文があるスタッフのみ）
 */
export async function findMonthlyComments({ tenantId, year, month, storeId }) {
  let sql = `
    SELECT
      sms.staff_id,
      s.name as staff_name,
      s.store_id,
      sms.year,
      sms.month,
      sms.comment,
      sms.submission_status,
      sms.updated_at
    FROM ops.staff_monthly_submissions sms
    JOIN hr.staff s ON sms.staff_id = s.staff_id
    WHERE sms.tenant_id = $1
      AND sms.year = $2
      AND sms.month = $3
      AND sms.comment IS NOT NULL
      AND sms.comment != ''
  `
  const params = [tenantId, year, month]

  if (storeId) {
    sql += ` AND s.store_id = $4`
    params.push(storeId)
  }

  sql += ` ORDER BY s.name`

  const result = await poolQuery(sql, params)
  return result.rows
}

/**
 * 月次シフト提出状況一覧
 */
export async function findSubmissions({ tenantId, year, month, storeId }) {
  let sql = `
    SELECT
      sms.staff_id,
      s.name as staff_name,
      s.store_id,
      sms.year,
      sms.month,
      sms.comment,
      sms.submission_status,
      sms.created_at,
      sms.updated_at
    FROM ops.staff_monthly_submissions sms
    JOIN hr.staff s ON sms.staff_id = s.staff_id
    WHERE sms.tenant_id = $1
      AND sms.year = $2
      AND sms.month = $3
  `
  const params = [tenantId, year, month]

  if (storeId) {
    sql += ` AND s.store_id = $4`
    params.push(storeId)
  }

  sql += ` ORDER BY s.name`

  const result = await poolQuery(sql, params)
  return result.rows
}

/**
 * shift_preferences を staff LEFT JOIN で突き合わせ、対象月の
 * 全アクティブスタッフに対して提出/未提出を返す。
 */
export async function findPreferenceSubmissionStatus({ tenantId, year, month, storeId }) {
  let sql = `
    SELECT
      staff.staff_id,
      staff.name AS staff_name,
      staff.employment_type,
      staff.store_id,
      COUNT(pref.preference_id)::int AS submitted_dates_count,
      (COUNT(pref.preference_id) > 0) AS submitted
    FROM hr.staff staff
    LEFT JOIN ops.shift_preferences pref
      ON pref.staff_id = staff.staff_id
      AND pref.tenant_id = staff.tenant_id
      AND EXTRACT(YEAR FROM pref.preference_date) = $2
      AND EXTRACT(MONTH FROM pref.preference_date) = $3
    WHERE staff.tenant_id = $1
      AND staff.is_active = true
  `
  const params = [tenantId, year, month]

  if (storeId) {
    sql += ` AND staff.store_id = $4`
    params.push(storeId)
  }

  sql += `
    GROUP BY staff.staff_id, staff.name, staff.employment_type, staff.store_id
    ORDER BY staff.name ASC
  `

  const result = await poolQuery(sql, params)
  return result.rows
}

/**
 * staff_monthly_submissions に提出記録を upsert する（bulk 登録時）
 */
export async function upsertMonthlySubmission({ tenantId, staffId, year, month }, executor) {
  const ex = pickExecutor(executor)
  await ex.query(
    `INSERT INTO ops.staff_monthly_submissions (tenant_id, staff_id, year, month)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, staff_id, year, month)
     DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
    [tenantId, staffId, year, month]
  )
}

export default {
  findMonthlyComments,
  findSubmissions,
  findPreferenceSubmissionStatus,
  upsertMonthlySubmission,
}
