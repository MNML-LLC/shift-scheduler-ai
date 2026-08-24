import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { MESSAGES } from './constants/messages'
import { getCurrentYear, getCurrentMonth } from './utils/dateUtils'
import './App.css'

// Context Providers
import { TenantProvider, useTenant } from './contexts/TenantContext'

// Screen Components
import FirstPlanEditor from './components/screens/shift/FirstPlanEditor'
import ShiftCreationMethodSelector from './components/screens/shift/ShiftCreationMethodSelector'
import LineShiftInput from './components/screens/shift/LineShiftInput'
import Monitoring from './components/screens/shift/Monitoring'
import StaffManagement from './components/screens/StaffManagement'
import StoreManagement from './components/screens/StoreManagement'
import ConstraintManagement from './components/screens/ConstraintManagement'
import ShiftDashboard from './components/screens/shift/ShiftDashboard'
import BudgetActualManagement from './components/screens/BudgetActualManagement'
import MasterDataManagement from './components/screens/MasterDataManagement'
import PreferencesSubmissionStatus from './components/screens/PreferencesSubmissionStatus'
import WorkHoursSummary from './components/screens/WorkHoursSummary'
import DevTools from './dev/DevTools'

// UI Components
import AppHeader from './components/shared/AppHeader'

// Repositories
import { ShiftRepository } from './infrastructure/repositories/ShiftRepository'

const shiftRepository = new ShiftRepository()

