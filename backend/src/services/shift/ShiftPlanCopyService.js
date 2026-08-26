import { query, transaction } from '../../config/database.js'
import ShiftPlanRepository from '../../repositories/shift/ShiftPlanRepository.js'
import ShiftRepository from '../../repositories/shift/ShiftRepository.js'
import StaffRepository from '../../repositories/StaffRepository.js'
import StoreRepository from '../../repositories/StoreRepository.js'
import ConstraintValidationService from './ConstraintValidationService.js'
import { getPreviousMonth, getWeekInfo } from '../../utils/monthUtils.js'
import { formatDateToYYYYMMDD } from '../../utils/timeUtils.js'

/**
 * シフト計画のコピー・複製系サービス。
 *
 * - POST /plans/generate         … 前月 SECOND を曜日ベースで新月に写像し FIRST を作る
 * - POST /plans/copy-from-previous            … 個別店舗の前月 SECOND コピー + 労基チェック
 * - POST /plans/copy-from-previous-all-stores … 全店舗の一括コピー
 * - POST /plans/fetch-previous-data-all-stores … DB 書き込みなしのプレビュー
 * - POST /plans/create-with-shifts             … メモリ上のシフトを DB に登録
 */

export class ValidationError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'ValidationError'
    Object.assign(this, extra)
  }
}

export class NotFoundError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'NotFoundError'
    Object.assign(this, extra)
  }
}

export class ConflictError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'ConflictError'
    Object.assign(this, extra)
  }
}

/**
 * ルート層で使う共通データ取得: 特定年月のプラン + シフト
 */
export async function fetchShiftsData(tenantId, { year, month, storeId = null, planType = null }) {
  let planSql = `
    SELECT plan_id, store_id, plan_year, plan_month, plan_type, status
    FROM ops.shift_plans
    WHERE tenant_id = $1 AND plan_year = $2 AND plan_month = $3
  `
  const planParams = [tenantId, year, month]
  let idx = 4

  if (storeId) {
    planSql += ` AND store_id = $${idx++}`
    planParams.push(storeId)
  }
  if (planType) {
    planSql += ` AND plan_type = $${idx}`
    planParams.push(planType)
  }
  planSql += ` ORDER BY store_id`

  const planResult = await query(planSql, planParams)
  const plans = planResult.rows
  if (plans.length === 0) {
    return { plans: [], shifts: [], plansByStoreId: new Map() }
  }

  const planIds = plans.map((p) => p.plan_id)
  const shiftResult = await query(
    `SELECT * FROM ops.shifts WHERE plan_id = ANY($1) ORDER BY store_id, shift_date, staff_id`,
    [planIds]
  )
  const plansByStoreId = new Map(plans.map((p) => [p.store_id, p]))
  return { plans, shifts: shiftResult.rows, plansByStoreId }
}

/**
 * 前月の SECOND プラン + シフトを取得
 */
export async function fetchPreviousSecondShifts(tenantId, year, month, storeId = null) {
  const { year: prevYear, month: prevMonth } = getPreviousMonth(year, month)
  return fetchShiftsData(tenantId, {
    year: prevYear, month: prevMonth, storeId, planType: 'SECOND',
  })
}

/**
 * POST /plans/generate 用: 前月 SECOND を曜日ベースで新月に写像する
 */
