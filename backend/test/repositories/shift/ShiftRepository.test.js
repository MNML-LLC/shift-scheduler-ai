import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/config/database.js', () => ({
  query: vi.fn(),
}))

const { query: poolQuery } = await import('../../../src/config/database.js')
const ShiftRepository = (await import('../../../src/repositories/shift/ShiftRepository.js')).default

function makeClientMock() {
  return { query: vi.fn() }
}

describe('ShiftRepository — executor selection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses pool.query when no executor is passed', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    await ShiftRepository.deleteByPlanId(1)
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })

  it('uses client.query when an executor is passed', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rows: [] })
    await ShiftRepository.deleteByPlanId(1, client)
    expect(client.query).toHaveBeenCalledTimes(1)
    expect(poolQuery).not.toHaveBeenCalled()
  })
})

describe('ShiftRepository.deleteByPlanIdAndTenant()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the deleted shift_id list from RETURNING', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rows: [{ shift_id: 1 }, { shift_id: 2 }] })
    const rows = await ShiftRepository.deleteByPlanIdAndTenant(10, 1, client)
    expect(rows).toHaveLength(2)
    expect(rows[0].shift_id).toBe(1)
  })
})

describe('ShiftRepository.sumByPlanId()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the single aggregate row', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({
      rows: [{ shift_count: 10, total_hours: 80, total_cost: 100000 }],
    })
    const summary = await ShiftRepository.sumByPlanId(1, client)
    expect(summary.total_hours).toBe(80)
    expect(summary.total_cost).toBe(100000)
  })
})

describe('ShiftRepository.insertAiGeneratedShift()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a single row with is_preferred=false and note=AI自動生成', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rowCount: 1 })
    await ShiftRepository.insertAiGeneratedShift(
      {
        tenantId: 1, storeId: 2, planId: 3, staffId: 4,
        shiftDate: '2026-09-01', patternId: 5,
        startTime: '09:00', endTime: '18:00', breakMinutes: 60,
      },
      client
    )
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO ops\.shifts/)
    expect(sql).toMatch(/AI自動生成/)
    expect(params[0]).toBe(1)
    expect(params[8]).toBe(60)
  })
})

describe('ShiftRepository.insertBulk()', () => {
  beforeEach(() => vi.clearAllMocks())

  it('short-circuits when the input is empty', async () => {
    const client = makeClientMock()
    await ShiftRepository.insertBulk([], client)
    await ShiftRepository.insertBulk(null, client)
    expect(client.query).not.toHaveBeenCalled()
  })

  it('emits VALUES with 9 placeholders per row', async () => {
    const client = makeClientMock()
    client.query.mockResolvedValueOnce({ rowCount: 2 })
    const rows = [
      { tenant_id: 1, store_id: 2, plan_id: 3, staff_id: 4, shift_date: '2026-09-01',
        pattern_id: 5, start_time: '09:00', end_time: '18:00', break_minutes: 60 },
      { tenant_id: 1, store_id: 2, plan_id: 3, staff_id: 5, shift_date: '2026-09-02',
        pattern_id: 5, start_time: '10:00', end_time: '19:00', break_minutes: 60 },
    ]
    await ShiftRepository.insertBulk(rows, client)
    const [sql, params] = client.query.mock.calls[0]
    // 2 rows × 9 columns = 18 params
    expect(params.length).toBe(18)
    // 2 groups of parenthesized placeholders
    const matches = sql.match(/\(\$/g) || []
    expect(matches.length).toBe(2)
  })
})
