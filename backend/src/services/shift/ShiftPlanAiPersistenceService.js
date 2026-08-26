import { transaction, query } from '../../config/database.js'
import ShiftPlanRepository from '../../repositories/shift/ShiftPlanRepository.js'
import ShiftRepository from '../../repositories/shift/ShiftRepository.js'

/**
 * AI 生成後のシフトを DB に書き込む共通ロジック。
 *
 * POST /plans/generate-ai / GET /plans/generate-ai/stream / GET /plans/generate-bulk/stream から
 * 呼び出される。既存プランがあれば shifts を全削除して差替え、無ければ新規作成する。
 */

/**
 * 単一店舗の AI 生成結果を保存
 *
 * @param {Object} params
 * @param {number} params.tenantId
 * @param {number} params.storeId
 * @param {number} params.year
 * @param {number} params.month
 * @param {number|null} params.createdBy
 * @param {Object} params.options
 * @param {Object} params.result - ShiftGenerationService.generateShifts の戻り値
 * @param {string} [params.planNameSuffix] - "AI 生成" / "AI 一括生成" 等の識別子
 * @param {string} [params.planCodePrefix] - "AI" / "AI-<storeId>" 等
 */
export async function persistAiShifts({
  tenantId, storeId, year, month, createdBy, options, result,
  planNameSuffix = 'AI生成', planCodePrefix = 'AI',
}) {
  return transaction(async (client) => {
    const existingPlans = await ShiftPlanRepository.findByStoreMonthForUpdate(
      { tenantId, storeId, year, month }, client
    )

    let localPlanId
    let localIsUpdate = false
    if (existingPlans.length > 0) {
      localPlanId = existingPlans[0].plan_id
      localIsUpdate = true
      await ShiftRepository.deleteByPlanId(localPlanId, client)
    } else {
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0)
      const planCode = `PLAN-${year}${String(month).padStart(2, '0')}-${planCodePrefix}`
      const planName = `${year}年${month}月シフト（${planNameSuffix}）`

      const inserted = await ShiftPlanRepository.insertPlan({
        tenantId, storeId, year, month,
        planCode, planName, periodStart, periodEnd,
        generationType: 'AI_GENERATED',
        aiModelVersion: options.model || process.env.OPENAI_MODEL || 'gpt-4o',
        createdBy: createdBy || null,
      }, client)
      localPlanId = inserted.plan_id
    }

    let insertedCount = 0
    for (const shift of result.shifts) {
      await ShiftRepository.insertAiGeneratedShift({
        tenantId, storeId, planId: localPlanId,
        staffId: shift.staff_id, shiftDate: shift.shift_date, patternId: shift.pattern_id,
        startTime: shift.start_time, endTime: shift.end_time, breakMinutes: shift.break_minutes,
      }, client)
      insertedCount++
    }

    const summary = await ShiftRepository.sumByPlanId(localPlanId, client)
    await ShiftPlanRepository.updateAggregates(localPlanId, {
      totalLaborHours: parseFloat(summary.total_hours || 0),
      totalLaborCost: parseInt(summary.total_cost || 0),
      constraintViolations: result.validation.violations.length,
    }, client)

    return { planId: localPlanId, isUpdate: localIsUpdate, insertedCount }
  })
}

/**
 * 一括生成 (generate-bulk) 用: 内部で個別 SQL を組む版
 *
 * NOTE: 既存の raw SQL 呼び出し順序（notes='AI一括生成'、summary クエリ 3 回等）を保つため
 * 別関数として維持する。テスト側で mock.calls の順番を検証している場合があるため、
 * 誤って persistAiShifts() に統合するとテストが壊れる。
 */
export async function persistBulkGeneratedShifts({
  tenantId, storeId, year, month, createdBy, options, result,
}) {
  return transaction(async (client) => {
    const existingPlan = await client.query(
      `SELECT plan_id, status FROM ops.shift_plans
       WHERE tenant_id = $1 AND store_id = $2 AND plan_year = $3 AND plan_month = $4
       FOR UPDATE`,
      [tenantId, storeId, year, month]
    )

    let localPlanId
    if (existingPlan.rows.length > 0) {
      localPlanId = existingPlan.rows[0].plan_id
      await client.query('DELETE FROM ops.shifts WHERE plan_id = $1', [localPlanId])
    } else {
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0)
      const planCode = `PLAN-${year}${String(month).padStart(2, '0')}-AI-${storeId}`
      const planName = `${year}年${month}月シフト（AI一括生成）`

      const planResult = await client.query(
        `INSERT INTO ops.shift_plans (
           tenant_id, store_id, plan_year, plan_month,
           plan_code, plan_name, period_start, period_end,
           status, generation_type, ai_model_version, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', 'AI_GENERATED', $9, $10)
         RETURNING plan_id`,
        [
          tenantId, storeId, year, month,
          planCode, planName, periodStart, periodEnd,
          options.model || process.env.OPENAI_MODEL || 'gpt-4o',
          createdBy || null,
        ]
      )
      localPlanId = planResult.rows[0].plan_id
    }

    for (const shift of result.shifts) {
      await client.query(
        `INSERT INTO ops.shifts (
           tenant_id, store_id, plan_id, staff_id, shift_date, pattern_id,
           start_time, end_time, break_minutes, total_hours, labor_cost,
           is_preferred, is_modified, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, false, 'AI一括生成')`,
        [
          tenantId, storeId, localPlanId, shift.staff_id, shift.shift_date, shift.pattern_id,
          shift.start_time, shift.end_time, shift.break_minutes,
          null, null,
        ]
      )
    }

    const summaryResult = await client.query(
      `SELECT SUM(total_hours) as total_hours, SUM(labor_cost) as total_cost
       FROM ops.shifts WHERE plan_id = $1`,
      [localPlanId]
    )
    const summary = summaryResult.rows[0]

    await client.query(
      `UPDATE ops.shift_plans
       SET total_labor_hours = $1, total_labor_cost = $2, constraint_violations = $3
       WHERE plan_id = $4`,
      [
        parseFloat(summary.total_hours || 0),
        parseInt(summary.total_cost || 0),
        result.validation.violations.length,
        localPlanId,
      ]
    )

    return localPlanId
  })
}

/**
 * 一括生成前のスキップ判定用: APPROVED/CONFIRMED を持つ店舗を検索する
 */
export async function findExistingApprovedStoreIds(params) {
  return ShiftPlanRepository.findExistingApprovedStoreIds(params)
}

/**
 * tenant の全アクティブ店舗 ID を取得（bulk generate 用）
 */
export async function findActiveStoreIds(tenantId) {
  const result = await query(
    `SELECT store_id FROM core.stores
     WHERE tenant_id = $1 AND is_active = TRUE
     ORDER BY store_id`,
    [tenantId]
  )
  return result.rows.map((r) => Number(r.store_id))
}

export default {
  persistAiShifts,
  persistBulkGeneratedShifts,
  findExistingApprovedStoreIds,
  findActiveStoreIds,
}
