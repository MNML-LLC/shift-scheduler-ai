import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config()

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null

const JSON_ONLY_SUFFIX =
  '\n\nレスポンスは必ずJSON形式のみで出力してください。マークダウンのコードブロックや説明文は含めないでください。'

/**
 * Anthropic API呼び出しサービス
 * OpenAIClientService と同一インターフェースで Claude を利用
 */
class AnthropicClientService {
  /**
   * Anthropic API呼び出し (リトライ付き)
   * @param {Object} prompt - {system, user}
   * @param {Object} options - 設定オプション
   * @returns {Promise<string>} AI応答 (JSON文字列)
   */
  async generateShifts(prompt, options = {}) {
    const {
      maxRetries = 3,
      model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      maxTokens = 16000,
      temperature = 0.7
    } = options

    if (!anthropic) {
      throw new Error(
        'Anthropic APIキーが設定されていません (ANTHROPIC_API_KEY)'
      )
    }

    const system = `${prompt.system}${JSON_ONLY_SUFFIX}`

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          system,
          messages: [
            { role: 'user', content: prompt.user },
            { role: 'assistant', content: '{' }
          ]
        })

        if (response.stop_reason === 'max_tokens') {
          throw new Error(
            `AI応答がトークン上限（${maxTokens}）に達しました。シフト規模を縮小するか ANTHROPIC_MODEL をより大きなモデルに変更してください`
          )
        }

        const textBlock = response.content.find((block) => block.type === 'text')
        if (!textBlock || typeof textBlock.text !== 'string') {
          throw new Error('Anthropic応答にテキストブロックが含まれていません')
        }

        return '{' + textBlock.text

      } catch (error) {
        console.error(`[AnthropicClient] エラー (試行 ${attempt}/${maxRetries}):`, error.message)

        if (attempt === maxRetries) {
          throw new Error(`AI生成に失敗しました (${maxRetries}回試行): ${error.message}`, { cause: error })
        }

        // 指数バックオフ (1秒、2秒、4秒)
        const waitTime = Math.pow(2, attempt - 1) * 1000
        await this.sleep(waitTime)
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default AnthropicClientService
