import { useState, useEffect, useRef } from 'react'
import { Button } from '../../ui/button'
import { Loader2, Sparkles, CheckCircle, AlertCircle } from 'lucide-react'
import { BACKEND_API_URL } from '../../../config/api'

/**
 * AI シフト生成コンポーネント
 *
 * SSE (Server-Sent Events) 経由でバックエンドの
 * GET /api/shifts/plans/generate-ai/stream に接続し、
 * 生成フェーズの進捗をリアルタイム表示する。
 *
 * Props:
 * - tenantId, storeId, year, month: 必須
 * - createdBy: 任意
 * - options: 任意 ({ model, temperature, maxRetries })
 * - onComplete(result): 生成完了時のコールバック
 * - onError(error): エラー時のコールバック
 * - className: 任意
 */
const AIShiftGenerator = ({
  tenantId,
  storeId,
  year,
  month,
  createdBy,
  options,
  onComplete,
  onError,
  className = '',
}) => {
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const eventSourceRef = useRef(null)

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [])

  const closeEventSource = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  const handleGenerate = () => {
    if (!tenantId || !storeId || !year || !month) {
      const msg = 'テナント・店舗・年月が指定されていません'
      setErrorMessage(msg)
      if (onError) onError(new Error(msg))
      return
    }

    setIsGenerating(true)
    setProgress(0)
    setStatusMessage('接続中...')
    setErrorMessage('')
    setSuccessMessage('')

    const params = new URLSearchParams({
      tenant_id: String(tenantId),
      store_id: String(storeId),
      year: String(year),
      month: String(month),
    })
    if (createdBy) {
      params.set('created_by', String(createdBy))
    }
    if (options && Object.keys(options).length > 0) {
      params.set('options', JSON.stringify(options))
    }

    const url = `${BACKEND_API_URL}/api/shifts/plans/generate-ai/stream?${params.toString()}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.addEventListener('progress', event => {
      try {
        const data = JSON.parse(event.data)
        if (typeof data.progress === 'number') {
          setProgress(data.progress)
        }
        if (data.message) {
          setStatusMessage(data.message)
        }
      } catch (err) {
        console.error('[AIShiftGenerator] progress パース失敗:', err)
      }
    })

    es.addEventListener('complete', event => {
      try {
        const result = JSON.parse(event.data)
        setProgress(100)
        setStatusMessage('')
        setSuccessMessage(result.message || 'シフトの生成が完了しました')
        setIsGenerating(false)
        closeEventSource()
        if (onComplete) onComplete(result)
      } catch (err) {
        console.error('[AIShiftGenerator] complete パース失敗:', err)
        setIsGenerating(false)
        closeEventSource()
        if (onError) onError(err)
      }
    })

    es.addEventListener('error', event => {
      let message = 'AI シフト生成中にエラーが発生しました'
      let parsed = null
      if (event && event.data) {
        try {
          parsed = JSON.parse(event.data)
          if (parsed && parsed.error) {
            message = parsed.error
          }
        } catch (err) {
          // データが無いネットワーク断エラー
        }
      } else if (es.readyState === EventSource.CLOSED) {
        message = 'サーバーとの接続が切断されました'
      }
      setErrorMessage(message)
      setStatusMessage('')
      setIsGenerating(false)
      closeEventSource()
      if (onError) onError(parsed || new Error(message))
    })
  }

  return (
    <div className={`ai-shift-generator ${className}`}>
      <Button
        size="sm"
        onClick={handleGenerate}
        disabled={isGenerating}
        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
        title="AI がシフトを自動生成します"
      >
        {isGenerating ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 mr-1" />
        )}
        {isGenerating ? '生成中...' : 'AI で生成'}
      </Button>

      {isGenerating && (
        <div className="mt-3 w-full max-w-md">
          <div className="flex items-center justify-between mb-1 text-xs text-gray-700">
            <span>{statusMessage || '処理中...'}</span>
            <span className="font-semibold">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-purple-600 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {!isGenerating && successMessage && (
        <div className="mt-3 flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2 max-w-md">
          <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {!isGenerating && errorMessage && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 max-w-md">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  )
}

export default AIShiftGenerator
