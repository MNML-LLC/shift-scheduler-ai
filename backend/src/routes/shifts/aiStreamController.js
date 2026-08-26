import { DatabaseUnavailableError } from '../../config/database.js'
import ShiftGenerationService from '../../services/shift/ShiftGenerationService.js'
import ShiftPlanAiPersistenceService from '../../services/shift/ShiftPlanAiPersistenceService.js'
import { notifyShiftGenerationError } from '../../utils/slackNotifier.js'
import { MESSAGES } from '../../constants/messages.js'

/**
 * SSE ヘルパ + AI シフト生成の SSE ハンドラ 2 つ（単一店舗・一括複数店舗）を集約する。
 * ルート層 (routes/shifts.js) からは薄い委譲だけになる。
 */

const BULK_STORE_TIMEOUT_MS = 90_000
const BULK_CONCURRENCY = 3

function sendSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()
}

function makeSseWriter(res) {
  return (event, data) => {
    if (res.writableEnded) return
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
}

/**
 * GET /api/shifts/plans/generate-ai/stream
 */
export async function handleAiGenerateStream(req, res) {
  sendSseHeaders(res)
  const sendEvent = makeSseWriter(res)
  const closeStream = () => { if (!res.writableEnded) res.end() }
  let clientClosed = false
  req.on('close', () => { clientClosed = true })

  try {
    const tenant_id = parseInt(req.query.tenant_id, 10)
    const store_id = parseInt(req.query.store_id, 10)
    const year = parseInt(req.query.year, 10)
    const month = parseInt(req.query.month, 10)
    const created_by = req.query.created_by ? parseInt(req.query.created_by, 10) : null

    let options = {}
    if (req.query.options) {
      try {
        options = JSON.parse(req.query.options)
      } catch {
        sendEvent('error', { success: false, error: 'options パラメータの JSON パースに失敗しました' })
        closeStream()
        return
      }
    }

    if (!tenant_id || !store_id || !year || !month) {
      sendEvent('error', {
        success: false, error: MESSAGES.VALIDATION.MISSING_FIELDS,
        required: ['tenant_id', 'store_id', 'year', 'month'],
      })
      closeStream()
      return
    }
    if (year < 2000 || year > 2100) {
      sendEvent('error', { success: false, error: MESSAGES.VALIDATION.INVALID_YEAR_RANGE })
      closeStream()
      return
    }
    if (month < 1 || month > 12) {
      sendEvent('error', { success: false, error: MESSAGES.VALIDATION.INVALID_MONTH_RANGE })
      closeStream()
      return
    }
    const now = new Date()
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
      sendEvent('error', {
        success: false, error: MESSAGES.VALIDATION.PAST_MONTH_CREATE,
        message: `${year}年${month}月は過去の月のため、シフトを作成できません。`,
      })
      closeStream()
      return
    }

    const service = new ShiftGenerationService()
    const result = await service.generateShifts(tenant_id, store_id, year, month, {
      ...options,
      onProgress: (payload) => { if (!clientClosed) sendEvent('progress', payload) },
    })

    if (clientClosed) { closeStream(); return }

    sendEvent('progress', { phase: 'saving', message: 'DBに保存中...', progress: 95 })

    const { planId, isUpdate, insertedCount } = await ShiftPlanAiPersistenceService.persistAiShifts({
      tenantId: tenant_id, storeId: store_id, year, month, createdBy: created_by,
      options, result, planNameSuffix: 'AI生成', planCodePrefix: 'AI',
    })

    sendEvent('progress', { phase: 'done', message: '生成完了', progress: 100 })
    sendEvent('complete', {
      success: true,
      message: isUpdate
        ? `AI自動生成でシフトを更新しました (${insertedCount}件)`
        : `AI自動生成でシフトを作成しました (${insertedCount}件)`,
      is_update: isUpdate,
      data: {
        plan_id: planId, year, month, shifts_count: insertedCount,
        validation: result.validation.summary,
        violations: result.validation.violations,
        metadata: result.metadata,
      },
    })
    closeStream()
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      sendEvent('error', { success: false, error: 'データベースに接続できません' })
      closeStream()
      return
    }
    console.error('[API] AI自動生成 (SSE) エラー:', error)
    res.locals.suppressGenericAlert = true
    await notifyShiftGenerationError('GET /api/shifts/plans/generate-ai/stream', error, req.query)

    if (error && error.success === false) {
      sendEvent('error', {
        success: false, error: error.error, phase: error.phase, elapsed_ms: error.elapsed_ms,
      })
    } else {
      sendEvent('error', {
        success: false, error: (error && error.message) || 'AI自動生成中にエラーが発生しました',
      })
    }
    closeStream()
  }
}

/**
 * GET /api/shifts/plans/generate-bulk/stream
 */
