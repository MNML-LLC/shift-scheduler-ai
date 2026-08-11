import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockClient = {
  query: vi.fn(),
  release: vi.fn()
}

vi.mock('../../src/config/database.js', () => ({
  getPool: () => ({
    connect: vi.fn(async () => mockClient)
  })
}))

vi.mock('../../src/middleware/verifyLineToken.js', () => ({
  verifyLineToken: (req, _res, next) => {
    req.lineUser = { userId: 'U_test', displayName: 'テスト' }
    next()
  }
}))

const { default: liffRoutes } = await import('../../src/routes/liff.js')

describe('POST /api/liff/shift-request — deadline enforcement', () => {
  let app
  const OriginalDate = global.Date

  beforeEach(() => {
    vi.clearAllMocks()
    mockClient.query.mockReset()
    app = express()
    app.use(express.json())
    app.use('/api/liff', liffRoutes)
    global.Date = OriginalDate
  })

  const stubStaffAndDeadline = (deadlineRow) => {
    mockClient.query.mockImplementation(async (sql) => {
      const text = String(sql)
      if (text.includes('FROM hr.staff_line_accounts sla')) {
        return {
          rows: [
            {
              staff_id: 1,
              store_id: 10,
              tenant_id: 3,
              employment_type: 'PART_TIME'
            }
          ]
        }
      }
      if (text.includes('FROM core.shift_deadline_settings')) {
        return { rows: deadlineRow ? [deadlineRow] : [] }
      }
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [] }
      }
      // existing shift check + insert
      if (text.includes('FROM ops.shifts')) {
        return { rows: [] }
      }
      if (text.includes('INSERT INTO ops.shifts')) {
        return { rows: [{ shift_id: 99 }] }
      }
      return { rows: [] }
    })
  }

  const freezeNowJst = (isoJst) => {
    const fixed = new OriginalDate(isoJst)
    // Vitest fake timers do not persist across the mock isDeadlinePassed's `new Date()`,
    // so we replace Date directly.
    global.Date = class extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) return new OriginalDate(fixed.getTime())
        return new OriginalDate(...args)
      }
      static now() {
        return fixed.getTime()
      }
    }
  }

  it('returns 403 when current JST time is past the deadline for the target month', async () => {
    stubStaffAndDeadline({
      deadline_day: 15,
      deadline_time: '18:00',
      is_enabled: true
    })

    // Target month = 2026-09, deadline = 2026-08-15 18:00 JST
    // Now = 2026-08-15 19:00 JST → past deadline
    freezeNowJst('2026-08-15T19:00:00+09:00')

    const response = await request(app)
      .post('/api/liff/shift-request')
      .send({ shift_dates: [{ date: '2026-09-01', start_time: '09:00', end_time: '18:00' }] })

    expect(response.status).toBe(403)
    expect(response.body.success).toBe(false)
    expect(response.body.deadline).toBe('2026-08-15T18:00:00+09:00')
    // No INSERT executed
    expect(mockClient.query.mock.calls.every(c => !String(c[0]).includes('INSERT'))).toBe(true)
  })

  it('allows submission when before deadline', async () => {
    stubStaffAndDeadline({
      deadline_day: 15,
      deadline_time: '18:00',
      is_enabled: true
    })

    // Now = 2026-08-15 17:59 JST → within deadline
    freezeNowJst('2026-08-15T17:59:00+09:00')

    const response = await request(app)
      .post('/api/liff/shift-request')
      .send({ shift_dates: [{ date: '2026-09-01', start_time: '09:00', end_time: '18:00' }] })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  it('allows submission when is_enabled is false regardless of date', async () => {
    stubStaffAndDeadline({
      deadline_day: 15,
      deadline_time: '18:00',
      is_enabled: false
    })

    freezeNowJst('2026-08-31T23:59:00+09:00')

    const response = await request(app)
      .post('/api/liff/shift-request')
      .send({ shift_dates: [{ date: '2026-09-01', start_time: '09:00', end_time: '18:00' }] })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  it('allows submission when no deadline setting exists for the employment_type', async () => {
    stubStaffAndDeadline(null)

    freezeNowJst('2026-08-31T23:59:00+09:00')

    const response = await request(app)
      .post('/api/liff/shift-request')
      .send({ shift_dates: [{ date: '2026-09-01', start_time: '09:00', end_time: '18:00' }] })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  it('handles January target month by using previous December as deadline month', async () => {
    stubStaffAndDeadline({
      deadline_day: 20,
      deadline_time: '12:00',
      is_enabled: true
    })

    // Target month = 2027-01, deadline = 2026-12-20 12:00 JST
    freezeNowJst('2026-12-20T12:01:00+09:00')

    const response = await request(app)
      .post('/api/liff/shift-request')
      .send({ shift_dates: [{ date: '2027-01-05', start_time: '09:00', end_time: '18:00' }] })

    expect(response.status).toBe(403)
    expect(response.body.deadline).toBe('2026-12-20T12:00:00+09:00')
  })
})