export async function generateFromPreviousMonth({ tenantId, storeId, year, month, createdBy }) {
  const { plans: sourcePlans, shifts: sourceShifts } = await fetchPreviousSecondShifts(
    tenantId, year, month, storeId
  )
  const { year: prevYear, month: prevMonth } = getPreviousMonth(year, month)

  if (sourcePlans.length === 0) {
    throw new NotFoundError('前月の第2案が見つかりません', {
      message: `${prevYear}年${prevMonth}月の第2案（確定版）が存在しません。第2案を作成・承認してからコピーしてください。`,
    })
  }
  if (sourceShifts.length === 0) {
    throw new NotFoundError(`No shift data found for previous month (${prevYear}/${prevMonth})`, {
      message: '前月のシフトデータが存在しません。最初の月は手動でシフトを作成してください。',
    })
  }

  const shiftsByWeekAndDay = {}
  for (const shift of sourceShifts) {
    const prevDate = new Date(shift.shift_date)
    const { weekNumber, dayOfWeek } = getWeekInfo(prevDate)
    const key = `w${weekNumber}_d${dayOfWeek}`
    if (!shiftsByWeekAndDay[key]) shiftsByWeekAndDay[key] = []
    shiftsByWeekAndDay[key].push(shift)
  }

  const txResult = await transaction(async (client) => {
    const existingPlans = await ShiftPlanRepository.findByStoreMonthForUpdate(
      { tenantId, storeId, year, month }, client
    )

    let isUpdate = false
    let newPlanId

    if (existingPlans.length > 0) {
      isUpdate = true
      newPlanId = existingPlans[0].plan_id
      await ShiftRepository.deleteByPlanId(newPlanId, client)
    } else {
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0)
      const planCode = `PLAN-${year}${String(month).padStart(2, '0')}-001`
      const planName = `${year}年${month}月シフト（第1案）`

      const inserted = await ShiftPlanRepository.insertPlan({
        tenantId, storeId, year, month,
        planCode, planName, periodStart, periodEnd,
        planType: 'FIRST', generationType: 'COPY_PREVIOUS',
        createdBy: createdBy || null,
      }, client)
      newPlanId = inserted.plan_id
    }

    const copiedShifts = []
    const daysInNewMonth = new Date(year, month, 0).getDate()
    for (let day = 1; day <= daysInNewMonth; day++) {
      const newShiftDate = new Date(year, month - 1, day)
      const { weekNumber, dayOfWeek } = getWeekInfo(newShiftDate)

      let key = `w${weekNumber}_d${dayOfWeek}`
      let shiftsForDay = shiftsByWeekAndDay[key]

      if (!shiftsForDay || shiftsForDay.length === 0) {
        key = `w1_d${dayOfWeek}`
        shiftsForDay = shiftsByWeekAndDay[key]
      }
      if (!shiftsForDay || shiftsForDay.length === 0) continue

      for (const shift of shiftsForDay) {
        const staff = await StaffRepository.findActiveWithRate(
          { staffId: shift.staff_id, tenantId }, client
        )
        if (!staff) continue

        const startTime = shift.start_time
        const endTime = shift.end_time
        const breakMinutes = shift.break_minutes || 0
        const startParts = startTime.split(':')
        const endParts = endTime.split(':')
        const startMinutes = parseInt(startParts[0]) * 60 + parseInt(startParts[1])
        const endMinutes = parseInt(endParts[0]) * 60 + parseInt(endParts[1])
        let totalMinutes = endMinutes - startMinutes
        if (totalMinutes < 0) totalMinutes += 24 * 60
        totalMinutes -= breakMinutes

        const totalHours = (totalMinutes / 60).toFixed(2)
        const hourlyRate = parseFloat(staff.hourly_rate || 1200)
        const laborCost = Math.round(hourlyRate * parseFloat(totalHours))

        await ShiftRepository.insertCopiedShift({
          tenantId, storeId, planId: newPlanId,
          staffId: shift.staff_id, shiftDate: newShiftDate, patternId: shift.pattern_id,
          startTime, endTime, breakMinutes, totalHours, laborCost,
          assignedSkills: shift.assigned_skills, isPreferred: shift.is_preferred,
          notes: `前月(${prevYear}/${prevMonth})第${weekNumber}週${key.includes('w1') ? '(第1週から補完)' : ''}からコピー`,
        }, client)

        copiedShifts.push(true)
      }
    }

    const summary = await ShiftRepository.sumByPlanId(newPlanId, client)
    await ShiftPlanRepository.updateAggregates(newPlanId, {
      totalLaborHours: parseFloat(summary.total_hours || 0),
      totalLaborCost: parseInt(summary.total_cost || 0),
    }, client)

    const detail = await ShiftPlanRepository.findDetailWithCreator({ planId: newPlanId }, client)
    return { isUpdate, copiedShiftsCount: copiedShifts.length, detail }
  })

  return { ...txResult, prevYear, prevMonth }
}

