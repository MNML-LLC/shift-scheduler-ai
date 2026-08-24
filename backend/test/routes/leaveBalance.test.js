import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import leaveBalanceRoutes from '../../src/routes/leaveBalance.js'
import { query } from '../../src/config/database.js'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {}
}))

describe('leave-balance routes', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = express()
    app.use(express.json())
    app.use('/api/master/leave-balance', leaveBalanceRoutes)
  })

  describe('GET /api/master/leave-balance', () => {
    it('returns 400 when tenant_id is missing', async () => {
      const res = await request(app).get('/api/master/leave-balance')
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 when tenant_id is not a positive integer', async () => {
      const res = await request(app).get('/api/master/leave-balance?tenant_id=abc')
      expect(res.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 200 with empty array when no rows exist', async () => {
      query.mockResolvedValue({ rows: [], rowCount: 0 })

      const res = await request(app).get(
        '/api/master/leave-balance?tenant_id=3&staff_id=42&fiscal_year=2026'
      )

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toEqual([])
      const [sql, params] = query.mock.calls[0]
      expect(sql).toContain('FROM hr.leave_balance')
      expect(sql).toContain('tenant_id = $1')
      expect(params).toEqual([3, 42, 2026])
    })

    it('filters by tenant only when staff_id/fiscal_year omitted', async () => {
      query.mockResolvedValue({
        rows: [
          {
            id: 1,
            tenant_id: 3,
            staff_id: 10,
            fiscal_year: 2026,
            granted_days: 20,
            consumed_days: 5,
            remaining_days: 15,
            notes: null
          }
        ],
        rowCount: 1
      })

      const res = await request(app).get('/api/master/leave-balance?tenant_id=3')
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      const [, params] = query.mock.calls[0]
      expect(params).toEqual([3])
    })
  })

  describe('POST /api/master/leave-balance/grant', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/master/leave-balance/grant')
        .send({ tenant_id: 3, staff_id: 10 })

      expect(res.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 when days is 0', async () => {
      const res = await request(app)
        .post('/api/master/leave-balance/grant')
        .send({ tenant_id: 3, staff_id: 10, fiscal_year: 2026, days: 0 })

      expect(res.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 when days is negative', async () => {
      const res = await request(app)
        .post('/api/master/leave-balance/grant')
        .send({ tenant_id: 3, staff_id: 10, fiscal_year: 2026, days: -1 })

      expect(res.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 when tenant/staff does not exist (FK violation)', async () => {
      const fkError = new Error('foreign key violation')
      fkError.code = '23503'
      query.mockRejectedValue(fkError)

      const res = await request(app)
        .post('/api/master/leave-balance/grant')
        .send({ tenant_id: 999, staff_id: 999, fiscal_year: 2026, days: 10 })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('UPSERTs and returns updated row on success', async () => {
      query.mockResolvedValue({
        rows: [
          {
            id: 1,
            tenant_id: 3,
            staff_id: 10,
            fiscal_year: 2026,
            granted_days: 20,
            consumed_days: 0,
            remaining_days: 20,
            notes: 'annual grant'
          }
        ],
        rowCount: 1
      })

      const res = await request(app)
        .post('/api/master/leave-balance/grant')
        .send({
          tenant_id: 3,
          staff_id: 10,
          fiscal_year: 2026,
          days: 20,
          notes: 'annual grant'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.granted_days).toBe(20)

      const [sql, params] = query.mock.calls[0]
      expect(sql).toContain('INSERT INTO hr.leave_balance')
      expect(sql).toContain('ON CONFLICT')
      expect(sql).toContain('hr.leave_balance.granted_days + EXCLUDED.granted_days')
      expect(params).toEqual([3, 10, 2026, 20, 'annual grant'])
    })
  })

  describe('POST /api/master/leave-balance/consume', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/master/leave-balance/consume')
        .send({ tenant_id: 3, staff_id: 10, fiscal_year: 2026 })

      expect(res.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 when no balance record exists', async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      const res = await request(app)
        .post('/api/master/leave-balance/consume')
        .send({ tenant_id: 3, staff_id: 10, fiscal_year: 2026, days: 1 })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('returns 400 and does not update DB when consuming more than remaining', async () => {
      query.mockResolvedValueOnce({
        rows: [{ id: 1, granted_days: 10, consumed_days: 8, remaining_days: 2 }],
        rowCount: 1
      })

      const res = await request(app)
        .post('/api/master/leave-balance/consume')
        .send({ tenant_id: 3, staff_id: 10, fiscal_year: 2026, days: 5 })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/残日数/)
      // 2回目のクエリ（UPDATE）は呼ばれない
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('returns 200 and increments consumed_days on success', async () => {
      query
        .mockResolvedValueOnce({
          rows: [{ id: 1, granted_days: 10, consumed_days: 2, remaining_days: 8 }],
          rowCount: 1
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              tenant_id: 3,
              staff_id: 10,
              fiscal_year: 2026,
              granted_days: 10,
              consumed_days: 5,
              remaining_days: 5,
              notes: null
            }
          ],
          rowCount: 1
        })

      const res = await request(app)
        .post('/api/master/leave-balance/consume')
        .send({ tenant_id: 3, staff_id: 10, fiscal_year: 2026, days: 3 })

      expect(res.status).toBe(200)
      expect(res.body.data.consumed_days).toBe(5)
      expect(res.body.data.remaining_days).toBe(5)

      expect(query).toHaveBeenCalledTimes(2)
      const [updateSql, updateParams] = query.mock.calls[1]
      expect(updateSql).toContain('UPDATE hr.leave_balance')
      expect(updateSql).toContain('consumed_days = consumed_days + $1')
      expect(updateParams).toEqual([3, null, 3, 10, 2026])
    })

    it('returns 400 when DB raises CHECK constraint violation', async () => {
      query.mockResolvedValueOnce({
        rows: [{ id: 1, granted_days: 10, consumed_days: 2, remaining_days: 8 }],
        rowCount: 1
      })
      const checkError = new Error('check constraint violation')
      checkError.code = '23514'
      query.mockRejectedValueOnce(checkError)

      const res = await request(app)
        .post('/api/master/leave-balance/consume')
        .send({ tenant_id: 3, staff_id: 10, fiscal_year: 2026, days: 3 })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })
})
