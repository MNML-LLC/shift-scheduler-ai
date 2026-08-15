import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

const axios = (await import('axios')).default
const {
  notifyShiftGenerationError,
  notifyServerError,
  classifyShiftGenerationError,
  SHIFT_GENERATION_ERROR_TYPES,
} = await import('../../src/utils/slackNotifier.js')

const WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/XXXX'

describe('classifyShiftGenerationError', () => {
  it('classifies ShiftGenerationService ai_generation errors as OpenAI API error', () => {
    const error = { success: false, phase: 'ai_generation', error: 'AI生成に失敗しました' }
    expect(classifyShiftGenerationError(error)).toBe(SHIFT_GENERATION_ERROR_TYPES.OPENAI)
  })

  it('classifies ShiftGenerationService errors in other phases as unexpected', () => {
    const error = { success: false, phase: 'data_collection', error: 'マスターデータが不足しています' }
    expect(classifyShiftGenerationError(error)).toBe(SHIFT_GENERATION_ERROR_TYPES.UNEXPECTED)
  })

  it('classifies errors with a SQLSTATE code as DB error', () => {
    const error = Object.assign(new Error('duplicate key value'), { code: '23505' })
    expect(classifyShiftGenerationError(error)).toBe(SHIFT_GENERATION_ERROR_TYPES.DATABASE)
  })

  it('classifies node-postgres errors with severity as DB error', () => {
    const error = Object.assign(new Error('connection terminated'), { severity: 'FATAL' })
    expect(classifyShiftGenerationError(error)).toBe(SHIFT_GENERATION_ERROR_TYPES.DATABASE)
  })

  it('classifies plain errors as unexpected', () => {
    expect(classifyShiftGenerationError(new Error('boom'))).toBe(SHIFT_GENERATION_ERROR_TYPES.UNEXPECTED)
    expect(classifyShiftGenerationError(null)).toBe(SHIFT_GENERATION_ERROR_TYPES.UNEXPECTED)
  })
})

describe('notifyShiftGenerationError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SLACK_WEBHOOK_URL = WEBHOOK_URL
    delete process.env.RAILWAY_LOG_URL
  })

  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL
    delete process.env.RAILWAY_LOG_URL
  })

  it('skips notification when SLACK_WEBHOOK_URL is not set', async () => {
    delete process.env.SLACK_WEBHOOK_URL

    const sent = await notifyShiftGenerationError(
      'POST /api/shifts/plans/generate-ai',
      new Error('boom'),
      { tenant_id: 1, store_id: 1, year: 2027, month: 3 }
    )

    expect(sent).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('posts error type, endpoint, request params and error message to the webhook', async () => {
    axios.post.mockResolvedValue({ status: 200 })

    const error = { success: false, phase: 'ai_generation', error: 'AI生成に失敗しました (3回試行)' }
    const sent = await notifyShiftGenerationError(
      'POST /api/shifts/plans/generate-ai',
      error,
      { tenant_id: 1, store_id: 2, year: 2027, month: 3 }
    )

    expect(sent).toBe(true)
    expect(axios.post).toHaveBeenCalledTimes(1)

    const [url, payload, options] = axios.post.mock.calls[0]
    expect(url).toBe(WEBHOOK_URL)
    expect(options.timeout).toBe(5000)
    expect(payload.text).toContain('シフト生成 API エラー')
    expect(payload.text).toContain(SHIFT_GENERATION_ERROR_TYPES.OPENAI)
    expect(payload.text).toContain('POST /api/shifts/plans/generate-ai')
    expect(payload.text).toContain('tenant_id=1 / store_id=2 / 2027年3月')
    expect(payload.text).toContain('AI生成に失敗しました (3回試行)')
    expect(payload.text).toContain('ai_generation')
  })

  it('includes the Railway log link when RAILWAY_LOG_URL is set', async () => {
    process.env.RAILWAY_LOG_URL = 'https://railway.app/project/xxx/logs'
    axios.post.mockResolvedValue({ status: 200 })

    await notifyShiftGenerationError('POST /api/shifts/plans/generate', new Error('boom'), {})

    const [, payload] = axios.post.mock.calls[0]
    expect(payload.text).toContain('https://railway.app/project/xxx/logs')
  })

  it('does not throw when the webhook request itself fails', async () => {
    axios.post.mockRejectedValue(new Error('network error'))

    const sent = await notifyShiftGenerationError(
      'POST /api/shifts/plans/generate',
      new Error('boom'),
      { tenant_id: 1, store_id: 1, year: 2027, month: 3 }
    )

    expect(sent).toBe(false)
  })
})

