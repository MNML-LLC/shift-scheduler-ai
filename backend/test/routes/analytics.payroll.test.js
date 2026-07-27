import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import analyticsRoutes from '../../src/routes/analytics.js'
import { query } from '../../src/config/database.js'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {}
}))

describe('GET /api/analytics/payroll', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = express()
    app.use('/api/analytics', analyticsRoutes)
  })

  it('returns 400 with "tenant_id is required" when tenant_id is missing', async () => {
    const response = await request(app).get('/api/analytics/payroll')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when tenant_id is an empty string', async () => {
    const response = await request(app).get('/api/analytics/payroll?tenant_id=')

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('tenant_id is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 200 with data when tenant_id is provided', async () => {
    query.mockResolvedValue({ rows: [{ payroll_id: 1, tenant_id: '42' }] })

    const response = await request(app).get('/api/analytics/payroll?tenant_id=42')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toEqual([{ payroll_id: 1, tenant_id: '42' }])
    expect(query).toHaveBeenCalledTimes(1)
    const [, params] = query.mock.calls[0]
    expect(params[0]).toBe('42')
  })

  it('scopes the query strictly to the supplied tenant_id (no default fallback)', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app).get('/api/analytics/payroll?tenant_id=99')

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('WHERE tenant_id = $1')
    expect(params[0]).toBe('99')
    expect(params[0]).not.toBe(1)
  })

  it('applies optional store_id / staff_id / year / month filters together with tenant_id', async () => {
    query.mockResolvedValue({ rows: [] })

    await request(app)
      .get('/api/analytics/payroll')
      .query({ tenant_id: '7', store_id: '3', staff_id: '11', year: '2026', month: '7' })

    const [queryText, params] = query.mock.calls[0]
    expect(queryText).toContain('AND store_id = $2')
    expect(queryText).toContain('AND staff_id = $3')
    expect(queryText).toContain('AND year = $4')
    expect(queryText).toContain('AND month = $5')
    expect(params).toEqual(['7', '3', '11', '2026', '7'])
  })
})
