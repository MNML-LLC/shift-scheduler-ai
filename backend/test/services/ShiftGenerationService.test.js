import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 外部依存 (DB / OpenAI) を差し替えるためのモック本体は
// vi.hoisted で先に生成し、vi.mock のファクトリと本文の両方から参照できるようにする
const mocks = vi.hoisted(() => {
  const collectMasterDataMock = vi.fn()
  const generateShiftsAIMock = vi.fn()

  // ShiftGenerationService は `new MasterDataCollectorService()` として
  // 依存を new するため、モックも class として提供する
  class MasterDataCollectorMock {
    constructor() {
      this.collectMasterData = collectMasterDataMock
    }
  }
  class OpenAIClientMock {
    constructor() {
      this.generateShifts = generateShiftsAIMock
    }
  }

  return {
    collectMasterDataMock,
    generateShiftsAIMock,
    MasterDataCollectorMock,
    OpenAIClientMock
  }
})

vi.mock('../../src/services/shift/MasterDataCollectorService.js', () => ({
  default: mocks.MasterDataCollectorMock
}))

vi.mock('../../src/services/shift/OpenAIClientService.js', () => ({
  default: mocks.OpenAIClientMock
}))

const { default: ShiftGenerationService } = await import(
  '../../src/services/shift/ShiftGenerationService.js'
)

const { collectMasterDataMock, generateShiftsAIMock } = mocks

function buildMasterData(overrides = {}) {
  return {
    staff: [
      {
        staff_id: 1,
        staff_code: 'S001',
        name: '田中太郎',
        employment_type: 'アルバイト',
        hourly_rate: 1200,
        monthly_salary: null,
        role_name: '一般',
        role_code: 'GENERAL'
      },
      {
        staff_id: 2,
        staff_code: 'S002',
        name: '佐藤花子',
        employment_type: 'アルバイト',
        hourly_rate: 1300,
        monthly_salary: null,
        role_name: '一般',
        role_code: 'GENERAL'
      }
    ],
    shiftPatterns: [
      {
        pattern_id: 1,
        pattern_code: 'EARLY',
        pattern_name: '早番',
        start_time: '09:00:00',
        end_time: '17:00:00',
        break_minutes: 60
      }
    ],
    constraints: {
      labor: [],
      store: [],
      validation: []
    },
    storeInfo: {
      store_id: 1,
      store_code: 'ST001',
      store_name: 'テスト店舗',
      business_hours_start: '09:00:00',
      business_hours_end: '22:00:00'
    },
    period: {
      year: 2026,
      month: 8,
      daysInMonth: 31
    },
    ...overrides
  }
}

function buildAIResponse(shifts) {
  return JSON.stringify({ shifts })
}