/**
 * POST /plans/copy-from-previous 用: 個別店舗コピー + 労基バリデーション
 */
export async function copyFromPreviousMonth({
  tenantId, storeId, targetYear, targetMonth, createdBy, overwrite = false,
}) {
  let sourceYear = targetYear
  let sourceMonth = targetMonth - 1
  if (sourceMonth === 0) {
    sourceMonth = 12
    sourceYear = targetYear - 1
  }

  const txResult = await transaction(async (client) => {
    const sourcePlan = await ShiftPlanRepository.findLatestSecondPlan(
      { tenantId, storeId, year: sourceYear, month: sourceMonth }, client
    )
    if (!sourcePlan) {
      throw new NotFoundError(`${sourceYear}年${sourceMonth}月の第2案（確定版）が見つかりません`)
    }

    const sourceShifts = await ShiftRepository.findByPlanIdOrdered(sourcePlan.plan_id, client)
    if (sourceShifts.length === 0) {
      throw new NotFoundError(`${sourceYear}年${sourceMonth}月のシフトデータが空です`)
    }

    const existingFirst = await ShiftPlanRepository.findByStoreMonthTypeWithClient(
      { tenantId, storeId, year: targetYear, month: targetMonth, planType: 'FIRST' }, client
    )
    if (existingFirst.length > 0) {
      if (!overwrite) {
        throw new ConflictError('同月の第1案が既に存在します（overwrite:true で上書き可能）')
      }
      const existingPlanIds = existingFirst.map((r) => r.plan_id)
      await ShiftRepository.deleteByPlanIds(existingPlanIds, tenantId, client)
      await ShiftPlanRepository.deleteByPlanIds(existingPlanIds, tenantId, client)
    }

    const periodStart = new Date(targetYear, targetMonth - 1, 1)
    const periodEnd = new Date(targetYear, targetMonth, 0)
    const planCode = `PLAN-${targetYear}${String(targetMonth).padStart(2, '0')}-COPY`
    const planName = `${targetYear}年${targetMonth}月シフト（前月コピー）`
    const newPlanId = await ShiftPlanRepository.insertCopiedFirstPlan({
      tenantId, storeId, year: targetYear, month: targetMonth,
      planCode, planName, periodStart, periodEnd, createdBy: createdBy || null,
    }, client)

    const sourceMapping = {}
    sourceShifts.forEach((shift) => {
      const shiftDate = new Date(shift.shift_date)
      const dayOfWeek = shiftDate.getDay()
      const dayOfMonth = shiftDate.getDate()
      let weekCount = 0
      for (let d = 1; d <= dayOfMonth; d++) {
        if (new Date(sourceYear, sourceMonth - 1, d).getDay() === dayOfWeek) weekCount++
      }
      const key = `week${weekCount}_dow${dayOfWeek}`
      if (!sourceMapping[key]) sourceMapping[key] = []
      sourceMapping[key].push(shift)
    })

    const targetMapping = {}
    const daysInTargetMonth = new Date(targetYear, targetMonth, 0).getDate()
    for (let day = 1; day <= daysInTargetMonth; day++) {
      const date = new Date(targetYear, targetMonth - 1, day)
      const dayOfWeek = date.getDay()
      let weekCount = 0
      for (let d = 1; d <= day; d++) {
        if (new Date(targetYear, targetMonth - 1, d).getDay() === dayOfWeek) weekCount++
      }
      targetMapping[`week${weekCount}_dow${dayOfWeek}`] = day
    }

    let insertedCount = 0
    let skippedCount = 0
    let fallbackCount = 0
    for (const [key, sourceGroup] of Object.entries(sourceMapping)) {
      let targetDay = targetMapping[key]
      let usedFallback = false
      if (!targetDay) {
        const match = key.match(/week(\d+)_dow(\d+)/)
        if (match) {
          const dayOfWeek = match[2]
          targetDay = targetMapping[`week1_dow${dayOfWeek}`]
          if (targetDay) {
            usedFallback = true
            fallbackCount += sourceGroup.length
          }
        }
        if (!targetDay) {
          skippedCount += sourceGroup.length
          continue
        }
      }
      const targetDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
      for (const src of sourceGroup) {
        await ShiftRepository.insertCopiedShift({
          tenantId, storeId, planId: newPlanId,
          staffId: src.staff_id, shiftDate: targetDate, patternId: src.pattern_id,
          startTime: src.start_time, endTime: src.end_time, breakMinutes: src.break_minutes,
          totalHours: src.total_hours, laborCost: src.labor_cost,
          assignedSkills: src.assigned_skills, isPreferred: src.is_preferred,
          notes: usedFallback ? '前月からコピー（第1週にフォールバック）' : '前月からコピー',
        }, client)
        insertedCount++
      }
    }

    return {
      newPlanId,
      insertedCount,
      skippedCount,
      fallbackCount,
      totalSourceCount: sourceShifts.length,
    }
  })

  const copiedShifts = await ShiftRepository.findWithStaffMetaByPlanId(txResult.newPlanId)
  const staff = await StaffRepository.findActiveByStore({ tenantId, storeId })
  const storeInfo = await StoreRepository.findByIdAndTenant(storeId, tenantId)

  const shiftsForValidation = copiedShifts.map((shift) => ({
    shift_id: shift.shift_id,
    staff_id: shift.staff_id,
    shift_date: formatDateToYYYYMMDD(shift.shift_date),
    start_time: shift.start_time,
    end_time: shift.end_time,
    break_minutes: shift.break_minutes || 0,
    staff_name: shift.staff_name,
    employment_type: shift.employment_type,
  }))

  const validator = new ConstraintValidationService()
  const validation = await validator.validateShifts(shiftsForValidation, {
    staff, storeInfo: storeInfo || {},
  })

  return { ...txResult, sourceYear, sourceMonth, validation }
}

