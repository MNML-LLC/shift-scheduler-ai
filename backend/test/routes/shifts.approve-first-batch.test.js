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

const { query } = await import('../../src/config/database.js')
const axios = (await import('axios')).default
const shiftsRoutes = (await import('../../src/routes/shifts.js')).default

describe('POST /api/shifts/plans/approve-first-batch', () => {
  let app
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use('/api/shifts', shiftsRoutes)

    query.mockReset()
    axios.post.mockReset()
    axios.post.mockResolvedValue({ data: { success: true } })

    process.env.BATCH_API_KEY = 'test-batch-key'
    delete process.env.LIFF_BACKEND_URL
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...ORIGINAL_ENV }
  })

  function mockStoresAndPlans(stores, plansByStoreId) {
    query.mockImplementation((sql, params) => {
      if (sql.includes('FROM core.stores')) {
        return Promise.resolve({ rows: stores.map((store_id) => ({ store_id })) })
      }
      if (sql.includes('SELECT plan_id, status') && sql.includes('FROM ops.shift_plans')) {
        const storeId = params[1]
        const plan = plansByStoreId[storeId]
        return Promise.resolve({ rows: plan ? [plan] : [] })
      }
      if (sql.includes('UPDATE ops.shift_plans')) {
        return Promise.resolve({ rowCount: 1 })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  it('returns 401 when the x-batch-api-key header is missing or incorrect', async () => {
    query.mockResolvedValue({ rows: [] })

    const res = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .send({ tenant_id: 1, target_year: 2026, target_month: 8 })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('returns 500 when BATCH_API_KEY is not configured on the server', async () => {
    delete process.env.BATCH_API_KEY

    const res = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .set('x-batch-api-key', 'anything')
      .send({ tenant_id: 1, target_year: 2026, target_month: 8 })

    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })

  it('returns 401 with a byte-length mismatched API key', async () => {
    query.mockResolvedValue({ rows: [] })

    const res = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .set('x-batch-api-key', 'short')
      .send({ tenant_id: 1, target_year: 2026, target_month: 8 })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('returns 400 when tenant_id is not a positive integer', async () => {
    query.mockResolvedValue({ rows: [] })

    for (const invalidTenantId of ['abc', 0, -1, 1.5, null]) {
      const res = await request(app)
        .post('/api/shifts/plans/approve-first-batch')
        .set('x-batch-api-key', 'test-batch-key')
        .send({ tenant_id: invalidTenantId, target_year: 2026, target_month: 8 })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    }
  })

  it('returns 400 when target_year is not a valid integer in range', async () => {
    query.mockResolvedValue({ rows: [] })

    for (const invalidYear of ['abc', 2019, 2101, 1.5]) {
      const res = await request(app)
        .post('/api/shifts/plans/approve-first-batch')
        .set('x-batch-api-key', 'test-batch-key')
        .send({ tenant_id: 1, target_year: invalidYear, target_month: 8 })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    }
  })

  it('computes the target month as next month (JST) when not provided', async () => {
    vi.setSystemTime(new Date('2026-07-01T00:30:00Z')) // 2026-07-01 09:30 JST
    mockStoresAndPlans([], {})

    const res = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .set('x-batch-api-key', 'test-batch-key')
      .send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.target_year).toBe(2026)
    expect(res.body.target_month).toBe(8)
  })

  it('rolls over to next year when the next month is January', async () => {
    vi.setSystemTime(new Date('2025-12-01T00:30:00Z')) // 2025-12-01 09:30 JST
    mockStoresAndPlans([], {})

    const res = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .set('x-batch-api-key', 'test-batch-key')
      .send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.target_year).toBe(2026)
    expect(res.body.target_month).toBe(1)
  })

  it('approves DRAFT plans, skips missing/already-approved plans, and is idempotent', async () => {
    mockStoresAndPlans(
      [1, 2, 3],
      {
        1: { plan_id: 101, status: 'DRAFT' },
        2: { plan_id: 102, status: 'APPROVED' },
        // store 3 has no plan record at all
      }
    )

    const res = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .set('x-batch-api-key', 'test-batch-key')
      .send({ tenant_id: 1, target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.approved).toEqual([1])
    expect(res.body.skipped_already).toEqual([2])
    expect(res.body.skipped_missing).toEqual([3])
    expect(res.body.failed).toEqual([])

    // Re-running against an already-approved plan should skip, not error (idempotency)
    mockStoresAndPlans([1], { 1: { plan_id: 101, status: 'APPROVED' } })

    const res2 = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .set('x-batch-api-key', 'test-batch-key')
      .send({ tenant_id: 1, target_year: 2026, target_month: 8 })

    expect(res2.status).toBe(200)
    expect(res2.body.approved).toEqual([])
    expect(res2.body.skipped_already).toEqual([1])
  })

  it('treats plan approval as successful even when the LINE notification fails, and reports it separately', async () => {
    process.env.LIFF_BACKEND_URL = 'https://liff.example.com'
    mockStoresAndPlans([1], { 1: { plan_id: 101, status: 'DRAFT' } })
    axios.post.mockRejectedValue(new Error('LINE notify failed'))

    const res = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .set('x-batch-api-key', 'test-batch-key')
      .send({ tenant_id: 1, target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.approved).toEqual([1])
    expect(res.body.notify_failed).toEqual([1])
    expect(res.body.failed).toEqual([])
  })

  it('reports per-store failures without aborting the rest of the batch', async () => {
    query.mockImplementation((sql, params) => {
      if (sql.includes('FROM core.stores')) {
        return Promise.resolve({ rows: [{ store_id: 1 }, { store_id: 2 }] })
      }
      if (sql.includes('SELECT plan_id, status') && sql.includes('FROM ops.shift_plans')) {
        const storeId = params[1]
        if (storeId === 1) {
          return Promise.reject(new Error('DB connection lost'))
        }
        return Promise.resolve({ rows: [{ plan_id: 202, status: 'DRAFT' }] })
      }
      if (sql.includes('UPDATE ops.shift_plans')) {
        return Promise.resolve({ rowCount: 1 })
      }
      return Promise.resolve({ rows: [] })
    })

    const res = await request(app)
      .post('/api/shifts/plans/approve-first-batch')
      .set('x-batch-api-key', 'test-batch-key')
      .send({ tenant_id: 1, target_year: 2026, target_month: 8 })

    expect(res.status).toBe(200)
    expect(res.body.approved).toEqual([2])
    expect(res.body.failed).toEqual([{ store_id: 1, error: 'DB connection lost' }])
  })
})