describe('notifyServerError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SLACK_ERROR_WEBHOOK_URL
    delete process.env.SLACK_WEBHOOK_URL
  })

  afterEach(() => {
    delete process.env.SLACK_ERROR_WEBHOOK_URL
    delete process.env.SLACK_WEBHOOK_URL
  })

  it('skips notification when neither SLACK_ERROR_WEBHOOK_URL nor SLACK_WEBHOOK_URL is set', async () => {
    const sent = await notifyServerError({
      endpoint: 'GET /api/foo',
      statusCode: 500,
      message: 'boom',
    })
    expect(sent).toBe(false)
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('prefers SLACK_ERROR_WEBHOOK_URL over SLACK_WEBHOOK_URL', async () => {
    process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/ERROR'
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/GENERAL'
    axios.post.mockResolvedValue({ status: 200 })

    await notifyServerError({
      endpoint: 'GET /api/foo',
      statusCode: 500,
      message: 'boom',
    })

    const [url] = axios.post.mock.calls[0]
    expect(url).toBe('https://hooks.slack.com/services/T000/B000/ERROR')
  })

  it('falls back to SLACK_WEBHOOK_URL when SLACK_ERROR_WEBHOOK_URL is not set', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/GENERAL'
    axios.post.mockResolvedValue({ status: 200 })

    await notifyServerError({
      endpoint: 'GET /api/foo',
      statusCode: 500,
      message: 'boom',
    })

    const [url] = axios.post.mock.calls[0]
    expect(url).toBe('https://hooks.slack.com/services/T000/B000/GENERAL')
  })

  it('posts endpoint, statusCode, message, timestamp and first 3 lines of stack', async () => {
    process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/ERROR'
    axios.post.mockResolvedValue({ status: 200 })

    const stack = 'Error: kaboom\n  at foo (a.js:1:1)\n  at bar (b.js:2:2)\n  at baz (c.js:3:3)\n  at qux (d.js:4:4)'

    const sent = await notifyServerError({
      endpoint: 'POST /api/whatever',
      statusCode: 502,
      message: 'upstream bad gateway',
      stack,
      timestamp: '2026-08-15T00:00:00.000Z',
    })

    expect(sent).toBe(true)
    const [, payload, options] = axios.post.mock.calls[0]
    expect(options.timeout).toBe(5000)
    expect(payload.text).toContain('POST /api/whatever')
    expect(payload.text).toContain('502')
    expect(payload.text).toContain('upstream bad gateway')
    expect(payload.text).toContain('2026-08-15T00:00:00.000Z')
    // 先頭3行までしか載せない
    expect(payload.text).toContain('at foo (a.js:1:1)')
    expect(payload.text).toContain('at bar (b.js:2:2)')
    expect(payload.text).not.toContain('at baz (c.js:3:3)')
    expect(payload.text).not.toContain('at qux (d.js:4:4)')
  })

  it('does not throw when the webhook request itself fails', async () => {
    process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/ERROR'
    axios.post.mockRejectedValue(new Error('network error'))

    const sent = await notifyServerError({
      endpoint: 'GET /api/foo',
      statusCode: 500,
      message: 'boom',
    })
    expect(sent).toBe(false)
  })

  it('generates a timestamp when none is passed', async () => {
    process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/ERROR'
    axios.post.mockResolvedValue({ status: 200 })

    await notifyServerError({
      endpoint: 'GET /api/foo',
      statusCode: 500,
      message: 'boom',
    })

    const [, payload] = axios.post.mock.calls[0]
    expect(payload.text).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
