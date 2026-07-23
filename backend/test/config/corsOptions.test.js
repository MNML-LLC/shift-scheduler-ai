import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import cors from 'cors'
import request from 'supertest'
import { corsOptions, corsErrorHandler } from '../../src/config/corsOptions.js'

function buildApp() {
  const app = express()
  app.use(cors(corsOptions))
  app.use(corsErrorHandler)
  app.get('/api/health', (req, res) => res.json({ success: true }))
  return app
}

describe('corsOptions', () => {
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS

  afterEach(() => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins
    }
  })

  describe('with ALLOWED_ORIGINS configured', () => {
    beforeEach(() => {
      process.env.ALLOWED_ORIGINS =
        'http://localhost:5173,https://shift-scheduler-ai.vercel.app'
    })

    it('allows a request from an allowed origin', async () => {
      const response = await request(buildApp())
        .get('/api/health')
        .set('Origin', 'https://shift-scheduler-ai.vercel.app')

      expect(response.status).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBe(
        'https://shift-scheduler-ai.vercel.app'
      )
    })

    it('rejects a request from a disallowed origin with 403', async () => {
      const response = await request(buildApp())
        .get('/api/health')
        .set('Origin', 'https://evil.example.com')

      expect(response.status).toBe(403)
    })

    it('allows requests without an Origin header (non-browser clients)', async () => {
      const response = await request(buildApp()).get('/api/health')

      expect(response.status).toBe(200)
    })
  })

  describe('without ALLOWED_ORIGINS configured', () => {
    beforeEach(() => {
      delete process.env.ALLOWED_ORIGINS
    })

    it('falls back to allowing http://localhost:5173', async () => {
      const response = await request(buildApp())
        .get('/api/health')
        .set('Origin', 'http://localhost:5173')

      expect(response.status).toBe(200)
    })

    it('rejects other origins with 403', async () => {
      const response = await request(buildApp())
        .get('/api/health')
        .set('Origin', 'https://evil.example.com')

      expect(response.status).toBe(403)
    })
  })
})
