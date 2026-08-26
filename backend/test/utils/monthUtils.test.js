import { describe, it, expect } from 'vitest'
import { getPreviousMonth, getLastDayOfMonth, getWeekInfo } from '../../src/utils/monthUtils.js'

describe('getPreviousMonth', () => {
  it('returns the previous month within the same year', () => {
    expect(getPreviousMonth(2026, 8)).toEqual({ year: 2026, month: 7 })
  })
  it('wraps to December of the previous year when month is January', () => {
    expect(getPreviousMonth(2026, 1)).toEqual({ year: 2025, month: 12 })
  })
})

describe('getLastDayOfMonth', () => {
  it('returns 31 for months with 31 days', () => {
    expect(getLastDayOfMonth(2026, 1)).toBe(31)
    expect(getLastDayOfMonth(2026, 12)).toBe(31)
  })
  it('returns 30 for months with 30 days', () => {
    expect(getLastDayOfMonth(2026, 4)).toBe(30)
    expect(getLastDayOfMonth(2026, 11)).toBe(30)
  })
  it('returns 28 for February in non-leap year', () => {
    expect(getLastDayOfMonth(2026, 2)).toBe(28)
  })
  it('returns 29 for February in a leap year divisible by 4', () => {
    expect(getLastDayOfMonth(2028, 2)).toBe(29)
  })
  it('returns 28 for February in year divisible by 100 but not 400', () => {
    expect(getLastDayOfMonth(2100, 2)).toBe(28)
  })
  it('returns 29 for February in year divisible by 400', () => {
    expect(getLastDayOfMonth(2000, 2)).toBe(29)
  })
})

describe('getWeekInfo', () => {
  it('returns 1 for the first occurrence of a weekday in the month', () => {
    // 2026-08-03 is the 1st Monday
    const d = new Date(2026, 7, 3)
    expect(getWeekInfo(d)).toEqual({ weekNumber: 1, dayOfWeek: 1 })
  })
  it('returns 3 for the 3rd occurrence of a weekday', () => {
    // 2026-08-17 is the 3rd Monday
    const d = new Date(2026, 7, 17)
    expect(getWeekInfo(d)).toEqual({ weekNumber: 3, dayOfWeek: 1 })
  })
  it('returns 5 when a weekday occurs 5 times in the month', () => {
    // 2026-08-31 is the 5th Monday
    const d = new Date(2026, 7, 31)
    expect(getWeekInfo(d)).toEqual({ weekNumber: 5, dayOfWeek: 1 })
  })
})