export async function handleBulkGenerateStream(req, res) {
  const tenant_id = parseInt(req.query.tenant_id, 10)
  const year = parseInt(req.query.year, 10)
  const month = parseInt(req.query.month, 10)
  const created_by = req.query.created_by ? parseInt(req.query.created_by, 10) : null
  const allFlag = String(req.query.all || '').toLowerCase() === 'true'
  const storeIdsRaw = typeof req.query.store_ids === 'string' ? req.query.store_ids.trim() : ''

  let options = {}
  if (req.query.options) {
    try {
      options = JSON.parse(req.query.options)
    } catch {
      return res.status(400).json({ success: false, error: 'options パラメータの JSON パースに失敗しました' })
    }
  }

  if (!tenant_id || !year || !month) {
    return res.status(400).json({
      success: false, error: MESSAGES.VALIDATION.MISSING_FIELDS,
      required: ['tenant_id', 'year', 'month'],
    })
  }
  if (!storeIdsRaw && !allFlag) {
    return res.status(400).json({
      success: false, error: 'store_ids または all=true のいずれかを指定してください',
    })
  }
  if (year < 2000 || year > 2100) {
    return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.INVALID_YEAR_RANGE })
  }
  if (month < 1 || month > 12) {
    return res.status(400).json({ success: false, error: MESSAGES.VALIDATION.INVALID_MONTH_RANGE })
  }
  const now = new Date()
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return res.status(400).json({
      success: false, error: MESSAGES.VALIDATION.PAST_MONTH_CREATE,
      message: `${year}年${month}月は過去の月のため、シフトを作成できません。`,
    })
  }

  sendSseHeaders(res)
  const sendEvent = makeSseWriter(res)
  const closeStream = () => { if (!res.writableEnded) res.end() }
  let clientClosed = false
  req.on('close', () => { clientClosed = true })

  try {
    let targetStoreIds = []
    if (allFlag) {
      targetStoreIds = await ShiftPlanAiPersistenceService.findActiveStoreIds(tenant_id)
    } else {
      targetStoreIds = storeIdsRaw
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0)
    }

    if (targetStoreIds.length === 0) {
      sendEvent('complete', { created: [], skipped: [], failed: [] })
      closeStream()
      return
    }

    const skipStoreIds = new Set(
      await ShiftPlanAiPersistenceService.findExistingApprovedStoreIds({
        tenantId: tenant_id, year, month, storeIds: targetStoreIds,
      })
    )

    const storesTotal = targetStoreIds.length
    const created = []
    const skipped = []
    const failed = []

    for (let i = 0; i < targetStoreIds.length; i++) {
      const storeId = targetStoreIds[i]
      if (skipStoreIds.has(storeId)) {
        const entry = { store_id: storeId, reason: '承認済み/確定済みプランが存在します' }
        skipped.push(entry)
        sendEvent('store_skipped', {
          store_id: storeId, store_index: i + 1, stores_total: storesTotal, reason: entry.reason,
        })
      }
    }

    const remaining = targetStoreIds
      .map((storeId, idx) => ({ storeId, index: idx + 1 }))
      .filter(({ storeId }) => !skipStoreIds.has(storeId))

    const runOneStore = async ({ storeId, index }) => {
      if (clientClosed) return

      const service = new ShiftGenerationService()
      const genOptions = {
        ...options,
        onProgress: (payload) => {
          if (clientClosed) return
          sendEvent('store_progress', {
            store_id: storeId, store_index: index, stores_total: storesTotal, ...payload,
          })
        },
      }

      try {
        const generatePromise = service.generateShifts(tenant_id, storeId, year, month, genOptions)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`タイムアウト (${BULK_STORE_TIMEOUT_MS}ms)`)), BULK_STORE_TIMEOUT_MS)
        )
        const genResult = await Promise.race([generatePromise, timeoutPromise])

        if (clientClosed) return

        const planId = await ShiftPlanAiPersistenceService.persistBulkGeneratedShifts({
          tenantId: tenant_id, storeId, year, month, createdBy: created_by,
          options, result: genResult,
        })

        if (clientClosed) return

        created.push({ store_id: storeId, plan_id: planId })
        sendEvent('store_complete', {
          store_id: storeId, store_index: index, stores_total: storesTotal, plan_id: planId,
        })
      } catch (error) {
        if (error instanceof DatabaseUnavailableError) throw error
        const message = (error && error.error) || (error && error.message) || 'シフト生成に失敗しました'
        console.error(`[BulkGenerate] store=${storeId} 生成失敗:`, error)
        failed.push({ store_id: storeId, error: message })
        if (!clientClosed) {
          sendEvent('store_error', {
            store_id: storeId, store_index: index, stores_total: storesTotal, error: message,
          })
        }
      }
    }

    let cursor = 0
    const workers = []
    for (let w = 0; w < Math.min(BULK_CONCURRENCY, remaining.length); w++) {
      workers.push((async () => {
        while (true) {
          if (clientClosed) return
          const idx = cursor++
          if (idx >= remaining.length) return
          await runOneStore(remaining[idx])
        }
      })())
    }
    await Promise.all(workers)

    if (!clientClosed) sendEvent('complete', { created, skipped, failed })
    closeStream()
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      sendEvent('error', { success: false, error: 'データベースに接続できません' })
      closeStream()
      return
    }
    console.error('[API] 一括AI自動生成 (SSE) エラー:', error)
    res.locals.suppressGenericAlert = true
    await notifyShiftGenerationError('GET /api/shifts/plans/generate-bulk/stream', error, req.query)
    sendEvent('error', {
      success: false, error: (error && error.message) || '一括AI自動生成中にエラーが発生しました',
    })
    closeStream()
  }
}

export default {
  handleAiGenerateStream,
  handleBulkGenerateStream,
}
