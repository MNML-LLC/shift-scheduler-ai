import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingSpinner } from './LoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders with default size (md) and default aria-label', () => {
    render(<LoadingSpinner />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-label', '読み込み中')
    const icon = status.querySelector('[data-slot="loading-spinner-icon"]')
    expect(icon).toBeTruthy()
    expect(icon.className).toMatch(/animate-spin/)
    expect(icon.className).toMatch(/h-8 w-8/)
  })

  it('applies sm size when size="sm"', () => {
    render(<LoadingSpinner size="sm" />)
    const icon = screen.getByRole('status').querySelector('[data-slot="loading-spinner-icon"]')
    expect(icon.className).toMatch(/h-4 w-4/)
  })

  it('applies lg size when size="lg"', () => {
    render(<LoadingSpinner size="lg" />)
    const icon = screen.getByRole('status').querySelector('[data-slot="loading-spinner-icon"]')
    expect(icon.className).toMatch(/h-12 w-12/)
  })

  it('renders visible label text when label prop is provided', () => {
    render(<LoadingSpinner label="読み込み中..." />)
    expect(screen.getByText('読み込み中...')).toBeTruthy()
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '読み込み中...')
  })

  it('renders as full-screen overlay when fullscreen=true', () => {
    const { container } = render(<LoadingSpinner fullscreen />)
    const overlay = container.querySelector('[data-slot="loading-spinner"]')
    expect(overlay.className).toMatch(/fixed/)
    expect(overlay.className).toMatch(/inset-0/)
  })

  it('does NOT render fixed overlay when fullscreen=false', () => {
    const { container } = render(<LoadingSpinner />)
    const overlay = container.querySelector('[data-slot="loading-spinner"]')
    expect(overlay.className).not.toMatch(/fixed/)
  })
})