/**
 * POST /plans/copy-from-previous-all-stores 用: 全店舗一括コピー
 */
export async function copyFromPreviousAllStores({ tenantId, targetYear, targetMonth, createdBy }) {
  const stores = await StoreRepository.findActiveByTenant(tenantId)
  if (stores.length === 0) {
    throw new NotFoundError('アクティブな店舗が見つかりません')
  }

  const { shifts: allSourceShifts, plansByStoreId: sourcePlanByStoreId } =
    await fetchPreviousSecondShifts(tenantId, targetYear, targetMonth)

  const createdPlans = []
  const errors = []

  for (const store of stores) {
    try {
      const sourcePlan = sourcePlanByStoreId.get(store.store_id)
      const { newPlanId, copiedShiftsCount } = await transaction(async (client) => {
        const periodStart = new Date(targetYear, targetMonth - 1, 1)
        const periodEnd = new Date(targetYear, targetMonth, 0)
        const planCode = `PLAN-${targetYear}${String(targetMonth).padStart(2, '0')}-${String(store.store_id).padStart(3, '0')}`
        const planName = `${targetYear}年${targetMonth}月シフト（第1案）`

        const inserted = await ShiftPlanRepository.insertPlan({
          tenantId, storeId: store.store_id,
          year: targetYear, month: targetMonth,
          planCode, planName, periodStart, periodEnd,
          planType: 'FIRST', generationType: 'COPY_ALL_STORES',
          createdBy: createdBy || null,
        }, client)
        const localPlanId = inserted.plan_id

        const shiftsToInsert = []
        if (sourcePlan) {
          const sourceShiftsRows = allSourceShifts.filter((s) => s.plan_id === sourcePlan.plan_id)
          const shiftsByWeekAndDay = {}
          for (const shift of sourceShiftsRows) {
            const shiftDate = new Date(shift.shift_date)
            const { weekNumber, dayOfWeek } = getWeekInfo(shiftDate)
            const key = `w${weekNumber}_d${dayOfWeek}`
            if (!shiftsByWeekAndDay[key]) shiftsByWeekAndDay[key] = []
            shiftsByWeekAndDay[key].push(shift)
          }

          const daysInTargetMonth = new Date(targetYear, targetMonth, 0).getDate()
          for (let day = 1; day <= daysInTargetMonth; day++) {
            const newShiftDate = new Date(targetYear, targetMonth - 1, day)
            const { weekNumber, dayOfWeek } = getWeekInfo(newShiftDate)
            let key = `w${weekNumber}_d${dayOfWeek}`
            let group = shiftsByWeekAndDay[key]
            if (!group || group.length === 0) {
              key = `w1_d${dayOfWeek}`
              group = shiftsByWeekAndDay[key]
            }
            if (!group || group.length === 0) continue
            for (const src of group) {
              shiftsToInsert.push({
                tenant_id: tenantId,
                store_id: store.store_id,
                plan_id: localPlanId,
                staff_id: src.staff_id,
                shift_date: formatDateToYYYYMMDD(newShiftDate),
                pattern_id: src.pattern_id,
                start_time: src.start_time,
                end_time: src.end_time,
                break_minutes: src.break_minutes,
              })
            }
          }
          await ShiftRepository.insertBulk(shiftsToInsert, client)
        }
        return { newPlanId: localPlanId, copiedShiftsCount: shiftsToInsert.length }
      })

      createdPlans.push({
        plan_id: newPlanId,
        store_id: store.store_id,
        store_name: store.store_name,
        year: targetYear,
        month: targetMonth,
        source_plan: sourcePlan ? `${sourcePlan.plan_year}年${sourcePlan.plan_month}月` : 'なし',
        copied_shifts_count: copiedShiftsCount,
      })
    } catch (err) {
      console.error(`  店舗 ${store.store_name} でエラー:`, err)
      errors.push({ store_id: store.store_id, store_name: store.store_name, error: err.message })
    }
  }
  return { createdPlans, errors }
}

