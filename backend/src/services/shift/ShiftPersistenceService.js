import ShiftRepository from '../../repositories/shift/ShiftRepository.js'
import ShiftPlanRepository from '../../repositories/shift/ShiftPlanRepository.js'
import StaffRepository from '../../repositories/StaffRepository.js'
import { validateShiftTimeOverlap } from '../../utils/shiftOverlap.js'
import { calculateWorkHours } from '../../utils/timeUtils.js'

/**
 * 単一シフトの CRUD（POST /、PUT /:id、DELETE /:id）を集約するサービス。
 *
 * バリデーション NG は `ValidationError`（extra に code を持たせる場合あり）、
 * 未発見は `NotFoundError`、確定済み等は `ConflictError` を投げる。
 * total_hours / labor_cost の自動計算もここに集約する。
 */

export class ValidationError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'ValidationError'
    Object.assign(this, extra)
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'ConflictError'
    Object.assign(this, extra)
  }
}

async function resolveLaborCost({ tenantId, staffId, totalHours }, executor) {
  const staff = await StaffRepository.findHourlyRate({ staffId, tenantId }, executor)
  if (!staff || !staff.hourly_rate) return null
  return Math.round(parseFloat(staff.hourly_rate) * parseFloat(totalHours))
}

/**
 * シフト登録
 */
export async function create(input) {
  const {
    tenant_id, store_id, plan_id, staff_id, shift_date, pattern_id,
    start_time, end_time, break_minutes, total_hours, labor_cost,
    assigned_skills, is_preferred = false, is_modified = false, notes,
  } = input

  if (break_minutes < 0) {
    throw new ValidationError('INVALID_BREAK_MINUTES')
  }

  const planStatus = await ShiftPlanRepository.getStatusById(plan_id)
  if (planStatus === 'CONFIRMED') {
    throw new ConflictError('PLAN_ALREADY_CONFIRMED', { code: 'PLAN_CONFIRMED' })
  }

  const overlap = await validateShiftTimeOverlap({
    tenant_id, staff_id, shift_date, start_time, end_time, plan_id,
  })
  if (!overlap.valid) {
    throw new ValidationError(overlap.error, { code: 'TIME_OVERLAP' })
  }

  let calculatedTotalHours = total_hours
  if (calculatedTotalHours === undefined || calculatedTotalHours === null) {
    const hours = calculateWorkHours(start_time, end_time, break_minutes)
    if (hours < 0) {
      throw new ValidationError('INVALID_BREAK_TIME_RANGE')
    }
    calculatedTotalHours = hours.toFixed(2)
  }

  let calculatedLaborCost = labor_cost
  if (calculatedLaborCost === undefined || calculatedLaborCost === null) {
    calculatedLaborCost = await resolveLaborCost({
      tenantId: tenant_id, staffId: staff_id, totalHours: calculatedTotalHours,
    })
  }

  const assignedSkillsJson = assigned_skills ? JSON.stringify(assigned_skills) : null

  const inserted = await ShiftRepository.insertOne({
    tenantId: tenant_id, storeId: store_id, planId: plan_id, staffId: staff_id,
    shiftDate: shift_date, patternId: pattern_id,
    startTime: start_time, endTime: end_time, breakMinutes: break_minutes,
    totalHours: calculatedTotalHours, laborCost: calculatedLaborCost,
    assignedSkills: assignedSkillsJson,
    isPreferred: is_preferred, isModified: is_modified, notes,
  })

  return ShiftRepository.findShiftDetailByPlainId(inserted.shift_id)
}

/**
 * シフト更新（部分更新）
 */
