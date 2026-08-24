/**
 * ShiftDashboard.jsx
 * 新しいトップ画面コンポーネント
 *
 * 構成:
 * - Sidebar（左）: 年月選択 + ナビゲーション
 * - メインエリア（右）: 3カード（募集状況、第一案、第二案）
 */

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Menu, Copy, Loader2 } from 'lucide-react'
import { useTargetMonth } from '../../../hooks/useTargetMonth'
import { useShiftStatus } from '../../../hooks/useShiftStatus'
import { useIsMobile } from '../../../hooks/use-mobile'
import { BACKEND_API_URL } from '../../../config/api'
import { ShiftRepository } from '../../../infrastructure/repositories/ShiftRepository'
import { MasterRepository } from '../../../infrastructure/repositories/MasterRepository'
import Sidebar from '../../Sidebar'
import ShiftStatusCards from '../../ShiftStatusCards'
import { LoadingSpinner } from '../../ui/LoadingSpinner'

const shiftRepository = new ShiftRepository()
const masterRepository = new MasterRepository()

/**
 * シフトダッシュボードコンポーネント
 * @param {Object} props
 * @param {Function} props.onStaffManagement - スタッフ管理画面への遷移コールバック（App.jsxから渡される）
 */
const ShiftDashboard = ({ onStaffManagement }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { targetMonth } = useTargetMonth()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // 遷移元からの年月情報を取得（ある場合はそれを使用）
  const stateYear = location.state?.year
  const stateMonth = location.state?.month

  // 選択中の年月（遷移元からの年月があればそれを優先）
  const [selectedYear, setSelectedYear] = useState(
    stateYear ? parseInt(stateYear) : targetMonth.year
  )
  const [selectedMonth, setSelectedMonth] = useState(
    stateMonth ? parseInt(stateMonth) : targetMonth.month
  )

  // 環境情報
  const [backendEnv, setBackendEnv] = useState(null)
  const [dbEnv, setDbEnv] = useState(null)

  // Issue #45: 前月シフトからのコピー実行中フラグ（二重送信防止）
  const [isCopying, setIsCopying] = useState(false)

  // シフトステータス取得
  const {
    loading,
    recruitmentStatus,
    firstPlanStatus,
    secondPlanStatus,
    submissionStats,
    refetch,
  } = useShiftStatus(selectedYear, selectedMonth)

  // recruitmentStatusにsubmissionStatsをマージ
  const recruitmentStatusWithStats = {
    ...recruitmentStatus,
    ...submissionStats,
  }

  // ページに戻ってきた時にデータをリフレッシュ
  useEffect(() => {
    refetch()
  }, [location.key])

  // 環境情報を取得
  useEffect(() => {
    const fetchHealthInfo = async () => {
      try {
        const response = await fetch(`${BACKEND_API_URL}/api/health`)
        const data = await response.json()
        if (data.success) {
          setBackendEnv(data.backend.environment)
          setDbEnv(data.database.environment)
        }
      } catch (error) {
        console.error('Failed to fetch health info:', error)
      }
    }
    fetchHealthInfo()
  }, [])

  // 環境判定
  const getEnvironment = () => {
    const hostname = window.location.hostname
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return { name: 'LOCAL', color: 'blue' }
    } else if (hostname.includes('stg') || hostname.includes('staging')) {
      return { name: 'STG', color: 'yellow' }
    } else {
      return { name: 'PRD', color: 'green' }
    }
  }

  const environment = getEnvironment()

  /**
   * 月選択ハンドラ
   */
  const handleMonthSelect = (year, month) => {
    setSelectedYear(year)
    setSelectedMonth(month)
  }

  /**
   * 募集状況カードクリック → Monitoring へ遷移
   */
  const handleRecruitmentClick = () => {
    navigate('/shift/monitoring', {
      state: {
        shift: { year: selectedYear, month: selectedMonth },
      },
    })
  }

  /**
   * 第一案カードクリック → FirstPlanEditor へ遷移（旧画面と同じ動作）
   */
  const handleFirstPlanClick = async () => {
    const status =
      firstPlanStatus.status === 'approved'
        ? 'APPROVED'
        : firstPlanStatus.status === 'draft'
          ? 'DRAFT'
          : 'not_started'

    // プランが存在しない場合は前月データを取得してから遷移
    if (status === 'not_started' && !firstPlanStatus.planId) {
      try {
        const result = await shiftRepository.fetchPreviousDataAllStores({
          target_year: selectedYear,
          target_month: selectedMonth,
        })

        if (result.success && result.data?.stores) {
          const shift = {
            year: selectedYear,
            month: selectedMonth,
            planId: null,
            planType: 'FIRST',
            status: 'unsaved', // FirstPlanEditorのhandleApproveで正しく処理されるようにする
            initialData: {
              stores: result.data.stores,
            },
          }
          navigate('/shift/draft-editor', { state: { shift } })
        } else {
          alert('前月のデータが見つかりませんでした。')
        }
      } catch (error) {
        console.error('前月データ取得エラー:', error)
        alert('前月データの取得に失敗しました。')
      }
      return
    }

    // 既存のプランがある場合は通常遷移
    const shift = {
      year: selectedYear,
      month: selectedMonth,
      planId: firstPlanStatus.planId,
      planType: 'FIRST',
      status,
    }

    navigate('/shift/draft-editor', { state: { shift } })
  }

  /**
   * 第二案カードクリック → SecondPlanEditor へ遷移
   */
  const handleSecondPlanClick = () => {
    if (secondPlanStatus.status === 'unavailable') return

    navigate('/shift/second-plan', {
      state: {
        shift: {
          year: selectedYear,
          month: selectedMonth,
          planId: secondPlanStatus.planId,
          planType: 'SECOND',
          status:
            secondPlanStatus.status === 'approved'
              ? 'APPROVED'
              : secondPlanStatus.status === 'draft'
                ? 'DRAFT'
                : 'not_started',
        },
      },
    })
  }

  /**
   * スタッフ管理クリック
   */
  const handleStaffManagement = () => {
    if (onStaffManagement) {
      onStaffManagement()
    } else {
      navigate('/staff')
    }
  }

  const handleMobileMonthSelect = (year, month) => {
    handleMonthSelect(year, month)
    setSidebarOpen(false)
  }

  const handleMobileStaffManagement = () => {
    setSidebarOpen(false)
    handleStaffManagement()
  }

  const handleMobileMasterManagement = () => {
    setSidebarOpen(false)
    navigate('/master')
  }

  const handleMobileDeadlineSettings = () => {
    setSidebarOpen(false)
    navigate('/deadline-settings')
  }

  /**
   * Issue #45: 前月シフトからのコピーを全店舗に実行
   * 確認ダイアログ → 全アクティブ店舗ごとに copy-from-previous を呼ぶ →
   * 集計結果（成功件数・404・409・失敗）を alert で表示。
   */
  const handleCopyFromPreviousMonth = async () => {
    if (isCopying) return

    if (
      !window.confirm(
        `${selectedYear}年${selectedMonth}月の第1案を前月の確定シフトからコピーします。よろしいですか？`
      )
    ) {
      return
    }

    setIsCopying(true)
    try {
      const stores = await masterRepository.getStores()
      const activeStores = (stores || []).filter(s => s.is_active !== false)
      if (activeStores.length === 0) {
        alert('アクティブな店舗が見つかりません')
        return
      }

      let totalInserted = 0
      const notFoundStores = []
      const conflictStores = []
      const errorStores = []

      for (const store of activeStores) {
        try {
          const result = await shiftRepository.copyFromPreviousMonth({
            store_id: store.store_id,
            target_year: selectedYear,
            target_month: selectedMonth,
            created_by: 1,
          })
          const inserted =
            result.inserted_shifts_count ??
            result.data?.inserted_shifts_count ??
            result.data?.inserted_count ??
            0
          totalInserted += inserted
        } catch (err) {
          if (err.status === 404) {
            notFoundStores.push(store.store_name || store.store_id)
          } else if (err.status === 409) {
            conflictStores.push(store.store_name || store.store_id)
          } else {
            errorStores.push({ name: store.store_name || store.store_id, message: err.message })
          }
        }
      }

      let message = `${totalInserted}件のシフトをコピーしました`
      if (notFoundStores.length > 0) {
        message += `\n\n前月の確定シフトが見つかりません:\n・${notFoundStores.join('\n・')}`
      }
      if (conflictStores.length > 0) {
        message += `\n\n同月の第1案が既に存在します（スキップ）:\n・${conflictStores.join('\n・')}`
      }
      if (errorStores.length > 0) {
        message += `\n\nエラー:\n${errorStores.map(e => `・${e.name}: ${e.message}`).join('\n')}`
      }
      alert(message)

      refetch()
    } catch (err) {
      console.error('前月コピーエラー:', err)
      alert(`前月コピー中にエラーが発生しました: ${err.message}`)
    } finally {
      setIsCopying(false)
    }
  }

  return (
    <div className="flex h-screen">
      {/* サイドバー（デスクトップ: 常時表示 / モバイル: ドロワー） */}
      {!isMobile && (
        <Sidebar
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          onMonthSelect={handleMonthSelect}
          onStaffManagement={handleStaffManagement}
          onMasterManagement={() => navigate('/master')}
          onDeadlineSettings={() => navigate('/deadline-settings')}
          currentPath="/"
        />
      )}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[80vw] shadow-xl flex-shrink-0">
            <Sidebar
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              onMonthSelect={handleMobileMonthSelect}
              onStaffManagement={handleMobileStaffManagement}
              onMasterManagement={handleMobileMasterManagement}
              onDeadlineSettings={handleMobileDeadlineSettings}
              currentPath="/"
            />
          </div>
          <div
            className="flex-1 bg-black/50"
            onClick={() => setSidebarOpen(false)}
            aria-label="サイドバーを閉じる"
          />
        </div>
      )}

      {/* メインコンテンツ */}
      <main className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
        {/* モバイル用トップバー */}
        {isMobile && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded hover:bg-slate-100"
              aria-label="メニューを開く"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-medium text-sm">シフト管理</span>
          </div>
        )}

        {/* ヘッダー */}
        <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h1 className="text-lg md:text-2xl font-bold text-slate-900">
                {selectedYear}年{selectedMonth}月 シフト管理
              </h1>
              <p className="text-slate-600 text-xs md:text-sm">対象月のシフト作成・管理</p>
            </div>
            {/* Issue #45: 前月シフトからコピーボタン */}
            <button
              type="button"
              onClick={handleCopyFromPreviousMonth}
              disabled={isCopying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs md:text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
              title="前月の確定シフトを当月の第1案としてコピーします"
            >
              {isCopying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {isCopying ? 'コピー中...' : '前月シフトからコピー'}
            </button>
            {/* 環境表示 */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium ${
                environment.color === 'green'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : environment.color === 'yellow'
                    ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                    : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}
            >
              <div
                className={`h-2 w-2 rounded-full ${
                  environment.color === 'green'
                    ? 'bg-green-500'
                    : environment.color === 'yellow'
                      ? 'bg-yellow-500'
                      : 'bg-blue-500'
                }`}
              />
              <span className="font-semibold">{environment.name}</span>
              {backendEnv && (
                <span className="text-[10px] opacity-70 ml-1">
                  FE:{environment.name} → BE:{backendEnv}
                  {dbEnv && ` → DB:${dbEnv}`}
                </span>
              )}
            </div>
          </div>
        </header>

        {/* カードエリア */}
        <div className="flex-1 p-4 md:p-6 overflow-auto flex items-center justify-center">
          {loading ? (
            <LoadingSpinner size="lg" />
          ) : (
            <ShiftStatusCards
              recruitmentStatus={recruitmentStatusWithStats}
              firstPlanStatus={firstPlanStatus}
              secondPlanStatus={secondPlanStatus}
              onRecruitmentClick={handleRecruitmentClick}
              onFirstPlanClick={handleFirstPlanClick}
              onSecondPlanClick={handleSecondPlanClick}
            />
          )}
        </div>
      </main>
    </div>
  )
}

export default ShiftDashboard
