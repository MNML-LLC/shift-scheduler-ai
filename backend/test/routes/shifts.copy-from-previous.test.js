import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}))

// ConstraintValidationService は正規パスからロードされるが、
// バリデーション結果の内容はこのテストの主眼ではないためスタブする
vi.mock('../../src/services/shift/ConstraintValidationService.js', () => ({
  default: class {
    async validateShifts() {
      return { summary: { error: 0, warning: 0 }, violations: [] }
    }
  },
}))

const { query } = await import('../../src/config/database.js')
const { default: shiftsRoutes } = await import('../../src/routes/shifts.js')

const ENDPOINT = '/api/shifts/plans/copy-from-previous'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return app
}

/**
 * copy-from-previous エンドポイントのクエリ順序:
 *   1) BEGIN
 *   2) SELECT plan_id FROM shift_plans (source SECOND plan)
 *   3) SELECT * FROM shifts (source shifts)
 *   4) SELECT plan_id FROM shift_plans (existing FIRST plan check)
 *   5) [overwrite時のみ] DELETE FROM shifts (2回) — 実装上は shifts と shift_plans を各1回削除
 *   6) INSERT INTO shift_plans (new plan)
 *   7) INSERT INTO shifts (1件ずつ)
 *   8) COMMIT
 *   9) SELECT copied shifts (バリデーション用)
 *  10) SELECT staff
 *  11) SELECT stores
 */

const SOURCE_PLAN_ID = 999
const NEW_PLAN_ID = 1234
const SOURCE_SHIFTS = [
  {
    staff_id: 10,
    shift_date: '2026-08-04', // 2026年8月4日は火曜日 (第1火曜)
    pattern_id: 1,
    start_time: '09:00:00',
    end_time: '18:00:00',
    break_minutes: 60,
    total_hours: 8,
    labor_cost: 8000,
    assigned_skills: null,
    is_preferred: false,
  },
]

function mockValidationTail() {
  // 9) copied shifts
  query.mockResolvedValueOnce({
    rows: [
      {
        shift_id: 1,
        staff_id: 10,
        shift_date: '2026-09-01',
        start_time: '09:00:00',
        end_time: '18:00:00',
        break_minutes: 60,
        staff_name: 'テスト太郎',
        employment_type: 'FULL_TIME',
      },
    ],
  })
  // 10) staff
  query.mockResolvedValueOnce({ rows: [] })
  // 11) stores
  query.mockResolvedValueOnce({ rows: [{ store_id: 5 }] })
}

describe('POST /api/shifts/plans/copy-from-previous — Issue #45', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
  })

  it('creates a FIRST plan with plan_type explicitly set to FIRST and returns inserted_shifts_count', async () => {
    // BEGIN
    query.mockResolvedValueOnce({ rows: [] })
    // source SECOND plan lookup
    query.mockResolvedValueOnce({ rows: [{ plan_id: SOURCE_PLAN_ID }] })
    // source shifts
    query.mockResolvedValueOnce({ rows: SOURCE_SHIFTS })
    // existing FIRST plan lookup (none)
    query.mockResolvedValueOnce({ rows: [] })
    // INSERT new plan
    query.mockResolvedValueOnce({ rows: [{ plan_id: NEW_PLAN_ID }] })
    // INSERT shift (1件)
    query.mockResolvedValueOnce({ rows: [] })
    // COMMIT
    query.mockResolvedValueOnce({ rows: [] })
    mockValidationTail()

    const res = await request(app).post(ENDPOINT).send({
      tenant_id: 1,
      store_id: 5,
      target_year: 2026,
      target_month: 9,
      created_by: 1,
    })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.inserted_shifts_count).toBe(1)
    expect(res.body.data.plan_type).toBe('FIRST')
    expect(res.body.data.plan_id).toBe(NEW_PLAN_ID)
    expect(res.body.data.inserted_shifts_count).toBe(1)

    // INSERT クエリに plan_type='FIRST' が含まれることを確認
    const insertPlanCall = query.mock.calls.find(c =>
      /INSERT INTO ops\.shift_plans/i.test(c[0])
    )
    expect(insertPlanCall).toBeTruthy()
    expect(insertPlanCall[0]).toMatch(/'FIRST'/)
    // status='DRAFT' も同時に指定される
    expect(insertPlanCall[0]).toMatch(/'DRAFT'/)
  })

  it('returns 404 when previous month has no SECOND plan', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // BEGIN
    query.mockResolvedValueOnce({ rows: [] }) // source SECOND plan lookup → not found
    query.mockResolvedValueOnce({ rows: [] }) // ROLLBACK

    const res = await request(app).post(ENDPOINT).send({
      tenant_id: 1,
      store_id: 5,
      target_year: 2026,
      target_month: 9,
      created_by: 1,
    })

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('第2案（確定版）が見つかりません')
  })

  it('returns 409 when a FIRST plan already exists in the target month and overwrite is not set', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // BEGIN
    query.mockResolvedValueOnce({ rows: [{ plan_id: SOURCE_PLAN_ID }] }) // source plan
    query.mockResolvedValueOnce({ rows: SOURCE_SHIFTS }) // source shifts
    query.mockResolvedValueOnce({ rows: [{ plan_id: 555 }] }) // existing FIRST plan
    query.mockResolvedValueOnce({ rows: [] }) // ROLLBACK

    const res = await request(app).post(ENDPOINT).send({
      tenant_id: 1,
      store_id: 5,
      target_year: 2026,
      target_month: 9,
      created_by: 1,
    })

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('同月の第1案が既に存在します')

    // INSERT plan は呼ばれない
    const insertPlanCall = query.mock.calls.find(c =>
      /INSERT INTO ops\.shift_plans/i.test(c[0])
    )
    expect(insertPlanCall).toBeFalsy()
  })

  it('deletes existing FIRST plan and re-creates it when overwrite=true', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // BEGIN
    query.mockResolvedValueOnce({ rows: [{ plan_id: SOURCE_PLAN_ID }] }) // source plan
    query.mockResolvedValueOnce({ rows: SOURCE_SHIFTS }) // source shifts
    query.mockResolvedValueOnce({ rows: [{ plan_id: 555 }] }) // existing FIRST plan
    query.mockResolvedValueOnce({ rows: [] }) // DELETE shifts
    query.mockResolvedValueOnce({ rows: [] }) // DELETE plan
    query.mockResolvedValueOnce({ rows: [{ plan_id: NEW_PLAN_ID }] }) // INSERT plan
    query.mockResolvedValueOnce({ rows: [] }) // INSERT shift
    query.mockResolvedValueOnce({ rows: [] }) // COMMIT
    mockValidationTail()

    const res = await request(app).post(ENDPOINT).send({
      tenant_id: 1,
      store_id: 5,
      target_year: 2026,
      target_month: 9,
      created_by: 1,
      overwrite: true,
    })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.inserted_shifts_count).toBe(1)

    // DELETE クエリが2つ呼ばれる（shifts と shift_plans）
    const deleteCalls = query.mock.calls.filter(c => /^\s*DELETE\s+FROM/i.test(c[0]))
    expect(deleteCalls.length).toBeGreaterThanOrEqual(2)
    expect(deleteCalls.some(c => /ops\.shifts/i.test(c[0]))).toBe(true)
    expect(deleteCalls.some(c => /ops\.shift_plans/i.test(c[0]))).toBe(true)
  })

  it('returns 400 when required parameters are missing', async () => {
    const res = await request(app).post(ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('必須')
  })
})
