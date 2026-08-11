import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Home, Save } from 'lucide-react'
import { BACKEND_API_URL, getAuthHeaders } from '../../config/api'
import { useTenant } from '../../contexts/TenantContext'
import { MasterRepository } from '../../infrastructure/repositories/MasterRepository'

const masterRepository = new MasterRepository()

const DEFAULT_DEADLINE_DAY = 15
const DEFAULT_DEADLINE_TIME = '18:00'

const DeadlineSettings = () => {
  const navigate = useNavigate()
  const { tenantId } = useTenant()
  const [employmentTypes, setEmploymentTypes] = useState([])
  const [rowsByCode, setRowsByCode] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [types, settingsRes] = await Promise.all([
        masterRepository.getEmploymentTypes(tenantId),
        fetch(`${BACKEND_API_URL}/api/master/deadline-settings?tenant_id=${tenantId}`, {
          headers: { ...getAuthHeaders() },
        }).then(r => r.json()),
      ])

      if (!settingsRes.success) {
        throw new Error(settingsRes.error || '締切設定の取得に失敗しました')
      }

      setEmploymentTypes(types)

      const map = {}
      for (const row of settingsRes.data || []) {
        map[row.employment_type] = {
          deadline_day: row.deadline_day,
          deadline_time: (row.deadline_time || '').slice(0, 5),
          is_enabled: row.is_enabled,
          description: row.description || '',
        }
      }
      // employment_types に存在するがまだ設定がないコードは空値で初期化
      for (const t of types) {
        const code = t.employment_code
        if (code && !map[code]) {
          map[code] = {
            deadline_day: DEFAULT_DEADLINE_DAY,
            deadline_time: DEFAULT_DEADLINE_TIME,
            is_enabled: false,
            description: t.employment_name || '',
          }
        }
      }
      setRowsByCode(map)
    } catch (e) {
      setError(e.message || 'データ取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const updateRow = (code, patch) => {
    setRowsByCode(prev => ({
      ...prev,
      [code]: { ...prev[code], ...patch },
    }))
  }

  const handleSave = async code => {
    const row = rowsByCode[code]
    if (!row) return

    setSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await fetch(`${BACKEND_API_URL}/api/master/deadline-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          employment_type: code,
          deadline_day: parseInt(row.deadline_day, 10),
          deadline_time: row.deadline_time,
          is_enabled: row.is_enabled,
          description: row.description || null,
        }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || `保存に失敗しました (HTTP ${response.status})`)
      }

      setSuccessMessage(`${code} の締切設定を保存しました`)
      await loadData()
    } catch (e) {
      setError(e.message || '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-600">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 pt-16">
      <div className="max-w-4xl mx-auto px-4">
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
            <h1 className="text-2xl font-bold text-gray-900">シフト希望 締切日設定</h1>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          雇用形態ごとに、シフト希望の入力締切日（前月の何日 何時まで）を設定します。
          「有効」にチェックがついた雇用形態のスタッフは、締切を過ぎるとシフト希望を提出できません。
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded">
            <p className="text-green-800 text-sm">{successMessage}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <table className="w-full border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b">
                  雇用形態
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b">
                  締切日（前月）
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b">
                  締切時刻
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b">
                  有効
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b">
                  備考
                </th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-b w-24">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {employmentTypes.map(type => {
                const code = type.employment_code
                const row = rowsByCode[code] || {
                  deadline_day: DEFAULT_DEADLINE_DAY,
                  deadline_time: DEFAULT_DEADLINE_TIME,
                  is_enabled: false,
                  description: '',
                }
                return (
                  <tr key={code} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-800">
                      <div className="font-medium">{type.employment_name}</div>
                      <div className="text-xs text-gray-500">{code}</div>
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={row.deadline_day ?? ''}
                        onChange={e => updateRow(code, { deadline_day: e.target.value })}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                      <span className="ml-1 text-xs text-gray-500">日</span>
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <input
                        type="time"
                        value={row.deadline_time || ''}
                        onChange={e => updateRow(code, { deadline_time: e.target.value })}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!row.is_enabled}
                        onChange={e => updateRow(code, { is_enabled: e.target.checked })}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <input
                        type="text"
                        value={row.description || ''}
                        onChange={e => updateRow(code, { description: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        placeholder="運用メモ（任意）"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleSave(code)}
                        disabled={saving}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-gray-400"
                      >
                        <Save className="h-3.5 w-3.5" />
                        保存
                      </button>
                    </td>
                  </tr>
                )
              })}
              {employmentTypes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-500">
                    雇用形態が登録されていません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default DeadlineSettings
