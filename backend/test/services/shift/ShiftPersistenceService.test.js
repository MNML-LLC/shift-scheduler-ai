import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}))

const { query } = await import('../../../src/config/database.js')
const service = (await import('../../../src/services/shift/ShiftPersistenceService.js')).default
const shiftRepo = (await import('../../../src/repositories/shift/ShiftRepository.js')).default
const planRepo = (await import('../../../src/repositories/shift/ShiftPlanRepository.js')).default
const staffRepo = (await import('../../../src/repositories/StaffRepository.js')).default

describe('ShiftPersistenceService.create', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws ValidationError for negative break_minutes', async () => {
    await expect(service.create({
      tenant_id: 1, store_id: 1, plan_id: 100, staff_id: 10,
      shift_date: '2026-08-01', pattern_id: 1,
      start_time: '09:00', end_time: '18:00',
      break_minutes: -1,
    })).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('throws ConflictError when plan is CONFIRMED', async () => {
    vi.spyOn(planRepo, 'getStatusById').mockResolvedValueOnce('CONFIRMED')

    await expect(service.create({
      tenant_id: 1, store_id: 1, plan_id: 100, staff_id: 10,
      shift_date: '2026-08-01', pattern_id: 1,
      start_time: '09:00', end_time: '18:00', break_minutes: 60,
    })).rejects.toMatchObject({ name: 'ConflictError', code: 'PLAN_CONFIRMED' })
  })

  it('inserts and returns detail on success', async () => {
    vi.spyOn(planRepo, 'getStatusById').mockResolvedValueOnce('DRAFT')
    // validateShiftTimeOverlap → query()
    query.mockResolvedValueOnce({ rows: [] })
    vi.spyOn(staffRepo, 'findHourlyRate').mockResolvedValueOnce({ hourly_rate: 1500 })
    vi.spyOn(shiftRepo, 'insertOne').mockResolvedValueOnce({ shift_id: 999 })
    vi.spyOn(shiftRepo, 'findShiftDetailByPlainId').mockResolvedValueOnce({ shift_id: 999, staff_name: 'A' })

    const data = await service.create({
      tenant_id: 1, store_id: 1, plan_id: 100, staff_id: 10,
      shift_date: '2026-08-01', pattern_id: 1,
      start_time: '09:00', end_time: '18:00', break_minutes: 60,
    })
    expect(data).toEqual({ shift_id: 999, staff_name: 'A' })
  })
})

describe('ShiftPersistenceService.update', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NotFoundError when the shift is missing', async () => {
    vi.spyOn(shiftRepo, 'findRawById').mockResolvedValueOnce(null)
    await expect(service.update({ id: 1, tenantId: 1, patch: {} }))
      .rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('sets is_modified=true when time fields change', async () => {
    vi.spyOn(shiftRepo, 'findRawById').mockResolvedValueOnce({
      shift_id: 1, plan_id: 100, tenant_id: 1, store_id: 1, staff_id: 5,
      shift_date: '2026-08-01', pattern_id: 1,
      start_time: '09:00:00', end_time: '18:00:00', break_minutes: 60,
      total_hours: 8, labor_cost: 12000,
      assigned_skills: null, is_preferred: false, is_modified: false, notes: null,
    })
    vi.spyOn(planRepo, 'getStatusById').mockResolvedValueOnce('DRAFT')
    query.mockResolvedValueOnce({ rows: [] })
    vi.spyOn(staffRepo, 'findHourlyRate').mockResolvedValueOnce({ hourly_rate: 1500 })
    const updateSpy = vi.spyOn(shiftRepo, 'updateOne').mockResolvedValueOnce()
    vi.spyOn(shiftRepo, 'findShiftDetailByPlainId').mockResolvedValueOnce({ shift_id: 1 })

    await service.update({
      id: 1, tenantId: 1,
      patch: { start_time: '10:00:00' },
    })
    expect(updateSpy.mock.calls[0][0].isModified).toBe(true)
  })
})

describe('ShiftPersistenceService.remove', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NotFoundError when the shift is missing', async () => {
    vi.spyOn(shiftRepo, 'findDeleteContextById').mockResolvedValueOnce(null)
    await expect(service.remove({ id: 1, tenantId: 1 }))
      .rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('throws ConflictError when plan is CONFIRMED', async () => {
    vi.spyOn(shiftRepo, 'findDeleteContextById').mockResolvedValueOnce({
      shift_id: 1, plan_id: 100, staff_id: 5, shift_date: '2026-08-01',
      start_time: '09:00', end_time: '18:00',
    })
    vi.spyOn(planRepo, 'getStatusById').mockResolvedValueOnce('CONFIRMED')
    await expect(service.remove({ id: 1, tenantId: 1 }))
      .rejects.toMatchObject({ name: 'ConflictError', code: 'PLAN_CONFIRMED' })
  })

  it('deletes the shift and returns context on success', async () => {
    vi.spyOn(shiftRepo, 'findDeleteContextById').mockResolvedValueOnce({
      shift_id: 1, plan_id: 100, staff_id: 5, shift_date: '2026-08-01',
      start_time: '09:00', end_time: '18:00',
    })
    vi.spyOn(planRepo, 'getStatusById').mockResolvedValueOnce('DRAFT')
    const deleteSpy = vi.spyOn(shiftRepo, 'deleteOne').mockResolvedValueOnce()

    const info = await service.remove({ id: 1, tenantId: 1 })
    expect(deleteSpy).toHaveBeenCalledWith(1, 1)
    expect(info.staff_id).toBe(5)
  })
})
