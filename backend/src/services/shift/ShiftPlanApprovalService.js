import axios from 'axios'
import { transaction } from '../../config/database.js'
import ShiftPlanRepository from '../../repositories/shift/ShiftPlanRepository.js'
import ShiftRepository from '../../repositories/shift/ShiftRepository.js'
import StaffRepository from '../../repositories/StaffRepository.js'
import NotificationService from './NotificationService.js'

/**
 * シフト計画の承認・確定・ステータス更新・削除を集約するサービス。
 * LINE 通知の分岐もここで完結させる（呼び出し側は結果を返すだけ）。
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

export class ForbiddenError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'ForbiddenError'
    Object.assign(this, extra)
  }
}

const VALID_STATUSES = ['DRAFT', 'APPROVED', 'CONFIRMED']

function shouldSendLineNotification() {
  return NotificationService.isEnabled() && !!process.env.LIFF_BACKEND_URL
}

/**
 * 第1案承認
 */
export async function approveFirst({ planId, tenantId }) {
  const plan = await ShiftPlanRepository.findApprovalTargetById(planId, tenantId)
  if (!plan) {
    throw new NotFoundError('SHIFT_PLAN_NOT_FOUND')
  }
  await ShiftPlanRepository.updateStatus(planId, 'APPROVED')

  if (shouldSendLineNotification()) {
    try {
      await NotificationService.notifyFirstPlanApproved({
        tenant_id: tenantId,
        store_id: plan.store_id,
        plan_id: planId,
        year: plan.plan_year,
        month: plan.plan_month,
      })
      console.log('LINE notification sent for first plan approval')
    } catch (err) {
      console.error('Failed to send LINE notification:', err.message)
    }
  } else if (!NotificationService.isEnabled()) {
    console.log('LINE notification skipped: NOTIFICATION_ENABLED is not "true"')
  }

  return { plan_id: planId, status: 'APPROVED' }
}

/**
 * シフト確定（APPROVED → CONFIRMED）
 */
export async function confirm({ planId, tenantId, confirmedBy }) {
  const plan = await ShiftPlanRepository.findApprovalTargetById(planId, tenantId)
  if (!plan) {
    throw new NotFoundError('SHIFT_PLAN_NOT_FOUND')
  }
  if (plan.status === 'CONFIRMED') {
    throw new ConflictError('PLAN_ALREADY_CONFIRMED', { current_status: plan.status })
  }
  if (plan.status !== 'APPROVED') {
    throw new ConflictError('PLAN_NOT_APPROVED', { current_status: plan.status })
  }

  await ShiftPlanRepository.updateStatusWithApprover(planId, 'CONFIRMED', confirmedBy)

  let notificationSent = false
  if (shouldSendLineNotification()) {
    try {
      await NotificationService.notifyShiftConfirmed({
        tenant_id: plan.tenant_id,
        store_id: plan.store_id,
        plan_id: parseInt(planId, 10),
        year: plan.plan_year,
        month: plan.plan_month,
      })
      notificationSent = true
      console.log('LINE shift-confirmed notification sent')
    } catch (err) {
      console.error('Failed to send shift-confirmed notification:', err.message)
    }
  } else if (!NotificationService.isEnabled()) {
    console.log('shift-confirmed notification skipped: NOTIFICATION_ENABLED is not "true"')
  }

  return {
    plan_id: parseInt(planId, 10),
    status: 'CONFIRMED',
    notification_sent: notificationSent,
  }
}

/**
 * ステータス更新（DRAFT/APPROVED/CONFIRMED）
 * FIRST の APPROVED と、CONFIRMED への遷移時に LINE 通知する。
 */
