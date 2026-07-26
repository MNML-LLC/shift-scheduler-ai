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

const PLAN_ID = 111
const ENDPOINT = `/api/shifts/plans/${PLAN_ID}/status`

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return app
}

function mockFirstPlanLookupAndUpdate() {
  query
    .mockResolvedValueOnce({
      rows: [
        {
          plan_id: PLAN_ID,
          tenant_id: 1,
          store_id: 5,
          plan_year: 2026,
          plan_month: 8,
          plan_type: 'FIRST',
          status: 'DRAFT',
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [] })
}

describe('PUT /api/shifts/plans/:plan_id/status — NOTIFICATION_ENABLED guard', () => {
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

  it('sends LINE notification when APPROVED, FIRST plan, NOTIFICATION_ENABLED="true", and LIFF_BACKEND_URL is set', async () => {
    mockFirstPlanLookupAndUpdate()

    const res = await request(app).put(ENDPOINT).send({ status: 'APPROVED' })

    expect(res.status).toBe(200)
    expect(axios.post).toHaveBeenCalledWith(
      'https://liff-backend.example.com/api/notification/first-plan-approved',
      { tenant_id: 1, store_id: 5, plan_id: PLAN_ID, year: 2026, month: 8 }
    )
  })

  it('skips notification when NOTIFICATION_ENABLED is not set (Issue #163)', async () => {
    delete process.env.NOTIFICATION_ENABLED
    mockFirstPlanLookupAndUpdate()

    const res = await request(app).put(ENDPOINT).send({ status: 'APPROVED' })

    expect(res.status).toBe(200)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('skips notification when NOTIFICATION_ENABLED is "false" (Issue #163)', async () => {
    process.env.NOTIFICATION_ENABLED = 'false'
    mockFirstPlanLookupAndUpdate()

    const res = await request(app).put(ENDPOINT).send({ status: 'APPROVED' })

    expect(res.status).toBe(200)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('skips notification when NOTIFICATION_ENABLED has an unrelated value (Issue #163)', async () => {
    process.env.NOTIFICATION_ENABLED = '1'
    mockFirstPlanLookupAndUpdate()

    const res = await request(app).put(ENDPOINT).send({ status: 'APPROVED' })

    expect(res.status).toBe(200)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('skips notification when LIFF_BACKEND_URL is not set even if NOTIFICATION_ENABLED="true"', async () => {
    delete process.env.LIFF_BACKEND_URL
    mockFirstPlanLookupAndUpdate()

    const res = await request(app).put(ENDPOINT).send({ status: 'APPROVED' })

    expect(res.status).toBe(200)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('does not send notification when plan_type is SECOND, regardless of NOTIFICATION_ENABLED', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            plan_id: PLAN_ID,
            tenant_id: 1,
            store_id: 5,
            plan_year: 2026,
            plan_month: 8,
            plan_type: 'SECOND',
            status: 'DRAFT',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })

    const res = await request(app).put(ENDPOINT).send({ status: 'APPROVED' })

    expect(res.status).toBe(200)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('does not send notification when status is DRAFT, regardless of NOTIFICATION_ENABLED', async () => {
    mockFirstPlanLookupAndUpdate()

    const res = await request(app).put(ENDPOINT).send({ status: 'DRAFT' })

    expect(res.status).toBe(200)
    expect(axios.post).not.toHaveBeenCalled()
  })
})
