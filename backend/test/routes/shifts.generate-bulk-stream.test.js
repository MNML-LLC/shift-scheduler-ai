import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import http from 'node:http'

vi.mock('../../src/config/database.js', async () => {
  const actual = await vi.importActual('../../src/config/database.js')
  return {
    query: vi.fn(),
    transaction: vi.fn(),
    DatabaseUnavailableError: actual.DatabaseUnavailableError,
  }
})

vi.mock('../../src/services/shift/ShiftGenerationService.js', () => {
  const ShiftGenerationService = vi.fn()
  ShiftGenerationService.prototype.generateShifts = vi.fn()
  return { default: ShiftGenerationService }
})

vi.mock('../../src/utils/slackNotifier.js', () => ({
  notifyShiftGenerationError: vi.fn().mockResolvedValue(undefined),
}))

const { query, transaction } = await import('../../src/config/database.js')
const { default: ShiftGenerationService } = await import(
  '../../src/services/shift/ShiftGenerationService.js'
)
const { default: shiftsRoutes } = await import('../../src/routes/shifts.js')

const ENDPOINT = '/api/shifts/plans/generate-bulk/stream'

function buildAppServer() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address()
      resolve({ server, port })
    })
  })
}

function fetchSSE(port, queryString) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: `${ENDPOINT}${queryString ? `?${queryString}` : ''}`,
        method: 'GET',
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

function parseEvents(body) {
  const events = []
  const blocks = body.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    const lines = block.split('\n')
    let event = null
    let data = null
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7)
      if (line.startsWith('data: ')) data = JSON.parse(line.slice(6))
    }
    if (event) events.push({ event, data })
  }
  return events
}

