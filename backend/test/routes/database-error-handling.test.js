import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// env.js が必須環境変数をチェックするため先に値を注入する
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test'
process.env.PORT ||= '3001'

// pg モジュールを mock（database.js の import 時に new Pool() を呼ぶため）
const poolQuery = vi.fn()
vi.mock('pg', () => {
  class MockPool {
    constructor() {
      this.query = poolQuery
      this.connect = vi.fn()
    }
    on() {}
  }
  return { default: { Pool: MockPool } }
})

const { DatabaseUnavailableError } = await import('../../src/config/database.js')
const tenantsRoutes = (await import('../../src/routes/tenants.js')).default

/**
 * ルート → グローバルエラーハンドラの委譲経路を検証する。
 *
 * `db.query()` がリトライ枯渇時に throw する DatabaseUnavailableError が、
 * 個別ルートの catch で `next(err)` に委譲され、server.js のグローバルハンドラで
 * 503 に変換される流れを end-to-end で確認する。
 */
describe('ルート経由での DatabaseUnavailableError → 503 変換', () => {
  let app

  beforeEach(() => {
    poolQuery.mockReset()

    app = express()
    app.use('/api/tenants', tenantsRoutes)
    // server.js と同じグローバルエラーハンドラ
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
      if (err instanceof DatabaseUnavailableError) {
        return res.status(503).json({
          error: 'サービスを一時的に利用できません。しばらく待ってから再度お試しください。'
        })
      }
      res.status(500).json({ error: 'サーバー内部エラーが発生しました' })
    })
  })

  it('リトライ枯渇時（DatabaseUnavailableError）は 503 を返す', async () => {
    const transient = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    // 初回 + 3 リトライ = 4 回すべて失敗させる
    poolQuery.mockRejectedValue(transient)

    // vitest fake timer を使わず、リアル setTimeout で 8s 弱かけて完走
    const response = await request(app).get('/api/tenants').timeout(15000)

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      error: 'サービスを一時的に利用できません。しばらく待ってから再度お試しください。'
    })
  }, 15000)

  it('リトライ対象外エラー（SQL構文エラー等）は既存の 500 応答を返す', async () => {
    const syntax = Object.assign(new Error('syntax'), { code: '42601' })
    poolQuery.mockRejectedValueOnce(syntax)

    const response = await request(app).get('/api/tenants')

    expect(response.status).toBe(500)
    // ルートの catch が返す既存フォーマット（`success: false`）を維持していること
    expect(response.body).toMatchObject({ success: false })
  })
})
