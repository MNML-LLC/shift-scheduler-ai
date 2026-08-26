import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('axios', () => ({
  default: { post: vi.fn() },
}))

const { transaction } = await import('../../../src/config/database.js')
const axios = (await import('axios')).default
const service = (await import('../../../src/services/shift/ShiftPlanApprovalService.js')).default
const planRepo = (await import('../../../src/repositories/shift/ShiftPlanRepository.js')).default
const shiftRepo = (await import('../../../src/repositories/shift/ShiftRepository.js')).default

describe('ShiftPlanApprovalService.approveFirst', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NotFoundError when plan is missing', async () => {
    vi.spyOn(planRepo, 'findApprovalTargetById').mockResolvedValueOnce(null)
    await expect(service.approveFirst({ planId: 1, tenantId: 1 }))
      .rejects.toThrow('SHIFT_PLAN_NOT_FOUND')
  })

  it('updates status and returns APPROVED', async () => {
    vi.spyOn(planRepo, 'findApprovalTargetById').mockResolvedValueOnce({
      plan_id: 1, store_id: 5, plan_year: 2026, plan_month: 8,
    })
    const updateSpy = vi.spyOn(planRepo, 'updateStatus').mockResolvedValueOnce()

    const data = await service.approveFirst({ planId: 1, tenantId: 1 })
    expect(updateSpy).toHaveBeenCalledWith(1, 'APPROVED')
    expect(data).toEqual({ plan_id: 1, status: 'APPROVED' })
  })
})

describe('ShiftPlanApprovalService.confirm', () => {
  beforeEach(() => vi.clearAllMocks())

  afterEach(() => {
    delete process.env.LIFF_BACKEND_URL
    delete process.env.NOTIFICATION_ENABLED
  })

  it('throws ConflictError when plan is already CONFIRMED', async () => {
    vi.spyOn(planRepo, 'findApprovalTargetById').mockResolvedValueOnce({
      plan_id: 1, status: 'CONFIRMED',
    })
    await expect(service.confirm({ planId: 1, tenantId: 1, confirmedBy: null }))
      .rejects.toMatchObject({ name: 'ConflictError' })
  })

  it('throws ConflictError when plan is not APPROVED', async () => {
    vi.spyOn(planRepo, 'findApprovalTargetById').mockResolvedValueOnce({
      plan_id: 1, status: 'DRAFT',
    })
    await expect(service.confirm({ planId: 1, tenantId: 1, confirmedBy: null }))
      .rejects.toMatchObject({ name: 'ConflictError', message: 'PLAN_NOT_APPROVED' })
  })

  it('confirms an APPROVED plan and returns notification_sent=false when disabled', async () => {
    vi.spyOn(planRepo, 'findApprovalTargetById').mockResolvedValueOnce({
      plan_id: 1, tenant_id: 1, store_id: 5,
      plan_year: 2026, plan_month: 8, status: 'APPROVED',
    })
    vi.spyOn(planRepo, 'updateStatusWithApprover').mockResolvedValueOnce()

    const data = await service.confirm({ planId: 1, tenantId: 1, confirmedBy: null })
    expect(data).toEqual({
      plan_id: 1, status: 'CONFIRMED', notification_sent: false,
    })
  })
})

