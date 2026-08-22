import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, Home, RefreshCw } from 'lucide-react'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { useTenant } from '../../contexts/TenantContext'
import { ShiftRepository } from '../../infrastructure/repositories/ShiftRepository'
import { MasterRepository } from '../../infrastructure/repositories/MasterRepository'
import { getCurrentYear, getCurrentMonth } from '../../utils/dateUtils'

const shiftRepository = new ShiftRepository()
const masterRepository = new MasterRepository()

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

function buildYearOptions(currentYear) {
  return [currentYear - 1, currentYear, currentYear + 1]
}

const PreferencesSubmissionStatus = () => {
  const navigate = useNavigate()
  const { tenantId } = useTenant()

  const currentYear = getCurrentYear()
  const currentMonth = getCurrentMonth()

  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)
  const [storeId, setStoreId] = useState('all')
  const [showUnsubmittedOnly, setShowUnsubmittedOnly] = useState(false)

  const [stores, setStores] = useState([])
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadStores = useCallback(async () => {
    try {
      const data = await masterRepository.getStores(tenantId)
      setStores(data || [])
    } catch (e) {
      console.error('店舗マスタ取得エラー:', e)
    }
  }, [tenantId])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, summary: sum } = await shiftRepository.getPreferencesSubmissionStatus({
        tenantId,
        year,
        month,
        storeId: storeId === 'all' ? undefined : storeId,
      })
      setRows(data)
      setSummary(sum)
    } catch (e) {
      setError(e.message || '提出状況の取得に失敗しました')
      setRows([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [tenantId, year, month, storeId])

  useEffect(() => {
    loadStores()
  }, [loadStores])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const filteredRows = useMemo(() => {
    if (!showUnsubmittedOnly) return rows
    return rows.filter(r => !r.submitted)
  }, [rows, showUnsubmittedOnly])

  const submissionRatePct = useMemo(() => {
    if (!summary || summary.total === 0) return 0
    return Math.round(summary.submission_rate * 1000) / 10
  }, [summary])

  const yearOptions = buildYearOptions(currentYear)

  return (
    <div className="min-h-screen bg-slate-50 pt-16">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
          >
            <Home className="h-4 w-4" />
            ダッシュボード
          </button>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">シフト希望 提出状況</h1>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          対象月にシフト希望を1件以上提出したスタッフを「提出済み」として集計します。
          非アクティブ（退職済み）スタッフは対象外です。
        </p>

        {/* フィルタ */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">対象年</label>
              <select
                value={year}
                onChange={e => setYear(parseInt(e.target.value, 10))}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">対象月</label>
              <select
                value={month}
                onChange={e => setMonth(parseInt(e.target.value, 10))}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
              >
                {MONTH_OPTIONS.map(m => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">店舗</label>
              <select
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="all">全店舗</option>
                {stores.map(s => (
                  <option key={s.store_id} value={s.store_id}>
                    {s.store_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showUnsubmittedOnly}
                  onChange={e => setShowUnsubmittedOnly(e.target.checked)}
                  className="h-4 w-4"
                />
                未提出のみ表示
              </label>
            </div>
            <div className="ml-auto">
              <button
                onClick={loadStatus}
                disabled={loading}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                再取得
              </button>
            </div>
          </div>
        </div>

        {/* サマリー */}
        {summary && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500">対象人数</div>
              <div className="text-2xl font-semibold text-gray-900">{summary.total}人</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">提出済み</div>
              <div className="text-2xl font-semibold text-green-700">{summary.submitted}人</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">未提出</div>
              <div className="text-2xl font-semibold text-red-700">{summary.unsubmitted}人</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">提出率</div>
              <div className="text-2xl font-semibold text-blue-700">{submissionRatePct}%</div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* 一覧 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="py-12">
              <LoadingSpinner label="読み込み中..." />
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b">
                    スタッフ名
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b">
                    雇用形態
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-b">
                    提出状況
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 border-b">
                    提出日数
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">
                      {showUnsubmittedOnly
                        ? '未提出のスタッフはいません'
                        : '対象スタッフがいません'}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(row => (
                    <tr key={row.staff_id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-800 font-medium">
                        {row.staff_name}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600">
                        {row.employment_type || '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.submitted ? (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 border border-green-200">
                            提出済み
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 border border-red-200">
                            未提出
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700 text-right">
                        {row.submitted_dates_count}日
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default PreferencesSubmissionStatus
