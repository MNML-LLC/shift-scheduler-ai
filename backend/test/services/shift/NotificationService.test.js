import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

const axios = (await import('axios')).default
const NotificationService = (await import('../../../src/services/shift/NotificationService.js')).default

describe('NotificationService.isEnabled()', () => {
  afterEach(() => {
    delete process.env.NOTIFICATION_ENABLED
  })

  it('returns true only when NOTIFICATION_ENABLED === "true"', () => {
    process.env.NOTIFICATION_ENABLED = 'true'
    expect(NotificationService.isEnabled()).toBe(true)
  })

  it('returns false when NOTIFICATION_ENABLED is unset', () => {
    delete process.env.NOTIFICATION_ENABLED
    expect(NotificationService.isEnabled()).toBe(false)
  })

  it('returns false for any value other than "true"', () => {
    process.env.NOTIFICATION_ENABLED = '1'
    expect(NotificationService.isEnabled()).toBe(false)
    process.env.NOTIFICATION_ENABLED = 'TRUE'
    expect(NotificationService.isEnabled()).toBe(false)
    process.env.NOTIFICATION_ENABLED = ''
    expect(NotificationService.isEnabled()).toBe(false)
  })
})

describe('NotificationService.hasBackendUrl()', () => {
  afterEach(() => {
    delete process.env.LIFF_BACKEND_URL
  })

  it('returns true when LIFF_BACKEND_URL is set to a non-empty string', () => {
    process.env.LIFF_BACKEND_URL = 'https://liff-backend.example.com'
    expect(NotificationService.hasBackendUrl()).toBe(true)
  })

  it('returns false when LIFF_BACKEND_URL is unset', () => {
    delete process.env.LIFF_BACKEND_URL
    expect(NotificationService.hasBackendUrl()).toBe(false)
  })

  it('returns false when LIFF_BACKEND_URL is empty string', () => {
    process.env.LIFF_BACKEND_URL = ''
    expect(NotificationService.hasBackendUrl()).toBe(false)
  })
})

describe('NotificationService.notifyFirstPlanApproved()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LIFF_BACKEND_URL = 'https://liff-backend.example.com'
    axios.post.mockResolvedValue({ data: { success: true } })
  })

  afterEach(() => {
    delete process.env.LIFF_BACKEND_URL
  })

  it('POSTs to the first-plan-approved endpoint with a 10s timeout', async () => {
    await NotificationService.notifyFirstPlanApproved({
      tenant_id: 1,
      store_id: 5,
      plan_id: 100,
      year: 2026,
      month: 9,
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://liff-backend.example.com/api/notification/first-plan-approved',
      { tenant_id: 1, store_id: 5, plan_id: 100, year: 2026, month: 9 },
      { timeout: 10000 }
    )
  })

  it('propagates axios errors to the caller', async () => {
    const err = new Error('boom')
    axios.post.mockRejectedValue(err)
    await expect(NotificationService.notifyFirstPlanApproved({
      tenant_id: 1, store_id: 1, plan_id: 1, year: 2026, month: 9,
    })).rejects.toThrow('boom')
  })
})

describe('NotificationService.notifyShiftConfirmed()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LIFF_BACKEND_URL = 'https://liff-backend.example.com'
    axios.post.mockResolvedValue({ data: { success: true } })
  })

  afterEach(() => {
    delete process.env.LIFF_BACKEND_URL
  })

  it('POSTs to the shift-confirmed endpoint with a 10s timeout', async () => {
    await NotificationService.notifyShiftConfirmed({
      tenant_id: 2,
      store_id: 7,
      plan_id: 222,
      year: 2027,
      month: 3,
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://liff-backend.example.com/api/notification/shift-confirmed',
      { tenant_id: 2, store_id: 7, plan_id: 222, year: 2027, month: 3 },
      { timeout: 10000 }
    )
  })
})
