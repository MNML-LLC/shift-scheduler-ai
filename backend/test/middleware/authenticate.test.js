import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { authenticate, isPublicPath, PUBLIC_PATH_PREFIXES } from '../../src/middleware/authenticate.js'

function buildApp() {
  const app = express()
  app.use(authenticate)
  app.get('/protected', (req, res) => res.json({ success: true }))
  return app
}

describe('authenticate middleware', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    delete process.env.API_AUTH_ENABLED
    delete process.env.API_AUTH_KEYS
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('allows requests through when API_AUTH_ENABLED is not "true"', async () => {
    const app = buildApp()

    const res = await request(app).get('/protected')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
  })

  it('rejects requests with 401 when enabled but no x-api-key header is provided', async () => {
    process.env.API_AUTH_ENABLED = 'true'
    process.env.API_AUTH_KEYS = 'test-key-1'
    const app = buildApp()

    const res = await request(app).get('/protected')

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('rejects requests with an invalid x-api-key', async () => {
    process.env.API_AUTH_ENABLED = 'true'
    process.env.API_AUTH_KEYS = 'test-key-1'
    const app = buildApp()

    const res = await request(app).get('/protected').set('x-api-key', 'wrong-key')

    expect(res.status).toBe(401)
  })

  it('allows requests with a valid x-api-key', async () => {
    process.env.API_AUTH_ENABLED = 'true'
    process.env.API_AUTH_KEYS = 'test-key-1'
    const app = buildApp()

    const res = await request(app).get('/protected').set('x-api-key', 'test-key-1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
  })

  it('accepts any key from a comma-separated key list (rotation support)', async () => {
    process.env.API_AUTH_ENABLED = 'true'
    process.env.API_AUTH_KEYS = 'old-key, new-key'
    const app = buildApp()

    const oldRes = await request(app).get('/protected').set('x-api-key', 'old-key')
    const newRes = await request(app).get('/protected').set('x-api-key', 'new-key')

    expect(oldRes.status).toBe(200)
    expect(newRes.status).toBe(200)
  })

  it('rejects all requests when enabled but API_AUTH_KEYS is not configured', async () => {
    process.env.API_AUTH_ENABLED = 'true'
    const app = buildApp()

    const res = await request(app).get('/protected').set('x-api-key', 'anything')

    expect(res.status).toBe(401)
  })
})

describe('server wiring (public path exclusion)', () => {
  const ORIGINAL_ENV = { ...process.env }

  function buildServerLikeApp() {
    const app = express()
    app.use((req, res, next) => {
      if (isPublicPath(req.path)) {
        return next()
      }
      return authenticate(req, res, next)
    })
    app.get('/api/health', (req, res) => res.json({ success: true, public: true }))
    app.get('/api/liff/staff-info', (req, res) => res.json({ success: true, liff: true }))
    app.get('/api/master/stores', (req, res) => res.json({ success: true }))
    app.get('/api/shifts/plans', (req, res) => res.json({ success: true }))
    app.get('/api/analytics/payroll', (req, res) => res.json({ success: true }))
    return app
  }

  beforeEach(() => {
    process.env.API_AUTH_ENABLED = 'true'
    process.env.API_AUTH_KEYS = 'test-key-1'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('keeps /api/health reachable without credentials', async () => {
    const res = await request(buildServerLikeApp()).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body.public).toBe(true)
  })

  it('leaves /api/liff routes untouched by the API key middleware', async () => {
    const res = await request(buildServerLikeApp()).get('/api/liff/staff-info')

    expect(res.status).toBe(200)
    expect(res.body.liff).toBe(true)
  })

  it('rejects unauthenticated requests to admin routes with 401', async () => {
    const app = buildServerLikeApp()

    for (const path of ['/api/master/stores', '/api/shifts/plans', '/api/analytics/payroll']) {
      const res = await request(app).get(path)

      expect(res.status).toBe(401)
      expect(res.body).toEqual({ success: false, error: 'Unauthorized' })
    }
  })

  it('allows authenticated requests to admin routes', async () => {
    const app = buildServerLikeApp()

    for (const path of ['/api/master/stores', '/api/shifts/plans', '/api/analytics/payroll']) {
      const res = await request(app).get(path).set('x-api-key', 'test-key-1')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ success: true })
    }
  })
})

describe('isPublicPath', () => {
  it('includes /api/health, /api/liff, and the batch endpoint', () => {
    expect(PUBLIC_PATH_PREFIXES).toContain('/api/health')
    expect(PUBLIC_PATH_PREFIXES).toContain('/api/liff')
    expect(PUBLIC_PATH_PREFIXES).toContain('/api/shifts/plans/monthly-first-plan-batch')
  })

  it('matches the exact prefix and nested paths', () => {
    expect(isPublicPath('/api/health')).toBe(true)
    expect(isPublicPath('/api/liff')).toBe(true)
    expect(isPublicPath('/api/liff/shift-request')).toBe(true)
    expect(isPublicPath('/api/shifts/plans/monthly-first-plan-batch')).toBe(true)
  })

  it('does not match unrelated or prefix-lookalike paths', () => {
    expect(isPublicPath('/api/shifts')).toBe(false)
    expect(isPublicPath('/api/analytics/payroll')).toBe(false)
    expect(isPublicPath('/api/liffx')).toBe(false)
    expect(isPublicPath('/api/healthcheck')).toBe(false)
  })
})
