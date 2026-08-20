import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}))
vi.mock('../../src/utils/logger.js', () => ({
  appendLog: vi.fn(),
}))

const { query } = await import('../../src/config/database.js')
const { appendLog } = await import('../../src/utils/logger.js')
const { ensureShiftPlansStatusCheck } = await import(
  '../../src/migrations/ensureShiftPlansStatusCheck.js'
)

describe('ensureShiftPlansStatusCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips when the constraint already includes CONFIRMED', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          definition:
            "CHECK ((status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text, 'CONFIRMED'::text])))",
        },
      ],
    })

    await ensureShiftPlansStatusCheck()

    expect(query).toHaveBeenCalledTimes(1)
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('already includes CONFIRMED'))
  })

  it('drops and re-adds the constraint when CONFIRMED is missing', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            definition: "CHECK ((status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text])))",
          },
        ],
      }) // pg_constraint lookup
      .mockResolvedValueOnce({ rows: [] }) // DROP CONSTRAINT
      .mockResolvedValueOnce({ rows: [] }) // ADD CONSTRAINT

    await ensureShiftPlansStatusCheck()

    expect(query).toHaveBeenCalledTimes(3)
    const [dropSql] = query.mock.calls[1]
    const [addSql] = query.mock.calls[2]
    expect(dropSql).toContain('DROP CONSTRAINT IF EXISTS shift_plans_status_check')
    expect(addSql).toContain('ADD CONSTRAINT shift_plans_status_check')
    expect(addSql).toContain("'DRAFT'")
    expect(addSql).toContain("'APPROVED'")
    expect(addSql).toContain("'CONFIRMED'")
    expect(appendLog).toHaveBeenCalledWith(
      expect.stringContaining('updated to include CONFIRMED')
    )
  })

  it('creates the constraint when it does not exist yet', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // pg_constraint lookup — no existing row
      .mockResolvedValueOnce({ rows: [] }) // DROP CONSTRAINT IF EXISTS (no-op)
      .mockResolvedValueOnce({ rows: [] }) // ADD CONSTRAINT

    await ensureShiftPlansStatusCheck()

    expect(query).toHaveBeenCalledTimes(3)
    const [addSql] = query.mock.calls[2]
    expect(addSql).toContain("'CONFIRMED'")
    expect(appendLog).toHaveBeenCalledWith(
      expect.stringContaining('updated to include CONFIRMED')
    )
  })

  it('logs and does not throw when a query fails', async () => {
    query.mockRejectedValueOnce(new Error('connection timeout'))

    await expect(ensureShiftPlansStatusCheck()).resolves.not.toThrow()

    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('connection timeout'))
  })
})
