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

const { query, transaction } = await import('../../src/config/database.js')
const { default: shiftsRoutes } = await import('../../src/routes/shifts.js')

const ENDPOINT = '/api/shifts/plans/copy-from-previous'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/shifts', shiftsRoutes)
  return app
}

/**
 * copy-from-previous エンドポイントの構造:
 *   [transaction() 内 — client.query 経由]
 *     1) SELECT plan_id FROM shift_plans (source SECOND plan)
 *     2) SELECT * FROM shifts (source shifts)
 *     3) SELECT plan_id FROM shift_plans (existing FIRST plan check)
 *     4) [overwrite時のみ] DELETE FROM shifts, DELETE FROM shift_plans
 *     5) INSERT INTO shift_plans (new plan)
 *     6) INSERT INTO shifts (1件ずつ)
 *   [transaction() 外 — query 経由の読み取りのみ]
 *     7) SELECT copied shifts (バリデーション用)
 *     8) SELECT staff
 *     9) SELECT stores
 *
 * 単一トランザクション化により、書き込みは全て同一コネクション上で BEGIN〜COMMIT
 * されることを担保する（pool.query() ラッパー経由の BEGIN/COMMIT は同一接続を
 * 保証しないため、以前の実装は部分適用のリスクがあった）。
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

/**
 * transaction(callback) をスタブし、callback に渡す client.query の応答を
 * 呼び出し順に返す。使い切り前に追加の呼び出しがあれば失敗させ、
 * 「必要な順序でクエリが発行されている」ことを担保する。
 */
function stubTransaction(clientResponses) {
  const queue = [...clientResponses]
  const clientCalls = []
  const client = {
    query: vi.fn((text, params) => {
      clientCalls.push([text, params])
      if (queue.length === 0) {
        throw new Error(`Unexpected client.query call: ${text.slice(0, 80)}`)
      }
      const next = queue.shift()
      if (next && next.throw) return Promise.reject(next.throw)
      return Promise.resolve(next ?? { rows: [] })
    }),
  }
  transaction.mockImplementation(async (cb) => cb(client))
  return { client, clientCalls }
}

function mockValidationTail() {
  // 7) copied shifts
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
  // 8) staff
  query.mockResolvedValueOnce({ rows: [] })
  // 9) stores
  query.mockResolvedValueOnce({ rows: [{ store_id: 5 }] })
}

describe('POST /api/shifts/plans/copy-from-previous — Issue #45', () => {
  let app

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
  })

  it('creates a FIRST plan with plan_type explicitly set to FIRST and returns inserted_shifts_count', async () => {
    const { clientCalls } = stubTransaction([
      { rows: [{ plan_id: SOURCE_PLAN_ID }] }, // source SECOND plan
      { rows: SOURCE_SHIFTS },                  // source shifts
      { rows: [] },                             // existing FIRST plan (none)
      { rows: [{ plan_id: NEW_PLAN_ID }] },     // INSERT new plan
      { rows: [] },                             // INSERT shift (1件)
    ])
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

    // 書き込みは単一の transaction() 呼び出しで完結する
    expect(transaction).toHaveBeenCalledTimes(1)

    // INSERT クエリに plan_type='FIRST' が含まれることを確認
    const insertPlanCall = clientCalls.find(c =>
      /INSERT INTO ops\.shift_plans/i.test(c[0])
    )
    expect(insertPlanCall).toBeTruthy()
    expect(insertPlanCall[0]).toMatch(/'FIRST'/)
    // status='DRAFT' も同時に指定される
    expect(insertPlanCall[0]).toMatch(/'DRAFT'/)

    // BEGIN/COMMIT/ROLLBACK が pool.query ラッパー経由で発行されていないこと
    const beginCommitRollback = query.mock.calls.filter(c =>
      /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(c[0])
    )
    expect(beginCommitRollback.length).toBe(0)
  })

  it('returns 404 when previous month has no SECOND plan', async () => {
    stubTransaction([
      { rows: [] }, // source SECOND plan lookup → not found
    ])

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
    const { clientCalls } = stubTransaction([
      { rows: [{ plan_id: SOURCE_PLAN_ID }] }, // source plan
      { rows: SOURCE_SHIFTS },                  // source shifts
      { rows: [{ plan_id: 555 }] },             // existing FIRST plan
    ])

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
    const insertPlanCall = clientCalls.find(c =>
      /INSERT INTO ops\.shift_plans/i.test(c[0])
    )
    expect(insertPlanCall).toBeFalsy()
  })

  it('deletes existing FIRST plan and re-creates it when overwrite=true, all within a single transaction', async () => {
    const { clientCalls } = stubTransaction([
      { rows: [{ plan_id: SOURCE_PLAN_ID }] }, // source plan
      { rows: SOURCE_SHIFTS },                  // source shifts
      { rows: [{ plan_id: 555 }] },             // existing FIRST plan
      { rows: [] },                             // DELETE shifts
      { rows: [] },                             // DELETE plan
      { rows: [{ plan_id: NEW_PLAN_ID }] },     // INSERT new plan
      { rows: [] },                             // INSERT shift
    ])
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

    // DELETE / INSERT が全て同一 transaction() 呼び出しの client.query で行われる
    expect(transaction).toHaveBeenCalledTimes(1)

    const deleteCalls = clientCalls.filter(c => /^\s*DELETE\s+FROM/i.test(c[0]))
    expect(deleteCalls.length).toBeGreaterThanOrEqual(2)
    expect(deleteCalls.some(c => /ops\.shifts/i.test(c[0]))).toBe(true)
    expect(deleteCalls.some(c => /ops\.shift_plans/i.test(c[0]))).toBe(true)

    const insertPlanCall = clientCalls.find(c =>
      /INSERT INTO ops\.shift_plans/i.test(c[0])
    )
    expect(insertPlanCall).toBeTruthy()
  })

  it('rolls back and returns 500 when the shift INSERT fails after DELETE', async () => {
    // overwrite=true で既存 FIRST 案を削除した直後に INSERT 失敗をシミュレート。
    // transaction() ヘルパーが同一 client 上で ROLLBACK することで、削除された
    // 確定シフトが復元されるべきである（本テストではエラー伝搬のみ検証）。
    stubTransaction([
      { rows: [{ plan_id: SOURCE_PLAN_ID }] }, // source plan
      { rows: SOURCE_SHIFTS },                  // source shifts
      { rows: [{ plan_id: 555 }] },             // existing FIRST plan
      { rows: [] },                             // DELETE shifts
      { rows: [] },                             // DELETE plan
      { rows: [{ plan_id: NEW_PLAN_ID }] },     // INSERT new plan (ok)
      { throw: new Error('simulated insert failure') }, // INSERT shift → 失敗
    ])

    const res = await request(app).post(ENDPOINT).send({
      tenant_id: 1,
      store_id: 5,
      target_year: 2026,
      target_month: 9,
      created_by: 1,
      overwrite: true,
    })

    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('simulated insert failure')
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when required parameters are missing', async () => {
    const res = await request(app).post(ENDPOINT).send({ tenant_id: 1 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('必須')
    // transaction は呼ばれない
    expect(transaction).not.toHaveBeenCalled()
  })
})
