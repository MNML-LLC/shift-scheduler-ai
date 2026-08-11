import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import masterRoutes from '../../src/routes/master.js'
import { query } from '../../src/config/database.js'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {}
}))

describe('master deadline-settings routes', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = express()
    app.use(express.json())
    app.use('/api/master', masterRoutes)
  })

  describe('GET /api/master/deadline-settings', () => {
    it('returns 400 when tenant_id is missing', async () => {
      const response = await request(app).get('/api/master/deadline-settings')

      expect(response.status).toBe(400)
      expect(response.body.success).toBe(false)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns rows scoped to tenant_id', async () => {
      query.mockResolvedValue({
        rows: [
          {
            deadline_setting_id: 1,
            tenant_id: 3,
            employment_type: 'PART_TIME',
            deadline_day: 15,
            deadline_time: '18:00',
            is_enabled: true,
            description: 'アルバイト'
          }
        ]
      })

      const response = await request(app).get('/api/master/deadline-settings?tenant_id=3')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(1)
      const [text, params] = query.mock.calls[0]
      expect(text).toContain('WHERE tenant_id = $1')
      expect(params[0]).toBe('3')
    })
  })

  describe('PUT /api/master/deadline-settings', () => {
    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .put('/api/master/deadline-settings')
        .send({ tenant_id: 3 })

      expect(response.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 when deadline_day is out of range', async () => {
      const response = await request(app)
        .put('/api/master/deadline-settings')
        .send({
          tenant_id: 3,
          employment_type: 'PART_TIME',
          deadline_day: 32,
          deadline_time: '18:00'
        })

      expect(response.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 when deadline_time is malformed', async () => {
      const response = await request(app)
        .put('/api/master/deadline-settings')
        .send({
          tenant_id: 3,
          employment_type: 'PART_TIME',
          deadline_day: 15,
          deadline_time: '25:99'
        })

      expect(response.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    })

    it('UPSERTs the row and returns it', async () => {
      query.mockResolvedValue({
        rows: [
          {
            deadline_setting_id: 7,
            tenant_id: 3,
            employment_type: 'PART_TIME',
            deadline_day: 20,
            deadline_time: '12:00',
            is_enabled: true,
            description: null
          }
        ]
      })

      const response = await request(app)
        .put('/api/master/deadline-settings')
        .send({
          tenant_id: 3,
          employment_type: 'PART_TIME',
          deadline_day: 20,
          deadline_time: '12:00',
          is_enabled: true
        })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.deadline_day).toBe(20)

      const [text, params] = query.mock.calls[0]
      expect(text).toContain('ON CONFLICT (tenant_id, employment_type) DO UPDATE')
      expect(params).toEqual([3, 'PART_TIME', 20, '12:00', true, null])
    })
  })
})
