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
const { default: shiftsRoutes } = await import('../../src/routes/shifts.js')

const ENDPOINT = '/api/shifts/plans/approve-first'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return app
}

function mockPlanLookupAndUpdate() {
  query
    .mockResolvedValueOnce({
      rows: [
        {
          plan_id: 111,
          status: 'DRAFT',
          store_id: 5,
          plan_year: 2026,
          plan_month: 8,
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [] })
}

describe('POST /api/shifts/plans/approve-first — NOTIFICATION_ENABLED guard', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LIFF_BACKEND_URL = 'https://liff-backend.example.com'
    process.env.NOTIFICATION_ENABLED = 'true'
    axios.post.mockResolvedValue({ data: { success: true } })
    app = buildApp()
  })

  afterEach(() => {
    delete process.env.LIFF_BACKEND_URL
    delete process.env.NOTIFICATION_ENABLED
  })

  it('sends LINE notification when NOTIFICATION_ENABLED="true" and LIFF_BACKEND_URL is set', async () => {
    mockPlanLookupAndUpdate()

    const res = await request(app).post(ENDPOINT).send({ plan_id: 111, tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(axios.post).toHaveBeenCalledWith(
      'https://liff-backend.example.com/api/notification/first-plan-approved',
      { tenant_id: 1, store_id: 5, plan_id: 111, year: 2026, month: 8 },
      { timeout: 10000 }
    )
  })

  it('skips notification when NOTIFICATION_ENABLED is not set (Issue #163)', async () => {
    delete process.env.NOTIFICATION_ENABLED
    mockPlanLookupAndUpdate()

    const res = await request(app).post(ENDPOINT).send({ plan_id: 111, tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('skips notification when NOTIFICATION_ENABLED is "false" (Issue #163)', async () => {
    process.env.NOTIFICATION_ENABLED = 'false'
    mockPlanLookupAndUpdate()

    const res = await request(app).post(ENDPOINT).send({ plan_id: 111, tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('skips notification when NOTIFICATION_ENABLED has an unrelated value (Issue #163)', async () => {
    process.env.NOTIFICATION_ENABLED = '1'
    mockPlanLookupAndUpdate()

    const res = await request(app).post(ENDPOINT).send({ plan_id: 111, tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('skips notification when LIFF_BACKEND_URL is not set even if NOTIFICATION_ENABLED="true"', async () => {
    delete process.env.LIFF_BACKEND_URL
    mockPlanLookupAndUpdate()

    const res = await request(app).post(ENDPOINT).send({ plan_id: 111, tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(axios.post).not.toHaveBeenCalled()
  })
})
