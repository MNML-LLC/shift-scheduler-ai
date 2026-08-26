import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/config/database.js', () => ({
  query: vi.fn(),
}))

const { query: poolQuery } = await import('../../../src/config/database.js')
const ShiftPlanRepository = (await import('../../../src/repositories/shift/ShiftPlanRepository.js')).default

function makeClientMock() {
  return { query: vi.fn() }
}

describe('ShiftPlanRepository — executor selection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the pool query when no executor is passed', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'DRAFT' }] })
    const status = await ShiftPlanRepository.getStatusById(1)
    expect(status).toBe('DRAFT')
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })

  it('uses client.query when a client-like executor is passed', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rows: [{ status: 'APPROVED' }] })
    const status = await ShiftPlanRepository.getStatusById(1, client)
    expect(status).toBe('APPROVED')
    expect(client.query).toHaveBeenCalledTimes(1)
    expect(poolQuery).not.toHaveBeenCalled()
  })
})

describe('ShiftPlanRepository.getStatusById()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when no rows match', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rows: [] })
    const status = await ShiftPlanRepository.getStatusById(999, client)
    expect(status).toBeNull()
  })
})

describe('ShiftPlanRepository.findByIdAndTenant()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the first row on match', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({
      rows: [{ plan_id: 10, status: 'DRAFT', plan_year: 2026, plan_month: 9, store_id: 5 }],
    })
    const plan = await ShiftPlanRepository.findByIdAndTenant(10, 1, client)
    expect(plan.plan_id).toBe(10)
    expect(plan.store_id).toBe(5)
  })

  it('returns null when the plan is not found', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rows: [] })
    const plan = await ShiftPlanRepository.findByIdAndTenant(10, 1, client)
    expect(plan).toBeNull()
  })
})

describe('ShiftPlanRepository.findByStoreMonthForUpdate()', () => {
  it('adds FOR UPDATE lock modifier to the SELECT', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rows: [] })
    await ShiftPlanRepository.findByStoreMonthForUpdate(
      { tenantId: 1, storeId: 2, year: 2026, month: 9 },
      client
    )
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/FOR UPDATE/i)
    expect(params).toEqual([1, 2, 2026, 9])
  })
})

describe('ShiftPlanRepository.deleteByIdAndTenant()', () => {
  it('issues a DELETE with both plan_id and tenant_id', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rowCount: 1 })
    await ShiftPlanRepository.deleteByIdAndTenant(42, 1, client)
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM ops\.shift_plans/i)
    expect(sql).toMatch(/plan_id = \$1 AND tenant_id = \$2/)
    expect(params).toEqual([42, 1])
  })
})

describe('ShiftPlanRepository.updateAggregates()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates hours and cost only when constraint_violations is not supplied', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rowCount: 1 })
    await ShiftPlanRepository.updateAggregates(
      50,
      { totalLaborHours: 100.5, totalLaborCost: 120000 },
      client
    )
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).not.toMatch(/constraint_violations/)
    expect(params).toEqual([100.5, 120000, 50])
  })

  it('updates constraint_violations when supplied', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rowCount: 1 })
    await ShiftPlanRepository.updateAggregates(
      50,
      { totalLaborHours: 100.5, totalLaborCost: 120000, constraintViolations: 2 },
      client
    )
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/constraint_violations = \$3/)
    expect(params).toEqual([100.5, 120000, 2, 50])
  })
})

describe('ShiftPlanRepository.insertPlan()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the plan_type variant when planType is supplied', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({
      rows: [{ plan_id: 1, store_id: 5, plan_year: 2026, plan_month: 9, plan_type: 'FIRST', status: 'DRAFT' }],
    })
    const result = await ShiftPlanRepository.insertPlan(
      {
        tenantId: 1, storeId: 5, year: 2026, month: 9,
        planCode: 'PC', planName: 'PN',
        periodStart: '2026-09-01', periodEnd: '2026-09-30',
        planType: 'FIRST', generationType: 'MANUAL', createdBy: null,
      },
      client
    )
    expect(result.plan_id).toBe(1)
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/plan_type/)
    expect(params.length).toBe(12)
  })

  it('uses the ai_model_version variant when planType is null', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rows: [{ plan_id: 2 }] })
    const result = await ShiftPlanRepository.insertPlan(
      {
        tenantId: 1, storeId: 5, year: 2026, month: 9,
        planCode: 'PC', planName: 'PN',
        periodStart: '2026-09-01', periodEnd: '2026-09-30',
        generationType: 'AI_GENERATED', aiModelVersion: 'gpt-4o', createdBy: null,
      },
      client
    )
    expect(result.plan_id).toBe(2)
    const [sql] = client.query.mock.calls[0]
    expect(sql).toMatch(/ai_model_version/)
  })
})
