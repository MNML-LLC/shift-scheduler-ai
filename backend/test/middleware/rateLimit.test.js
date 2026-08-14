import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  createOpenaiLimiter,
  createGeneralLimiter,
  createAuthFailureLimiter,
  OPENAI_RATE_LIMIT,
  GENERAL_RATE_LIMIT,
  AUTH_FAILURE_LIMIT,
  AUTH_FAILURE_WINDOW_MS
} from '../../src/middleware/rateLimit.js'

function buildApp(limiter) {
  const app = express()
  app.use(limiter)
  app.get('/test', (req, res) => res.json({ success: true }))
  return app
}

describe('rate limit middleware', () => {
  it('exposes the limits required by the security policy', () => {
    expect(OPENAI_RATE_LIMIT).toBe(10)
    expect(GENERAL_RATE_LIMIT).toBe(100)
  })

  it('allows requests up to the OpenAI limit, then returns 429', async () => {
    const app = buildApp(createOpenaiLimiter())

    for (let i = 0; i < OPENAI_RATE_LIMIT; i++) {
      const res = await request(app).get('/test')
      expect(res.status).toBe(200)
    }

    const blocked = await request(app).get('/test')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      success: false,
      error: 'リクエストが多すぎます。しばらく待ってから再度お試しください。'
    })
  })

  it('allows requests up to the general limit, then returns 429', async () => {
    const app = buildApp(createGeneralLimiter())

    for (let i = 0; i < GENERAL_RATE_LIMIT; i++) {
      const res = await request(app).get('/test')
      expect(res.status).toBe(200)
    }

    const blocked = await request(app).get('/test')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      success: false,
      error: 'リクエストが多すぎます。しばらく待ってから再度お試しください。'
    })
  })

  it('sends standard RateLimit headers without legacy X-RateLimit headers', async () => {
    const app = buildApp(createOpenaiLimiter())

    const res = await request(app).get('/test')

    expect(res.headers['ratelimit-policy']).toBeDefined()
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()
  })

  it('keeps counters independent between limiter instances', async () => {
    const openaiApp = buildApp(createOpenaiLimiter())
    const generalApp = buildApp(createGeneralLimiter())

    for (let i = 0; i < OPENAI_RATE_LIMIT; i++) {
      await request(openaiApp).get('/test')
    }

    const openaiBlocked = await request(openaiApp).get('/test')
    const generalAllowed = await request(generalApp).get('/test')

    expect(openaiBlocked.status).toBe(429)
    expect(generalAllowed.status).toBe(200)
  })
})

describe('server wiring (rate limit after auth)', () => {
  it('applies the strict limiter to /api/openai and the general limiter to other routes', async () => {
    const app = express()
    app.use('/api/openai', createOpenaiLimiter(), (req, res) => res.json({ success: true }))
    app.use('/api', createGeneralLimiter())
    app.get('/api/master/stores', (req, res) => res.json({ success: true }))

    for (let i = 0; i < OPENAI_RATE_LIMIT; i++) {
      await request(app).get('/api/openai')
    }

    const openaiBlocked = await request(app).get('/api/openai')
    const otherAllowed = await request(app).get('/api/master/stores')

    expect(openaiBlocked.status).toBe(429)
    expect(otherAllowed.status).toBe(200)
  })
})

describe('auth failure rate limiter (brute-force protection)', () => {
  it('exposes the limits required by the brute-force policy', () => {
    expect(AUTH_FAILURE_LIMIT).toBe(10)
    expect(AUTH_FAILURE_WINDOW_MS).toBe(15 * 60 * 1000)
  })

  it('returns 429 after the configured number of 401 responses from the same IP', async () => {
    const app = express()
    app.use(createAuthFailureLimiter())
    app.get('/unauth', (req, res) => res.status(401).json({ success: false }))

    for (let i = 0; i < AUTH_FAILURE_LIMIT; i++) {
      const res = await request(app).get('/unauth')
      expect(res.status).toBe(401)
    }

    const blocked = await request(app).get('/unauth')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      success: false,
      error: 'リクエストが多すぎます。しばらく待ってから再度お試しください。'
    })
  })

  it('does not throttle successful responses even when the threshold is exceeded', async () => {
    const app = express()
    app.use(createAuthFailureLimiter())
    app.get('/ok', (req, res) => res.status(200).json({ success: true }))

    for (let i = 0; i < AUTH_FAILURE_LIMIT * 3; i++) {
      const res = await request(app).get('/ok')
      expect(res.status).toBe(200)
    }
  })

  it('does not throttle non-401 error responses (only 401 counts)', async () => {
    const app = express()
    app.use(createAuthFailureLimiter())
    app.get('/boom', (req, res) => res.status(500).json({ success: false }))

    for (let i = 0; i < AUTH_FAILURE_LIMIT * 2; i++) {
      const res = await request(app).get('/boom')
      expect(res.status).toBe(500)
    }
  })

  it('blocks subsequent valid requests once the IP is throttled (integration with authenticate)', async () => {
    const app = express()
    const limiter = createAuthFailureLimiter()

    app.use(limiter)
    app.get('/api/protected', (req, res) => {
      if (req.headers['x-api-key'] === 'valid-key') {
        return res.status(200).json({ success: true })
      }
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    })

    for (let i = 0; i < AUTH_FAILURE_LIMIT; i++) {
      const res = await request(app).get('/api/protected').set('x-api-key', 'wrong-key')
      expect(res.status).toBe(401)
    }

    const blockedInvalid = await request(app)
      .get('/api/protected')
      .set('x-api-key', 'wrong-key')
    expect(blockedInvalid.status).toBe(429)

    const blockedValid = await request(app)
      .get('/api/protected')
      .set('x-api-key', 'valid-key')
    expect(blockedValid.status).toBe(429)
  })

  it('does not accumulate the counter when only valid keys are used', async () => {
    const app = express()
    app.use(createAuthFailureLimiter())
    app.get('/api/protected', (req, res) => {
      if (req.headers['x-api-key'] === 'valid-key') {
        return res.status(200).json({ success: true })
      }
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    })

    for (let i = 0; i < AUTH_FAILURE_LIMIT * 3; i++) {
      const res = await request(app).get('/api/protected').set('x-api-key', 'valid-key')
      expect(res.status).toBe(200)
    }
  })
})
