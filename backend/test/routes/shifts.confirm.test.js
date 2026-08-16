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
const CONFIRM_ENDPOINT = `/api/shifts/plans/${PLAN_ID}/confirm`

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return app
}

/**
 * confirm エンドポイントの一連の呼び出しをモック:
 *   1) SELECT plan_id, tenant_id, store_id, ... FROM ops.shift_plans WHERE plan_id = $1 AND tenant_id = $2
 *   2) UPDATE ops.shift_plans SET status = 'CONFIRMED' ...
 */
function mockApprovedPlanConfirmFlow(overrides = {}) {
  query
    .mockResolvedValueOnce({
      rows: [
        {
          plan_id: PLAN_ID,
          tenant_id: 1,
          store_id: 5,
          plan_year: 2026,
          plan_month: 9,
          plan_type: 'SECOND',
          status: 'APPROVED',
          ...overrides,
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [] })
}

describe('POST /api/shifts/plans/:plan_id/confirm — happy path', () => {
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

  it('confirms an APPROVED plan and returns status=CONFIRMED', async () => {
    mockApprovedPlanConfirmFlow()

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('CONFIRMED')
    expect(res.body.data.plan_id).toBe(PLAN_ID)
  })

  it('sends shift-confirmed notification when NOTIFICATION_ENABLED="true" and LIFF_BACKEND_URL is set', async () => {
    mockApprovedPlanConfirmFlow()

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.data.notification_sent).toBe(true)
    expect(axios.post).toHaveBeenCalledWith(
      'https://liff-backend.example.com/api/notification/shift-confirmed',
      { tenant_id: 1, store_id: 5, plan_id: PLAN_ID, year: 2026, month: 9 },
      { timeout: 10000 }
    )
  })

  it('confirms FIRST plan too (plan_type-agnostic)', async () => {
    mockApprovedPlanConfirmFlow({ plan_type: 'FIRST' })

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('CONFIRMED')
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('does not fail the confirm when notification post throws', async () => {
    mockApprovedPlanConfirmFlow()
    axios.post.mockRejectedValueOnce(new Error('LIFF backend timeout'))

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('CONFIRMED')
    expect(res.body.data.notification_sent).toBe(false)
  })
})

describe('POST /api/shifts/plans/:plan_id/confirm — NOTIFICATION_ENABLED guard', () => {
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

  it('skips notification when NOTIFICATION_ENABLED is unset', async () => {
    delete process.env.NOTIFICATION_ENABLED
    mockApprovedPlanConfirmFlow()

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.data.notification_sent).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('skips notification when NOTIFICATION_ENABLED="false"', async () => {
    process.env.NOTIFICATION_ENABLED = 'false'
    mockApprovedPlanConfirmFlow()

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.data.notification_sent).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('skips notification when LIFF_BACKEND_URL is unset', async () => {
    delete process.env.LIFF_BACKEND_URL
    mockApprovedPlanConfirmFlow()

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(200)
    expect(res.body.data.notification_sent).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
  })
})

describe('POST /api/shifts/plans/:plan_id/confirm — state validation', () => {
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

  it('returns 404 when the plan does not exist', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('returns 409 when the plan is already CONFIRMED', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          plan_id: PLAN_ID,
          tenant_id: 1,
          store_id: 5,
          plan_year: 2026,
          plan_month: 9,
          plan_type: 'SECOND',
          status: 'CONFIRMED',
        },
      ],
    })

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    expect(res.body.current_status).toBe('CONFIRMED')
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('returns 409 when the plan is still DRAFT (not yet APPROVED)', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          plan_id: PLAN_ID,
          tenant_id: 1,
          store_id: 5,
          plan_year: 2026,
          plan_month: 9,
          plan_type: 'SECOND',
          status: 'DRAFT',
        },
      ],
    })

    const res = await request(app).post(CONFIRM_ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    expect(res.body.current_status).toBe('DRAFT')
    expect(axios.post).not.toHaveBeenCalled()
  })
})

describe('Shift edit/add/delete — 409 for CONFIRMED plans', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
  })

  it('POST /api/shifts rejects with 409 when target plan is CONFIRMED', async () => {
    // POST / calls getPlanStatus(plan_id) first
    query.mockResolvedValueOnce({ rows: [{ status: 'CONFIRMED' }] })

    const res = await request(app)
      .post('/api/shifts')
      .send({
        tenant_id: 1,
        store_id: 5,
        plan_id: PLAN_ID,
        staff_id: 10,
        shift_date: '2026-09-15',
        pattern_id: 1,
        start_time: '09:00:00',
        end_time: '18:00:00',
        break_minutes: 60,
      })

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    expect(res.body.code).toBe('PLAN_CONFIRMED')
  })

  it('PUT /api/shifts/:id rejects with 409 when parent plan is CONFIRMED', async () => {
    // 1) SELECT existing shift → 2) getPlanStatus(plan_id) → CONFIRMED
    query
      .mockResolvedValueOnce({
        rows: [
          {
            shift_id: 999,
            tenant_id: 1,
            store_id: 5,
            plan_id: PLAN_ID,
            staff_id: 10,
            shift_date: '2026-09-15',
            start_time: '09:00',
            end_time: '18:00',
            break_minutes: 60,
            pattern_id: 1,
            is_preferred: false,
            is_modified: false,
            notes: null,
            assigned_skills: null,
            total_hours: 8,
            labor_cost: 9600,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'CONFIRMED' }] })

    const res = await request(app)
      .put('/api/shifts/999?tenant_id=1')
      .send({ start_time: '10:00:00' })

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    expect(res.body.code).toBe('PLAN_CONFIRMED')
  })

  it('DELETE /api/shifts/:id rejects with 409 when parent plan is CONFIRMED', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            shift_id: 999,
            staff_id: 10,
            shift_date: '2026-09-15',
            start_time: '09:00',
            end_time: '18:00',
            plan_id: PLAN_ID,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'CONFIRMED' }] })

    const res = await request(app).delete('/api/shifts/999?tenant_id=1')

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    expect(res.body.code).toBe('PLAN_CONFIRMED')
  })
})

describe('PUT /api/shifts/plans/:plan_id/status — CONFIRMED downgrade guard', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
  })

  it('rejects with 409 when trying to downgrade CONFIRMED → APPROVED', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          plan_id: PLAN_ID,
          tenant_id: 1,
          store_id: 5,
          plan_year: 2026,
          plan_month: 9,
          plan_type: 'SECOND',
          status: 'CONFIRMED',
        },
      ],
    })

    const res = await request(app)
      .put(`/api/shifts/plans/${PLAN_ID}/status`)
      .send({ status: 'APPROVED' })

    expect(res.status).toBe(409)
    expect(res.body.current_status).toBe('CONFIRMED')
    expect(res.body.requested_status).toBe('APPROVED')
  })

  it('rejects with 409 when trying to downgrade CONFIRMED → DRAFT', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          plan_id: PLAN_ID,
          tenant_id: 1,
          store_id: 5,
          plan_year: 2026,
          plan_month: 9,
          plan_type: 'SECOND',
          status: 'CONFIRMED',
        },
      ],
    })

    const res = await request(app)
      .put(`/api/shifts/plans/${PLAN_ID}/status`)
      .send({ status: 'DRAFT' })

    expect(res.status).toBe(409)
    expect(res.body.current_status).toBe('CONFIRMED')
    expect(res.body.requested_status).toBe('DRAFT')
  })
})
