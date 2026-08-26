import { transaction } from '../../config/database.js'
import ShiftPreferenceRepository from '../../repositories/shift/ShiftPreferenceRepository.js'
import SubmissionRepository from '../../repositories/shift/SubmissionRepository.js'

/**
 * シフト希望 (ops.shift_preferences) の CRUD + 一括入替 + 提出状況を集約するサービス。
 *
 * 例外: バリデーション NG は `ValidationError` を投げ、
 * リソース未発見は `NotFoundError` を投げる（ルートは HTTP マッピングのみ担当）。
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^([0-2][0-9]):([0-5][0-9])$/

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

/**
 * 一覧取得
 */
export async function list(params) {
  return ShiftPreferenceRepository.search(params)
}

/**
 * 詳細取得
 */
export async function findById({ id, tenantId }) {
  return ShiftPreferenceRepository.findById(id, tenantId)
}

/**
 * 提出状況一覧
 */
export async function getSubmissionStatus({ tenantId, year, month, storeId }) {
  const rows = await SubmissionRepository.findPreferenceSubmissionStatus({
    tenantId, year, month, storeId,
  })
  const total = rows.length
  const submittedCount = rows.filter((r) => r.submitted).length
  return {
    rows,
    summary: {
      total,
      submitted: submittedCount,
      unsubmitted: total - submittedCount,
      submission_rate: total === 0 ? 0 : submittedCount / total,
    },
  }
}

function assertTimeFormat(startTime, endTime) {
  if (startTime && !TIME_REGEX.test(startTime)) {
    throw new ValidationError('INVALID_START_TIME')
  }
  if (endTime && !TIME_REGEX.test(endTime)) {
    throw new ValidationError('INVALID_END_TIME')
  }
}

/**
 * 単一登録
 */
export async function create({
  tenantId, storeId, staffId, preferenceDate,
  isNg, startTime, endTime, notes,
}) {
  if (!DATE_REGEX.test(preferenceDate)) {
    throw new ValidationError('INVALID_PREFERENCE_DATE')
  }
  assertTimeFormat(startTime, endTime)

  const preferenceId = await ShiftPreferenceRepository.insert({
    tenantId, storeId, staffId, preferenceDate,
    isNg,
    startTime: startTime || null,
    endTime: endTime || null,
    notes: notes || null,
  })
  return ShiftPreferenceRepository.findDetailById(preferenceId)
}

/**
 * 部分更新
 */
export async function update({ id, tenantId, patch }) {
  const existing = await ShiftPreferenceRepository.findExistingRaw(id, tenantId)
  if (!existing) {
    throw new NotFoundError('SHIFT_PREFERENCE_NOT_FOUND')
  }

  const newIsNg = patch.is_ng !== undefined ? patch.is_ng : existing.is_ng
  const newStartTime = patch.start_time !== undefined ? patch.start_time : existing.start_time
  const newEndTime = patch.end_time !== undefined ? patch.end_time : existing.end_time
  const newNotes = patch.notes !== undefined ? patch.notes : existing.notes

  assertTimeFormat(newStartTime, newEndTime)

  await ShiftPreferenceRepository.updateById({
    id,
    tenantId,
    isNg: newIsNg,
    startTime: newStartTime,
    endTime: newEndTime,
    notes: newNotes,
  })

  return ShiftPreferenceRepository.findDetailById(id)
}

/**
 * 削除
 */
export async function remove({ id, tenantId }) {
  const existing = await ShiftPreferenceRepository.findExistingRaw(id, tenantId)
  if (!existing) {
    throw new NotFoundError('SHIFT_PREFERENCE_NOT_FOUND')
  }
  await ShiftPreferenceRepository.deleteById(id, tenantId)
  return {
    staff_id: existing.staff_id,
    preference_date: existing.preference_date,
  }
}

/**
 * 一括入替（対象月の既存レコードを全削除 → 新規挿入）
 */
export async function bulkReplace({
  tenantId, storeId, staffId, preferences, year, month,
}) {
  if (preferences.length === 0 && (!year || !month)) {
    throw new ValidationError('preferences が空の場合は年月が必須です')
  }

  for (const pref of preferences) {
    if (!pref.preference_date) {
      throw new ValidationError('各シフト希望に preference_date が必要です')
    }
    if (!DATE_REGEX.test(pref.preference_date)) {
      throw new ValidationError(
        `preference_date の形式が不正です: ${pref.preference_date}（YYYY-MM-DD 形式で指定してください）`
      )
    }
    if (pref.start_time && !TIME_REGEX.test(pref.start_time)) {
      throw new ValidationError(
        `start_time の形式が不正です: ${pref.start_time}（HH:MM 形式で指定してください）`
      )
    }
    if (pref.end_time && !TIME_REGEX.test(pref.end_time)) {
      throw new ValidationError(
        `end_time の形式が不正です: ${pref.end_time}（HH:MM 形式で指定してください）`
      )
    }
  }

  let targetYear
  let targetMonth
  if (preferences.length > 0) {
    const [y, m] = preferences[0].preference_date.substring(0, 7).split('-').map(Number)
    targetYear = y
    targetMonth = m
  } else {
    targetYear = Number(year)
    targetMonth = Number(month)
  }
  const startDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
  const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1
  const nextYear = targetMonth === 12 ? targetYear + 1 : targetYear
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

  return transaction(async (client) => {
    const deletedCount = await ShiftPreferenceRepository.deleteByStaffAndPeriod(
      { tenantId, staffId, startDate, endDate },
      client
    )

    const insertedIds = []
    for (const pref of preferences) {
      const id = await ShiftPreferenceRepository.insert(
        {
          tenantId,
          storeId,
          staffId,
          preferenceDate: pref.preference_date,
          isNg: pref.is_ng || false,
          startTime: pref.start_time || null,
          endTime: pref.end_time || null,
          notes: pref.notes || null,
        },
        client
      )
      insertedIds.push(id)
    }

    if (preferences.length > 0) {
      await SubmissionRepository.upsertMonthlySubmission(
        { tenantId, staffId, year: targetYear, month: targetMonth },
        client
      )
    }

    return { deletedCount, insertedIds }
  })
}

export default {
  ValidationError,
  NotFoundError,
  list,
  findById,
  getSubmissionStatus,
  create,
  update,
  remove,
  bulkReplace,
}
