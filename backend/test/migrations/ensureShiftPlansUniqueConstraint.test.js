import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}))
vi.mock('../../src/utils/logger.js', () => ({
  appendLog: vi.fn(),
}))

const { query } = await import('../../src/config/database.js')
const { appendLog } = await import('../../src/utils/logger.js')
const { ensureShiftPlansUniqueConstraint } = await import(
  '../../src/migrations/ensureShiftPlansUniqueConstraint.js'
)

describe('ensureShiftPlansUniqueConstraint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips when the constraint already exists', async () => {
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })

    await ensureShiftPlansUniqueConstraint()

    expect(query).toHaveBeenCalledTimes(1)
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('already exists'))
  })

  it('adds the constraint when no duplicates exist', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // pg_constraint check
      .mockResolvedValueOnce({ rows: [] }) // duplicate check
      .mockResolvedValueOnce({ rows: [] }) // ALTER TABLE

    await ensureShiftPlansUniqueConstraint()

    expect(query).toHaveBeenCalledTimes(3)
    const [alterSql] = query.mock.calls[2]
    expect(alterSql).toContain('ADD CONSTRAINT unique_plan_per_store_month_type')
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('added successfully'))
  })

  it('does not add the constraint when duplicate rows are found', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // pg_constraint check
      .mockResolvedValueOnce({
        rows: [{ tenant_id: 1, store_id: 5, plan_year: 2026, plan_month: 8, plan_type: 'FIRST', cnt: 2 }],
      }) // duplicate check

    await ensureShiftPlansUniqueConstraint()

    expect(query).toHaveBeenCalledTimes(2)
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('duplicate group'))
  })

  it('logs and does not throw when a query fails', async () => {
    query.mockRejectedValueOnce(new Error('connection timeout'))

    await expect(ensureShiftPlansUniqueConstraint()).resolves.not.toThrow()

    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('connection timeout'))
  })
})
