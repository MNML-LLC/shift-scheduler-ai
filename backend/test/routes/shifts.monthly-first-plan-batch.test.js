import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

const { query, transaction } = await import('../../src/config/database.js')
const axios = (await import('axios')).default
const { default: shiftsRoutes } = await import('../../src/routes/shifts.js')

const BATCH_API_KEY = 'test-batch-api-key'
const ENDPOINT = '/api/shifts/plans/monthly-first-plan-batch'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return app
}

function makeStores(...stores) {
  return { rows: stores }
}

describe('POST /api/shifts/plans/monthly-first-plan-batch', () => {
  let app
  let clientQueryMock

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BATCH_API_KEY = BATCH_API_KEY
    process.env.LIFF_BACKEND_URL = 'https://liff-backend.example.com'

    clientQueryMock = vi.fn()
    transaction.mockImplementation(cb => cb({ query: clientQueryMock }))
    axios.post.mockResolvedValue({ data: { success: true } })

    app = buildApp()
  })

  afterEach(() => {
    delete process.env.BATCH_API_KEY
    delete process.env.LIFF_BACKEND_URL
  })

  it('returns 401 when x-batch-api-key header is missing', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 401 when x-batch-api-key does not match BATCH_API_KEY', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', 'wrong-key')
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('returns 401 when BATCH_API_KEY is not configured on the server', async () => {
    delete process.env.BATCH_API_KEY

    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(401)
  })

  it('returns 400 when target_month is 0', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 0 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when target_month is 13', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 13 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('returns 400 when target_year or target_month is missing', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_month: 8 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('queries only active stores of active tenants', async () => {
    query.mockResolvedValueOnce(makeStores())

    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    const [sql] = query.mock.calls[0]
    expect(sql).toContain('s.is_active = TRUE')
    expect(sql).toContain('t.is_active = TRUE')
  })

  it('computes period_start/period_end/plan_code/plan_name and inserts an APPROVED empty plan', async () => {
    query.mockResolvedValueOnce(makeStores({ tenant_id: 1, store_id: 5 }))
    clientQueryMock.mockResolvedValueOnce({ rows: [{ plan_id: 111, inserted: true }] })

    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      success: true,
      target_year: 2026,
      target_month: 8,
      created: [{ tenant_id: 1, store_id: 5, plan_id: 111 }],
      skipped_already: [],
      failed: [],
      failed_notification: [],
    })

    const [sql, params] = clientQueryMock.mock.calls[0]
    expect(sql).toContain("'FIRST', 'APPROVED'")
    expect(sql).toContain('ON CONFLICT (tenant_id, store_id, plan_year, plan_month, plan_type)')
    const [tenantId, storeId, planYear, planMonth, planCode, planName, periodStart, periodEnd, generationType] = params
    expect(tenantId).toBe(1)
    expect(storeId).toBe(5)
    expect(planYear).toBe(2026)
    expect(planMonth).toBe(8)
    expect(planCode).toBe('FIRST-202608-5')
    expect(planName).toBe('2026年8月シフト（第1案）')
    expect(periodStart).toBe('2026-08-01')
    expect(periodEnd).toBe('2026-08-31')
    expect(generationType).toBe('BATCH')

    expect(axios.post).toHaveBeenCalledWith(
      'https://liff-backend.example.com/api/notification/first-plan-approved',
      { tenant_id: 1, store_id: 5, plan_id: 111, year: 2026, month: 8 }
    )
  })

  it('computes the last day of February correctly for a leap year', async () => {
    query.mockResolvedValueOnce(makeStores({ tenant_id: 1, store_id: 1 }))
    clientQueryMock.mockResolvedValueOnce({ rows: [{ plan_id: 1, inserted: true }] })

    await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2028, target_month: 2 })

    const [, params] = clientQueryMock.mock.calls[0]
    expect(params[6]).toBe('2028-02-01')
    expect(params[7]).toBe('2028-02-29')
  })

  it('is idempotent: does not notify and reports skipped_already when the plan already exists', async () => {
    query.mockResolvedValueOnce(makeStores({ tenant_id: 1, store_id: 5 }))
    clientQueryMock.mockResolvedValueOnce({ rows: [{ plan_id: 111, inserted: false }] })

    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.created).toEqual([])
    expect(res.body.skipped_already).toEqual([{ tenant_id: 1, store_id: 5 }])
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('only notifies newly-inserted stores, not stores that already existed', async () => {
    query.mockResolvedValueOnce(makeStores(
      { tenant_id: 1, store_id: 1 },
      { tenant_id: 1, store_id: 2 }
    ))
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ plan_id: 10, inserted: true }] })
      .mockResolvedValueOnce({ rows: [{ plan_id: 20, inserted: false }] })

    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.body.created).toEqual([{ tenant_id: 1, store_id: 1, plan_id: 10 }])
    expect(res.body.skipped_already).toEqual([{ tenant_id: 1, store_id: 2 }])
    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ store_id: 1, plan_id: 10 })
    )
  })

  it('continues processing remaining stores when one store fails', async () => {
    query.mockResolvedValueOnce(makeStores(
      { tenant_id: 1, store_id: 1 },
      { tenant_id: 1, store_id: 2 }
    ))
    clientQueryMock
      .mockRejectedValueOnce(new Error('connection timeout'))
      .mockResolvedValueOnce({ rows: [{ plan_id: 20, inserted: true }] })

    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.failed).toEqual([{ tenant_id: 1, store_id: 1, error: 'connection timeout' }])
    expect(res.body.created).toEqual([{ tenant_id: 1, store_id: 2, plan_id: 20 }])
  })

  it('does not roll back the DB insert when the LINE notification fails, and reports failed_notification', async () => {
    query.mockResolvedValueOnce(makeStores({ tenant_id: 1, store_id: 5 }))
    clientQueryMock.mockResolvedValueOnce({ rows: [{ plan_id: 111, inserted: true }] })
    axios.post.mockRejectedValueOnce(new Error('502 Bad Gateway'))

    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.created).toEqual([{ tenant_id: 1, store_id: 5, plan_id: 111 }])
    expect(res.body.failed_notification).toEqual([
      { tenant_id: 1, store_id: 5, error: '502 Bad Gateway' },
    ])
  })

  it('skips notification when LIFF_BACKEND_URL is not configured', async () => {
    delete process.env.LIFF_BACKEND_URL
    query.mockResolvedValueOnce(makeStores({ tenant_id: 1, store_id: 5 }))
    clientQueryMock.mockResolvedValueOnce({ rows: [{ plan_id: 111, inserted: true }] })

    const res = await request(app)
      .post(ENDPOINT)
      .set('x-batch-api-key', BATCH_API_KEY)
      .send({ target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.created).toEqual([{ tenant_id: 1, store_id: 5, plan_id: 111 }])
    expect(axios.post).not.toHaveBeenCalled()
  })
})
