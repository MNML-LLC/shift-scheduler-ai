import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import BulkShiftGenerator from './BulkShiftGenerator'

/**
 * BulkShiftGenerator (Issue #50) の最小ユニットテスト。
 * EventSource を差し替えて、店舗別ステータス反映とサマリー表示を検証する。
 */

class MockEventSource {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = {}
    MockEventSource.instances.push(this)
  }
  addEventListener(name, handler) {
    this.listeners[name] = handler
  }
  close() {
    this.readyState = 2
  }
  emit(name, data) {
    if (this.listeners[name]) {
      this.listeners[name]({ data: JSON.stringify(data) })
    }
  }
}
MockEventSource.CLOSED = 2
MockEventSource.instances = []

const STORES = [
  { store_id: 1, store_name: '店舗A' },
  { store_id: 2, store_name: '店舗B' },
]

describe('BulkShiftGenerator', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    global.EventSource = MockEventSource
  })

  it('checkboxes render for each store and 一括生成 button is disabled when 0 selected', () => {
    render(<BulkShiftGenerator tenantId={1} stores={STORES} year={2100} month={1} />)

    expect(screen.getByText('店舗A')).toBeInTheDocument()
    expect(screen.getByText('店舗B')).toBeInTheDocument()

    const generateButton = screen.getByRole('button', { name: /一括生成/ })
    expect(generateButton).toBeDisabled()
  })

  it('toggling 全選択 selects all stores and enables the generate button', () => {
    render(<BulkShiftGenerator tenantId={1} stores={STORES} year={2100} month={1} />)

    fireEvent.click(screen.getByText('全選択'))
    const generateButton = screen.getByRole('button', { name: /2店舗を一括生成/ })
    expect(generateButton).not.toBeDisabled()
  })

  it('opens EventSource with correct query params on 一括生成 click', () => {
    render(<BulkShiftGenerator tenantId={1} stores={STORES} year={2100} month={5} />)

    fireEvent.click(screen.getByText('全選択'))
    fireEvent.click(screen.getByRole('button', { name: /2店舗を一括生成/ }))

    expect(MockEventSource.instances).toHaveLength(1)
    const url = MockEventSource.instances[0].url
    expect(url).toContain('/api/shifts/plans/generate-bulk/stream')
    expect(url).toContain('tenant_id=1')
    expect(url).toContain('store_ids=1%2C2')
    expect(url).toContain('year=2100')
    expect(url).toContain('month=5')
  })

  it('renders per-store status from SSE events and summary from complete event', () => {
    render(<BulkShiftGenerator tenantId={1} stores={STORES} year={2100} month={1} />)

    fireEvent.click(screen.getByText('全選択'))
    fireEvent.click(screen.getByRole('button', { name: /2店舗を一括生成/ }))

    const es = MockEventSource.instances[0]

    act(() => {
      es.emit('store_progress', {
        store_id: 1,
        store_index: 1,
        stores_total: 2,
        phase: 'generating',
        message: 'AI 生成中',
        progress: 50,
      })
    })
    expect(screen.getByText('50%')).toBeInTheDocument()

    act(() => {
      es.emit('store_complete', { store_id: 1, plan_id: 100 })
      es.emit('store_error', { store_id: 2, error: 'タイムアウト' })
      es.emit('complete', {
        created: [{ store_id: 1, plan_id: 100 }],
        skipped: [],
        failed: [{ store_id: 2, error: 'タイムアウト' }],
      })
    })

    expect(screen.getByText(/プランID: 100/)).toBeInTheDocument()
    expect(
      screen.getByText(/1店舗のシフトを生成しました（スキップ 0件・失敗 1件）/)
    ).toBeInTheDocument()
    // failed[] の店舗名がサマリーに列挙されている
    expect(screen.getByText(/店舗B: タイムアウト/)).toBeInTheDocument()
  })

  it('handles store_skipped events', () => {
    render(<BulkShiftGenerator tenantId={1} stores={STORES} year={2100} month={1} />)
    fireEvent.click(screen.getByText('全選択'))
    fireEvent.click(screen.getByRole('button', { name: /2店舗を一括生成/ }))
    const es = MockEventSource.instances[0]

    act(() => {
      es.emit('store_skipped', {
        store_id: 1,
        reason: '承認済みプラン',
      })
      es.emit('complete', {
        created: [],
        skipped: [{ store_id: 1, reason: '承認済みプラン' }],
        failed: [],
      })
    })

    expect(screen.getByText(/承認済みプラン/)).toBeInTheDocument()
  })

  it('disables checkboxes during generation to prevent double execution', () => {
    render(<BulkShiftGenerator tenantId={1} stores={STORES} year={2100} month={1} />)
    fireEvent.click(screen.getByText('全選択'))
    fireEvent.click(screen.getByRole('button', { name: /2店舗を一括生成/ }))

    // Button is disabled and label switches to "生成中..."
    const button = screen.getByRole('button', { name: /生成中/ })
    expect(button).toBeDisabled()

    // Checkboxes are disabled too
    const checkboxes = screen.getAllByRole('checkbox')
    for (const cb of checkboxes) {
      expect(cb).toBeDisabled()
    }
  })
})