describe('GET /api/shifts/plans/generate-bulk/stream', () => {
  let server
  let port

  beforeEach(async () => {
    vi.clearAllMocks()
    const created = await buildAppServer()
    server = created.server
    port = created.port
  })

  afterEach(() => {
    if (server) server.close()
  })

  it('returns 400 when store_ids and all are both missing', async () => {
    const res = await fetchSSE(port, 'tenant_id=1&year=2100&month=1')
    expect(res.status).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
    expect(body.error).toContain('store_ids')
  })

  it('returns 400 when year is missing', async () => {
    const res = await fetchSSE(port, 'tenant_id=1&store_ids=1&month=1')
    expect(res.status).toBe(400)
  })

  it('returns 400 when month is missing', async () => {
    const res = await fetchSSE(port, 'tenant_id=1&store_ids=1&year=2100')
    expect(res.status).toBe(400)
  })

  it('returns 400 when tenant_id is missing', async () => {
    const res = await fetchSSE(port, 'store_ids=1&year=2100&month=1')
    expect(res.status).toBe(400)
  })

  it('skips APPROVED/CONFIRMED plan stores and reports them in skipped[]', async () => {
    query.mockResolvedValueOnce({
      rows: [{ store_id: 2 }],
    })

    ShiftGenerationService.prototype.generateShifts.mockResolvedValue({
      shifts: [],
      validation: { summary: {}, violations: [] },
      metadata: {},
    })
    transaction.mockResolvedValue(42)

    const res = await fetchSSE(port, 'tenant_id=1&store_ids=1,2,3&year=2100&month=1')
    expect(res.status).toBe(200)

    const events = parseEvents(res.body)
    const complete = events.find((e) => e.event === 'complete')
    expect(complete).toBeDefined()
    expect(complete.data.skipped).toEqual([
      { store_id: 2, reason: '承認済み/確定済みプランが存在します' },
    ])
    expect(complete.data.created).toHaveLength(2)
    const skippedEvents = events.filter((e) => e.event === 'store_skipped')
    expect(skippedEvents).toHaveLength(1)
    expect(skippedEvents[0].data.store_id).toBe(2)
  })

  it('emits store_complete for successful stores with plan_id from transaction', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    ShiftGenerationService.prototype.generateShifts.mockResolvedValue({
      shifts: [],
      validation: { summary: {}, violations: [] },
      metadata: {},
    })
    transaction.mockResolvedValueOnce(101).mockResolvedValueOnce(102)

    const res = await fetchSSE(port, 'tenant_id=1&store_ids=10,20&year=2100&month=1')
    expect(res.status).toBe(200)

    const events = parseEvents(res.body)
    const completes = events.filter((e) => e.event === 'store_complete')
    expect(completes).toHaveLength(2)
    const complete = events.find((e) => e.event === 'complete')
    expect(complete.data.created).toEqual(
      expect.arrayContaining([
        { store_id: 10, plan_id: expect.any(Number) },
        { store_id: 20, plan_id: expect.any(Number) },
      ])
    )
    expect(complete.data.failed).toEqual([])
  })

  it('continues with other stores when one store fails; failed[] has the error', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    ShiftGenerationService.prototype.generateShifts
      .mockRejectedValueOnce({ success: false, error: 'AI API error', phase: 'ai_generation' })
      .mockResolvedValueOnce({
        shifts: [],
        validation: { summary: {}, violations: [] },
        metadata: {},
      })
    transaction.mockResolvedValue(999)

    const res = await fetchSSE(port, 'tenant_id=1&store_ids=1,2&year=2100&month=1')
    expect(res.status).toBe(200)

    const events = parseEvents(res.body)
    const complete = events.find((e) => e.event === 'complete')
    expect(complete.data.created).toHaveLength(1)
    expect(complete.data.failed).toHaveLength(1)
    expect(complete.data.failed[0].store_id).toBe(1)
    expect(complete.data.failed[0].error).toBe('AI API error')

    const errorEvents = events.filter((e) => e.event === 'store_error')
    expect(errorEvents).toHaveLength(1)
  })

  it('uses transaction(callback) to ensure atomic writes (no BEGIN via query)', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    ShiftGenerationService.prototype.generateShifts.mockResolvedValue({
      shifts: [],
      validation: { summary: {}, violations: [] },
      metadata: {},
    })
    transaction.mockResolvedValue(1)

    await fetchSSE(port, 'tenant_id=1&store_ids=1&year=2100&month=1')

    expect(transaction).toHaveBeenCalledTimes(1)
    // 生成後の BEGIN/COMMIT が query() 経由で呼ばれていないこと
    const beginCalls = query.mock.calls.filter(([sql]) => /BEGIN|COMMIT|ROLLBACK/i.test(sql || ''))
    expect(beginCalls).toHaveLength(0)
  })

  it('resolves store_ids from tenant when all=true is set', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ store_id: 7 }, { store_id: 8 }] })
      .mockResolvedValueOnce({ rows: [] })

    ShiftGenerationService.prototype.generateShifts.mockResolvedValue({
      shifts: [],
      validation: { summary: {}, violations: [] },
      metadata: {},
    })
    transaction.mockResolvedValue(1)

    const res = await fetchSSE(port, 'tenant_id=1&all=true&year=2100&month=1')
    expect(res.status).toBe(200)

    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('core.stores')
    expect(sql).toContain('is_active = TRUE')
    expect(params).toEqual([1])

    const events = parseEvents(res.body)
    const complete = events.find((e) => e.event === 'complete')
    expect(complete.data.created).toHaveLength(2)
  })

  it('enforces max concurrency of 3 during transaction() calls', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    let inFlight = 0
    let observedMax = 0
    ShiftGenerationService.prototype.generateShifts.mockImplementation(async () => {
      inFlight++
      observedMax = Math.max(observedMax, inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
      return { shifts: [], validation: { summary: {}, violations: [] }, metadata: {} }
    })
    transaction.mockResolvedValue(1)

    await fetchSSE(port, 'tenant_id=1&store_ids=1,2,3,4,5,6&year=2100&month=1')

    expect(observedMax).toBeLessThanOrEqual(3)
    expect(observedMax).toBeGreaterThan(0)
  })

  it('emits complete event with empty arrays when all stores are skipped', async () => {
    query.mockResolvedValueOnce({ rows: [{ store_id: 1 }, { store_id: 2 }] })

    const res = await fetchSSE(port, 'tenant_id=1&store_ids=1,2&year=2100&month=1')
    expect(res.status).toBe(200)

    const events = parseEvents(res.body)
    const complete = events.find((e) => e.event === 'complete')
    expect(complete.data.created).toEqual([])
    expect(complete.data.failed).toEqual([])
    expect(complete.data.skipped).toHaveLength(2)
    expect(ShiftGenerationService.prototype.generateShifts).not.toHaveBeenCalled()
  })
})
