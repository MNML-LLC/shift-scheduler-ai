import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}))

const { query } = await import('../../src/config/database.js')
const { parseTimeToMinutes, isTimeOverlap, validateShiftTimeOverlap } =
  await import('../../src/utils/shiftOverlap.js')

describe('parseTimeToMinutes', () => {
  it('parses HH:MM into minutes', () => {
    expect(parseTimeToMinutes('09:30')).toBe(570)
  })
  it('parses HH:MM:SS by ignoring seconds', () => {
    expect(parseTimeToMinutes('09:30:15')).toBe(570)
  })
  it('returns 0 for empty input', () => {
    expect(parseTimeToMinutes(null)).toBe(0)
    expect(parseTimeToMinutes(undefined)).toBe(0)
    expect(parseTimeToMinutes('')).toBe(0)
  })
})

describe('isTimeOverlap', () => {
  it('returns true for fully overlapping ranges', () => {
    expect(isTimeOverlap(
      { start_time: '09:00', end_time: '18:00' },
      { start_time: '10:00', end_time: '15:00' }
    )).toBe(true)
  })
  it('returns true for partially overlapping ranges', () => {
    expect(isTimeOverlap(
      { start_time: '09:00', end_time: '13:00' },
      { start_time: '12:00', end_time: '18:00' }
    )).toBe(true)
  })
  it('returns false for back-to-back ranges (end == start)', () => {
    expect(isTimeOverlap(
      { start_time: '09:00', end_time: '12:00' },
      { start_time: '12:00', end_time: '18:00' }
    )).toBe(false)
  })
  it('returns false for disjoint ranges', () => {
    expect(isTimeOverlap(
      { start_time: '09:00', end_time: '12:00' },
      { start_time: '13:00', end_time: '18:00' }
    )).toBe(false)
  })
})

describe('validateShiftTimeOverlap', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns valid=true when no existing shifts', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const result = await validateShiftTimeOverlap({
      tenant_id: 1, staff_id: 10, shift_date: '2026-08-01',
      start_time: '09:00', end_time: '18:00', plan_id: 100,
    })
    expect(result.valid).toBe(true)
  })

  it('returns valid=false with store_name-suffixed error when an overlapping shift exists', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        shift_id: 999,
        store_name: 'テスト店舗',
        start_time: '10:00:00',
        end_time: '20:00:00',
      }],
    })
    const result = await validateShiftTimeOverlap({
      tenant_id: 1, staff_id: 10, shift_date: '2026-08-01',
      start_time: '09:00', end_time: '18:00', plan_id: 100,
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('テスト店舗')
    expect(result.error).toContain('10:00-20:00')
  })

  it('scopes to plan_id when provided (5-arg SQL)', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await validateShiftTimeOverlap({
      tenant_id: 1, staff_id: 10, shift_date: '2026-08-01',
      start_time: '09:00', end_time: '18:00', shift_id: 42, plan_id: 100,
    })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('s.plan_id = $5')
    expect(params).toEqual([1, 10, '2026-08-01', 42, 100])
  })

  it('does not include plan_id filter when plan_id is not provided', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await validateShiftTimeOverlap({
      tenant_id: 1, staff_id: 10, shift_date: '2026-08-01',
      start_time: '09:00', end_time: '18:00',
    })
    const [sql, params] = query.mock.calls[0]
    expect(sql).not.toContain('s.plan_id')
    expect(params).toEqual([1, 10, '2026-08-01', 0])
  })
})
