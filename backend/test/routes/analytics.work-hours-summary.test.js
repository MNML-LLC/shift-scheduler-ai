import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import analyticsRoutes from '../../src/routes/analytics.js'
import { query } from '../../src/config/database.js'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {}
}))

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/analytics', analyticsRoutes)
  return app
}

describe('GET /api/analytics/work-hours-summary', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('returns 400 when tenant_id is missing', async () => {
    const response = await request(app).get('/api/analytics/work-hours-summary')

    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
    expect(response.body.error).toBe('tenant_id は必須です')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app).get('/api/analytics/work-hours-summary?tenant_id=')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id は必須です')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 200 with empty data array when no rows match', async () => {
    query.mockResolvedValue({ rows: [] })

    const response = await request(app).get(
      '/api/analytics/work-hours-summary?tenant_id=1&year=2026&month=8'
    )

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toEqual([])
  })

  it('returns 200 with aggregated rows including is_over_160h flag', async () => {
    query.mockResolvedValue({
      rows: [
        { staff_id: 1, staff_name: '山田太郎', total_work_hours: 180, is_over_160h: true },
        { staff_id: 2, staff_name: '佐藤花子', total_work_hours: 120, is_over_160h: false }
      ]
    })

    const response = await request(app).get(
      '/api/analytics/work-hours-summary?tenant_id=1&year=2026&month=8'
    )

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toHaveLength(2)
    expect(response.body.data[0]).toEqual({
      staff_id: 1,
      staff_name: '山田太郎',
      total_work_hours: 180,
      is_over_160h: true
    })
    expect(response.body.data[1].is_over_160h).toBe(false)
  })

  it('aggregates in DB with SUM GROUP BY staff_id and staff_name', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/work-hours-summary?tenant_id=1&year=2026&month=8')

    const [queryText] = query.mock.calls[0]
    expect(queryText).toContain('SUM(work_hours)')
    expect(queryText).toContain('GROUP BY staff_id, staff_name')
    expect(queryText).toContain('FROM hr.payroll')
    expect(queryText).toContain('> 160')
  })

  it('scopes to supplied tenant_id (no default fallback)', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/work-hours-summary?tenant_id=42')

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('WHERE tenant_id = $1')
    expect(params[0]).toBe('42')
  })

  it('appends year filter when year is provided', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/work-hours-summary?tenant_id=1&year=2026')

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('AND year = $2')
    expect(params).toEqual(['1', '2026'])
  })

  it('appends month filter when month is provided', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/work-hours-summary?tenant_id=1&year=2026&month=8')

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('AND year =')
    expect(queryText).toContain('AND month =')
    expect(params).toEqual(['1', '2026', '8'])
  })

  it('appends store_id filter when store_id is provided', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/work-hours-summary?tenant_id=1&store_id=5')

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('AND store_id = $2')
    expect(params).toEqual(['1', '5'])
  })
})
