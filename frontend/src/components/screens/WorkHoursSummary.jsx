import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Home, RefreshCw } from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { useTenant } from '../../contexts/TenantContext'
import { AnalyticsRepository } from '../../infrastructure/repositories/AnalyticsRepository'
import { MasterRepository } from '../../infrastructure/repositories/MasterRepository'
import { getCurrentYear, getCurrentMonth } from '../../utils/dateUtils'

const analyticsRepository = new AnalyticsRepository()
const masterRepository = new MasterRepository()

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)
const OVER_HOURS_THRESHOLD = 160

const COLOR_NORMAL = '#0057b7'
const COLOR_OVER = '#d95c5c'

function buildYearOptions(currentYear) {
  return [currentYear - 1, currentYear, currentYear + 1]
}

const WorkHoursSummary = () => {
  const navigate = useNavigate()
  const { tenantId } = useTenant()

  const currentYear = getCurrentYear()
  const currentMonth = getCurrentMonth()

  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)
  const [storeId, setStoreId] = useState('all')

  const [stores, setStores] = useState([])
  const [rows, setRows] = useState([])
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

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await analyticsRepository.getWorkHoursSummary({
        tenantId,
        year,
        month,
        storeId: storeId === 'all' ? undefined : storeId,
      })
      setRows(data)
    } catch (e) {
      setError(e.message || '稼働時間サマリー取得に失敗しました')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tenantId, year, month, storeId])

  useEffect(() => {
    loadStores()
  }, [loadStores])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const chartData = useMemo(
    () =>
      rows.map(r => ({
        staff_name: r.staff_name,
        total_work_hours: Number(r.total_work_hours) || 0,
        is_over_160h: Boolean(r.is_over_160h),
      })),
    [rows]
  )

  const overCount = useMemo(() => rows.filter(r => r.is_over_160h).length, [rows])

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
            <Clock className="h-6 w-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">スタッフ別 月次稼働時間</h1>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          hr.payroll の work_hours を対象年月・店舗で SUM した集計です。 月{OVER_HOURS_THRESHOLD}
          時間を超えたスタッフは警告色でハイライトされます。
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
            <div className="ml-auto">
              <button
                onClick={loadSummary}
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-gray-500">対象人数</div>
            <div className="text-2xl font-semibold text-gray-900">{rows.length}人</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{OVER_HOURS_THRESHOLD}時間超</div>
            <div
              className={`text-2xl font-semibold ${overCount > 0 ? 'text-red-700' : 'text-gray-900'}`}
            >
              {overCount}人
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">対象年月</div>
            <div className="text-2xl font-semibold text-gray-900">
              {year}年{month}月
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* グラフ */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          {loading ? (
            <div className="py-12">
              <LoadingSpinner label="読み込み中..." />
            </div>
          ) : chartData.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">対象データがありません</div>
          ) : (
            <div style={{ width: '100%', height: Math.max(320, chartData.length * 32 + 80) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 16, right: 24, left: 24, bottom: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 12 }} unit="h" />
                  <YAxis type="category" dataKey="staff_name" width={110} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={value => [`${Number(value).toFixed(1)}時間`, '稼働時間']} />
                  <ReferenceLine
                    x={OVER_HOURS_THRESHOLD}
                    stroke={COLOR_OVER}
                    strokeDasharray="4 4"
                    label={{
                      value: `${OVER_HOURS_THRESHOLD}h`,
                      position: 'top',
                      fill: COLOR_OVER,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="total_work_hours" name="稼働時間">
                    {chartData.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={entry.is_over_160h ? COLOR_OVER : COLOR_NORMAL}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default WorkHoursSummary
