import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// database.js の import で env.js が必須環境変数をチェックするため先に値を注入する。
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test'
process.env.PORT ||= '3001'

// pg モジュール全体をモックする。database.js は import 時に new Pool() を呼ぶため、
// Pool コンストラクタを差し替えて query の挙動を制御する。
const poolQuery = vi.fn()
const poolConnect = vi.fn()

vi.mock('pg', () => {
  class MockPool {
    constructor() {
      this.query = poolQuery
      this.connect = poolConnect
    }
    on() {
      /* ignore connect/error handlers in tests */
    }
  }
  return { default: { Pool: MockPool } }
})

const { query, RETRY_DELAYS_MS } = await import('../../src/config/database.js')

// setTimeout をリアルタイム待たずに即時解決できるよう vitest の fake timer を使う。
beforeEach(() => {
  vi.useFakeTimers()
  poolQuery.mockReset()
  poolConnect.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * fake timer 環境下では sleep(ms) が resolve するまで vi.advanceTimersByTimeAsync が必要。
 * query() の返した Promise を並行させ、setTimeout をタイマー送りしつつ resolve を待つ。
 */
async function runWithTimers(promise) {
  // 全リトライ分のタイマーを一気に消化
  await vi.runAllTimersAsync()
  return promise
}

describe('database.query — 指数バックオフリトライ', () => {
  it('初回で成功した場合はリトライしない', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ ok: 1 }] })

    const result = await query('SELECT 1')

    expect(result.rowCount).toBe(1)
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })

  it('リトライ対象エラー（ECONNREFUSED）で最大3回リトライし、最終的に成功する', async () => {
    const transientError = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED'
    })
    poolQuery
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })

    const pending = query('SELECT 1')
    const result = await runWithTimers(pending)

    expect(result.rowCount).toBe(0)
    // 初回 + 2 リトライ = 3 回
    expect(poolQuery).toHaveBeenCalledTimes(3)
  })

  it('PostgreSQL 一時エラー（57P01）はリトライ対象', async () => {
    const adminShutdown = Object.assign(new Error('admin shutdown'), {
      code: '57P01'
    })
    poolQuery
      .mockRejectedValueOnce(adminShutdown)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })

    const pending = query('SELECT 1')
    const result = await runWithTimers(pending)

    expect(result.rowCount).toBe(1)
    expect(poolQuery).toHaveBeenCalledTimes(2)
  })

  it('リトライ上限を超えた場合は最後のエラーを throw する', async () => {
    const transientError = Object.assign(new Error('timeout'), {
      code: 'ETIMEDOUT'
    })
    poolQuery.mockRejectedValue(transientError)

    const pending = query('SELECT 1')
    // rejects の assertion を先に構築して pending にハンドラを付ける（unhandled rejection 対策）
    const assertion = expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' })
    await vi.runAllTimersAsync()
    await assertion

    // 初回 + 3 リトライ = 4 回すべて失敗
    expect(poolQuery).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length)
  })

  it('リトライ対象外のエラー（SQL構文エラー等）はリトライせず即 throw する', async () => {
    const syntaxError = Object.assign(new Error('syntax error'), {
      code: '42601'
    })
    poolQuery.mockRejectedValueOnce(syntaxError)

    await expect(query('SELECT bogus')).rejects.toMatchObject({
      code: '42601'
    })
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })

  it('待機時間が指数バックオフ（1s, 2s, 4s）で増加する', async () => {
    const transientError = Object.assign(new Error('reset'), {
      code: 'ECONNRESET'
    })
    poolQuery.mockRejectedValue(transientError)

    const pending = query('SELECT 1').catch(() => {})

    // 1 回目のリトライは 1000ms 後
    await vi.advanceTimersByTimeAsync(999)
    expect(poolQuery).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(poolQuery).toHaveBeenCalledTimes(2)

    // 2 回目のリトライは +2000ms
    await vi.advanceTimersByTimeAsync(1999)
    expect(poolQuery).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(poolQuery).toHaveBeenCalledTimes(3)

    // 3 回目のリトライは +4000ms
    await vi.advanceTimersByTimeAsync(3999)
    expect(poolQuery).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(poolQuery).toHaveBeenCalledTimes(4)

    await pending
  })

  it('RETRY_DELAYS_MS はリクエスト要件どおり [1000, 2000, 4000]', () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000])
  })
})
