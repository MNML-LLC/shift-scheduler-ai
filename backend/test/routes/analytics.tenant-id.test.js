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

describe('GET /api/analytics/sales-actual', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('returns 400 with "tenant_id is required" when tenant_id is missing', async () => {
    const response = await request(app).get('/api/analytics/sales-actual')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app).get('/api/analytics/sales-actual?tenant_id=')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('scopes the query strictly to the supplied tenant_id (no default fallback)', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/sales-actual?tenant_id=99')

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('WHERE tenant_id = $1')
    expect(params[0]).toBe('99')
    expect(params[0]).not.toBe(1)
  })
})

describe('GET /api/analytics/sales-forecast', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('returns 400 with "tenant_id is required" when tenant_id is missing', async () => {
    const response = await request(app).get('/api/analytics/sales-forecast')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app).get('/api/analytics/sales-forecast?tenant_id=')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('scopes the query strictly to the supplied tenant_id (no default fallback)', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/sales-forecast?tenant_id=42')

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('WHERE tenant_id = $1')
    expect(params[0]).toBe('42')
    expect(params[0]).not.toBe(1)
  })
})

describe('GET /api/analytics/dashboard-metrics', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('returns 400 with "tenant_id is required" when tenant_id is missing', async () => {
    const response = await request(app).get('/api/analytics/dashboard-metrics')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app).get('/api/analytics/dashboard-metrics?tenant_id=')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('scopes the query strictly to the supplied tenant_id (no default fallback)', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/dashboard-metrics?tenant_id=7')

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('WHERE tenant_id = $1')
    expect(params[0]).toBe('7')
    expect(params[0]).not.toBe(1)
  })
})

describe('POST /api/analytics/work-hours', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('returns 400 with "tenant_id is required" when tenant_id is missing from body', async () => {
    const response = await request(app)
      .post('/api/analytics/work-hours')
      .send({ data: [{ staff_id: 1, shift_date: '2026-07-01' }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app)
      .post('/api/analytics/work-hours')
      .send({ tenant_id: '', data: [{ staff_id: 1, shift_date: '2026-07-01' }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('uses the supplied tenant_id (no default fallback) when data is provided', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app)
      .post('/api/analytics/work-hours')
      .send({
        tenant_id: 42,
        data: [{
          store_id: 3,
          staff_id: 10,
          shift_date: '2026-07-01',
          actual_start: '09:00',
          actual_end: '18:00',
          actual_hours: 8
        }]
      })

    const [, values] = query.mock.calls[0]
    expect(values[0]).toBe(42)
    expect(values[0]).not.toBe(1)
  })
})

describe('POST /api/analytics/payroll', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('returns 400 with "tenant_id is required" when tenant_id is missing from body', async () => {
    const response = await request(app)
      .post('/api/analytics/payroll')
      .send({ data: [{ staff_id: 1 }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app)
      .post('/api/analytics/payroll')
      .send({ tenant_id: '', data: [{ staff_id: 1 }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('uses the supplied tenant_id (no default fallback) when data is provided', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app)
      .post('/api/analytics/payroll')
      .send({
        tenant_id: 42,
        data: [{
          store_id: 3,
          year: 2026,
          month: 7,
          staff_id: 10,
          staff_name: 'テスト',
          work_days: 20,
          work_hours: 160,
          base_salary: 200000,
          gross_salary: 200000,
          net_salary: 160000
        }]
      })

    const [, values] = query.mock.calls[0]
    expect(values[0]).toBe(42)
    expect(values[0]).not.toBe(1)
  })
})

describe('POST /api/analytics/sales-actual', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('returns 400 with "tenant_id is required" when tenant_id is missing from body', async () => {
    const response = await request(app)
      .post('/api/analytics/sales-actual')
      .send({ data: [{ year: 2026, month: 7 }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app)
      .post('/api/analytics/sales-actual')
      .send({ tenant_id: '', data: [{ year: 2026, month: 7 }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('uses the supplied tenant_id (no default fallback) when data is provided', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await request(app)
      .post('/api/analytics/sales-actual')
      .send({
        tenant_id: 42,
        data: [{
          store_id: 3,
          year: 2026,
          month: 7,
          actual_sales: 1000000
        }]
      })

    const [, checkParams] = query.mock.calls[0]
    expect(checkParams[0]).toBe(42)
    expect(checkParams[0]).not.toBe(1)
  })
})

describe('POST /api/analytics/sales-forecast', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('returns 400 with "tenant_id is required" when tenant_id is missing from body', async () => {
    const response = await request(app)
      .post('/api/analytics/sales-forecast')
      .send({ data: [{ year: 2026, month: 7 }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app)
      .post('/api/analytics/sales-forecast')
      .send({ tenant_id: '', data: [{ year: 2026, month: 7 }] })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('uses the supplied tenant_id (no default fallback) when data is provided', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await request(app)
      .post('/api/analytics/sales-forecast')
      .send({
        tenant_id: 42,
        data: [{
          store_id: 3,
          year: 2026,
          month: 7,
          forecasted_sales: 1000000
        }]
      })

    const [, checkParams] = query.mock.calls[0]
    expect(checkParams[0]).toBe(42)
    expect(checkParams[0]).not.toBe(1)
  })
})
