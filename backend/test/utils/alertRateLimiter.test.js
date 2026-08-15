import { describe, it, expect, beforeEach } from 'vitest'
import { shouldNotify, _resetRateLimiter } from '../../src/utils/alertRateLimiter.js'

describe('alertRateLimiter.shouldNotify', () => {
  beforeEach(() => {
    _resetRateLimiter()
  })

  it('returns true on the first call for a given signature', () => {
    expect(shouldNotify('GET /api/foo::Error: boom', { now: 1000, windowMs: 60000 })).toBe(true)
  })

  it('returns false for the same signature within the window', () => {
    shouldNotify('GET /api/foo::Error: boom', { now: 1000, windowMs: 60000 })
    expect(shouldNotify('GET /api/foo::Error: boom', { now: 30_000, windowMs: 60000 })).toBe(false)
  })

  it('returns true again once the window has elapsed', () => {
    shouldNotify('GET /api/foo::Error: boom', { now: 1000, windowMs: 60000 })
    expect(shouldNotify('GET /api/foo::Error: boom', { now: 62_000, windowMs: 60000 })).toBe(true)
  })

  it('tracks different signatures independently', () => {
    shouldNotify('GET /api/foo::Error: boom', { now: 1000, windowMs: 60000 })
    expect(shouldNotify('GET /api/bar::Error: boom', { now: 1000, windowMs: 60000 })).toBe(true)
    expect(shouldNotify('GET /api/foo::TypeError: bang', { now: 1000, windowMs: 60000 })).toBe(true)
  })

  it('returns false for empty or invalid signatures', () => {
    expect(shouldNotify('', { now: 1000, windowMs: 60000 })).toBe(false)
    expect(shouldNotify(null, { now: 1000, windowMs: 60000 })).toBe(false)
    expect(shouldNotify(undefined, { now: 1000, windowMs: 60000 })).toBe(false)
  })

  it('caps the internal map at MAX_KEYS entries by evicting the oldest', () => {
    // MAX_KEYS = 500 なので、501 個ユニークキーを投入すると最初のキーが evict される
    for (let i = 0; i < 501; i += 1) {
      shouldNotify(`sig-${i}`, { now: 1000 + i, windowMs: 60000 })
    }
    // 最初のシグネチャは evict されたので、同じウィンドウ内でも再度通知可能になる
    expect(shouldNotify('sig-0', { now: 1500, windowMs: 60000 })).toBe(true)
    // 一方、最新に近いシグネチャはまだウィンドウ内で抑止される
    expect(shouldNotify('sig-500', { now: 1500, windowMs: 60000 })).toBe(false)
  })

  it('_resetRateLimiter clears all state', () => {
    shouldNotify('GET /api/foo::Error: boom', { now: 1000, windowMs: 60000 })
    _resetRateLimiter()
    expect(shouldNotify('GET /api/foo::Error: boom', { now: 1500, windowMs: 60000 })).toBe(true)
  })
})
