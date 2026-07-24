import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import healthRoutes from '../../src/routes/health.js'
import { query } from '../../src/config/database.js'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn()
}))

describe('GET /api/health', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = express()
    app.use('/api/health', healthRoutes)
  })

  afterEach(() => {
    delete process.env.HEALTH_DB_CHECK_TIMEOUT_MS
  })

  it('returns 200 with connected: true when the DB responds', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] })

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledWith('SELECT 1')
    expect(response.body.success).toBe(true)
    expect(response.body.status).toBe('ok')
    expect(response.body.database.connected).toBe(true)
    expect(response.body.backend).toHaveProperty('environment')
    expect(response.body.database).toHaveProperty('environment')
    expect(response.body.database).toHaveProperty('host')
  })

  it('returns 503 with connected: false when the DB query fails', async () => {
    query.mockRejectedValue(new Error('connection refused'))

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body.success).toBe(false)
    expect(response.body.status).toBe('error')
    expect(response.body.database.connected).toBe(false)
  })

  it('returns 503 with connected: false when the DB check times out', async () => {
    process.env.HEALTH_DB_CHECK_TIMEOUT_MS = '50'
    query.mockImplementation(() => new Promise(() => {}))

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body.success).toBe(false)
    expect(response.body.database.connected).toBe(false)
  })
})
