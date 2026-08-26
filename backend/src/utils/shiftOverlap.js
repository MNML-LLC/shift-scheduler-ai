import { query } from '../config/database.js'

/**
 * シフトの時間重複判定ヘルパー。
 *
 * ルーティング層に散らばっていた時間重複ロジックを集約する。
 * DB を参照する `validateShiftTimeOverlap` は同一 plan_id 内のシフトのみを対象に
 * 重複を検査する（Issue #165: 第一案と第二案は別プランなので独立判定）。
 */

/**
 * "HH:MM[:SS]" を分数に変換する
 * @param {string} timeStr
 * @returns {number}
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0
  const parts = timeStr.split(':').map(Number)
  return parts[0] * 60 + parts[1]
}

/**
 * 2つのシフト時間が重複しているかを判定する
 */
export function isTimeOverlap(shift1, shift2) {
  const s1Start = parseTimeToMinutes(shift1.start_time)
  const s1End = parseTimeToMinutes(shift1.end_time)
  const s2Start = parseTimeToMinutes(shift2.start_time)
  const s2End = parseTimeToMinutes(shift2.end_time)
  return !(s1End <= s2Start || s2End <= s1Start)
}

/**
 * 対象シフトが、同一日・同一スタッフ・同一プランの既存シフトと重複しないかを
 * DB を引いて検査する。
 *
 * @param {Object} newShift
 * @param {number} newShift.tenant_id
 * @param {number} newShift.staff_id
 * @param {string} newShift.shift_date
 * @param {string} newShift.start_time
 * @param {string} newShift.end_time
 * @param {number} [newShift.shift_id] - 更新時、自シフトを除外するために渡す
 * @param {number} [newShift.plan_id]  - 指定した場合、そのプラン内のみで判定
 */
export async function validateShiftTimeOverlap(newShift) {
  const { tenant_id, staff_id, shift_date, start_time, end_time, shift_id, plan_id } = newShift

  let sql = `
    SELECT s.*, st.store_name
    FROM ops.shifts s
    JOIN core.stores st ON s.store_id = st.store_id
    WHERE s.tenant_id = $1
      AND s.staff_id = $2
      AND s.shift_date = $3
      AND s.shift_id != $4
  `
  const params = [tenant_id, staff_id, shift_date, shift_id || 0]

  if (plan_id) {
    sql += ` AND s.plan_id = $5`
    params.push(plan_id)
  }

  const existingShifts = await query(sql, params)

  for (const existing of existingShifts.rows) {
    if (isTimeOverlap({ start_time, end_time }, existing)) {
      return {
        valid: false,
        error: `${existing.store_name}のシフト(${existing.start_time.slice(0, 5)}-${existing.end_time.slice(0, 5)})と時間が重複しています`,
        existingShift: existing,
      }
    }
  }

  return { valid: true, error: null }
}

export default {
  parseTimeToMinutes,
  isTimeOverlap,
  validateShiftTimeOverlap,
}
