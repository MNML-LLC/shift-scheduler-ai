import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}))

const { transaction } = await import('../../../src/config/database.js')
const service = (await import('../../../src/services/shift/ShiftPreferenceService.js')).default
const preferenceRepo = (await import('../../../src/repositories/shift/ShiftPreferenceRepository.js')).default
const submissionRepo = (await import('../../../src/repositories/shift/SubmissionRepository.js')).default

describe('ShiftPreferenceService.create', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects invalid preference_date format', async () => {
    await expect(service.create({
      tenantId: 1, storeId: 1, staffId: 1,
      preferenceDate: '2026/08/01',
      isNg: false,
    })).rejects.toThrow('INVALID_PREFERENCE_DATE')
  })

  it('rejects invalid start_time format', async () => {
    await expect(service.create({
      tenantId: 1, storeId: 1, staffId: 1,
      preferenceDate: '2026-08-01',
      isNg: false, startTime: '9:00',
    })).rejects.toThrow('INVALID_START_TIME')
  })

  it('inserts and returns detail on success', async () => {
    vi.spyOn(preferenceRepo, 'insert').mockResolvedValueOnce(42)
    vi.spyOn(preferenceRepo, 'findDetailById').mockResolvedValueOnce({ preference_id: 42 })

    const data = await service.create({
      tenantId: 1, storeId: 1, staffId: 1,
      preferenceDate: '2026-08-01',
      isNg: false, startTime: '09:00', endTime: '18:00',
    })

    expect(preferenceRepo.insert).toHaveBeenCalledOnce()
    expect(data).toEqual({ preference_id: 42 })
  })
})

describe('ShiftPreferenceService.update', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NotFoundError when the preference does not exist', async () => {
    vi.spyOn(preferenceRepo, 'findExistingRaw').mockResolvedValueOnce(null)
    await expect(service.update({ id: 1, tenantId: 1, patch: {} }))
      .rejects.toThrow('SHIFT_PREFERENCE_NOT_FOUND')
  })

  it('merges patch with existing values before validating', async () => {
    vi.spyOn(preferenceRepo, 'findExistingRaw').mockResolvedValueOnce({
      preference_id: 1, is_ng: false,
      start_time: '09:00', end_time: '18:00', notes: null,
    })
    // patch specifies only is_ng; start_time/end_time inherited from existing.
    const updateSpy = vi.spyOn(preferenceRepo, 'updateById').mockResolvedValueOnce()
    vi.spyOn(preferenceRepo, 'findDetailById').mockResolvedValueOnce({ preference_id: 1, is_ng: true })

    const data = await service.update({ id: 1, tenantId: 1, patch: { is_ng: true } })
    expect(updateSpy).toHaveBeenCalledWith({
      id: 1, tenantId: 1, isNg: true,
      startTime: '09:00', endTime: '18:00', notes: null,
    })
    expect(data.is_ng).toBe(true)
  })
})

describe('ShiftPreferenceService.getSubmissionStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('summarizes to submission_rate of 0 when no rows', async () => {
    vi.spyOn(submissionRepo, 'findPreferenceSubmissionStatus').mockResolvedValueOnce([])
    const { summary } = await service.getSubmissionStatus({
      tenantId: 1, year: 2026, month: 8,
    })
    expect(summary).toEqual({ total: 0, submitted: 0, unsubmitted: 0, submission_rate: 0 })
  })

  it('computes submission_rate correctly', async () => {
    vi.spyOn(submissionRepo, 'findPreferenceSubmissionStatus').mockResolvedValueOnce([
      { staff_id: 1, submitted: true },
      { staff_id: 2, submitted: true },
      { staff_id: 3, submitted: false },
      { staff_id: 4, submitted: false },
    ])
    const { summary } = await service.getSubmissionStatus({
      tenantId: 1, year: 2026, month: 8,
    })
    expect(summary).toEqual({ total: 4, submitted: 2, unsubmitted: 2, submission_rate: 0.5 })
  })
})

describe('ShiftPreferenceService.bulkReplace', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an empty preferences list when year/month are missing', async () => {
    await expect(service.bulkReplace({
      tenantId: 1, storeId: 1, staffId: 1, preferences: [],
    })).rejects.toThrow('preferences が空の場合は年月が必須です')
  })

  it('deletes and inserts inside a transaction and upserts submission', async () => {
    const client = { query: vi.fn() }
    transaction.mockImplementationOnce(async (cb) => cb(client))

    vi.spyOn(preferenceRepo, 'deleteByStaffAndPeriod').mockResolvedValueOnce(3)
    const insertSpy = vi.spyOn(preferenceRepo, 'insert')
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102)
    const upsertSpy = vi.spyOn(submissionRepo, 'upsertMonthlySubmission').mockResolvedValueOnce()

    const result = await service.bulkReplace({
      tenantId: 1, storeId: 1, staffId: 5,
      preferences: [
        { preference_date: '2026-08-01', is_ng: false, start_time: '09:00', end_time: '18:00' },
        { preference_date: '2026-08-02', is_ng: true },
      ],
    })

    expect(result).toEqual({ deletedCount: 3, insertedIds: [101, 102] })
    expect(insertSpy).toHaveBeenCalledTimes(2)
    expect(upsertSpy).toHaveBeenCalledWith(
      { tenantId: 1, staffId: 5, year: 2026, month: 8 }, client
    )
  })

  it('skips submission upsert when preferences is empty', async () => {
    const client = { query: vi.fn() }
    transaction.mockImplementationOnce(async (cb) => cb(client))

    vi.spyOn(preferenceRepo, 'deleteByStaffAndPeriod').mockResolvedValueOnce(2)
    const upsertSpy = vi.spyOn(submissionRepo, 'upsertMonthlySubmission').mockResolvedValueOnce()

    const result = await service.bulkReplace({
      tenantId: 1, storeId: 1, staffId: 5,
      preferences: [], year: 2026, month: 9,
    })
    expect(result).toEqual({ deletedCount: 2, insertedIds: [] })
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})