export async function updateStatus({ planId, status }) {
  if (!status) {
    throw new ValidationError('STATUS_REQUIRED')
  }
  if (!VALID_STATUSES.includes(status)) {
    throw new ValidationError(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`)
  }

  const plan = await ShiftPlanRepository.findStatusChangeTargetById(planId)
  if (!plan) {
    throw new NotFoundError('SHIFT_PLAN_NOT_FOUND')
  }

  if (plan.status === 'CONFIRMED' && status !== 'CONFIRMED') {
    throw new ConflictError('CONFIRMED_CANNOT_REVERT', {
      current_status: plan.status,
      requested_status: status,
    })
  }

  await ShiftPlanRepository.updateStatus(planId, status)

  // NOTE: 過去互換のため updateStatus() の axios 呼び出しは NotificationService を
  // 経由せず、既存の 2 引数呼び出し（FIRST APPROVED）/ 3 引数呼び出し（CONFIRMED, timeout 付き）
  // シグネチャをそのまま維持する（shifts.plan-status.test.js の toHaveBeenCalledWith と一致）。
  if (status === 'APPROVED' && plan.plan_type === 'FIRST') {
    if (shouldSendLineNotification()) {
      try {
        await axios.post(`${process.env.LIFF_BACKEND_URL}/api/notification/first-plan-approved`, {
          tenant_id: plan.tenant_id,
          store_id: plan.store_id,
          plan_id: parseInt(planId),
          year: plan.plan_year,
          month: plan.plan_month,
        })
        console.log('LINE notification sent for first plan approval')
      } catch (err) {
        console.error('Failed to send LINE notification:', err.message)
      }
    } else if (!NotificationService.isEnabled()) {
      console.log('LINE notification skipped: NOTIFICATION_ENABLED is not "true"')
    }
  }

  if (status === 'CONFIRMED') {
    if (shouldSendLineNotification()) {
      try {
        await axios.post(
          `${process.env.LIFF_BACKEND_URL}/api/notification/shift-confirmed`,
          {
            tenant_id: plan.tenant_id,
            store_id: plan.store_id,
            plan_id: parseInt(planId),
            year: plan.plan_year,
            month: plan.plan_month,
          },
          { timeout: 10000 }
        )
        console.log('LINE shift-confirmed notification sent')
      } catch (err) {
        console.error('Failed to send shift-confirmed notification:', err.message)
      }
    } else if (!NotificationService.isEnabled()) {
      console.log('shift-confirmed notification skipped: NOTIFICATION_ENABLED is not "true"')
    }
  }

  return {
    plan_id: parseInt(planId),
    old_status: plan.status,
    new_status: status,
  }
}

/**
 * 第2案 保存（差替え or 新規作成）
 */
export async function approveSecond({
  tenantId, storeId, firstPlanId, year, month, shifts, createdBy,
  loggers = { warnStaffNotFound: () => {} },
}) {
  const first = await ShiftPlanRepository.findApprovalTargetById(firstPlanId, tenantId)
  if (!first) {
    throw new NotFoundError('FIRST_PLAN_NOT_FOUND')
  }

  const existingSecond = await ShiftPlanRepository.findSecondPlanId({
    tenantId, storeId, year, month,
  })

  let secondPlanId
  if (existingSecond) {
    secondPlanId = existingSecond.plan_id
    await ShiftRepository.deleteByPlanAndTenant(secondPlanId, tenantId)
    await ShiftPlanRepository.resetSecondPlanToDraft(secondPlanId)
  } else {
    secondPlanId = await ShiftPlanRepository.insertSecondPlan({
      tenantId, storeId, year, month, createdBy,
    })
  }

  let insertedCount = 0
  for (const shift of shifts) {
    const shiftDate = `${year}-${String(month).padStart(2, '0')}-${String(shift.date).padStart(2, '0')}`
    const staffId = await StaffRepository.findIdByName({ name: shift.name, tenantId })
    if (!staffId) {
      loggers.warnStaffNotFound(shift.name)
      continue
    }
    const [startHour, endHour] = shift.time.split('-')
    const startTime = `${startHour.padStart(2, '0')}:00:00`
    const endTime = `${endHour.padStart(2, '0')}:00:00`
    const hours = parseInt(endHour) - parseInt(startHour)
    const hourlyWage = await StaffRepository.findHourlyWageById(staffId)
    const cost = hours * hourlyWage

    await ShiftRepository.insertSimpleShift({
      tenantId, planId: secondPlanId, shiftDate, staffId,
      startTime, endTime, hours, cost,
      isPreferred: shift.preferred || false,
      skillLevel: shift.skill || 1,
    })
    insertedCount++
  }

  const stats = await ShiftRepository.statsByPlanId(secondPlanId)
  return {
    plan_id: secondPlanId,
    inserted_shifts: insertedCount,
    total_shifts: shifts.length,
    stats,
  }
}

/**
 * シフト計画の削除
 * トランザクション内で 404/403 を判定し、失敗時はロールバックさせる。
 */
export async function remove({ planId, tenantId, now = new Date() }) {
  return transaction(async (client) => {
    const plan = await ShiftPlanRepository.findByIdAndTenant(planId, tenantId, client)
    if (!plan) {
      throw new NotFoundError('SHIFT_PLAN_NOT_FOUND')
    }

    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const isPastMonth = plan.plan_year < currentYear ||
      (plan.plan_year === currentYear && plan.plan_month < currentMonth)

    if (isPastMonth) {
      throw new ForbiddenError(`${plan.plan_year}年${plan.plan_month}月は過去月のため削除できません`, {
        code: 'PAST_MONTH_DELETE',
      })
    }

    const deletedShifts = await ShiftRepository.deleteByPlanIdAndTenant(planId, tenantId, client)
    await ShiftPlanRepository.deleteByIdAndTenant(planId, tenantId, client)

    return { plan, deletedShiftsCount: deletedShifts.length }
  })
}

export default {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  approveFirst,
  confirm,
  updateStatus,
  approveSecond,
  remove,
}
