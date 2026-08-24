import { useState, useEffect, useMemo, useRef } from 'react'
import { Button } from '../../ui/button'
import { Loader2, Sparkles, CheckCircle, AlertCircle, SkipForward } from 'lucide-react'
import { BACKEND_API_URL, API_ENDPOINTS } from '../../../config/api'

/**
 * 複数店舗一括 AI シフト生成 (Issue #50)
 *
 * SSE 経由で GET /api/shifts/plans/generate-bulk/stream に接続し、
 * 店舗ごとの進捗/完了/失敗/スキップをリアルタイム表示する。
 *
 * Props:
 * - tenantId: number (required)
 * - stores: Array<{ store_id, store_name }> — 選択候補
 * - year, month: number (required)
 * - createdBy: number (optional)
 * - options: 任意 ({ model, temperature, maxRetries })
 * - onComplete(result): 完了時 ({ created, skipped, failed })
 * - onError(error): 致命的エラー時
 * - className: 任意
 */
const STATUS_LABEL = {
  pending: '待機中',
  running: '生成中',
  complete: '完了',
  skipped: 'スキップ',
  error: '失敗',
}

const STATUS_CLASS = {
  pending: 'bg-gray-100 text-gray-600 border-gray-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  complete: 'bg-green-50 text-green-700 border-green-200',
  skipped: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-200',
}