describe('ShiftGenerationService', () => {
  let service

  beforeEach(() => {
    vi.clearAllMocks()
    // ログ出力を抑制 (エラー系テストで console.error が呼ばれるため)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service = new ShiftGenerationService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('validateMasterData', () => {
    it('有効なマスターデータでは例外をスローしない', () => {
      const masterData = buildMasterData()
      expect(() => service.validateMasterData(masterData)).not.toThrow()
    })

    it('スタッフが空配列の場合は例外をスロー', () => {
      const masterData = buildMasterData({ staff: [] })
      expect(() => service.validateMasterData(masterData)).toThrow(
        /スタッフが登録されていません/
      )
    })

    it('スタッフが undefined の場合は例外をスロー', () => {
      const masterData = buildMasterData({ staff: undefined })
      expect(() => service.validateMasterData(masterData)).toThrow(
        /スタッフが登録されていません/
      )
    })

    it('シフトパターンが空の場合は例外をスロー', () => {
      const masterData = buildMasterData({ shiftPatterns: [] })
      expect(() => service.validateMasterData(masterData)).toThrow(
        /シフトパターンが登録されていません/
      )
    })

    it('店舗情報が欠落している場合は例外をスロー', () => {
      const masterData = buildMasterData({ storeInfo: null })
      expect(() => service.validateMasterData(masterData)).toThrow(
        /店舗情報が取得できませんでした/
      )
    })

    it('複数のエラーがある場合は全て含めた例外メッセージをスロー', () => {
      const masterData = buildMasterData({
        staff: [],
        shiftPatterns: [],
        storeInfo: null
      })
      expect(() => service.validateMasterData(masterData)).toThrow(
        /スタッフが登録されていません.*シフトパターンが登録されていません.*店舗情報が取得できませんでした/
      )
    })
  })

  describe('detectPhase', () => {
    it('マスターデータ関連のエラーは data_collection', () => {
      expect(service.detectPhase(new Error('マスターデータが不足しています'))).toBe(
        'data_collection'
      )
    })

    it('プロンプト関連のエラーは prompt_building', () => {
      expect(service.detectPhase(new Error('プロンプト生成失敗'))).toBe(
        'prompt_building'
      )
    })

    it('AI 関連のエラーは ai_generation', () => {
      expect(service.detectPhase(new Error('OpenAI API rate limit'))).toBe(
        'ai_generation'
      )
    })

    it('パース関連のエラーは response_parsing', () => {
      expect(service.detectPhase(new Error('JSONパース失敗'))).toBe(
        'response_parsing'
      )
    })

    it('制約関連のエラーは constraint_validation', () => {
      expect(service.detectPhase(new Error('制約検証エラー'))).toBe(
        'constraint_validation'
      )
    })

    it('該当なしの場合は unknown', () => {
      expect(service.detectPhase(new Error('その他のエラー'))).toBe('unknown')
    })
  })

  describe('generateShifts', () => {
    it('正常系: shifts / validation / metadata を含むオブジェクトを返す', async () => {
      const masterData = buildMasterData()
      collectMasterDataMock.mockResolvedValue(masterData)
      generateShiftsAIMock.mockResolvedValue(
        buildAIResponse([
          {
            staff_id: 1,
            shift_date: '2026-08-01',
            pattern_id: 1,
            start_time: '09:00:00',
            end_time: '17:00:00',
            break_minutes: 60
          }
        ])
      )

      const result = await service.generateShifts(10, 20, 2026, 8)

      expect(result).toHaveProperty('shifts')
      expect(result).toHaveProperty('validation')
      expect(result).toHaveProperty('metadata')
      expect(Array.isArray(result.shifts)).toBe(true)
      expect(result.shifts).toHaveLength(1)
      expect(result.shifts[0]).toMatchObject({
        staff_id: 1,
        shift_date: '2026-08-01',
        pattern_id: 1
      })
    })

    it('正常系: metadata に tenant_id / store_id / year / month / model が含まれる', async () => {
      collectMasterDataMock.mockResolvedValue(buildMasterData())
      generateShiftsAIMock.mockResolvedValue(
        buildAIResponse([
          {
            staff_id: 1,
            shift_date: '2026-08-05',
            pattern_id: 1,
            start_time: '09:00:00',
            end_time: '17:00:00',
            break_minutes: 60
          }
        ])
      )

      const result = await service.generateShifts(10, 20, 2026, 8, {
        model: 'gpt-4o-mini'
      })

      expect(result.metadata).toMatchObject({
        tenant_id: 10,
        store_id: 20,
        year: 2026,
        month: 8,
        model: 'gpt-4o-mini',
        staff_count: 2,
        pattern_count: 1
      })
      expect(result.metadata.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(typeof result.metadata.elapsed_ms).toBe('number')
      expect(result.metadata.elapsed_ms).toBeGreaterThanOrEqual(0)
    })

    it('正常系: validation に summary と violations が含まれる', async () => {
      collectMasterDataMock.mockResolvedValue(buildMasterData())
      generateShiftsAIMock.mockResolvedValue(
        buildAIResponse([
          {
            staff_id: 1,
            shift_date: '2026-08-01',
            pattern_id: 1,
            start_time: '09:00:00',
            end_time: '17:00:00',
            break_minutes: 60
          }
        ])
      )

      const result = await service.generateShifts(10, 20, 2026, 8)

      expect(result.validation).toHaveProperty('summary')
      expect(result.validation).toHaveProperty('violations')
      expect(Array.isArray(result.validation.violations)).toBe(true)
      expect(result.validation.summary).toHaveProperty('total')
      expect(result.validation.summary).toHaveProperty('is_valid')
    })

    it('MasterDataCollector と OpenAIClient に正しい引数が渡される', async () => {
      collectMasterDataMock.mockResolvedValue(buildMasterData())
      generateShiftsAIMock.mockResolvedValue(
        buildAIResponse([
          {
            staff_id: 1,
            shift_date: '2026-08-01',
            pattern_id: 1,
            start_time: '09:00:00',
            end_time: '17:00:00',
            break_minutes: 60
          }
        ])
      )

      await service.generateShifts(10, 20, 2026, 8, {
        maxRetries: 2,
        temperature: 0.5,
        model: 'gpt-4o'
      })

      expect(collectMasterDataMock).toHaveBeenCalledWith(10, 20, 2026, 8)
      expect(generateShiftsAIMock).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.any(String),
          user: expect.any(String)
        }),
        expect.objectContaining({
          maxRetries: 2,
          temperature: 0.5,
          model: 'gpt-4o'
        })
      )
    })

    it('異常系: マスターデータ不足 (スタッフ 0 名) で phase=data_collection のエラー', async () => {
      collectMasterDataMock.mockResolvedValue(buildMasterData({ staff: [] }))

      await expect(service.generateShifts(10, 20, 2026, 8)).rejects.toMatchObject(
        {
          success: false,
          phase: 'data_collection',
          error: expect.stringContaining('マスターデータが不足しています')
        }
      )
      // AI 呼び出しには到達しない
      expect(generateShiftsAIMock).not.toHaveBeenCalled()
    })

    it('異常系: マスターデータ不足 (店舗情報なし) で例外がスロー', async () => {
      collectMasterDataMock.mockResolvedValue(
        buildMasterData({ storeInfo: null })
      )

      await expect(service.generateShifts(10, 20, 2026, 8)).rejects.toMatchObject(
        {
          success: false,
          phase: 'data_collection',
          error: expect.stringContaining('店舗情報が取得できませんでした')
        }
      )
    })

    it('異常系: MasterDataCollector が reject した場合はエラーが伝播', async () => {
      collectMasterDataMock.mockRejectedValue(new Error('DB接続エラー'))

      await expect(service.generateShifts(10, 20, 2026, 8)).rejects.toMatchObject(
        {
          success: false,
          error: expect.stringContaining('DB接続エラー')
        }
      )
      expect(generateShiftsAIMock).not.toHaveBeenCalled()
    })

    it('異常系: AI クライアントが reject した場合は phase=ai_generation のエラー', async () => {
      collectMasterDataMock.mockResolvedValue(buildMasterData())
      generateShiftsAIMock.mockRejectedValue(new Error('OpenAI API timeout'))

      await expect(service.generateShifts(10, 20, 2026, 8)).rejects.toMatchObject(
        {
          success: false,
          phase: 'ai_generation',
          error: expect.stringContaining('OpenAI API timeout')
        }
      )
    })

    it('異常系: AI 応答が不正な JSON の場合は phase=response_parsing のエラー', async () => {
      collectMasterDataMock.mockResolvedValue(buildMasterData())
      generateShiftsAIMock.mockResolvedValue('これは JSON ではありません')

      await expect(service.generateShifts(10, 20, 2026, 8)).rejects.toMatchObject(
        {
          success: false,
          phase: 'response_parsing'
        }
      )
    })

    it('異常系: エラーオブジェクトに elapsed_ms が含まれる', async () => {
      collectMasterDataMock.mockRejectedValue(new Error('何らかのエラー'))

      await expect(service.generateShifts(10, 20, 2026, 8)).rejects.toMatchObject(
        {
          elapsed_ms: expect.any(Number)
        }
      )
    })
  })
})