function AppContent() {
  const { tenantId } = useTenant()
  const navigate = useNavigate()
  const location = useLocation()

  const [currentStep, setCurrentStep] = useState(1)
  const [showStaffManagement, setShowStaffManagement] = useState(false)
  const [showStoreManagement, setShowStoreManagement] = useState(false)
  const [showConstraintManagement, setShowConstraintManagement] = useState(false)
  const [showShiftDashboard, setShowShiftDashboard] = useState(true)
  const [showDraftShiftEditor, setShowDraftShiftEditor] = useState(false)
  const [showShiftCreationMethodSelector, setShowShiftCreationMethodSelector] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [shiftStatus, setShiftStatus] = useState({
    [getCurrentMonth()]: 'not_started',
  })
  const [showLineMessages, setShowLineMessages] = useState(false)
  const [showMonitoring, setShowMonitoring] = useState(false)
  const [showBudgetActualManagement, setShowBudgetActualManagement] = useState(false)
  const [showMasterDataManagement, setShowMasterDataManagement] = useState(false)
  const [showPreferencesSubmissionStatus, setShowPreferencesSubmissionStatus] = useState(false)
  const [showWorkHoursSummary, setShowWorkHoursSummary] = useState(false)
  const [showDevTools, setShowDevTools] = useState(false)
  const [showTenantSettings, setShowTenantSettings] = useState(false)
  const [selectedShiftForEdit, setSelectedShiftForEdit] = useState(null)
  const [monitoringInitialMonth, setMonitoringInitialMonth] = useState(null) // Monitoring画面に渡す初期月
  const [monitoringInitialStoreId, setMonitoringInitialStoreId] = useState(null) // Monitoring画面に渡す初期店舗ID
  const [isCopyingFromPrevious, setIsCopyingFromPrevious] = useState(false) // Issue #45: 前月コピー実行中フラグ（二重送信防止）

  // 店舗フィルター
  const [selectedStore, setSelectedStore] = useState('all')
  const [availableStores, setAvailableStores] = useState([])

  // URLからステートを初期化
  useEffect(() => {
    const path = location.pathname

    // 全フラグをリセットしてから対象のフラグをセット
    const resetAllFlags = () => {
      setShowShiftDashboard(false)
      setShowStaffManagement(false)
      setShowStoreManagement(false)
      setShowConstraintManagement(false)
      setShowDraftShiftEditor(false)
      setShowShiftCreationMethodSelector(false)
      setShowLineMessages(false)
      setShowMonitoring(false)
      setShowBudgetActualManagement(false)
      setShowMasterDataManagement(false)
      setShowPreferencesSubmissionStatus(false)
      setShowWorkHoursSummary(false)
      setShowDevTools(false)
      setShowTenantSettings(false)
    }

    if (path === '/') {
      // トップページ → ShiftDashboard
      resetAllFlags()
      setShowShiftDashboard(true)
    } else if (path === '/staff') {
      resetAllFlags()
      setShowStaffManagement(true)
    } else if (path === '/store') {
      resetAllFlags()
      setShowStoreManagement(true)
    } else if (path === '/master') {
      resetAllFlags()
      setShowMasterDataManagement(true)
    } else if (path === '/budget-actual') {
      resetAllFlags()
      setShowBudgetActualManagement(true)
    } else if (path === '/shift/line') {
      resetAllFlags()
      setShowLineMessages(true)
    } else if (path === '/shift/monitoring') {
      resetAllFlags()
      setShowMonitoring(true)
    } else if (path === '/shift/preferences-submission-status') {
      resetAllFlags()
      setShowPreferencesSubmissionStatus(true)
    } else if (path === '/analytics/work-hours-summary') {
      resetAllFlags()
      setShowWorkHoursSummary(true)
    } else if (path === '/constraint') {
      resetAllFlags()
      setShowConstraintManagement(true)
    } else if (path === '/shift/draft-editor') {
      resetAllFlags()
      setShowDraftShiftEditor(true)
      // location.stateからシフト情報を取得
      if (location.state?.shift) {
        setSelectedShiftForEdit(location.state.shift)
      }
    } else if (path === '/shift/method') {
      resetAllFlags()
      setShowShiftCreationMethodSelector(true)
    } else if (path === '/dev-tools') {
      resetAllFlags()
      setShowDevTools(true)
    } else if (path === '/tenant-settings') {
      resetAllFlags()
      setShowTenantSettings(true)
    }
  }, [location.pathname])

  // ステートが変更されたらURLを更新
  useEffect(() => {
    if (showShiftDashboard) {
      navigate('/', { replace: true })
    } else if (showStaffManagement) {
      navigate('/staff', { replace: true })
    } else if (showStoreManagement) {
      navigate('/store', { replace: true })
    } else if (showMasterDataManagement) {
      navigate('/master', { replace: true })
    } else if (showBudgetActualManagement) {
      navigate('/budget-actual', { replace: true })
    } else if (showLineMessages) {
      navigate('/shift/line', { replace: true })
    } else if (showMonitoring) {
      navigate('/shift/monitoring', { replace: true })
    } else if (showPreferencesSubmissionStatus) {
      navigate('/shift/preferences-submission-status', { replace: true })
    } else if (showWorkHoursSummary) {
      navigate('/analytics/work-hours-summary', { replace: true })
    } else if (showConstraintManagement) {
      navigate('/constraint', { replace: true })
    } else if (showDraftShiftEditor) {
      navigate('/shift/draft-editor', { replace: true })
    } else if (showShiftCreationMethodSelector) {
      navigate('/shift/method', { replace: true })
    } else if (showDevTools) {
      navigate('/dev-tools', { replace: true })
    } else if (showTenantSettings) {
      navigate('/tenant-settings', { replace: true })
    } else if (
      !showShiftDashboard &&
      !showStaffManagement &&
      !showStoreManagement &&
      !showMasterDataManagement &&
      !showBudgetActualManagement &&
      !showLineMessages &&
      !showMonitoring &&
      !showConstraintManagement &&
      !showDraftShiftEditor &&
      !showShiftCreationMethodSelector &&
      !showDevTools &&
      !showTenantSettings &&
      !showPreferencesSubmissionStatus &&
      !showWorkHoursSummary &&
      currentStep === 1
    ) {
      navigate('/', { replace: true })
    }
  }, [
    showShiftDashboard,
    showStaffManagement,
    showStoreManagement,
    showMasterDataManagement,
    showBudgetActualManagement,
    showLineMessages,
    showMonitoring,
    showConstraintManagement,
    showDraftShiftEditor,
    showShiftCreationMethodSelector,
    showDevTools,
    showTenantSettings,
    showPreferencesSubmissionStatus,
    showWorkHoursSummary,
    currentStep,
    navigate,
  ])

  const goToStaffManagement = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。スタッフ管理に移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setMonitoringInitialMonth(null)
    setShowStaffManagement(true)
    setShowStoreManagement(false)
    setShowConstraintManagement(false)
    setShowDraftShiftEditor(false)
    setShowShiftCreationMethodSelector(false)
    setShowLineMessages(false)
    setShowMonitoring(false)
    setShowBudgetActualManagement(false)
    setShowMasterDataManagement(false)
    setShowTenantSettings(false)
  }

  const goToStoreManagement = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。店舗管理に移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setShowStoreManagement(true)
    setShowStaffManagement(false)
    setShowConstraintManagement(false)
    setShowLineMessages(false)
    setShowMonitoring(false)
    setShowBudgetActualManagement(false)
    setShowMasterDataManagement(false)
    setShowTenantSettings(false)
  }

  const goToConstraintManagement = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。制約管理に移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setShowConstraintManagement(true)
    setShowStaffManagement(false)
    setShowStoreManagement(false)
    setShowLineMessages(false)
    setShowMonitoring(false)
    setShowBudgetActualManagement(false)
    setShowMasterDataManagement(false)
    setShowTenantSettings(false)
  }

  const goToLineMessages = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。メッセージ画面に移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setShowLineMessages(true)
    setShowStaffManagement(false)
    setShowStoreManagement(false)
    setShowConstraintManagement(false)
    setShowMonitoring(false)
    setShowBudgetActualManagement(false)
    setShowMasterDataManagement(false)
  }

  const goToMonitoring = (initialData = null) => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。モニタリング画面に移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    // initialDataがオブジェクトの場合、monthとstoreIdを抽出
    if (initialData && typeof initialData === 'object') {
      setMonitoringInitialMonth(initialData)
      setMonitoringInitialStoreId(initialData.storeId || null)
    } else {
      // 後方互換性のため、nullまたは単純な値の場合は初期月のみ設定
      setMonitoringInitialMonth(initialData)
      setMonitoringInitialStoreId(null)
    }
    setShowMonitoring(true)
    setShowStaffManagement(false)
    setShowStoreManagement(false)
    setShowConstraintManagement(false)
    setShowLineMessages(false)
    setShowBudgetActualManagement(false)
    setShowMasterDataManagement(false)
  }

  const goToBudgetActualManagement = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。予実管理画面に移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setShowBudgetActualManagement(true)
    setShowMonitoring(false)
    setShowStaffManagement(false)
    setShowStoreManagement(false)
    setShowConstraintManagement(false)
    setShowLineMessages(false)
    setShowMasterDataManagement(false)
    setShowDevTools(false)
    setShowTenantSettings(false)
  }

  const goToPreferencesSubmissionStatus = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。提出状況ダッシュボードに移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setShowPreferencesSubmissionStatus(true)
    setShowShiftDashboard(false)
    setShowStaffManagement(false)
    setShowStoreManagement(false)
    setShowConstraintManagement(false)
    setShowLineMessages(false)
    setShowMonitoring(false)
    setShowBudgetActualManagement(false)
    setShowMasterDataManagement(false)
    setShowWorkHoursSummary(false)
    setShowDevTools(false)
    setShowTenantSettings(false)
  }

  const goToWorkHoursSummary = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。稼働時間ダッシュボードに移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setShowWorkHoursSummary(true)
    setShowShiftDashboard(false)
    setShowStaffManagement(false)
    setShowStoreManagement(false)
    setShowConstraintManagement(false)
    setShowLineMessages(false)
    setShowMonitoring(false)
    setShowBudgetActualManagement(false)
    setShowMasterDataManagement(false)
    setShowPreferencesSubmissionStatus(false)
    setShowDevTools(false)
    setShowTenantSettings(false)
  }

  const goToMasterDataManagement = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。マスターデータ管理に移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setShowMasterDataManagement(true)
    setShowBudgetActualManagement(false)
    setShowMonitoring(false)
    setShowStaffManagement(false)
    setShowStoreManagement(false)
    setShowConstraintManagement(false)
    setShowLineMessages(false)
    setShowDevTools(false)
    setShowTenantSettings(false)
  }

  const goToShiftDashboard = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。ダッシュボードに移動しますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }

    // 全てのフラグを確実にリセット
    setMonitoringInitialMonth(null)
    setShowShiftDashboard(true)
    setShowStaffManagement(false)
    setShowStoreManagement(false)
    setShowConstraintManagement(false)
    setShowDraftShiftEditor(false)
    setShowShiftCreationMethodSelector(false)
    setShowLineMessages(false)
    setShowMonitoring(false)
    setShowBudgetActualManagement(false)
    setShowMasterDataManagement(false)
    setShowPreferencesSubmissionStatus(false)
    setShowWorkHoursSummary(false)
    setShowDevTools(false)
    setShowTenantSettings(false)

    // ステップもリセット
    setCurrentStep(1)
  }

  const goToFirstPlanFromShiftMgmt = async shift => {
    // shiftオブジェクトから情報を取得
    const status = shift?.status || 'not_started'

    if (status === 'completed') {
      // 確定済みの場合は閲覧のみ
      alert(MESSAGES.INFO.VIEW_ONLY)
      return
    } else if ((status === 'APPROVED' && shift.planType === 'FIRST') || status === 'DRAFT') {
      // 第1案承認済みまたは下書きの場合はカレンダー表示・編集画面へ
      setSelectedShiftForEdit(shift)
      setShowDraftShiftEditor(true)
      setShowShiftCreationMethodSelector(false)
    } else {
      // 未作成の場合は作成方法選択画面へ
      setSelectedShiftForEdit(shift)
      setShowShiftCreationMethodSelector(true)
      setShowDraftShiftEditor(false)
    }
  }

  const backToShiftManagementFromDraft = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('変更が保存されていません。ダッシュボードに戻りますか？')) {
        return
      }
      setHasUnsavedChanges(false)
    }
    setShowDraftShiftEditor(false)
    setShowShiftDashboard(true)
  }

  const handleDeleteShiftPlan = () => {
    // シフト削除後の処理
    setHasUnsavedChanges(false)
    setShowDraftShiftEditor(false)
    setShowShiftDashboard(true)
  }

  const backToShiftManagementFromMethodSelector = () => {
    setShowShiftCreationMethodSelector(false)
    setShowShiftDashboard(true)
  }

  // Issue #45: 前月シフトからのコピー実行
  // 404/409 を含むエラーを分岐処理し、成功時は inserted_shifts_count を表示する。
  // overwrite=true の場合は既存 FIRST 案を削除して再作成する（409 リトライ用）。
  const runCopyFromPreviousMonth = async ({
    storeId,
    targetYear,
    targetMonth,
    transitionToDraftEditor = false,
    overwrite = false,
  }) => {
    setIsCopyingFromPrevious(true)
    try {
      const result = await shiftRepository.copyFromPreviousMonth({
        store_id: storeId,
        target_year: targetYear,
        target_month: targetMonth,
        created_by: 1,
        tenantId,
        overwrite,
      })

      const insertedCount =
        result.inserted_shifts_count ??
        result.data?.inserted_shifts_count ??
        result.data?.inserted_count ??
        0

      alert(`${insertedCount}件のシフトをコピーしました`)

      if (transitionToDraftEditor) {
        setShowShiftCreationMethodSelector(false)
        setShowDraftShiftEditor(true)
      }

      return { ok: true, insertedCount }
    } catch (error) {
      if (error.status === 404) {
        alert('前月の確定シフトが見つかりません')
        return { ok: false, status: 404 }
      }
      if (error.status === 409) {
        if (
          window.confirm(
            '同月の第1案が既に存在します。上書きしてもよろしいですか？（既存のシフトは削除されます）'
          )
        ) {
          return runCopyFromPreviousMonth({
            storeId,
            targetYear,
            targetMonth,
            transitionToDraftEditor,
            overwrite: true,
          })
        }
        return { ok: false, status: 409 }
      }
      console.error('[前月コピー] エラー:', error)
      alert(`前月コピー中にエラーが発生しました: ${error.message}`)
      return { ok: false, status: error.status || 500 }
    } finally {
      setIsCopyingFromPrevious(false)
    }
  }

  const handleSelectCreationMethod = async methodId => {
    // 作成方法選択後の処理
    if (methodId === 'copy') {
      if (isCopyingFromPrevious) return

      const year = selectedShiftForEdit?.year || getCurrentYear()
      const month = selectedShiftForEdit?.month || getCurrentMonth()
      const storeId = selectedShiftForEdit?.storeId || selectedShiftForEdit?.store_id || 1

      // 確認ダイアログ
      if (!window.confirm('前月の確定シフトを当月の第1案としてコピーします。よろしいですか？')) {
        return
      }

      await runCopyFromPreviousMonth({
        storeId,
        targetYear: year,
        targetMonth: month,
        transitionToDraftEditor: true,
      })
    } else if (methodId === 'csv') {
      // CSVインポート -> 下書き編集画面に遷移
      setShowShiftCreationMethodSelector(false)
      setShowDraftShiftEditor(true)
    }
  }

  const approveFirstPlan = () => {
    // 第1案を仮承認してダッシュボードに戻る
    const targetMonth = selectedShiftForEdit?.month ?? getCurrentMonth()
    setShiftStatus({ ...shiftStatus, [targetMonth]: 'first_plan_approved' })
    setHasUnsavedChanges(false)
    setShowDraftShiftEditor(false)
    setShowShiftDashboard(true)
    setShowBudgetActualManagement(false)
  }

  const renderCurrentScreen = () => {
    // ShiftDashboard（新トップ画面）
    if (showShiftDashboard) {
      return <ShiftDashboard onStaffManagement={goToStaffManagement} />
    }

    if (showStaffManagement) {
      return (
        <StaffManagement
          onHome={goToShiftDashboard}
          onShiftManagement={goToShiftDashboard}
          onLineMessages={goToLineMessages}
          onMonitoring={goToMonitoring}
          onStaffManagement={goToStaffManagement}
          onStoreManagement={goToStoreManagement}
          onConstraintManagement={goToConstraintManagement}
          onBudgetActualManagement={goToBudgetActualManagement}
        />
      )
    }

    if (showStoreManagement) {
      return (
        <StoreManagement
          onHome={goToShiftDashboard}
          onShiftManagement={goToShiftDashboard}
          onLineMessages={goToLineMessages}
          onMonitoring={goToMonitoring}
          onStaffManagement={goToStaffManagement}
          onStoreManagement={goToStoreManagement}
          onConstraintManagement={goToConstraintManagement}
          onBudgetActualManagement={goToBudgetActualManagement}
        />
      )
    }

    if (showConstraintManagement) {
      return (
        <ConstraintManagement
          onHome={goToShiftDashboard}
          onShiftManagement={goToShiftDashboard}
          onLineMessages={goToLineMessages}
          onMonitoring={goToMonitoring}
          onStaffManagement={goToStaffManagement}
          onStoreManagement={goToStoreManagement}
          onConstraintManagement={goToConstraintManagement}
          onBudgetActualManagement={goToBudgetActualManagement}
        />
      )
    }

    if (showLineMessages) {
      return (
        <LineShiftInput
          shiftStatus={shiftStatus}
          onHome={goToShiftDashboard}
          onShiftManagement={goToShiftDashboard}
          onLineMessages={goToLineMessages}
          onMonitoring={goToMonitoring}
          onStaffManagement={goToStaffManagement}
          onStoreManagement={goToStoreManagement}
          onConstraintManagement={goToConstraintManagement}
          onBudgetActualManagement={goToBudgetActualManagement}
        />
      )
    }

    if (showMonitoring) {
      return (
        <Monitoring
          onHome={goToShiftDashboard}
          onShiftManagement={goToShiftDashboard}
          onLineMessages={goToLineMessages}
          onMonitoring={goToMonitoring}
          onStaffManagement={goToStaffManagement}
          onStoreManagement={goToStoreManagement}
          onConstraintManagement={goToConstraintManagement}
          onBudgetActualManagement={goToBudgetActualManagement}
          initialMonth={monitoringInitialMonth}
          initialStoreId={monitoringInitialStoreId}
        />
      )
    }

    if (showBudgetActualManagement) {
      return (
        <BudgetActualManagement
          onHome={goToShiftDashboard}
          onShiftManagement={goToShiftDashboard}
          onLineMessages={goToLineMessages}
          onMonitoring={goToMonitoring}
          onStaffManagement={goToStaffManagement}
          onStoreManagement={goToStoreManagement}
          onConstraintManagement={goToConstraintManagement}
          onBudgetActualManagement={goToBudgetActualManagement}
        />
      )
    }

    if (showMasterDataManagement) {
      return <MasterDataManagement onPrev={goToShiftDashboard} />
    }

    if (showPreferencesSubmissionStatus) {
      return <PreferencesSubmissionStatus />
    }

    if (showWorkHoursSummary) {
      return <WorkHoursSummary />
    }

    if (showDevTools) {
      return (
        <DevTools
          targetYear={getCurrentYear()}
          targetMonth={getCurrentMonth()}
          onHome={goToShiftDashboard}
          onShiftManagement={goToShiftDashboard}
          onLineMessages={goToLineMessages}
          onMonitoring={goToMonitoring}
          onStaffManagement={goToStaffManagement}
          onStoreManagement={goToStoreManagement}
          onConstraintManagement={goToConstraintManagement}
          onBudgetActualManagement={goToBudgetActualManagement}
        />
      )
    }

    if (showShiftCreationMethodSelector) {
      return (
        <ShiftCreationMethodSelector
          selectedShift={selectedShiftForEdit}
          onBack={backToShiftManagementFromMethodSelector}
          onSelectMethod={handleSelectCreationMethod}
        />
      )
    }

    if (showDraftShiftEditor) {
      return (
        <FirstPlanEditor
          selectedShift={selectedShiftForEdit}
          onBack={backToShiftManagementFromDraft}
          onApprove={approveFirstPlan}
          onDelete={handleDeleteShiftPlan}
        />
      )
    }

    // デフォルト画面はShiftDashboard（showShiftDashboardは初期値trueなのでここに来ることはないはず）
    return <ShiftDashboard onStaffManagement={goToStaffManagement} />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex flex-col overflow-x-hidden w-full max-w-full">
      <AppHeader
        onHome={goToShiftDashboard}
        onShiftManagement={goToShiftDashboard}
        onLineMessages={goToLineMessages}
        onMonitoring={goToMonitoring}
        onStaffManagement={goToStaffManagement}
        onStoreManagement={goToStoreManagement}
        onConstraintManagement={goToConstraintManagement}
        onBudgetActualManagement={goToBudgetActualManagement}
        onMasterDataManagement={goToMasterDataManagement}
        onPreferencesSubmissionStatus={goToPreferencesSubmissionStatus}
        onWorkHoursSummary={goToWorkHoursSummary}
      />
      <div className="flex-1 overflow-x-hidden w-full max-w-full">
        <AnimatePresence mode="wait">
          <div
            key={
              showShiftDashboard
                ? 'shift-dashboard'
                : showStaffManagement
                  ? 'staff-management'
                  : showStoreManagement
                    ? 'store-management'
                    : showConstraintManagement
                      ? 'constraint-management'
                      : showShiftCreationMethodSelector
                        ? 'shift-creation-method-selector'
                        : showDraftShiftEditor
                          ? 'draft-shift-editor'
                          : showBudgetActualManagement
                            ? 'budget-actual-management'
                            : showMasterDataManagement
                              ? 'master-data-management'
                              : currentStep
            }
          >
            {renderCurrentScreen()}
          </div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function App() {
  return (
    <TenantProvider>
      <AppContent />
    </TenantProvider>
  )
}

export default App