/**
 * POST /plans/fetch-previous-data-all-stores 用: DB 書き込みなしプレビュー
 */
export async function fetchPreviousDataAllStores({ tenantId, targetYear, targetMonth }) {
  const stores = await StoreRepository.findActiveByTenant(tenantId)
  if (stores.length === 0) {
    throw new NotFoundError('アクティブな店舗が見つかりません')
  }

  const { shifts: allSourceShifts, plansByStoreId: sourcePlanByStoreId } =
    await fetchPreviousSecondShifts(tenantId, targetYear, targetMonth)

  const activeStaffIds = new Set(await StaffRepository.findActiveStaffIds({ tenantId }))

  const staffShiftsByKey = {}
  for (const shift of allSourceShifts) {
    if (!activeStaffIds.has(shift.staff_id)) continue
    const shiftDate = new Date(shift.shift_date)
    const { weekNumber, dayOfWeek } = getWeekInfo(shiftDate)
    const key = `w${weekNumber}_d${dayOfWeek}`
    if (!staffShiftsByKey[shift.staff_id]) staffShiftsByKey[shift.staff_id] = {}
    if (!staffShiftsByKey[shift.staff_id][key]) staffShiftsByKey[shift.staff_id][key] = []
    staffShiftsByKey[shift.staff_id][key].push(shift)
  }

  const shiftsByStoreId = {}
  for (const store of stores) shiftsByStoreId[store.store_id] = []

  const daysInTargetMonth = new Date(targetYear, targetMonth, 0).getDate()
  for (let day = 1; day <= daysInTargetMonth; day++) {
    const newShiftDate = new Date(targetYear, targetMonth - 1, day)
    const { weekNumber, dayOfWeek } = getWeekInfo(newShiftDate)
    const primaryKey = `w${weekNumber}_d${dayOfWeek}`
    const fallbackKey = `w1_d${dayOfWeek}`

    for (const [staffIdStr, keyShifts] of Object.entries(staffShiftsByKey)) {
      let group = keyShifts[primaryKey]
      if (!group || group.length === 0) group = keyShifts[fallbackKey]
      if (!group || group.length === 0) continue
      for (const src of group) {
        const newShift = {
          store_id: src.store_id,
          staff_id: parseInt(staffIdStr),
          shift_date: formatDateToYYYYMMDD(newShiftDate),
          pattern_id: src.pattern_id,
          start_time: src.start_time,
          end_time: src.end_time,
          break_minutes: src.break_minutes,
        }
        if (shiftsByStoreId[src.store_id]) {
          shiftsByStoreId[src.store_id].push(newShift)
        }
      }
    }
  }

  return stores.map((store) => {
    const sourcePlan = sourcePlanByStoreId.get(store.store_id)
    return {
      store_id: store.store_id,
      store_name: store.store_name,
      source_plan: sourcePlan ? `${sourcePlan.plan_year}年${sourcePlan.plan_month}月` : null,
      shifts: shiftsByStoreId[store.store_id] || [],
    }
  })
}

