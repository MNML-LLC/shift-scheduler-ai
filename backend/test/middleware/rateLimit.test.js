import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  createOpenaiLimiter,
  createGeneralLimiter,
  OPENAI_RATE_LIMIT,
  GENERAL_RATE_LIMIT
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
      error: 'Too many requests, please try again later.'
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
      error: 'Too many requests, please try again later.'
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
