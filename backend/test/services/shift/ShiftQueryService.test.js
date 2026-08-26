import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/config/database.js', () => ({
  query: vi.fn(),
}))

const service = (await import('../../../src/services/shift/ShiftQueryService.js')).default
const submissionRepo = (await import('../../../src/repositories/shift/SubmissionRepository.js')).default
const planRepo = (await import('../../../src/repositories/shift/ShiftPlanRepository.js')).default
const shiftRepo = (await import('../../../src/repositories/shift/ShiftRepository.js')).default

describe('ShiftQueryService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listMonthlyComments delegates to SubmissionRepository', async () => {
    const spy = vi.spyOn(submissionRepo, 'findMonthlyComments').mockResolvedValueOnce([{ staff_id: 1 }])
    const rows = await service.listMonthlyComments({ tenantId: 1, year: 2026, month: 8 })
    expect(spy).toHaveBeenCalledWith({ tenantId: 1, year: 2026, month: 8 })
    expect(rows).toEqual([{ staff_id: 1 }])
  })

  it('listSubmissions delegates to SubmissionRepository', async () => {
    const spy = vi.spyOn(submissionRepo, 'findSubmissions').mockResolvedValueOnce([])
    await service.listSubmissions({ tenantId: 1, year: 2026, month: 8, storeId: 5 })
    expect(spy).toHaveBeenCalledWith({ tenantId: 1, year: 2026, month: 8, storeId: 5 })
  })

  it('listPlans delegates to ShiftPlanRepository.findList', async () => {
    const spy = vi.spyOn(planRepo, 'findList').mockResolvedValueOnce([])
    await service.listPlans({ tenantId: 1 })
    expect(spy).toHaveBeenCalledWith({ tenantId: 1 })
  })

  it('getSummary delegates to ShiftPlanRepository.findSummary', async () => {
    const spy = vi.spyOn(planRepo, 'findSummary').mockResolvedValueOnce([])
    await service.getSummary({ tenantId: 1, year: 2026 })
    expect(spy).toHaveBeenCalledWith({ tenantId: 1, year: 2026 })
  })

  it('getPlanDetail delegates to ShiftPlanRepository.findDetailById', async () => {
    const spy = vi.spyOn(planRepo, 'findDetailById').mockResolvedValueOnce({ plan_id: 1 })
    const data = await service.getPlanDetail({ planId: 1, tenantId: 1 })
    expect(spy).toHaveBeenCalledWith({ planId: 1, tenantId: 1 })
    expect(data).toEqual({ plan_id: 1 })
  })

  it('listShifts delegates to ShiftRepository.searchShifts', async () => {
    const spy = vi.spyOn(shiftRepo, 'searchShifts').mockResolvedValueOnce([])
    await service.listShifts({ tenantId: 1, storeId: 5 })
    expect(spy).toHaveBeenCalledWith({ tenantId: 1, storeId: 5 })
  })

  it('getShiftById delegates to ShiftRepository.findShiftById', async () => {
    const spy = vi.spyOn(shiftRepo, 'findShiftById').mockResolvedValueOnce({ shift_id: 1 })
    const data = await service.getShiftById({ shiftId: 1, tenantId: 1 })
    expect(spy).toHaveBeenCalledWith({ shiftId: 1, tenantId: 1 })
    expect(data).toEqual({ shift_id: 1 })
  })
})