/**
 * POST /plans/create-with-shifts 用: メモリ上のシフトを DB に登録
 */
export async function createWithShifts({
  tenantId, targetYear, targetMonth, createdBy, stores, planType = 'FIRST',
}) {
  if (!['FIRST', 'SECOND'].includes(planType)) {
    throw new ValidationError('plan_type は FIRST または SECOND である必要があります')
  }

  const createdPlans = []
  const errors = []

  for (const storeData of stores) {
    try {
      const { store_id, shifts } = storeData
      if (!store_id) {
        errors.push({ error: 'store_idが必要です', storeData })
        continue
      }

      const { planId, isNewPlan } = await transaction(async (client) => {
        const periodStart = new Date(targetYear, targetMonth - 1, 1)
        const periodEnd = new Date(targetYear, targetMonth, 0)
        const planTypeSuffix = planType === 'SECOND' ? '2' : '1'
        const planCode = `PLAN-${targetYear}${String(targetMonth).padStart(2, '0')}-${String(store_id).padStart(3, '0')}-${planTypeSuffix}`
        const planNameSuffix = planType === 'SECOND' ? '第2案' : '第1案'
        const planName = `${targetYear}年${targetMonth}月シフト（${planNameSuffix}）`

        const existingPlans = await ShiftPlanRepository.findByStoreMonthAndType(
          { tenantId, storeId: store_id, year: targetYear, month: targetMonth, planType }, client
        )

        let localPlanId
        let localIsNewPlan = false

        if (existingPlans.length > 0) {
          localPlanId = existingPlans[0].plan_id
          await ShiftRepository.deleteByPlanId(localPlanId, client)
        } else {
          const inserted = await ShiftPlanRepository.insertPlan({
            tenantId, storeId: store_id, year: targetYear, month: targetMonth,
            planCode, planName, periodStart, periodEnd,
            planType, generationType: 'MANUAL', createdBy: createdBy || null,
          }, client)
          localPlanId = inserted.plan_id
          localIsNewPlan = true
        }

        if (shifts && shifts.length > 0) {
          const rows = shifts.map((s) => ({
            tenant_id: tenantId,
            store_id,
            plan_id: localPlanId,
            staff_id: s.staff_id,
            shift_date: s.shift_date,
            pattern_id: s.pattern_id || null,
            start_time: s.start_time,
            end_time: s.end_time,
            break_minutes: s.break_minutes || 0,
          }))
          await ShiftRepository.insertBulk(rows, client)
        }

        return { planId: localPlanId, isNewPlan: localIsNewPlan }
      })

      createdPlans.push({
        plan_id: planId,
        store_id,
        shifts_count: shifts ? shifts.length : 0,
        is_new: isNewPlan,
      })
    } catch (err) {
      console.error(`  店舗ID ${storeData.store_id} でエラー:`, err)
      errors.push({ store_id: storeData.store_id, error: err.message })
    }
  }

  return { createdPlans, errors }
}

export default {
  ValidationError,
  NotFoundError,
  ConflictError,
  fetchShiftsData,
  fetchPreviousSecondShifts,
  generateFromPreviousMonth,
  copyFromPreviousMonth,
  copyFromPreviousAllStores,
  fetchPreviousDataAllStores,
  createWithShifts,
}