describe('ShiftPlanApprovalService.updateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LIFF_BACKEND_URL = 'https://liff-backend.example.com'
    process.env.NOTIFICATION_ENABLED = 'true'
  })

  afterEach(() => {
    delete process.env.LIFF_BACKEND_URL
    delete process.env.NOTIFICATION_ENABLED
  })

  it('rejects unknown status', async () => {
    await expect(service.updateStatus({ planId: 1, status: 'UNKNOWN' }))
      .rejects.toThrow(/DRAFT, APPROVED, CONFIRMED/)
  })

  it('throws ConflictError when trying to revert CONFIRMED', async () => {
    vi.spyOn(planRepo, 'findStatusChangeTargetById').mockResolvedValueOnce({
      plan_id: 1, status: 'CONFIRMED', plan_type: 'FIRST',
    })
    await expect(service.updateStatus({ planId: 1, status: 'DRAFT' }))
      .rejects.toMatchObject({ name: 'ConflictError' })
  })

  it('calls axios.post with 2-arg signature when APPROVED FIRST', async () => {
    vi.spyOn(planRepo, 'findStatusChangeTargetById').mockResolvedValueOnce({
      plan_id: 1, tenant_id: 1, store_id: 5,
      plan_year: 2026, plan_month: 8, status: 'DRAFT', plan_type: 'FIRST',
    })
    vi.spyOn(planRepo, 'updateStatus').mockResolvedValueOnce()
    axios.post.mockResolvedValueOnce({ data: { ok: true } })

    await service.updateStatus({ planId: 1, status: 'APPROVED' })
    expect(axios.post).toHaveBeenCalledWith(
      'https://liff-backend.example.com/api/notification/first-plan-approved',
      { tenant_id: 1, store_id: 5, plan_id: 1, year: 2026, month: 8 }
    )
  })

  it('calls axios.post with 3-arg signature (timeout) when CONFIRMED', async () => {
    vi.spyOn(planRepo, 'findStatusChangeTargetById').mockResolvedValueOnce({
      plan_id: 1, tenant_id: 1, store_id: 5,
      plan_year: 2026, plan_month: 8, status: 'APPROVED', plan_type: 'FIRST',
    })
    vi.spyOn(planRepo, 'updateStatus').mockResolvedValueOnce()
    axios.post.mockResolvedValueOnce({ data: { ok: true } })

    await service.updateStatus({ planId: 1, status: 'CONFIRMED' })
    expect(axios.post).toHaveBeenCalledWith(
      'https://liff-backend.example.com/api/notification/shift-confirmed',
      { tenant_id: 1, store_id: 5, plan_id: 1, year: 2026, month: 8 },
      { timeout: 10000 }
    )
  })
})

describe('ShiftPlanApprovalService.remove', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NotFoundError when the plan is missing', async () => {
    const client = { query: vi.fn() }
    transaction.mockImplementationOnce(async (cb) => cb(client))
    vi.spyOn(planRepo, 'findByIdAndTenant').mockResolvedValueOnce(null)
    await expect(service.remove({ planId: 1, tenantId: 1, now: new Date(2026, 7, 1) }))
      .rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('throws ForbiddenError for past months', async () => {
    const client = { query: vi.fn() }
    transaction.mockImplementationOnce(async (cb) => cb(client))
    vi.spyOn(planRepo, 'findByIdAndTenant').mockResolvedValueOnce({
      plan_id: 1, plan_year: 2025, plan_month: 12,
    })
    await expect(service.remove({ planId: 1, tenantId: 1, now: new Date(2026, 7, 1) }))
      .rejects.toMatchObject({ name: 'ForbiddenError', code: 'PAST_MONTH_DELETE' })
  })

  it('deletes shifts and plan for a future month', async () => {
    const client = { query: vi.fn() }
    transaction.mockImplementationOnce(async (cb) => cb(client))
    vi.spyOn(planRepo, 'findByIdAndTenant').mockResolvedValueOnce({
      plan_id: 1, plan_year: 2026, plan_month: 9,
    })
    const shiftDeleteSpy = vi.spyOn(shiftRepo, 'deleteByPlanIdAndTenant').mockResolvedValueOnce([
      { shift_id: 1 }, { shift_id: 2 },
    ])
    const planDeleteSpy = vi.spyOn(planRepo, 'deleteByIdAndTenant').mockResolvedValueOnce()

    const result = await service.remove({ planId: 1, tenantId: 1, now: new Date(2026, 7, 1) })
    expect(shiftDeleteSpy).toHaveBeenCalledWith(1, 1, client)
    expect(planDeleteSpy).toHaveBeenCalledWith(1, 1, client)
    expect(result.deletedShiftsCount).toBe(2)
  })
})