export async function update({ id, tenantId, patch }) {
  const existing = await ShiftRepository.findRawById(id, tenantId)
  if (!existing) {
    throw new NotFoundError('SHIFT_NOT_FOUND')
  }

  const planStatus = await ShiftPlanRepository.getStatusById(existing.plan_id)
  if (planStatus === 'CONFIRMED') {
    throw new ConflictError('PLAN_ALREADY_CONFIRMED', { code: 'PLAN_CONFIRMED' })
  }

  const {
    start_time, end_time, break_minutes, shift_date, pattern_id,
    staff_id, store_id, total_hours, labor_cost, assigned_skills,
    is_preferred, is_modified, notes,
  } = patch

  const newStartTime = start_time !== undefined ? start_time : existing.start_time
  const newEndTime = end_time !== undefined ? end_time : existing.end_time
  const newBreakMinutes = break_minutes !== undefined ? break_minutes : existing.break_minutes
  const newShiftDate = shift_date !== undefined ? shift_date : existing.shift_date
  const newPatternId = pattern_id !== undefined ? pattern_id : existing.pattern_id
  const newStaffId = staff_id !== undefined ? staff_id : existing.staff_id
  const newStoreId = store_id !== undefined ? store_id : existing.store_id
  const newIsPreferred = is_preferred !== undefined ? is_preferred : existing.is_preferred
  const newNotes = notes !== undefined ? notes : existing.notes

  if (newBreakMinutes < 0) {
    throw new ValidationError('INVALID_BREAK_MINUTES')
  }

  if (staff_id !== undefined || shift_date !== undefined ||
      start_time !== undefined || end_time !== undefined) {
    const overlap = await validateShiftTimeOverlap({
      tenant_id: tenantId,
      staff_id: newStaffId,
      shift_date: newShiftDate,
      start_time: newStartTime,
      end_time: newEndTime,
      shift_id: parseInt(id, 10),
      plan_id: existing.plan_id,
    })
    if (!overlap.valid) {
      throw new ValidationError(overlap.error, { code: 'TIME_OVERLAP' })
    }
  }

  let newIsModified = is_modified !== undefined ? is_modified : existing.is_modified
  if (start_time !== undefined || end_time !== undefined || break_minutes !== undefined) {
    newIsModified = true
  }

  let calculatedTotalHours = total_hours
  if (calculatedTotalHours === undefined) {
    if (start_time !== undefined || end_time !== undefined || break_minutes !== undefined) {
      const hours = calculateWorkHours(newStartTime, newEndTime, newBreakMinutes)
      if (hours < 0) {
        throw new ValidationError('INVALID_BREAK_TIME_RANGE')
      }
      calculatedTotalHours = hours.toFixed(2)
    } else {
      calculatedTotalHours = existing.total_hours
    }
  }

  let calculatedLaborCost = labor_cost
  if (calculatedLaborCost === undefined) {
    if (start_time !== undefined || end_time !== undefined ||
        break_minutes !== undefined || staff_id !== undefined) {
      calculatedLaborCost = await resolveLaborCost({
        tenantId, staffId: newStaffId, totalHours: calculatedTotalHours,
      })
    } else {
      calculatedLaborCost = existing.labor_cost
    }
  }

  const assignedSkillsJson = assigned_skills !== undefined
    ? (assigned_skills ? JSON.stringify(assigned_skills) : null)
    : existing.assigned_skills

  let newPlanId = existing.plan_id
  if (store_id !== undefined && parseInt(store_id) !== existing.store_id) {
    const oldPlan = await ShiftPlanRepository.findMetaById(existing.plan_id)
    if (oldPlan) {
      const existingPlan = await ShiftPlanRepository.findPlanIdByStoreMonthType({
        tenantId,
        storeId: store_id,
        year: oldPlan.plan_year,
        month: oldPlan.plan_month,
        planType: oldPlan.plan_type,
      })
      if (existingPlan) {
        newPlanId = existingPlan.plan_id
      } else {
        const periodStart = new Date(oldPlan.plan_year, oldPlan.plan_month - 1, 1)
        const periodEnd = new Date(oldPlan.plan_year, oldPlan.plan_month, 0)
        const planCode = `PLAN-${oldPlan.plan_year}${String(oldPlan.plan_month).padStart(2, '0')}-${String(store_id).padStart(3, '0')}`
        const planName = `${oldPlan.plan_year}年${oldPlan.plan_month}月シフト（${oldPlan.plan_type === 'FIRST' ? '第1案' : '第2案'}）`
        newPlanId = await ShiftPlanRepository.insertStoreTransferPlan({
          tenantId,
          storeId: store_id,
          year: oldPlan.plan_year,
          month: oldPlan.plan_month,
          planCode, planName, periodStart, periodEnd,
          planType: oldPlan.plan_type,
          status: oldPlan.status,
        })
      }
    }
  }

  await ShiftRepository.updateOne({
    shiftId: id, tenantId,
    shiftDate: newShiftDate, patternId: newPatternId,
    staffId: newStaffId, storeId: newStoreId, planId: newPlanId,
    startTime: newStartTime, endTime: newEndTime,
    breakMinutes: newBreakMinutes, totalHours: calculatedTotalHours,
    laborCost: calculatedLaborCost, assignedSkills: assignedSkillsJson,
    isPreferred: newIsPreferred, isModified: newIsModified, notes: newNotes,
  })

  return ShiftRepository.findShiftDetailByPlainId(id)
}

/**
 * シフト削除
 */
export async function remove({ id, tenantId }) {
  const context = await ShiftRepository.findDeleteContextById(id, tenantId)
  if (!context) {
    throw new NotFoundError('SHIFT_NOT_FOUND')
  }

  const planStatus = await ShiftPlanRepository.getStatusById(context.plan_id)
  if (planStatus === 'CONFIRMED') {
    throw new ConflictError('PLAN_ALREADY_CONFIRMED', { code: 'PLAN_CONFIRMED' })
  }

  await ShiftRepository.deleteOne(id, tenantId)
  return context
}

export default {
  ValidationError,
  NotFoundError,
  ConflictError,
  create,
  update,
  remove,
}
