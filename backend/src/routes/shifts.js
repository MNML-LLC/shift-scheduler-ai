import express from 'express'
import { DatabaseUnavailableError } from '../config/database.js'
import { VALIDATION_MESSAGES } from '../config/validation.js'
import ShiftGenerationService from '../services/shift/ShiftGenerationService.js'
import ShiftQueryService from '../services/shift/ShiftQueryService.js'
import ShiftPreferenceService from '../services/shift/ShiftPreferenceService.js'
import ShiftPersistenceService from '../services/shift/ShiftPersistenceService.js'
import ShiftPlanApprovalService from '../services/shift/ShiftPlanApprovalService.js'
import ShiftPlanBatchService from '../services/shift/ShiftPlanBatchService.js'
import ShiftPlanCopyService from '../services/shift/ShiftPlanCopyService.js'
import ShiftPlanAiPersistenceService from '../services/shift/ShiftPlanAiPersistenceService.js'
import aiStreamController from './shifts/aiStreamController.js'
import { notifyShiftGenerationError } from '../utils/slackNotifier.js'
import { MESSAGES } from '../constants/messages.js'

const router = express.Router()

// ============================================
// 共通ヘルパー
// ============================================

/**
 * try/catch + DatabaseUnavailableError の next() 委譲を統一するラッパー
 */
function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) return next(error)
      throw error
    }
  }
}

function respondFkError(res, error) {
  if (error.code !== '23503') return false
  res.status(400).json({ success: false, error: MESSAGES.VALIDATION.INVALID_REFERENCE, detail: error.detail })
  return true
}

function respondUniqueError(res, error, message) {
  if (error.code !== '23505') return false
  res.status(409).json({ success: false, error: message, detail: error.detail })
  return true
}

/**
 * サービス層のカスタムエラーを HTTP レスポンスにマップする。
 * 未処理なら false を返して呼び出し側に throw させる。
 */
function respondServiceError(res, error, config = {}) {
  const {
    notFoundMessage,
    conflictMessage,
    validationMessageMap = {},
  } = config

  if (error.name === 'NotFoundError') {
    res.status(404).json({
      success: false,
      error: notFoundMessage || error.message,
      ...(notFoundMessage ? { message: notFoundMessage } : {}),
    })
    return true
  }
  if (error.name === 'ForbiddenError') {
    res.status(403).json({
      success: false,
      error: validationMessageMap[error.code] || error.message,
      message: error.message,
    })
    return true
  }
  if (error.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: validationMessageMap[error.message] || error.message,
      ...(error.code ? { code: error.code } : {}),
    })
    return true
  }
  if (error.name === 'ConflictError') {
    const msg = conflictMessage || (error.message === 'PLAN_ALREADY_CONFIRMED'
      ? MESSAGES.CONFLICT.PLAN_ALREADY_CONFIRMED
      : error.message === 'PLAN_NOT_APPROVED'
        ? MESSAGES.CONFLICT.PLAN_NOT_APPROVED
        : error.message)
    const extras = {}
    if (error.current_status !== undefined) extras.current_status = error.current_status
    if (error.requested_status !== undefined) extras.requested_status = error.requested_status
    if (error.code) extras.code = error.code
    res.status(409).json({ success: false, error: msg, ...extras })
    return true
  }
  return false
}

/**
 * year/month の妥当性 + 過去月チェック（過去月は 400）
 */
function assertYearMonth(res, year, month, { pastMonthErrorKey = MESSAGES.VALIDATION.PAST_MONTH, checkPastMonth = true } = {}) {
  if (year < 2000 || year > 2100) {
    res.status(400).json({ success: false, error: MESSAGES.VALIDATION.INVALID_YEAR_RANGE })
    return false
  }
  if (month < 1 || month > 12) {
    res.status(400).json({ success: false, error: MESSAGES.VALIDATION.INVALID_MONTH_RANGE })
    return false
  }
  if (checkPastMonth) {
    const now = new Date()
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
      res.status(400).json({
        success: false, error: pastMonthErrorKey,
        message: `${year}年${month}月は過去の月のため、シフトを作成できません。`,
      })
      return false
    }
  }
  return true
}

