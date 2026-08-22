import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}))

const { query } = await import('../../src/config/database.js')
const { default: shiftsRoutes } = await import('../../src/routes/shifts.js')

const ENDPOINT = '/api/shifts/preferences/submission-status'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return app
}

describe('GET /api/shifts/preferences/submission-status', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
  })

  it('returns 400 when tenant_id is missing', async () => {
    const res = await request(app).get(ENDPOINT).query({ year: 2026, month: 8 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when year is missing', async () => {
    const res = await request(app).get(ENDPOINT).query({ tenant_id: 1, month: 8 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when month is missing', async () => {
    const res = await request(app).get(ENDPOINT).query({ tenant_id: 1, year: 2026 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when year is out of range', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ tenant_id: 1, year: 1999, month: 8 })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when month is out of range', async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ tenant_id: 1, year: 2026, month: 13 })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 200 with staff rows and summary when tenant_id/year/month provided', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          staff_id: 1,
          staff_name: 'Alice',
          employment_type: 'PART_TIME',
          store_id: 5,
          submitted_dates_count: 3,
          submitted: true,
        },
        {
          staff_id: 2,
          staff_name: 'Bob',
          employment_type: 'FULL_TIME',
          store_id: 5,
          submitted_dates_count: 0,
          submitted: false,
        },
      ],
    })

    const res = await request(app)
      .get(ENDPOINT)
      .query({ tenant_id: 1, year: 2026, month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0]).toMatchObject({
      staff_id: 1,
      staff_name: 'Alice',
      employment_type: 'PART_TIME',
      submitted: true,
      submitted_dates_count: 3,
    })
    expect(res.body.summary).toEqual({
      total: 2,
      submitted: 1,
      unsubmitted: 1,
      submission_rate: 0.5,
    })
  })

  it('passes tenant_id, year, month to query and filters is_active=true', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    await request(app)
      .get(ENDPOINT)
      .query({ tenant_id: 42, year: 2026, month: 8 })

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/staff\.is_active = true/)
    expect(sql).toMatch(/LEFT JOIN ops\.shift_preferences/)
    expect(sql).toMatch(/EXTRACT\(YEAR FROM pref\.preference_date\) = \$2/)
    expect(sql).toMatch(/EXTRACT\(MONTH FROM pref\.preference_date\) = \$3/)
    expect(params).toEqual(['42', 2026, 8])
  })

  it('appends store_id filter when provided', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    await request(app)
      .get(ENDPOINT)
      .query({ tenant_id: 1, year: 2026, month: 8, store_id: 7 })

    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/AND staff\.store_id = \$4/)
    expect(params).toEqual(['1', 2026, 8, '7'])
  })

  it('returns summary with submission_rate=0 when no staff match', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .get(ENDPOINT)
      .query({ tenant_id: 1, year: 2026, month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.summary).toEqual({
      total: 0,
      submitted: 0,
      unsubmitted: 0,
      submission_rate: 0,
    })
  })

  it('returns 500 when the database query throws a generic error', async () => {
    query.mockRejectedValueOnce(new Error('boom'))

    const res = await request(app)
      .get(ENDPOINT)
      .query({ tenant_id: 1, year: 2026, month: 8 })

    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })
})
