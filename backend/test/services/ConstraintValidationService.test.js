import { describe, it, expect, beforeEach } from 'vitest'
import ConstraintValidationService from '../../src/services/shift/ConstraintValidationService.js'

const staff = [
  { staff_id: 1, name: '田中', employment_type: '正社員' },
  { staff_id: 2, name: '鈴木', employment_type: 'アルバイト' },
]

const makeShift = (overrides = {}) => ({
  shift_id: 1,
  staff_id: 1,
  shift_date: '2026-08-03',
  start_time: '09:00',
  end_time: '18:00',
  break_minutes: 60,
  ...overrides,
})

describe('ConstraintValidationService', () => {
  let service
  let masterData

  beforeEach(() => {
    service = new ConstraintValidationService()
    masterData = { staff }
  })

  describe('checkWeeklyHours', () => {
    // 2026-08-03 (月) 〜 2026-08-07 (金) は同一週に収まる
    const weekDates = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']

    it('週36時間以下は violation なし', () => {
      // 4日 × 9h = 36h (境界の下)
      const shifts = weekDates.slice(0, 4).map((date, i) =>
        makeShift({
          shift_id: i + 1,
          shift_date: date,
          start_time: '09:00',
          end_time: '19:00',
          break_minutes: 60,
        })
      )
      const violations = service.checkWeeklyHours(shifts, masterData)
      expect(violations).toEqual([])
    })

    it('週40時間ちょうどは WARNING violation を返す (36<h<=40 の境界)', () => {
      // 5日 × 8h = 40h
      const shifts = weekDates.map((date, i) =>
        makeShift({
          shift_id: i + 1,
          shift_date: date,
          start_time: '09:00',
          end_time: '18:00',
          break_minutes: 60,
        })
      )
      const violations = service.checkWeeklyHours(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'WARNING',
        category: 'weekly_hours',
        staff_id: 1,
        staff_name: '田中',
        actual_hours: 40,
        limit: 40,
      })
    })

    it('週40時間超は ERROR violation を返す', () => {
      // 5日 × 9h = 45h
      const shifts = weekDates.map((date, i) =>
        makeShift({
          shift_id: i + 1,
          shift_date: date,
          start_time: '09:00',
          end_time: '19:00',
          break_minutes: 60,
        })
      )
      const violations = service.checkWeeklyHours(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'ERROR',
        category: 'weekly_hours',
        staff_id: 1,
        actual_hours: 45,
        limit: 40,
      })
    })

    it('スタッフ名が masterData に無い場合は "不明" を使う', () => {
      const shifts = weekDates.map((date, i) =>
        makeShift({
          shift_id: i + 1,
          staff_id: 999,
          shift_date: date,
          start_time: '09:00',
          end_time: '19:00',
          break_minutes: 60,
        })
      )
      const violations = service.checkWeeklyHours(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0].staff_name).toBe('不明')
    })
  })

  describe('checkConsecutiveDays', () => {
    const consecutive = [
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
    ]

    it('5日連続は violation なし', () => {
      const shifts = consecutive.slice(0, 5).map((date, i) =>
        makeShift({ shift_id: i + 1, shift_date: date })
      )
      expect(service.checkConsecutiveDays(shifts, masterData)).toEqual([])
    })

    it('6日連続は WARNING violation を返す (境界)', () => {
      const shifts = consecutive.slice(0, 6).map((date, i) =>
        makeShift({ shift_id: i + 1, shift_date: date })
      )
      const violations = service.checkConsecutiveDays(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'WARNING',
        category: 'consecutive_days',
        staff_id: 1,
        consecutive_days: 6,
        limit: 6,
      })
    })

    it('7日連続は WARNING + ERROR violation を返す', () => {
      const shifts = consecutive.slice(0, 7).map((date, i) =>
        makeShift({ shift_id: i + 1, shift_date: date })
      )
      const violations = service.checkConsecutiveDays(shifts, masterData)
      expect(violations).toHaveLength(2)
      expect(violations.find((v) => v.level === 'WARNING')).toMatchObject({
        category: 'consecutive_days',
        consecutive_days: 6,
      })
      expect(violations.find((v) => v.level === 'ERROR')).toMatchObject({
        category: 'consecutive_days',
        consecutive_days: 7,
      })
    })

    it('日付が飛べば連続扱いにならない', () => {
      // 2026-08-03, 04, 05, 07, 08, 09 (06 が欠) → 最大3日連続
      const dates = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-07', '2026-08-08', '2026-08-09']
      const shifts = dates.map((date, i) => makeShift({ shift_id: i + 1, shift_date: date }))
      expect(service.checkConsecutiveDays(shifts, masterData)).toEqual([])
    })
  })

  describe('checkBreakTime', () => {
    it('勤務6時間ちょうどは休憩なしでも violation なし (境界)', () => {
      // 09:00-15:00 = 6h、休憩0分。6h は "> 6" ではないので不要
      const shifts = [makeShift({ start_time: '09:00', end_time: '15:00', break_minutes: 0 })]
      expect(service.checkBreakTime(shifts, masterData)).toEqual([])
    })

    it('勤務6時間超8時間以下で休憩45分以上は violation なし', () => {
      // 09:00-16:00 = 7h, 休憩45分
      const shifts = [makeShift({ start_time: '09:00', end_time: '16:00', break_minutes: 45 })]
      expect(service.checkBreakTime(shifts, masterData)).toEqual([])
    })

    it('勤務6時間超8時間以下で休憩45分未満は ERROR', () => {
      const shifts = [makeShift({ start_time: '09:00', end_time: '16:00', break_minutes: 30 })]
      const violations = service.checkBreakTime(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'ERROR',
        category: 'break_time',
        staff_id: 1,
        required_break: 45,
        break_minutes: 30,
      })
    })

    it('勤務8時間ちょうどは 45分休憩で OK (境界: workHours > 8 に該当しない)', () => {
      // 09:00-17:00 = 8h ちょうど → "> 8" は false、"> 6" は true → 45分でOK
      const shifts = [makeShift({ start_time: '09:00', end_time: '17:00', break_minutes: 45 })]
      expect(service.checkBreakTime(shifts, masterData)).toEqual([])
    })

    it('勤務8時間超で休憩60分以上は violation なし', () => {
      // 09:00-18:30 = 9.5h, 休憩60分
      const shifts = [makeShift({ start_time: '09:00', end_time: '18:30', break_minutes: 60 })]
      expect(service.checkBreakTime(shifts, masterData)).toEqual([])
    })

    it('勤務8時間超で休憩60分未満は ERROR', () => {
      const shifts = [makeShift({ start_time: '09:00', end_time: '18:30', break_minutes: 45 })]
      const violations = service.checkBreakTime(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'ERROR',
        category: 'break_time',
        required_break: 60,
        break_minutes: 45,
      })
    })

    it('break_minutes 未指定でも 6時間以内なら violation なし', () => {
      const shifts = [{ ...makeShift(), start_time: '09:00', end_time: '14:00', break_minutes: undefined }]
      expect(service.checkBreakTime(shifts, masterData)).toEqual([])
    })
  })

  describe('checkShiftInterval', () => {
    it('連続する日のインターバルが12時間以上は violation なし', () => {
      // 前日 09:00-18:00、翌日 09:00-18:00 → interval = (24-18)+9 = 15h
      const shifts = [
        makeShift({ shift_id: 1, shift_date: '2026-08-03', start_time: '09:00', end_time: '18:00' }),
        makeShift({ shift_id: 2, shift_date: '2026-08-04', start_time: '09:00', end_time: '18:00' }),
      ]
      expect(service.checkShiftInterval(shifts, masterData)).toEqual([])
    })

    it('連続する日のインターバルが11-12時間は WARNING', () => {
      // 前日 22:00 終業、翌日 09:00 始業 → (24-22)+9 = 11h
      const shifts = [
        makeShift({ shift_id: 1, shift_date: '2026-08-03', start_time: '13:00', end_time: '22:00' }),
        makeShift({ shift_id: 2, shift_date: '2026-08-04', start_time: '09:00', end_time: '18:00' }),
      ]
      const violations = service.checkShiftInterval(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'WARNING',
        category: 'shift_interval',
        staff_id: 1,
        required_interval: 11,
      })
    })

    it('連続する日のインターバルが11時間未満は ERROR', () => {
      // 前日 23:00 終業、翌日 09:00 始業 → (24-23)+9 = 10h
      const shifts = [
        makeShift({ shift_id: 1, shift_date: '2026-08-03', start_time: '14:00', end_time: '23:00' }),
        makeShift({ shift_id: 2, shift_date: '2026-08-04', start_time: '09:00', end_time: '18:00' }),
      ]
      const violations = service.checkShiftInterval(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'ERROR',
        category: 'shift_interval',
        required_interval: 11,
      })
    })

    it('連続していない日はインターバルチェック対象外', () => {
      // 8/3, 8/5 (1日空き)
      const shifts = [
        makeShift({ shift_id: 1, shift_date: '2026-08-03', start_time: '14:00', end_time: '23:00' }),
        makeShift({ shift_id: 2, shift_date: '2026-08-05', start_time: '09:00', end_time: '18:00' }),
      ]
      expect(service.checkShiftInterval(shifts, masterData)).toEqual([])
    })
  })

  describe('checkMonthlyHours (正社員のみ)', () => {
    const monthlyShifts = (days, startTime, endTime, staffId = 1) =>
      Array.from({ length: days }, (_, i) => ({
        shift_id: i + 1,
        staff_id: staffId,
        shift_date: `2026-08-${String(i + 1).padStart(2, '0')}`,
        start_time: startTime,
        end_time: endTime,
        break_minutes: 60,
      }))

    it('月160時間以下は violation なし', () => {
      // 20日 × 8h = 160h
      const shifts = monthlyShifts(20, '09:00', '18:00')
      expect(service.checkMonthlyHours(shifts, masterData)).toEqual([])
    })

    it('月160時間超173時間以下は WARNING', () => {
      // 21日 × 8h = 168h
      const shifts = monthlyShifts(21, '09:00', '18:00')
      const violations = service.checkMonthlyHours(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'WARNING',
        category: 'monthly_hours',
        actual_hours: 168,
        limit: 173,
      })
    })

    it('月173時間超は ERROR', () => {
      // 22日 × 8h = 176h
      const shifts = monthlyShifts(22, '09:00', '18:00')
      const violations = service.checkMonthlyHours(shifts, masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'ERROR',
        category: 'monthly_hours',
        actual_hours: 176,
        limit: 173,
      })
    })

    it('アルバイトは checkMonthlyHours の対象外', () => {
      // 鈴木 (アルバイト) が 22日 × 8h = 176h でも violation なし
      const shifts = monthlyShifts(22, '09:00', '18:00', 2)
      expect(service.checkMonthlyHours(shifts, masterData)).toEqual([])
    })
  })

  describe('checkMonthlyOvertime (正社員のみ)', () => {
    const monthlyShifts = (days, staffId = 1) =>
      Array.from({ length: days }, (_, i) => ({
        shift_id: i + 1,
        staff_id: staffId,
        shift_date: `2026-08-${String(i + 1).padStart(2, '0')}`,
        start_time: '09:00',
        end_time: '18:00',
        break_minutes: 60,
      }))

    it('残業時間40時間以下は violation なし', () => {
      // 26日 × 8h = 208h → overtime 35h
      expect(service.checkMonthlyOvertime(monthlyShifts(26), masterData)).toEqual([])
    })

    it('残業時間40時間超45時間以下は WARNING', () => {
      // 27日 × 8h = 216h → overtime 43h
      const violations = service.checkMonthlyOvertime(monthlyShifts(27), masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'WARNING',
        category: 'monthly_overtime',
        limit: 45,
      })
    })

    it('残業時間45時間超は ERROR', () => {
      // 28日 × 8h = 224h → overtime 51h
      const violations = service.checkMonthlyOvertime(monthlyShifts(28), masterData)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({
        level: 'ERROR',
        category: 'monthly_overtime',
        limit: 45,
      })
    })

    it('アルバイトは checkMonthlyOvertime の対象外', () => {
      expect(service.checkMonthlyOvertime(monthlyShifts(28, 2), masterData)).toEqual([])
    })
  })

  describe('checkCoverage', () => {
    const storeInfo = { business_hours_start: '10:00', business_hours_end: '12:00' }

    it('storeInfo に営業時間がなければチェックスキップ', () => {
      const shifts = [makeShift({ shift_date: '2026-08-03', start_time: '10:00', end_time: '12:00' })]
      expect(service.checkCoverage(shifts, { staff })).toEqual([])
    })

    it('全時間帯に2名以上いれば violation なし', () => {
      const shifts = [
        makeShift({ shift_id: 1, staff_id: 1, shift_date: '2026-08-03', start_time: '10:00', end_time: '12:00' }),
        makeShift({ shift_id: 2, staff_id: 2, shift_date: '2026-08-03', start_time: '10:00', end_time: '12:00' }),
      ]
      expect(service.checkCoverage(shifts, { staff, storeInfo })).toEqual([])
    })

    it('スタッフ1名の時間帯は WARNING', () => {
      const shifts = [
        makeShift({ shift_id: 1, staff_id: 1, shift_date: '2026-08-03', start_time: '10:00', end_time: '12:00' }),
      ]
      const violations = service.checkCoverage(shifts, { staff, storeInfo })
      // 10:00 と 11:00 の2時間帯で1名 → WARNING × 2
      expect(violations.length).toBeGreaterThan(0)
      violations.forEach((v) => {
        expect(v).toMatchObject({
          level: 'WARNING',
          category: 'coverage',
          staff_count: 1,
          minimum: 2,
        })
      })
    })

    it('スタッフ0名の時間帯は ERROR', () => {
      // 10:00-11:00 のみ勤務 → 11:00 帯は 0 名 (ERROR)
      const shifts = [
        makeShift({ shift_id: 1, staff_id: 1, shift_date: '2026-08-03', start_time: '10:00', end_time: '11:00' }),
      ]
      const violations = service.checkCoverage(shifts, { staff, storeInfo })
      const errors = violations.filter((v) => v.level === 'ERROR')
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toMatchObject({
        category: 'coverage',
        staff_count: 0,
        minimum: 2,
      })
    })
  })

  describe('validateShifts (統合)', () => {
    it('制約違反ゼロのシフトで空配列と is_valid: true を返す', async () => {
      // 4日 × 8h = 32h → 週制約OK / 連続4日OK / 休憩60分 OK
      const shifts = [
        makeShift({ shift_id: 1, staff_id: 1, shift_date: '2026-08-03' }),
        makeShift({ shift_id: 2, staff_id: 1, shift_date: '2026-08-04' }),
        makeShift({ shift_id: 3, staff_id: 1, shift_date: '2026-08-05' }),
        makeShift({ shift_id: 4, staff_id: 1, shift_date: '2026-08-06' }),
      ]
      const result = await service.validateShifts(shifts, { staff })
      expect(result.violations).toEqual([])
      expect(result.summary).toMatchObject({
        total: 0,
        error: 0,
        warning: 0,
        info: 0,
        is_valid: true,
      })
    })

    it('複数の違反がある場合に全て返し、summary が正しくカウントする', async () => {
      // 田中 (正社員) が 7日連続 × 10h + 最終日は休憩不足
      const shifts = [
        // 8/3-8/8: 6日 × 10h (09:00-20:00, 休憩60分)
        makeShift({ shift_id: 1, staff_id: 1, shift_date: '2026-08-03', start_time: '09:00', end_time: '20:00', break_minutes: 60 }),
        makeShift({ shift_id: 2, staff_id: 1, shift_date: '2026-08-04', start_time: '09:00', end_time: '20:00', break_minutes: 60 }),
        makeShift({ shift_id: 3, staff_id: 1, shift_date: '2026-08-05', start_time: '09:00', end_time: '20:00', break_minutes: 60 }),
        makeShift({ shift_id: 4, staff_id: 1, shift_date: '2026-08-06', start_time: '09:00', end_time: '20:00', break_minutes: 60 }),
        makeShift({ shift_id: 5, staff_id: 1, shift_date: '2026-08-07', start_time: '09:00', end_time: '20:00', break_minutes: 60 }),
        makeShift({ shift_id: 6, staff_id: 1, shift_date: '2026-08-08', start_time: '09:00', end_time: '20:00', break_minutes: 60 }),
        // 8/9: 7日目 (休憩30分で break_time ERROR も)
        makeShift({ shift_id: 7, staff_id: 1, shift_date: '2026-08-09', start_time: '09:00', end_time: '17:00', break_minutes: 30 }),
      ]
      const result = await service.validateShifts(shifts, { staff })

      const categories = new Set(result.violations.map((v) => v.category))
      expect(categories.has('weekly_hours')).toBe(true) // 週60h > 40h → ERROR
      expect(categories.has('consecutive_days')).toBe(true) // 7日連続 → WARNING+ERROR
      expect(categories.has('break_time')).toBe(true) // 8h勤務で休憩30分 < 45分 → ERROR

      expect(result.summary.total).toBe(result.violations.length)
      expect(result.summary.error).toBeGreaterThan(0)
      expect(result.summary.warning).toBeGreaterThan(0)
      expect(result.summary.is_valid).toBe(false)
      // categories サマリーが違反カテゴリと一致すること
      expect(Object.keys(result.summary.categories).sort()).toEqual(
        [...categories].sort()
      )
    })
  })
})