function assertRequired(res, values, fields) {
  const missing = fields.some((k) => (k === 'break_minutes' ? values[k] === undefined : !values[k]))
  if (missing) {
    res.status(400).json({ success: false, error: MESSAGES.VALIDATION.MISSING_FIELDS, required: fields })
    return false
  }
  return true
}

// ============================================
// 参照系
// ============================================

router.get('/monthly-comments', asyncHandler(async (req, res) => {
  const { tenant_id, year, month, store_id } = req.query
  if (!tenant_id || !year || !month) {
    return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.TENANT_YEAR_MONTH_REQUIRED })
  }
  try {
    const rows = await ShiftQueryService.listMonthlyComments({
      tenantId: tenant_id, year, month, storeId: store_id,
    })
    res.json({ success: true, data: rows, count: rows.length })
  } catch (error) {
    console.error('Error fetching monthly comments:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.get('/submissions', asyncHandler(async (req, res) => {
  const { tenant_id, year, month, store_id } = req.query
  if (!tenant_id || !year || !month) {
    return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.TENANT_YEAR_MONTH_REQUIRED })
  }
  try {
    const rows = await ShiftQueryService.listSubmissions({
      tenantId: tenant_id, year, month, storeId: store_id,
    })
    res.json({ success: true, data: rows, count: rows.length })
  } catch (error) {
    console.error('Error fetching submissions:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.get('/plans', asyncHandler(async (req, res) => {
  try {
    const { tenant_id = 1, store_id, year, month, status } = req.query
    const rows = await ShiftQueryService.listPlans({
      tenantId: tenant_id, storeId: store_id, year, month, status,
    })
    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Error fetching shift plans:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.get('/summary', asyncHandler(async (req, res) => {
  const { tenant_id = 1, store_id, year, month, plan_type } = req.query
  if (!year) {
    return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.YEAR_REQUIRED })
  }
  try {
    const rows = await ShiftQueryService.getSummary({
      tenantId: tenant_id, year, storeId: store_id, month, planType: plan_type,
    })
    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Error fetching shift summary:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.get('/', asyncHandler(async (req, res) => {
  try {
    const {
      tenant_id = 1, plan_id, store_id, staff_id,
      year, month, date_from, date_to, is_modified, plan_type,
    } = req.query
    const rows = await ShiftQueryService.listShifts({
      tenantId: tenant_id, planId: plan_id, storeId: store_id, staffId: staff_id,
      year, month, dateFrom: date_from, dateTo: date_to,
      isModified: is_modified, planType: plan_type,
    })
    res.json({ success: true, data: rows, count: rows.length })
  } catch (error) {
    console.error('Error fetching shifts:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

// ============================================
// シフト計画: 生成 / AI / 承認 / 確定
// ============================================

router.post('/plans/generate', asyncHandler(async (req, res) => {
  const { tenant_id, store_id, year, month, created_by } = req.body
  if (!assertRequired(res, req.body, ['tenant_id', 'store_id', 'year', 'month'])) return
  if (!assertYearMonth(res, year, month)) return

  try {
    const result = await ShiftPlanCopyService.generateFromPreviousMonth({
      tenantId: tenant_id, storeId: store_id, year, month, createdBy: created_by,
    })
    const { isUpdate, copiedShiftsCount, detail, prevYear, prevMonth } = result
    const actionMessage = isUpdate
      ? `第1案シフトを更新しました（前月 ${prevYear}/${prevMonth} から ${copiedShiftsCount} 件コピー）`
      : `第1案シフトを作成しました（前月 ${prevYear}/${prevMonth} から ${copiedShiftsCount} 件コピー）`

    res.status(isUpdate ? 200 : 201).json({
      success: true, message: actionMessage, is_update: isUpdate,
      data: detail, copied_shifts_count: copiedShiftsCount,
      source_month: { year: prevYear, month: prevMonth },
      target_month: { year, month },
    })
  } catch (error) {
    if (respondServiceError(res, error)) return
    console.error('Error generating shift plan:', error)
    if (respondFkError(res, error)) return
    if (respondUniqueError(res, error, MESSAGES.CONFLICT.SHIFT_PLAN_EXISTS)) return

    res.locals.suppressGenericAlert = true
    await notifyShiftGenerationError('POST /api/shifts/plans/generate', error, req.body)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.get('/plans/generate-ai/stream', aiStreamController.handleAiGenerateStream)

router.post('/plans/generate-ai', asyncHandler(async (req, res) => {
  const { tenant_id, store_id, year, month, created_by, options = {} } = req.body
  if (!assertRequired(res, req.body, ['tenant_id', 'store_id', 'year', 'month'])) return
  if (!assertYearMonth(res, year, month, { pastMonthErrorKey: MESSAGES.VALIDATION.PAST_MONTH_CREATE })) return

  try {
    const service = new ShiftGenerationService()
    const result = await service.generateShifts(tenant_id, store_id, year, month, options)

    const { planId, isUpdate, insertedCount } = await ShiftPlanAiPersistenceService.persistAiShifts({
      tenantId: tenant_id, storeId: store_id, year, month, createdBy: created_by,
      options, result,
    })

    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: isUpdate
        ? `AI自動生成でシフトを更新しました (${insertedCount}件)`
        : `AI自動生成でシフトを作成しました (${insertedCount}件)`,
      is_update: isUpdate,
      data: {
        plan_id: planId, year, month, shifts_count: insertedCount,
        validation: result.validation.summary,
        violations: result.validation.violations,
        metadata: result.metadata,
      },
    })
  } catch (error) {
    console.error('[API] AI自動生成エラー:', error)
    res.locals.suppressGenericAlert = true
    await notifyShiftGenerationError('POST /api/shifts/plans/generate-ai', error, req.body)

    if (error.success === false) {
      return res.status(500).json({
        success: false, error: error.error, phase: error.phase, elapsed_ms: error.elapsed_ms,
      })
    }
    res.status(500).json({ success: false, error: error.message || 'AI自動生成中にエラーが発生しました' })
  }
}))

router.post('/plans/approve-first', asyncHandler(async (req, res) => {
  const { plan_id, tenant_id = 1 } = req.body
  if (!plan_id) return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.PLAN_ID_REQUIRED })
  try {
    const data = await ShiftPlanApprovalService.approveFirst({ planId: plan_id, tenantId: tenant_id })
    res.json({ success: true, message: MESSAGES.SUCCESS.FIRST_PLAN_APPROVED, data })
  } catch (error) {
    if (respondServiceError(res, error, { notFoundMessage: MESSAGES.NOT_FOUND.SHIFT_PLAN_NOT_FOUND })) return
    console.error('Error approving first plan:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/plans/:plan_id/confirm', asyncHandler(async (req, res) => {
  const { plan_id } = req.params
  const { tenant_id = 1, confirmed_by = null } = req.body
  if (!plan_id) return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.PLAN_ID_REQUIRED })
  try {
    const data = await ShiftPlanApprovalService.confirm({
      planId: plan_id, tenantId: tenant_id, confirmedBy: confirmed_by,
    })
    res.json({ success: true, message: MESSAGES.SUCCESS.SHIFT_CONFIRMED, data })
  } catch (error) {
    if (respondServiceError(res, error, { notFoundMessage: MESSAGES.NOT_FOUND.SHIFT_PLAN_NOT_FOUND })) return
    console.error('Error confirming shift plan:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/plans/monthly-first-plan-batch', asyncHandler(async (req, res) => {
  if (!ShiftPlanBatchService.verifyBatchApiKey(req.headers['x-batch-api-key'])) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  const targetYear = Number(req.body.target_year)
  const targetMonth = Number(req.body.target_month)
  try {
    ShiftPlanBatchService.validateTarget({
      targetYear, targetMonth, currentYear: new Date().getFullYear(),
    })
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message })
  }
  try {
    const { created, skippedAlready, failed, failedNotification } =
      await ShiftPlanBatchService.runMonthlyFirstPlanBatch({ targetYear, targetMonth })
    res.json({
      success: true,
      target_year: targetYear,
      target_month: targetMonth,
      created,
      skipped_already: skippedAlready,
      failed,
      failed_notification: failedNotification,
    })
  } catch (error) {
    console.error('Error running monthly first plan batch:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/plans/approve-second', asyncHandler(async (req, res) => {
  const {
    tenant_id = 1, store_id = 1, plan_id: firstPlanId,
    year, month, shifts, created_by = 1,
  } = req.body

  if (!firstPlanId || !year || !month || !shifts || !Array.isArray(shifts)) {
    return res.status(400).json({ success: false, error: 'plan_id、年、月、shifts は必須です' })
  }

  try {
    const result = await ShiftPlanApprovalService.approveSecond({
      tenantId: tenant_id, storeId: store_id, firstPlanId, year, month, shifts,
      createdBy: created_by,
      loggers: { warnStaffNotFound: (name) => console.warn(MESSAGES.LOG.STAFF_NOT_FOUND(name)) },
    })
    res.json({
      success: true,
      message: shifts.length === result.inserted_shifts
        ? '第2案を保存しました'
        : `第2案を保存しました（${result.inserted_shifts}/${shifts.length}件）`,
      data: {
        plan_id: result.plan_id, plan_type: 'SECOND', year, month,
        inserted_shifts: result.inserted_shifts, total_shifts: shifts.length,
        stats: result.stats,
      },
    })
  } catch (error) {
    if (respondServiceError(res, error, { notFoundMessage: MESSAGES.NOT_FOUND.FIRST_PLAN_NOT_FOUND })) return
    console.error('Error approving second plan:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.get('/plans/:id', asyncHandler(async (req, res) => {
  try {
    const data = await ShiftQueryService.getPlanDetail({
      planId: req.params.id, tenantId: req.query.tenant_id || 1,
    })
    if (!data) return res.status(404).json({ success: false, error: MESSAGES.NOT_FOUND.SHIFT_PLAN_NOT_FOUND })
    res.json({ success: true, data })
  } catch (error) {
    console.error('Error fetching shift plan:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

// ============================================
// シフト希望 (Shift Preferences)
// 設計書: docs/design-docs/20251126_shift_preferences_schema_change.html
// ============================================

const PREF_VALIDATION_MAP = {
  INVALID_PREFERENCE_DATE: MESSAGES.VALIDATION.INVALID_PREFERENCE_DATE,
  INVALID_START_TIME: MESSAGES.VALIDATION.INVALID_START_TIME,
  INVALID_END_TIME: MESSAGES.VALIDATION.INVALID_END_TIME,
}

router.get('/preferences', asyncHandler(async (req, res) => {
  try {
    const { tenant_id = 1, store_id, staff_id, date_from, date_to, is_ng } = req.query
    const rows = await ShiftPreferenceService.list({
      tenantId: tenant_id, storeId: store_id, staffId: staff_id,
      dateFrom: date_from, dateTo: date_to, isNg: is_ng,
    })
    res.json({ success: true, data: rows, count: rows.length })
  } catch (error) {
    console.error('Error fetching shift preferences:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.get('/preferences/submission-status', asyncHandler(async (req, res) => {
  const { tenant_id, year, month, store_id } = req.query
  if (!tenant_id || !year || !month) {
    return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.TENANT_YEAR_MONTH_REQUIRED })
  }
  const yearNum = parseInt(year, 10)
  const monthNum = parseInt(month, 10)
  if (!assertYearMonth(res, yearNum, monthNum, { checkPastMonth: false })) return
  try {
    const { rows, summary } = await ShiftPreferenceService.getSubmissionStatus({
      tenantId: tenant_id, year: yearNum, month: monthNum, storeId: store_id,
    })
    res.json({ success: true, data: rows, count: rows.length, summary })
  } catch (error) {
    console.error('Error fetching preferences submission status:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.get('/preferences/:id', asyncHandler(async (req, res) => {
  try {
    const data = await ShiftPreferenceService.findById({
      id: req.params.id, tenantId: req.query.tenant_id || 1,
    })
    if (!data) return res.status(404).json({ success: false, error: MESSAGES.NOT_FOUND.SHIFT_PREFERENCE_NOT_FOUND })
    res.json({ success: true, data })
  } catch (error) {
    console.error('Error fetching shift preference:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/preferences', asyncHandler(async (req, res) => {
  const {
    tenant_id, store_id, staff_id, preference_date,
    is_ng = false, start_time, end_time, notes,
  } = req.body
  if (!assertRequired(res, req.body, ['tenant_id', 'store_id', 'staff_id', 'preference_date'])) return

  try {
    const data = await ShiftPreferenceService.create({
      tenantId: tenant_id, storeId: store_id, staffId: staff_id,
      preferenceDate: preference_date, isNg: is_ng,
      startTime: start_time, endTime: end_time, notes,
    })
    res.status(201).json({ success: true, message: MESSAGES.SUCCESS.SHIFT_PREFERENCE_CREATED, data })
  } catch (error) {
    if (respondServiceError(res, error, { validationMessageMap: PREF_VALIDATION_MAP })) return
    console.error('Error creating shift preference:', error)
    if (respondFkError(res, error)) return
    if (respondUniqueError(res, error, MESSAGES.CONFLICT.SHIFT_PREFERENCE_EXISTS)) return
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.put('/preferences/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const { tenant_id } = req.query
  if (!tenant_id) return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.TENANT_ID_REQUIRED })
  try {
    const data = await ShiftPreferenceService.update({ id, tenantId: tenant_id, patch: req.body })
    res.json({ success: true, message: MESSAGES.SUCCESS.SHIFT_PREFERENCE_UPDATED, data })
  } catch (error) {
    if (respondServiceError(res, error, {
      notFoundMessage: MESSAGES.NOT_FOUND.SHIFT_PREFERENCE_NOT_FOUND,
      validationMessageMap: PREF_VALIDATION_MAP,
    })) return
    console.error('Error updating shift preference:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/preferences/bulk', asyncHandler(async (req, res) => {
  const {
    tenant_id, store_id, staff_id, preferences,
    year: requestYear, month: requestMonth,
  } = req.body

  if (!tenant_id || !store_id || !staff_id || !preferences || !Array.isArray(preferences)) {
    return res.status(400).json({
      success: false,
      error: MESSAGES.VALIDATION.MISSING_FIELDS,
      required: ['tenant_id', 'store_id', 'staff_id', 'preferences (array)'],
    })
  }

  try {
    const { deletedCount, insertedIds } = await ShiftPreferenceService.bulkReplace({
      tenantId: tenant_id, storeId: store_id, staffId: staff_id, preferences,
      year: requestYear, month: requestMonth,
    })
    res.status(201).json({
      success: true, message: MESSAGES.SUCCESS.BULK_OPERATION_COMPLETED,
      deleted: deletedCount, inserted: insertedIds.length, inserted_ids: insertedIds,
    })
  } catch (error) {
    if (respondServiceError(res, error)) return
    console.error('Error bulk creating shift preferences:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.delete('/preferences/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const { tenant_id } = req.query
  if (!tenant_id) return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.TENANT_ID_REQUIRED })
  try {
    const info = await ShiftPreferenceService.remove({ id, tenantId: tenant_id })
    res.json({
      success: true, message: MESSAGES.SUCCESS.SHIFT_PREFERENCE_DELETED,
      deleted_preference_id: parseInt(id),
      deleted_preference_info: info,
    })
  } catch (error) {
    if (respondServiceError(res, error, { notFoundMessage: MESSAGES.NOT_FOUND.SHIFT_PREFERENCE_NOT_FOUND })) return
    console.error('Error deleting shift preference:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

// ============================================
// 単一シフト
// NOTE: /:id 系は /preferences より後、かつ /plans/... より後に置く必要がある
// ============================================

const SHIFT_VALIDATION_MAP = {
  INVALID_BREAK_MINUTES: VALIDATION_MESSAGES.INVALID_BREAK_MINUTES,
  INVALID_BREAK_TIME_RANGE: MESSAGES.VALIDATION.INVALID_BREAK_TIME_RANGE,
}

router.get('/:id', asyncHandler(async (req, res) => {
  try {
    const data = await ShiftQueryService.getShiftById({
      shiftId: req.params.id, tenantId: req.query.tenant_id || 1,
    })
    if (!data) return res.status(404).json({ success: false, error: MESSAGES.NOT_FOUND.SHIFT_NOT_FOUND })
    res.json({ success: true, data })
  } catch (error) {
    console.error('Error fetching shift:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/', asyncHandler(async (req, res) => {
  const required = [
    'tenant_id', 'store_id', 'plan_id', 'staff_id', 'shift_date',
    'pattern_id', 'start_time', 'end_time', 'break_minutes',
  ]
  if (!assertRequired(res, req.body, required)) return

  try {
    const data = await ShiftPersistenceService.create(req.body)
    res.status(201).json({ success: true, message: MESSAGES.SUCCESS.SHIFT_CREATED, data })
  } catch (error) {
    if (respondServiceError(res, error, { validationMessageMap: SHIFT_VALIDATION_MAP })) return
    console.error('Error creating shift:', error)
    if (respondFkError(res, error)) return
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const { tenant_id } = req.query
  if (!tenant_id) return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.TENANT_ID_REQUIRED })
  try {
    const data = await ShiftPersistenceService.update({ id, tenantId: tenant_id, patch: req.body })
    res.json({ success: true, message: MESSAGES.SUCCESS.SHIFT_UPDATED, data })
  } catch (error) {
    if (respondServiceError(res, error, {
      notFoundMessage: MESSAGES.NOT_FOUND.SHIFT_NOT_FOUND,
      validationMessageMap: SHIFT_VALIDATION_MAP,
    })) return
    console.error('Error updating shift:', error)
    if (respondFkError(res, error)) return
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const { tenant_id } = req.query
  if (!tenant_id) return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.TENANT_ID_REQUIRED })
  try {
    const info = await ShiftPersistenceService.remove({ id, tenantId: tenant_id })
    res.json({
      success: true, message: MESSAGES.SUCCESS.SHIFT_DELETED,
      deleted_shift_id: parseInt(id),
      deleted_shift_info: {
        staff_id: info.staff_id, shift_date: info.shift_date,
        start_time: info.start_time, end_time: info.end_time,
      },
    })
  } catch (error) {
    if (respondServiceError(res, error, { notFoundMessage: MESSAGES.NOT_FOUND.SHIFT_NOT_FOUND })) return
    console.error('Error deleting shift:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

// ============================================
// シフト計画: 削除 / ステータス更新 / コピー
// ============================================

router.delete('/plans/:plan_id', asyncHandler(async (req, res) => {
  const { plan_id } = req.params
  const { tenant_id = 1 } = req.query
  if (!plan_id) return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.PLAN_ID_REQUIRED })
  try {
    const { plan, deletedShiftsCount } = await ShiftPlanApprovalService.remove({
      planId: plan_id, tenantId: tenant_id,
    })
    res.json({
      success: true,
      message: `${plan.plan_year}年${plan.plan_month}月のシフト計画を削除しました`,
      data: {
        deleted_plan_id: parseInt(plan_id),
        deleted_shifts_count: deletedShiftsCount,
        plan_year: plan.plan_year,
        plan_month: plan.plan_month,
        store_id: plan.store_id,
      },
    })
  } catch (error) {
    if (respondServiceError(res, error, {
      notFoundMessage: MESSAGES.NOT_FOUND.SHIFT_PLAN_NOT_FOUND,
      validationMessageMap: { PAST_MONTH_DELETE: MESSAGES.VALIDATION.PAST_MONTH_DELETE },
    })) return
    console.error('Error deleting shift plan:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.put('/plans/:plan_id/status', asyncHandler(async (req, res) => {
  const { plan_id } = req.params
  const { status } = req.body
  if (!plan_id) return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.PLAN_ID_REQUIRED })
  try {
    const data = await ShiftPlanApprovalService.updateStatus({ planId: plan_id, status })
    res.json({ success: true, message: `ステータスを${status}に更新しました`, data })
  } catch (error) {
    if (respondServiceError(res, error, {
      notFoundMessage: MESSAGES.NOT_FOUND.SHIFT_PLAN_NOT_FOUND,
      conflictMessage: MESSAGES.CONFLICT.CONFIRMED_CANNOT_REVERT,
      validationMessageMap: { STATUS_REQUIRED: MESSAGES.VALIDATION.STATUS_REQUIRED },
    })) return
    console.error('Error updating plan status:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/plans/copy-from-previous', asyncHandler(async (req, res) => {
  const { tenant_id = 1, store_id, target_year, target_month, created_by, overwrite = false } = req.body
  if (!store_id || !target_year || !target_month) {
    return res.status(400).json({ success: false, error: 'store_id, target_year, target_month は必須です' })
  }
  try {
    const result = await ShiftPlanCopyService.copyFromPreviousMonth({
      tenantId: tenant_id, storeId: store_id,
      targetYear: target_year, targetMonth: target_month,
      createdBy: created_by, overwrite,
    })
    const { newPlanId, insertedCount, skippedCount, fallbackCount, totalSourceCount, sourceYear, sourceMonth, validation } = result

    res.status(201).json({
      success: true,
      message: `${sourceYear}年${sourceMonth}月のシフトを${target_year}年${target_month}月にコピーしました`,
      inserted_shifts_count: insertedCount,
      data: {
        plan_id: newPlanId, plan_type: 'FIRST',
        source_year: sourceYear, source_month: sourceMonth,
        target_year, target_month,
        inserted_count: insertedCount,
        inserted_shifts_count: insertedCount,
        skipped_count: skippedCount,
        fallback_count: fallbackCount,
        total_source_count: totalSourceCount,
        validation,
      },
    })
  } catch (error) {
    if (respondServiceError(res, error)) return
    console.error('Error copying shifts from previous month:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/plans/copy-from-previous-all-stores', asyncHandler(async (req, res) => {
  const { tenant_id = 1, target_year, target_month, created_by } = req.body
  if (!target_year || !target_month) {
    return res.status(400).json({ success: false, error: 'target_year, target_month は必須です' })
  }
  try {
    const { createdPlans, errors } = await ShiftPlanCopyService.copyFromPreviousAllStores({
      tenantId: tenant_id, targetYear: target_year, targetMonth: target_month, createdBy: created_by,
    })
    res.json({
      success: true,
      message: `${createdPlans.length}店舗のプランを作成しました`,
      data: { created_plans: createdPlans, errors: errors.length > 0 ? errors : undefined },
    })
  } catch (error) {
    if (respondServiceError(res, error)) return
    console.error('Error copying shifts for all stores:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/plans/fetch-previous-data-all-stores', asyncHandler(async (req, res) => {
  const { tenant_id = 1, target_year, target_month } = req.body
  if (!target_year || !target_month) {
    return res.status(400).json({ success: false, error: 'target_year, target_month は必須です' })
  }
  try {
    const stores = await ShiftPlanCopyService.fetchPreviousDataAllStores({
      tenantId: tenant_id, targetYear: target_year, targetMonth: target_month,
    })
    res.json({
      success: true,
      message: `${stores.length}店舗のデータを取得しました`,
      data: { target_year, target_month, stores },
    })
  } catch (error) {
    if (respondServiceError(res, error)) return
    console.error('Error fetching previous data for all stores:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

router.post('/plans/create-with-shifts', asyncHandler(async (req, res) => {
  const { tenant_id = 1, target_year, target_month, created_by, stores, plan_type = 'FIRST' } = req.body
  if (!target_year || !target_month || !stores || !Array.isArray(stores)) {
    return res.status(400).json({ success: false, error: 'target_year, target_month, stores は必須です' })
  }
  try {
    const { createdPlans, errors } = await ShiftPlanCopyService.createWithShifts({
      tenantId: tenant_id, targetYear: target_year, targetMonth: target_month,
      createdBy: created_by, stores, planType: plan_type,
    })
    res.json({
      success: true,
      message: `${createdPlans.length}店舗のプランとシフトを作成しました`,
      data: { created_plans: createdPlans, errors: errors.length > 0 ? errors : undefined },
    })
  } catch (error) {
    if (respondServiceError(res, error)) return
    console.error('Error creating plans with shifts:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}))

// ============================================
// 一括 AI 生成 (SSE)
// ============================================

router.get('/plans/generate-bulk/stream', aiStreamController.handleBulkGenerateStream)

export default router
