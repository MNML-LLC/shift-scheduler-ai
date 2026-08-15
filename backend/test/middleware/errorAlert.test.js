import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

const axios = (await import('axios')).default
const { createErrorAlertMiddleware } = await import('../../src/middleware/errorAlert.js')
const { _resetRateLimiter } = await import('../../src/utils/alertRateLimiter.js')

const WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/ERROR'

function waitFor(fn, { timeout = 500, interval = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      try {
        if (fn()) return resolve()
      } catch {
        /* keep polling */
      }
      if (Date.now() - start > timeout) {
        return reject(new Error('waitFor: timeout'))
      }
      setTimeout(tick, interval)
    }
    tick()
  })
}

describe('createErrorAlertMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetRateLimiter()
    process.env.SLACK_ERROR_WEBHOOK_URL = WEBHOOK_URL
    axios.post.mockResolvedValue({ status: 200 })
  })

  afterEach(() => {
    delete process.env.SLACK_ERROR_WEBHOOK_URL
    delete process.env.SLACK_WEBHOOK_URL
  })

  it('notifies Slack when a route responds with a 5xx status', async () => {
    const app = express()
    app.use(createErrorAlertMiddleware())
    app.get('/api/boom', (req, res) => {
      res.status(500).json({ error: 'boom' })
    })

    await request(app).get('/api/boom').expect(500)

    await waitFor(() => axios.post.mock.calls.length === 1)
    const [url, payload] = axios.post.mock.calls[0]
    expect(url).toBe(WEBHOOK_URL)
    expect(payload.text).toContain('GET /api/boom')
    expect(payload.text).toContain('500')
  })

  it('does not notify for 4xx or 2xx responses', async () => {
    const app = express()
    app.use(createErrorAlertMiddleware())
    app.get('/api/ok', (req, res) => res.status(200).json({ ok: true }))
    app.get('/api/bad', (req, res) => res.status(400).json({ error: 'bad' }))

    await request(app).get('/api/ok').expect(200)
    await request(app).get('/api/bad').expect(400)

    // 少し待ってから確認（finish イベントが非同期に発火するため）
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('excludes /api/health from notifications', async () => {
    const app = express()
    app.use(createErrorAlertMiddleware())
    app.use('/api/health', (req, res) => res.status(503).json({ status: 'error' }))

    await request(app).get('/api/health').expect(503)

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('respects res.locals.suppressGenericAlert to skip notification', async () => {
    const app = express()
    app.use(createErrorAlertMiddleware())
    app.get('/api/suppressed', (req, res) => {
      res.locals.suppressGenericAlert = true
      res.status(500).json({ error: 'already handled by route' })
    })

    await request(app).get('/api/suppressed').expect(500)

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('deduplicates repeated identical 5xx errors within the rate-limit window', async () => {
    const app = express()
    app.use(createErrorAlertMiddleware())
    app.get('/api/flaky', (req, res) => res.status(500).json({ error: 'boom' }))

    await request(app).get('/api/flaky').expect(500)
    await request(app).get('/api/flaky').expect(500)
    await request(app).get('/api/flaky').expect(500)

    await waitFor(() => axios.post.mock.calls.length >= 1)
    // 短時間の連続発生は 1 回だけ通知される
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('uses the route pattern (not the concrete path) in the signature', async () => {
    const app = express()
    app.use(createErrorAlertMiddleware())
    app.get('/api/items/:id', (req, res) => res.status(500).json({ error: 'boom' }))

    // 別 id で連続アクセスしても、同じルートパターンとして 1 回に絞られる
    await request(app).get('/api/items/1').expect(500)
    await request(app).get('/api/items/2').expect(500)

    await waitFor(() => axios.post.mock.calls.length >= 1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(axios.post).toHaveBeenCalledTimes(1)
    const [, payload] = axios.post.mock.calls[0]
    expect(payload.text).toContain('/api/items/:id')
  })

  it('includes the error message and stack head from res.locals.alertError', async () => {
    const app = express()
    app.use(createErrorAlertMiddleware())
    app.get('/api/explode', (req, res, next) => {
      const err = new Error('explosion in aisle 5')
      next(err)
    })
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
      res.locals.alertError = err
      res.status(500).json({ error: 'internal' })
    })

    await request(app).get('/api/explode').expect(500)

    await waitFor(() => axios.post.mock.calls.length === 1)
    const [, payload] = axios.post.mock.calls[0]
    expect(payload.text).toContain('explosion in aisle 5')
  })

  it('skips notification when no webhook is configured (does not throw)', async () => {
    delete process.env.SLACK_ERROR_WEBHOOK_URL
    delete process.env.SLACK_WEBHOOK_URL

    const app = express()
    app.use(createErrorAlertMiddleware())
    app.get('/api/boom', (req, res) => res.status(500).json({ error: 'boom' }))

    await request(app).get('/api/boom').expect(500)

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(axios.post).not.toHaveBeenCalled()
  })
})
