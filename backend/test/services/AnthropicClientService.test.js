import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// @anthropic-ai/sdk を mock。messages.create を差し替えて呼び出しを検証する。
const mocks = vi.hoisted(() => {
  const messagesCreateMock = vi.fn()

  class AnthropicMock {
    constructor(config) {
      this.apiKey = config?.apiKey
      this.messages = { create: messagesCreateMock }
    }
  }

  return { messagesCreateMock, AnthropicMock }
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: mocks.AnthropicMock
}))

// dotenv がローカルの .env / .env.local から ANTHROPIC_API_KEY を
// 読み込んで「未設定」テストが壊れるのを防ぐため、no-op にする。
vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn()
}))

/**
 * AnthropicClientService は `process.env.ANTHROPIC_API_KEY` を
 * モジュールロード時にキャプチャするため、環境変数を切り替えて
 * 都度 `vi.resetModules()` → dynamic import する。
 */
async function loadService(apiKey) {
  vi.resetModules()
  const original = process.env.ANTHROPIC_API_KEY
  if (apiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = apiKey
  }
  try {
    const mod = await import('../../src/services/shift/AnthropicClientService.js')
    return mod.default
  } finally {
    if (original === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = original
    }
  }
}

describe('AnthropicClientService', () => {
  const { messagesCreateMock } = mocks

  beforeEach(() => {
    messagesCreateMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('APIキー未設定時の挙動', () => {
    it('ANTHROPIC_API_KEY が未設定の場合はエラーをスロー', async () => {
      const AnthropicClientService = await loadService(undefined)
      const service = new AnthropicClientService()

      await expect(
        service.generateShifts({ system: 's', user: 'u' })
      ).rejects.toThrow(/ANTHROPIC_API_KEY/)

      // API 呼び出しには一切到達しない
      expect(messagesCreateMock).not.toHaveBeenCalled()
    })
  })

  describe('正常応答', () => {
    it('assistant prefill "{" を先頭に補完した完全な JSON 文字列を返す', async () => {
      const AnthropicClientService = await loadService('test-key')
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '"shifts":[]}' }]
      })

      const service = new AnthropicClientService()
      const result = await service.generateShifts({
        system: 'system prompt',
        user: 'user prompt'
      })

      expect(result).toBe('{"shifts":[]}')
      expect(JSON.parse(result)).toEqual({ shifts: [] })
    })

    it('messages 配列に user プロンプトと assistant prefill "{" が含まれる', async () => {
      const AnthropicClientService = await loadService('test-key')
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '"x":1}' }]
      })

      const service = new AnthropicClientService()
      await service.generateShifts({ system: 'sys', user: 'ユーザ入力' })

      expect(messagesCreateMock).toHaveBeenCalledTimes(1)
      expect(messagesCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'user', content: 'ユーザ入力' },
            { role: 'assistant', content: '{' }
          ]
        })
      )
    })

    it('デフォルトで max_tokens=16000, temperature=0.7 が渡される', async () => {
      const AnthropicClientService = await loadService('test-key')
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '}' }]
      })

      const service = new AnthropicClientService()
      await service.generateShifts({ system: 's', user: 'u' })

      expect(messagesCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 16000,
          temperature: 0.7
        })
      )
    })

    it('options で渡した temperature / maxTokens / model が API 呼び出しに反映される', async () => {
      const AnthropicClientService = await loadService('test-key')
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '}' }]
      })

      const service = new AnthropicClientService()
      await service.generateShifts(
        { system: 's', user: 'u' },
        { temperature: 0.3, maxTokens: 12000, model: 'claude-opus-4' }
      )

      expect(messagesCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4',
          max_tokens: 12000,
          temperature: 0.3
        })
      )
    })

    it('system プロンプトに JSON-only サフィックスが付与される', async () => {
      const AnthropicClientService = await loadService('test-key')
      messagesCreateMock.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '}' }]
      })

      const service = new AnthropicClientService()
      await service.generateShifts({ system: 'ベースプロンプト', user: 'u' })

      const call = messagesCreateMock.mock.calls[0][0]
      expect(call.system).toContain('ベースプロンプト')
      expect(call.system).toContain('JSON形式のみ')
    })
  })

  describe('stop_reason ハンドリング', () => {
    it('stop_reason === "max_tokens" の場合はトークン上限エラーをスロー', async () => {
      const AnthropicClientService = await loadService('test-key')
      messagesCreateMock.mockResolvedValue({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '"incomplete...' }]
      })

      const service = new AnthropicClientService()
      service.sleep = () => Promise.resolve()

      await expect(
        service.generateShifts(
          { system: 's', user: 'u' },
          { maxRetries: 1 }
        )
      ).rejects.toThrow(/トークン上限/)
    })
  })

  describe('リトライ動作', () => {
    it('一時的なエラー後に成功すればレスポンスを返す', async () => {
      const AnthropicClientService = await loadService('test-key')
      messagesCreateMock
        .mockRejectedValueOnce(new Error('一時的なネットワークエラー'))
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '"ok":true}' }]
        })

      const service = new AnthropicClientService()
      service.sleep = () => Promise.resolve()

      const result = await service.generateShifts(
        { system: 's', user: 'u' },
        { maxRetries: 3 }
      )

      expect(result).toBe('{"ok":true}')
      expect(messagesCreateMock).toHaveBeenCalledTimes(2)
    })

    it('maxRetries 回連続失敗で最終エラーをスロー', async () => {
      const AnthropicClientService = await loadService('test-key')
      messagesCreateMock.mockRejectedValue(new Error('APIエラー'))

      const service = new AnthropicClientService()
      service.sleep = () => Promise.resolve()

      await expect(
        service.generateShifts(
          { system: 's', user: 'u' },
          { maxRetries: 3 }
        )
      ).rejects.toThrow(/AI生成に失敗しました \(3回試行\)/)

      expect(messagesCreateMock).toHaveBeenCalledTimes(3)
    })
  })
})
