import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const { generateShiftsMock } = vi.hoisted(() => ({ generateShiftsMock: vi.fn() }))

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))
vi.mock('../../src/services/shift/ShiftGenerationService.js', () => ({
  default: class {
    generateShifts(...args) {
      return generateShiftsMock(...args)
    }
  },
}))

const { query } = await import('../../src/config/database.js')
const axios = (await import('axios')).default
const { default: shiftsRoutes } = await import('../../src/routes/shifts.js')

const WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/XXXX'
const ENDPOINT = '/api/shifts/plans/generate-ai'

// 過去月チェックを回避するため未来の年月を使う
const FUTURE_YEAR = new Date().getFullYear() + 1
const REQUEST_BODY = { tenant_id: 1, store_id: 2, year: FUTURE_YEAR, month: 3 }

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return app
}

function mockSuccessfulDbQueries() {
  query.mockImplementation(async (sql) => {
    if (sql.includes('SELECT plan_id, status FROM ops.shift_plans')) {
      return { rows: [] }
    }
    if (sql.includes('INSERT INTO ops.shift_plans')) {
      return { rows: [{ plan_id: 10 }] }
    }
    if (sql.includes('COUNT(*) as shift_count')) {
      return { rows: [{ shift_count: 0, total_hours: null, total_cost: null }] }
    }
    return { rows: [] }
  })
}

describe('POST /api/shifts/plans/generate-ai — Slack error notification', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SLACK_WEBHOOK_URL = WEBHOOK_URL
    axios.post.mockResolvedValue({ status: 200 })
    app = buildApp()
  })

  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL
    delete process.env.RAILWAY_LOG_URL
  })

  it('notifies Slack when shift generation fails with an OpenAI API error', async () => {
    generateShiftsMock.mockRejectedValue({
      success: false,
      error: 'AI生成に失敗しました (3回試行): rate limit exceeded',
      phase: 'ai_generation',
      elapsed_ms: 1234,
    })

    const res = await request(app).post(ENDPOINT).send(REQUEST_BODY)

    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)

    expect(axios.post).toHaveBeenCalledTimes(1)
    const [url, payload] = axios.post.mock.calls[0]
    expect(url).toBe(WEBHOOK_URL)
    expect(payload.text).toContain('OpenAI API エラー')
    expect(payload.text).toContain('POST /api/shifts/plans/generate-ai')
    expect(payload.text).toContain(`tenant_id=1 / store_id=2 / ${FUTURE_YEAR}年3月`)
    expect(payload.text).toContain('rate limit exceeded')
  })

  it('notifies Slack when the database fails during shift generation', async () => {
    generateShiftsMock.mockResolvedValue({
      shifts: [],
      validation: { violations: [], summary: {} },
      metadata: {},
    })
    query.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }))

    const res = await request(app).post(ENDPOINT).send(REQUEST_BODY)

    expect(res.status).toBe(500)

    expect(axios.post).toHaveBeenCalledTimes(1)
    const [, payload] = axios.post.mock.calls[0]
    expect(payload.text).toContain('DB エラー')
    expect(payload.text).toContain('relation does not exist')
  })

  it('does not notify Slack when shift generation succeeds', async () => {
    generateShiftsMock.mockResolvedValue({
      shifts: [],
      validation: { violations: [], summary: {} },
      metadata: {},
    })
    mockSuccessfulDbQueries()

    const res = await request(app).post(ENDPOINT).send(REQUEST_BODY)

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('still returns the error response when SLACK_WEBHOOK_URL is not set', async () => {
    delete process.env.SLACK_WEBHOOK_URL
    generateShiftsMock.mockRejectedValue({
      success: false,
      error: 'AI生成に失敗しました',
      phase: 'ai_generation',
      elapsed_ms: 1234,
    })

    const res = await request(app).post(ENDPOINT).send(REQUEST_BODY)

    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('still returns the error response when the Slack webhook request fails', async () => {
    generateShiftsMock.mockRejectedValue({
      success: false,
      error: 'AI生成に失敗しました',
      phase: 'ai_generation',
      elapsed_ms: 1234,
    })
    axios.post.mockRejectedValue(new Error('slack is down'))

    const res = await request(app).post(ENDPOINT).send(REQUEST_BODY)

    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })
})
