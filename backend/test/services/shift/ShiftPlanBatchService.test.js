import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('axios', () => ({ default: { post: vi.fn() } }))

const axios = (await import('axios')).default
const service = (await import('../../../src/services/shift/ShiftPlanBatchService.js')).default
const planRepo = (await import('../../../src/repositories/shift/ShiftPlanRepository.js')).default
const storeRepo = (await import('../../../src/repositories/StoreRepository.js')).default

describe('ShiftPlanBatchService.verifyBatchApiKey', () => {
  afterEach(() => { delete process.env.BATCH_API_KEY })

  it('returns false when BATCH_API_KEY is not set', () => {
    expect(service.verifyBatchApiKey('anything')).toBe(false)
  })

  it('returns false when provided key differs', () => {
    process.env.BATCH_API_KEY = 'secret-key-value'
    expect(service.verifyBatchApiKey('wrong-value')).toBe(false)
  })

  it('returns false for empty provided key', () => {
    process.env.BATCH_API_KEY = 'secret-key-value'
    expect(service.verifyBatchApiKey('')).toBe(false)
  })

  it('returns true when provided key matches', () => {
    process.env.BATCH_API_KEY = 'secret-key-value'
    expect(service.verifyBatchApiKey('secret-key-value')).toBe(true)
  })
})

describe('ShiftPlanBatchService.validateTarget', () => {
  it('rejects non-integer year', () => {
    expect(() => service.validateTarget({ targetYear: 2026.5, targetMonth: 8, currentYear: 2026 }))
      .toThrow(/target_year/)
  })
  it('rejects month out of range', () => {
    expect(() => service.validateTarget({ targetYear: 2026, targetMonth: 13, currentYear: 2026 }))
      .toThrow()
  })
  it('rejects year too far in the past', () => {
    expect(() => service.validateTarget({ targetYear: 2020, targetMonth: 8, currentYear: 2026 }))
      .toThrow()
  })
  it('accepts current year + 5', () => {
    expect(() => service.validateTarget({ targetYear: 2031, targetMonth: 8, currentYear: 2026 }))
      .not.toThrow()
  })
})

describe('ShiftPlanBatchService.runMonthlyFirstPlanBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LIFF_BACKEND_URL = 'https://liff-backend.example.com'
    process.env.NOTIFICATION_ENABLED = 'true'
  })
  afterEach(() => {
    delete process.env.LIFF_BACKEND_URL
    delete process.env.NOTIFICATION_ENABLED
  })

  it('classifies inserted vs skipped stores based on the RETURNING flag', async () => {
    vi.spyOn(storeRepo, 'findActiveStoresForBatch').mockResolvedValueOnce([
      { tenant_id: 1, store_id: 1 },
      { tenant_id: 1, store_id: 2 },
    ])
    vi.spyOn(planRepo, 'upsertEmptyFirstPlan')
      .mockResolvedValueOnce({ plan_id: 10, inserted: true })
      .mockResolvedValueOnce({ plan_id: 20, inserted: false })
    axios.post.mockResolvedValue({ data: { ok: true } })

    const { created, skippedAlready, failed, failedNotification } =
      await service.runMonthlyFirstPlanBatch({ targetYear: 2026, targetMonth: 8 })

    expect(created).toEqual([{ tenant_id: 1, store_id: 1, plan_id: 10 }])
    expect(skippedAlready).toEqual([{ tenant_id: 1, store_id: 2 }])
    expect(failed).toEqual([])
    expect(failedNotification).toEqual([])
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('records notification failure without failing the batch', async () => {
    vi.spyOn(storeRepo, 'findActiveStoresForBatch').mockResolvedValueOnce([
      { tenant_id: 1, store_id: 1 },
    ])
    vi.spyOn(planRepo, 'upsertEmptyFirstPlan').mockResolvedValueOnce({ plan_id: 10, inserted: true })
    axios.post.mockRejectedValueOnce(new Error('LIFF timeout'))

    const { created, failedNotification } =
      await service.runMonthlyFirstPlanBatch({ targetYear: 2026, targetMonth: 8 })

    expect(created).toEqual([{ tenant_id: 1, store_id: 1, plan_id: 10 }])
    expect(failedNotification).toEqual([{ tenant_id: 1, store_id: 1, error: 'LIFF timeout' }])
  })
})