const BulkShiftGenerator = ({
  tenantId,
  stores = [],
  year,
  month,
  createdBy,
  options,
  onComplete,
  onError,
  className = '',
}) => {
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const [storeStatus, setStoreStatus] = useState({}) // {store_id: {status,progress,message,plan_id,error,reason}}
  const [summary, setSummary] = useState(null) // {created,skipped,failed}
  const [fatalError, setFatalError] = useState('')
  const eventSourceRef = useRef(null)

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [])

  const allSelected = useMemo(
    () => stores.length > 0 && selectedIds.size === stores.length,
    [stores, selectedIds]
  )

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(stores.map(s => Number(s.store_id))))
    }
  }

  const toggleOne = storeId => {
    const next = new Set(selectedIds)
    if (next.has(storeId)) next.delete(storeId)
    else next.add(storeId)
    setSelectedIds(next)
  }

  const closeEventSource = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  const updateStoreStatus = (storeId, patch) => {
    setStoreStatus(prev => ({
      ...prev,
      [storeId]: { ...(prev[storeId] || {}), ...patch },
    }))
  }

  const handleGenerate = () => {
    if (!tenantId || !year || !month) {
      const msg = 'テナント・年月が指定されていません'
      setFatalError(msg)
      if (onError) onError(new Error(msg))
      return
    }
    if (selectedIds.size === 0) {
      setFatalError('店舗を1つ以上選択してください')
      return
    }

    setIsGenerating(true)
    setSummary(null)
    setFatalError('')

    // 選択店舗を pending で初期化
    const initial = {}
    for (const id of selectedIds) {
      initial[id] = { status: 'pending', progress: 0, message: '' }
    }
    setStoreStatus(initial)

    const params = new URLSearchParams({
      tenant_id: String(tenantId),
      store_ids: Array.from(selectedIds).join(','),
      year: String(year),
      month: String(month),
    })
    if (createdBy) params.set('created_by', String(createdBy))
    if (options && Object.keys(options).length > 0) {
      params.set('options', JSON.stringify(options))
    }

    const url = `${BACKEND_API_URL}${API_ENDPOINTS.GENERATE_BULK_STREAM}?${params.toString()}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.addEventListener('store_progress', event => {
      try {
        const data = JSON.parse(event.data)
        updateStoreStatus(data.store_id, {
          status: 'running',
          progress: typeof data.progress === 'number' ? data.progress : 0,
          message: data.message || '',
        })
      } catch (err) {
        console.error('[BulkShiftGenerator] store_progress パース失敗:', err)
      }
    })

    es.addEventListener('store_complete', event => {
      try {
        const data = JSON.parse(event.data)
        updateStoreStatus(data.store_id, {
          status: 'complete',
          progress: 100,
          plan_id: data.plan_id,
        })
      } catch (err) {
        console.error('[BulkShiftGenerator] store_complete パース失敗:', err)
      }
    })

    es.addEventListener('store_error', event => {
      try {
        const data = JSON.parse(event.data)
        updateStoreStatus(data.store_id, {
          status: 'error',
          error: data.error,
        })
      } catch (err) {
        console.error('[BulkShiftGenerator] store_error パース失敗:', err)
      }
    })

    es.addEventListener('store_skipped', event => {
      try {
        const data = JSON.parse(event.data)
        updateStoreStatus(data.store_id, {
          status: 'skipped',
          reason: data.reason,
        })
      } catch (err) {
        console.error('[BulkShiftGenerator] store_skipped パース失敗:', err)
      }
    })

    es.addEventListener('complete', event => {
      try {
        const result = JSON.parse(event.data)
        setSummary(result)
        setIsGenerating(false)
        closeEventSource()
        if (onComplete) onComplete(result)
      } catch (err) {
        console.error('[BulkShiftGenerator] complete パース失敗:', err)
        setIsGenerating(false)
        closeEventSource()
        if (onError) onError(err)
      }
    })

    es.addEventListener('error', event => {
      let message = '一括生成中にエラーが発生しました'
      let parsed = null
      if (event && event.data) {
        try {
          parsed = JSON.parse(event.data)
          if (parsed && parsed.error) message = parsed.error
        } catch {
          // ネットワーク切断など
        }
      } else if (es.readyState === EventSource.CLOSED) {
        message = 'サーバーとの接続が切断されました'
      }
      setFatalError(message)
      setIsGenerating(false)
      closeEventSource()
      if (onError) onError(parsed || new Error(message))
    })
  }

  const storeName = storeId => {
    const found = stores.find(s => Number(s.store_id) === Number(storeId))
    return found ? found.store_name : `店舗ID:${storeId}`
  }

  return (
    <div className={`bulk-shift-generator ${className}`}>
      {/* 店舗選択 */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">一括生成する店舗を選択</label>
          <button
            type="button"
            onClick={toggleAll}
            disabled={isGenerating}
            className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
          >
            {allSelected ? '全解除' : '全選択'}
          </button>
        </div>
        <div className="flex flex-wrap gap-3 p-2 border border-gray-200 rounded bg-white">
          {stores.length === 0 && <span className="text-xs text-gray-500">店舗がありません</span>}
          {stores.map(store => {
            const idNum = Number(store.store_id)
            const checked = selectedIds.has(idNum)
            return (
              <label
                key={store.store_id}
                className={`flex items-center gap-2 cursor-pointer ${
                  isGenerating ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isGenerating}
                  onChange={() => toggleOne(idNum)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm text-gray-700">{store.store_name}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* 一括生成ボタン */}
      <div className="flex items-center gap-3 mb-3">
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating || selectedIds.size === 0}
          className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
          title={
            selectedIds.size === 0 ? '店舗を選択してください' : `${selectedIds.size}店舗を一括生成`
          }
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-1" />
          )}
          {isGenerating
            ? '生成中...'
            : `${selectedIds.size > 0 ? `${selectedIds.size}店舗を` : ''}一括生成`}
        </Button>
        {isGenerating && (
          <span className="text-xs text-gray-500">
            並列度3で順次実行中（この画面を閉じないでください）
          </span>
        )}
      </div>

      {/* 店舗別ステータス */}
      {Object.keys(storeStatus).length > 0 && (
        <div className="space-y-2 max-w-2xl mb-3">
          {Object.entries(storeStatus).map(([storeId, s]) => (
            <div
              key={storeId}
              className={`flex items-center justify-between p-2 border rounded ${
                STATUS_CLASS[s.status] || STATUS_CLASS.pending
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {s.status === 'running' && (
                  <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                )}
                {s.status === 'complete' && <CheckCircle className="h-4 w-4 flex-shrink-0" />}
                {s.status === 'error' && <AlertCircle className="h-4 w-4 flex-shrink-0" />}
                {s.status === 'skipped' && <SkipForward className="h-4 w-4 flex-shrink-0" />}
                <span className="text-sm font-medium truncate">{storeName(storeId)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {s.status === 'running' && (
                  <>
                    <span className="text-gray-600 hidden sm:inline">{s.message}</span>
                    <div className="w-24 bg-white/60 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-blue-600 h-1.5 transition-all duration-300"
                        style={{ width: `${s.progress || 0}%` }}
                      />
                    </div>
                    <span className="font-semibold">{s.progress || 0}%</span>
                  </>
                )}
                {s.status === 'complete' && <span>プランID: {s.plan_id}</span>}
                {s.status === 'error' && (
                  <span className="truncate max-w-xs" title={s.error}>
                    {s.error}
                  </span>
                )}
                {s.status === 'skipped' && (
                  <span className="truncate max-w-xs" title={s.reason}>
                    {s.reason}
                  </span>
                )}
                {s.status === 'pending' && <span>{STATUS_LABEL.pending}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* サマリートースト */}
      {summary && (
        <div className="mt-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm max-w-2xl">
          <div className="text-sm font-medium text-gray-800 mb-1">
            {summary.created.length}店舗のシフトを生成しました（スキップ {summary.skipped.length}
            件・失敗 {summary.failed.length}件）
          </div>
          {summary.failed.length > 0 && (
            <ul className="mt-2 text-xs text-red-700 space-y-1">
              {summary.failed.map(f => (
                <li key={f.store_id}>
                  ・{storeName(f.store_id)}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {fatalError && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 max-w-2xl">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{fatalError}</span>
        </div>
      )}
    </div>
  )
}

export default BulkShiftGenerator
