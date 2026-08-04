import { useState, useEffect } from 'react'
import { MESSAGES } from '../../../constants/messages'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../../ui/button'
import {
  CheckCircle,
  Loader2,
  Save,
  Trash2,
  Download,
  Maximize2,
  Minimize2,
  X,
  Home,
  Printer,
} from 'lucide-react'
import { Rnd } from 'react-rnd'
import MultiStoreShiftTable from '../../shared/MultiStoreShiftTable'
import ShiftTableView from '../../shared/ShiftTableView'
import TimeInput from '../../shared/TimeInput'
import { ShiftRepository } from '../../../infrastructure/repositories/ShiftRepository'
import { MasterRepository } from '../../../infrastructure/repositories/MasterRepository'
import { useShiftPlanEditor } from '../../../hooks/useShiftPlanEditor'
import { useIsMobile } from '../../../hooks/use-mobile'
import { getCurrentTenantId } from '../../../config/tenant'

const shiftRepository = new ShiftRepository()
const masterRepository = new MasterRepository()

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  in: { opacity: 1, y: 0 },
  out: { opacity: 0, y: -20 },
}

const pageTransition = {
  type: 'tween',
  ease: 'anticipate',
  duration: 0.5,
}

/**
 * シフト編集・閲覧画面（統合版）
 * - 既存のシフトをカレンダー表示
 * - 日付クリックで詳細表示・編集（editモード時のみ）
 * - 第1案/第2案の承認ボタン（editモード時のみ）
 * - 削除ボタン（editモード時のみ）
 *
 * @param {string} mode - 'view' (閲覧) または 'edit' (編集) デフォルト: 'edit'
 * @param {string} planType - 'FIRST' または 'SECOND'
 * @param {number|null} storeId - 店舗ID（nullの場合は全店舗表示）
 */
const FirstPlanEditor = ({
  selectedShift,
  onBack,
  onApprove,
  onDelete,
  onStatusChange, // 保存後の状態更新コールバック
  mode = 'edit', // 'view' or 'edit'
}) => {
  const isMobile = useIsMobile()

  // 共通フックを使用
  const editor = useShiftPlanEditor({
    planType: 'FIRST',
    selectedShift,
    onBack,
    onApprove,
    onDelete,
    mode,
  })

  // 共通フックから取得（状態）
  const {
    loading,
    setLoading,
    calendarData,
    setCalendarData,
    selectedDay,
    setSelectedDay,
    selectedStoreId,
    setSelectedStoreId,
    dayShifts,
    setDayShifts,
    hasSavedDraft,
    setHasSavedDraft,
    windowState,
    setWindowState,
    shiftData,
    setShiftData,
    defaultPatternId,
    setDefaultPatternId,
    preferences,
    shiftPatterns,
    setShiftPatterns,
    year,
    month,
    planId,
    planType,
    isViewMode,
    isEditMode,
    preferencesMap,
    timeOverlapInfo,
    // マスタデータ
    staffMap,
    storesMap,
    availableStores,
    selectedStores,
    loadMasterData,
    setSelectedStores,
    // シフト編集
    addedShifts,
    hasUnsavedChanges,
    saving,
    planIds: planIdsState,
    modalState,
    setPlanId: setPlanIdsState,
    handleModifyShift,
    saveChanges,
    setModalState,
    resetChanges,
    setHasUnsavedChanges,
    allowNavigation,
    // ベース関数（ローカルでラップする用）
    handleDeleteShiftBase,
    handleAddShiftBase,
    // ナビゲーション
    navigate,
    navigateToDashboard,
    handleDashboard,
    // ハンドラー（共通）- ローカルで上書きしないものはここから使用
    handleDayClick,
    handleMaximize,
    handleBack,
    handleDelete,
    handleExportCSV,
    // ヘルパー
    updateCalendarData,
  } = editor

  // FirstPlanEditor特有のデータ読み込み
  useEffect(() => {
    // initialDataがある場合はそれを使用、ない場合はDBからロード
    if (selectedShift?.initialData) {
      loadInitialData(selectedShift.initialData)
    } else if (planId || (year && month && planType)) {
      loadShiftData()
    }
  }, [planId, year, month, planType, selectedShift?.initialData])

  const loadInitialData = async initialData => {
    try {
      setLoading(true)

      // マスタデータを取得
      const { staffMapping } = await loadMasterData()

      // initialDataからシフトデータを抽出（全店舗分）
      const allShifts = []
      const extractedPlanIds = new Set() // 全店舗のplan_idを収集
      let tempIdCounter = 0
      initialData.stores.forEach(store => {
        store.shifts.forEach(shift => {
          // plan_idを収集
          if (shift.plan_id) {
            extractedPlanIds.add(shift.plan_id)
          }
          const staffInfo = staffMapping[shift.staff_id] || { name: '不明', role_name: 'スタッフ' }
          // shift_idがない場合は一時的なIDを生成
          const shiftId = shift.shift_id || `init_${Date.now()}_${tempIdCounter++}`
          allShifts.push({
            ...shift,
            shift_id: shiftId,
            staff_name: staffInfo.name,
            role: staffInfo.role_name,
            modified_flag: false,
          })
        })
      })

      // plan_idsを状態に保存（全店舗分）
      if (extractedPlanIds.size > 0) {
        setPlanIdsState([...extractedPlanIds])
      }

      // 日付別にグループ化
      const shiftsByDate = {}
      allShifts.forEach(shift => {
        const date = new Date(shift.shift_date)
        const day = date.getDate()

        if (!shiftsByDate[day]) {
          shiftsByDate[day] = []
        }

        shiftsByDate[day].push(shift)
      })

      // 月の情報を計算
      const date = new Date(year, month - 1, 1)
      const daysInMonth = new Date(year, month, 0).getDate()
      const firstDay = date.getDay()

      setCalendarData({
        daysInMonth,
        firstDay,
        shiftsByDate,
        year,
        month,
      })

      setShiftData(allShifts)

      // 希望シフトは取得しない（第一案は前月コピーなので不要）

      // シフトパターンマスタを取得
      try {
        const patterns = await masterRepository.getShiftPatterns()
        setShiftPatterns(patterns)
      } catch (error) {
        console.error('シフトパターン取得エラー:', error)
      }

      setLoading(false)
    } catch (err) {
      console.error('initialData読み込みエラー:', err)
      setLoading(false)
      alert('初期データの読み込みに失敗しました')
    }
  }

  const loadShiftData = async () => {
    try {
      setLoading(true)

      // シフトデータとプランデータを並列取得
      // プランデータを直接取得することで、shifts 0件でもplanIdを取得可能
      const [shiftsResult, plansResult] = await Promise.all([
        shiftRepository.getShifts({ year, month, plan_type: planType }),
        shiftRepository.getPlans({ year, month }),
      ])

      // シフトデータからpattern_idを取得（最初のシフトから使用）
      const fetchedPatternId = shiftsResult.length > 0 ? shiftsResult[0].pattern_id : null

      // shift_plansから直接planIdsを取得（shiftsが0件でも取得可能）
      const firstPlans = plansResult.filter(p => p.plan_type === 'FIRST')
      const fetchedPlanIds = firstPlans.map(p => p.plan_id)

      // ステートに保存
      setDefaultPatternId(fetchedPatternId)
      setPlanIdsState(fetchedPlanIds)

      // マスタデータを取得（カスタムhook経由）
      const { staffMapping } = await loadMasterData()

      // 日付別にグループ化
      const shiftsByDate = {}
      shiftsResult.forEach(shift => {
        const date = new Date(shift.shift_date)
        const day = date.getDate()

        if (!shiftsByDate[day]) {
          shiftsByDate[day] = []
        }

        const staffInfo = staffMapping[shift.staff_id] || { name: '不明', role_name: 'スタッフ' }
        shiftsByDate[day].push({
          ...shift,
          staff_name: staffInfo.name,
          role: staffInfo.role_name,
          modified_flag: false,
        })
      })

      // 月の情報を計算
      const date = new Date(year, month - 1, 1)
      const daysInMonth = new Date(year, month, 0).getDate()
      const firstDay = date.getDay()

      setCalendarData({
        daysInMonth,
        firstDay,
        shiftsByDate,
        year,
        month,
      })

      // シフトデータを保存（StaffTimeTable用）
      setShiftData(
        shiftsResult.map(shift => ({
          ...shift,
          staff_name: staffMapping[shift.staff_id]?.name || '不明',
          role: staffMapping[shift.staff_id]?.role_name || 'スタッフ',
          modified_flag: false, // DBから取得したシフトは未変更
        }))
      )

      // 希望シフトは取得しない（第一案は前月コピーなので不要）

      // シフトパターンマスタを取得
      try {
        const patterns = await masterRepository.getShiftPatterns()
        setShiftPatterns(patterns)
      } catch (error) {
        console.error('シフトパターン取得エラー:', error)
      }

      // DB読み込み完了後は未保存変更なし状態にリセット
      resetChanges()

      setLoading(false)
    } catch (err) {
      console.error('データ読み込みエラー:', err)
      setLoading(false)
      alert(MESSAGES.ERROR.SHIFT_DATA_LOAD_FAILED)
    }
  }

  // 日表示を閉じる
  const closeDayView = () => {
    setSelectedDay(null)
    setSelectedStoreId(null)
    setDayShifts([])
  }

  // 下書き保存ハンドラー（FirstPlanEditor特有：unsaved状態からの保存処理）
  const handleSaveDraft = async () => {
    if (!confirm('下書きを保存しますか？')) {
      return
    }

    try {
      // initialDataから作成された未保存データの場合（特殊ケース）
      if (selectedShift?.status === 'unsaved' && selectedShift?.initialData) {
        // 現在表示中のシフトデータ（削除・追加を反映済み）を店舗ごとにグループ化
        const storeShiftsMap = {}
        shiftData.forEach(shift => {
          if (!storeShiftsMap[shift.store_id]) {
            storeShiftsMap[shift.store_id] = []
          }
          storeShiftsMap[shift.store_id].push({
            staff_id: shift.staff_id,
            shift_date: shift.shift_date,
            pattern_id: shift.pattern_id,
            start_time: shift.start_time,
            end_time: shift.end_time,
            break_minutes: shift.break_minutes || 0,
          })
        })

        // 店舗情報を保持しつつ、現在のシフトデータで上書き
        const mergedStores = selectedShift.initialData.stores.map(store => ({
          ...store,
          shifts: storeShiftsMap[store.store_id] || [],
        }))

        // メモリ上のデータをDBに保存（addedShiftsをマージ）
        const result = await shiftRepository.createPlansWithShifts({
          target_year: year,
          target_month: month,
          created_by: 1, // TODO: 実際のユーザーIDに置き換え
          stores: mergedStores,
          plan_type: 'FIRST',
        })

        // エラーチェック: success=trueでもerrorsがある場合やcreated_plansが空の場合はエラー
        if (result.data?.errors?.length > 0) {
          console.error('プラン作成でエラーが発生しました:', result.data.errors)
          const errorMessages = result.data.errors
            .map(e => `店舗${e.store_id}: ${e.error}`)
            .join('\n')
          throw new Error(`プラン作成でエラーが発生しました:\n${errorMessages}`)
        }

        if (!result.success || !result.data?.created_plans?.length) {
          throw new Error('プランの作成に失敗しました。作成されたプランがありません。')
        }

        setHasSavedDraft(true)
        alert(MESSAGES.SUCCESS.SAVED)

        // 親コンポーネントに状態変更を通知（DRAFT状態、作成されたplan_id）
        const createdPlanIds = result.data.created_plans.map(p => p.plan_id)
        if (onStatusChange) {
          onStatusChange('DRAFT', createdPlanIds)
        }

        // 新規プラン作成後はトップ画面に戻る（ブロッカーをスキップ）
        allowNavigation()
        navigateToDashboard()
      } else {
        // 既存のプラン編集の場合 - 共通フックを使用
        if (!hasUnsavedChanges) {
          alert(MESSAGES.SUCCESS.NO_CHANGES)
          return
        }

        // 共通フックの保存処理を使用
        const result = await saveChanges()

        if (result.success) {
          setHasSavedDraft(true)
          alert(MESSAGES.SUCCESS.SAVED)
          // データをリロードして最新の状態を表示
          await loadShiftData()
        } else {
          throw new Error(result.message)
        }
      }
    } catch (error) {
      console.error('下書き保存エラー:', error)
      alert(`下書きの保存に失敗しました\n\nエラー: ${error.message}`)
    }
  }

  // 承認ハンドラー（共通フックを使用）
  const handleApprove = async () => {
    // initialDataから作成された未保存データの場合（特殊ケース）
    if (selectedShift?.status === 'unsaved' && selectedShift?.initialData) {
      if (!confirm('第1案を承認しますか？承認後は第2案の作成に進めます。')) {
        return
      }

      try {
        // 現在表示中のシフトデータ（削除・追加を反映済み）を店舗ごとにグループ化
        const storeShiftsMap = {}
        shiftData.forEach(shift => {
          if (!storeShiftsMap[shift.store_id]) {
            storeShiftsMap[shift.store_id] = []
          }
          storeShiftsMap[shift.store_id].push({
            staff_id: shift.staff_id,
            shift_date: shift.shift_date,
            pattern_id: shift.pattern_id,
            start_time: shift.start_time,
            end_time: shift.end_time,
            break_minutes: shift.break_minutes || 0,
          })
        })

        // 店舗情報を保持しつつ、現在のシフトデータで上書き
        const storesToSave = selectedShift.initialData.stores.map(store => ({
          ...store,
          shifts: storeShiftsMap[store.store_id] || [],
        }))

        // メモリ上のデータをDBに保存
        const createResult = await shiftRepository.createPlansWithShifts({
          target_year: year,
          target_month: month,
          created_by: 1,
          stores: storesToSave,
          plan_type: 'FIRST',
        })

        if (createResult.success) {
          // 作成されたプランIDを取得してAPPROVEDに更新
          const createdPlanIds = createResult.data.created_plans.map(p => p.plan_id)
          for (const id of createdPlanIds) {
            await shiftRepository.updatePlanStatus(id, 'APPROVED')
          }

          setHasSavedDraft(true)
          alert(MESSAGES.SUCCESS.APPROVE_FIRST_PLAN)
          allowNavigation()
          onApprove?.()
        }
      } catch (error) {
        console.error('承認処理エラー:', error)
        alert(`承認処理に失敗しました\n\nエラー: ${error.message}`)
      }
      return
    }

    // 既存のプラン編集の場合
    const isAlreadyApproved =
      selectedShift?.status === 'APPROVED' && selectedShift?.planType === 'FIRST'

    // 承認済みで変更なしの場合
    if (isAlreadyApproved && !hasUnsavedChanges) {
      alert(MESSAGES.SUCCESS.NO_CHANGES)
      return
    }

    // 確認ダイアログ
    const confirmMessage = isAlreadyApproved
      ? '変更を保存しますか？'
      : hasUnsavedChanges
        ? '未保存の変更を保存して承認します。よろしいですか？'
        : '第1案を承認しますか？承認後は第2案の作成に進めます。'

    if (!confirm(confirmMessage)) {
      return
    }

    try {
      // 変更があれば先に保存（共通フックを使用）
      if (hasUnsavedChanges) {
        const saveResult = await saveChanges()
        if (!saveResult.success) {
          throw new Error(saveResult.message)
        }
      }

      // 承認済みでない場合はステータスを更新（全店舗分）
      if (!isAlreadyApproved) {
        // planIdsState（全店舗分）を優先的に使用
        const planIdsToUpdate =
          planIdsState.length > 0
            ? planIdsState
            : [...new Set(shiftData.map(shift => shift.plan_id).filter(Boolean))]

        for (const id of planIdsToUpdate) {
          await shiftRepository.updatePlanStatus(id, 'APPROVED')
        }
      }

      setHasSavedDraft(true)

      if (isAlreadyApproved) {
        alert(MESSAGES.SUCCESS.SAVED)
        await loadShiftData()
      } else {
        alert(MESSAGES.SUCCESS.APPROVE_FIRST_PLAN)
        allowNavigation()
        onApprove?.()
      }
    } catch (error) {
      console.error('承認処理エラー:', error)
      alert(`${MESSAGES.ERROR.SAVE_APPROVE_FAILED}\n\nエラー: ${error.message}`)
    }
  }

  // シフト更新ハンドラー（共通フック + UI更新）
  const handleUpdateShift = (shiftId, updates) => {
    // UI更新のコールバック
    const updateUI = () => {
      // UIを即座に更新
      setCalendarData(prev => {
        if (!prev) return prev
        const updatedShiftsByDate = { ...prev.shiftsByDate }

        // すべての日付のシフトを更新
        Object.keys(updatedShiftsByDate).forEach(day => {
          updatedShiftsByDate[day] = updatedShiftsByDate[day].map(shift => {
            if (shift.shift_id === shiftId) {
              return {
                ...shift,
                ...updates,
                modified_flag: true,
              }
            }
            return shift
          })
        })

        return {
          ...prev,
          shiftsByDate: updatedShiftsByDate,
        }
      })

      // shiftDataも更新（StaffTimeTable用）
      setShiftData(prev =>
        prev.map(shift =>
          shift.shift_id === shiftId ? { ...shift, ...updates, modified_flag: true } : shift
        )
      )

      // 現在表示中の日のシフトも更新
      if (selectedDay) {
        setDayShifts(prev =>
          prev.map(shift =>
            shift.shift_id === shiftId ? { ...shift, ...updates, modified_flag: true } : shift
          )
        )
      }
    }

    // 共通フックの関数を使用
    handleModifyShift(shiftId, updates, updateUI)
  }

  // シフト削除ハンドラー（共通フック + UI更新）
  // 削除成功時はtrue、キャンセル時はfalseを返す
  const handleDeleteShift = shiftId => {
    // 削除確認
    if (!window.confirm('このシフトを削除しますか？')) return false

    // UI更新のコールバック
    const updateUI = () => {
      // UIから削除
      setCalendarData(prev => {
        if (!prev) return prev
        const updatedShiftsByDate = { ...prev.shiftsByDate }

        // すべての日付のシフトから削除
        Object.keys(updatedShiftsByDate).forEach(day => {
          updatedShiftsByDate[day] = updatedShiftsByDate[day].filter(
            shift => shift.shift_id !== shiftId
          )
        })

        return {
          ...prev,
          shiftsByDate: updatedShiftsByDate,
        }
      })

      // 現在表示中の日のシフトも削除
      if (selectedDay) {
        const updatedShifts = dayShifts.filter(s => s.shift_id !== shiftId)
        setDayShifts(updatedShifts)

        // その日のシフトがなくなったら閉じる
        if (updatedShifts.length === 0) {
          closeDayView()
        }
      }

      // shiftDataからも削除（timeOverlapInfoの更新に必要）
      setShiftData(prev => prev.filter(shift => shift.shift_id !== shiftId))
    }

    // 共通フックの関数を使用
    handleDeleteShiftBase(shiftId, updateUI)
    return true
  }

  // シフト追加ハンドラー（共通フック + UI更新）
  const handleAddShift = newShiftData => {
    // スタッフ情報を取得
    const staffInfo = staffMap[newShiftData.staff_id] || { name: '不明', role_name: 'スタッフ' }

    // pattern_id を動的に取得（マルチテナント対応）
    // 優先順位: 選択されたパターン > 既存シフトの最初のパターン > デフォルト
    const dynamicPatternId =
      modalState.selectedPattern?.pattern_id ||
      defaultPatternId ||
      (shiftData.length > 0 ? shiftData[0].pattern_id : null) ||
      (shiftPatterns.length > 0 ? shiftPatterns[0].pattern_id : 1)

    // 対象店舗の正しいplan_idを取得（マルチストア対応）
    const planIdForStore =
      shiftData.find(s => s.store_id === newShiftData.store_id)?.plan_id || planId

    // 新しいシフトオブジェクトを作成（バックエンド保存用の必須フィールドを含む）
    const shiftDataToAdd = {
      tenant_id: getCurrentTenantId(), // 必須
      store_id: newShiftData.store_id, // 必須（ポップアップから渡される）
      plan_id: planIdForStore, // 必須 - 対象店舗の正しいplan_id
      staff_id: newShiftData.staff_id, // 必須
      shift_date: newShiftData.date || newShiftData.shift_date, // 必須
      pattern_id: dynamicPatternId, // 動的に取得（マルチテナント対応）
      start_time: newShiftData.start_time, // 必須
      end_time: newShiftData.end_time, // 必須
      break_minutes: newShiftData.break_minutes || 0, // 必須
      is_preferred: false,
      staff_name: staffInfo.name,
      role: staffInfo.role_name,
      modified_flag: true,
    }

    // UI更新のコールバック
    const updateUI = newShift => {
      // UIに即座に反映
      const date = new Date(newShift.shift_date)
      const day = date.getDate()

      setCalendarData(prev => {
        if (!prev) return prev
        const updatedShiftsByDate = { ...prev.shiftsByDate }

        if (!updatedShiftsByDate[day]) {
          updatedShiftsByDate[day] = []
        }

        updatedShiftsByDate[day].push(newShift)

        return {
          ...prev,
          shiftsByDate: updatedShiftsByDate,
        }
      })

      // shiftDataにも追加
      setShiftData(prev => [...prev, newShift])

      // 現在表示中の日の場合は dayShifts にも追加
      if (selectedDay === day) {
        setDayShifts(prev => [...prev, newShift])
      }
    }

    // 共通フックの関数を使用
    handleAddShiftBase(shiftDataToAdd, updateUI)
  }

  // セルクリック時のハンドラー
  const handleShiftClick = ({ mode, shift, date, staffId, event }) => {
    // クリック位置を取得
    const rect = event?.target.getBoundingClientRect()
    const position = rect
      ? {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        }
      : {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }

    // 日付フォーマットを統一（"2024-11-29" 形式）
    const formattedDate =
      typeof date === 'string' && date.includes('-')
        ? date
        : `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`

    if (mode === 'add') {
      // 新規追加モード - スタッフの所属店舗をデフォルトに設定
      const staffStoreId = staffMap[staffId]?.store_id
      const storeData =
        storesMap instanceof Map
          ? storesMap.get(parseInt(staffStoreId))
          : storesMap[parseInt(staffStoreId)]

      setModalState({
        isOpen: true,
        mode: 'add',
        shift: {
          date: formattedDate,
          staff_id: staffId,
          store_id: staffStoreId, // スタッフの所属店舗ID
          staff_name: staffMap[staffId]?.name || '不明',
          store_name: storeData?.store_name || '不明',
        },
        position,
      })
    } else {
      // 編集モード
      setModalState({
        isOpen: true,
        mode: 'edit',
        shift: {
          ...shift,
          date: shift.date || formattedDate,
        },
        position,
      })
    }
  }

  // モーダルからの保存処理
  const handleModalSave = timeData => {
    if (modalState.mode === 'add') {
      handleAddShift({
        ...modalState.shift,
        ...timeData,
      })
    } else {
      handleUpdateShift(modalState.shift.shift_id, timeData)
    }

    setModalState({ isOpen: false, mode: 'add', shift: null, position: { x: 0, y: 0 } })
  }

  // モーダルからの削除処理
  const handleModalDelete = () => {
    const deleted = handleDeleteShift(modalState.shift.shift_id)
    if (deleted) {
      setModalState({ isOpen: false, mode: 'add', shift: null, position: { x: 0, y: 0 } })
    }
  }

  // シフト編集ポップアップコンポーネント
  const ShiftEditModal = ({
    isOpen,
    onClose,
    mode,
    shift,
    preferencesMap,
    onSave,
    onDelete,
    position,
    availableStores,
  }) => {
    const [startTime, setStartTime] = useState(shift?.start_time || '')
    const [endTime, setEndTime] = useState(shift?.end_time || '')
    const [breakMinutes, setBreakMinutes] = useState(shift?.break_minutes || 0)
    const [storeId, setStoreId] = useState(shift?.store_id || '')
    const [popupStyle, setPopupStyle] = useState({})
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 })

    // shift が変更されたときにフォームの値をリセット
    useEffect(() => {
      if (shift) {
        setStartTime(shift.start_time || '')
        setEndTime(shift.end_time || '')
        setBreakMinutes(shift.break_minutes || 0)
        setStoreId(shift.store_id || '')
      }
    }, [shift])

    // ドラッグハンドラー
    const handleDragStart = e => {
      setIsDragging(true)
      setDragStart({
        x: e.clientX - popupPosition.x,
        y: e.clientY - popupPosition.y,
      })
    }

    const handleDrag = e => {
      if (isDragging) {
        setPopupPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        })
      }
    }

    const handleDragEnd = () => {
      setIsDragging(false)
    }

    // ドラッグイベントリスナー
    useEffect(() => {
      if (isDragging) {
        window.addEventListener('mousemove', handleDrag)
        window.addEventListener('mouseup', handleDragEnd)
        return () => {
          window.removeEventListener('mousemove', handleDrag)
          window.removeEventListener('mouseup', handleDragEnd)
        }
      }
    }, [isDragging, dragStart, popupPosition])

    // ポップアップの位置を計算（画面端で見切れないように調整）
    useEffect(() => {
      if (isOpen && position) {
        const popupWidth = 320
        const popupHeight = mode === 'edit' ? 320 : 300
        const margin = 20

        let x = position.x
        let y = position.y

        // 右端チェック
        if (x + popupWidth / 2 > window.innerWidth - margin) {
          x = window.innerWidth - popupWidth - margin
        } else if (x - popupWidth / 2 < margin) {
          // 左端チェック
          x = margin
        } else {
          // 中央配置
          x = x - popupWidth / 2
        }

        // 下端チェック
        if (y + popupHeight > window.innerHeight - margin) {
          // 上に表示
          y = position.y - popupHeight - 20
          if (y < margin) {
            y = margin
          }
        } else {
          // 上寄りに表示（クリック位置から少し上）
          y = position.y - 30
        }

        // 初期位置を設定
        setPopupPosition({ x, y })
      }
    }, [isOpen, position, mode])

    // スタイルを更新
    useEffect(() => {
      setPopupStyle({
        position: 'fixed',
        left: `${popupPosition.x}px`,
        top: `${popupPosition.y}px`,
        zIndex: 10000,
        cursor: isDragging ? 'move' : 'default',
      })
    }, [popupPosition, isDragging])

    // ★変更: 新API形式（1日1レコード）での希望シフトチェック（O(1) Map lookup）
    const checkPreference = () => {
      if (!shift || !preferencesMap || preferencesMap.size === 0) return null

      const dateStr = shift.date
      const key = `${shift.staff_id}_${dateStr}`
      const pref = preferencesMap.get(key)

      if (!pref) return null

      // is_ng フラグでNG日/希望日を判定
      if (pref.is_ng) {
        return 'ng'
      } else {
        return 'preferred'
      }
    }

    const handleSave = () => {
      // 必須項目チェック
      if (!startTime || !endTime) {
        alert('開始時刻と終了時刻を入力してください')
        return
      }

      if (!storeId) {
        alert('勤務店舗を選択してください')
        return
      }

      // 時刻の妥当性チェック
      if (startTime >= endTime) {
        alert('終了時刻は開始時刻より後にしてください')
        return
      }

      // 休憩時間の妥当性チェック
      const breakMins = parseInt(breakMinutes) || 0
      if (breakMins < 0) {
        alert('休憩時間は0以上の値を入力してください')
        return
      }

      // 希望シフトチェック
      const prefStatus = checkPreference()
      if (prefStatus === 'ng') {
        const confirmMsg =
          mode === 'add'
            ? 'この日はスタッフのNG日として登録されています。\n本当にシフトを追加しますか？'
            : 'この日はスタッフのNG日として登録されています。\n本当に更新しますか？'
        if (!confirm(confirmMsg)) {
          return
        }
      }

      onSave({
        start_time: startTime,
        end_time: endTime,
        break_minutes: breakMins,
        store_id: parseInt(storeId),
      })
    }

    if (!isOpen || !shift) return null

    return (
      <>
        {/* 背景オーバーレイ（薄く半透明） */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[999]"
              onClick={onClose}
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}
            />
          )}
        </AnimatePresence>

        {/* ポップアップ本体 */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: -10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: -10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white rounded-lg shadow-2xl p-4 w-[320px]"
              style={popupStyle}
              onClick={e => e.stopPropagation()}
            >
              {/* ヘッダー */}
              <div
                className="flex items-center justify-between mb-2 cursor-move select-none"
                onMouseDown={handleDragStart}
              >
                <h3 className="text-base font-bold text-gray-800">
                  {mode === 'add' ? 'シフト追加' : 'シフト編集'}
                </h3>
                <button
                  onClick={onClose}
                  onMouseDown={e => e.stopPropagation()}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* スタッフ・日付情報の表示 */}
              <div className="bg-blue-50 border border-blue-200 p-2 rounded mb-2 text-xs">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-600">スタッフ</span>
                  <span className="font-semibold">{shift.staff_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">日付</span>
                  <span className="font-semibold">{shift.date}</span>
                </div>
              </div>

              {/* フォーム入力 */}
              <div className="space-y-2">
                {/* 店舗選択 */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    勤務店舗 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={storeId}
                    onChange={e => setStoreId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- 店舗を選択 --</option>
                    {availableStores &&
                      availableStores.map(store => (
                        <option key={store.store_id} value={store.store_id}>
                          {store.store_name}
                        </option>
                      ))}
                  </select>
                </div>

                <TimeInput
                  value={startTime}
                  onChange={setStartTime}
                  label="開始時刻"
                  required
                  minHour={5}
                  maxHour={28}
                  minuteStep={15}
                />

                <TimeInput
                  value={endTime}
                  onChange={setEndTime}
                  label="終了時刻"
                  required
                  minHour={5}
                  maxHour={28}
                  minuteStep={15}
                />
              </div>

              {/* ボタン群 */}
              <div className="flex gap-2 mt-3">
                {mode === 'edit' && (
                  <Button
                    onClick={onDelete}
                    size="sm"
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700 text-xs"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    削除
                  </Button>
                )}
                <div className="flex-1"></div>
                <Button
                  onClick={onClose}
                  size="sm"
                  variant="outline"
                  className="border-gray-300 text-xs"
                >
                  キャンセル
                </Button>
                <Button
                  onClick={handleSave}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-xs"
                >
                  {mode === 'add' ? '追加' : '更新'}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    )
  }

  if (loading) {
    return (
      <motion.div
        initial="initial"
        animate="in"
        exit="out"
        variants={pageVariants}
        transition={pageTransition}
        className={`h-screen flex flex-col px-4 py-8 ${isMobile ? 'overflow-auto' : 'overflow-hidden'}`}
      >
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
          <p className="text-lg text-gray-600">データを読み込んでいます...</p>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial="initial"
      animate="in"
      exit="out"
      variants={pageVariants}
      transition={pageTransition}
      className={`h-screen flex flex-col pt-16 ${isMobile ? 'overflow-auto' : 'overflow-hidden'}`}
    >
      {/* ヘッダー */}
      <div className="mb-2 flex items-center justify-between flex-shrink-0 px-8 py-4 bg-white border-b border-gray-200 print-hidden">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={handleDashboard}>
            <Home className="h-4 w-4 mr-1" />
            ダッシュボード
          </Button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {year}年{month}月のシフト（{planType === 'SECOND' ? '第2案' : '第1案'}）
              <span className="text-sm font-normal text-gray-600 ml-3">
                {selectedShift?.store_name ? `${selectedShift.store_name} · ` : ''}
                {isViewMode ? '閲覧モード' : '編集可能'}
              </span>
              {isEditMode && hasUnsavedChanges && (
                <span className="text-sm font-semibold text-orange-600 ml-3 animate-pulse">
                  ● 未保存の変更があります
                </span>
              )}
            </h1>
          </div>
        </div>
        <div className="flex gap-2">
          {/* CSVエクスポートボタン（常に表示） */}
          <Button size="sm" variant="outline" onClick={handleExportCSV}>
            <Download className="h-3 w-3 mr-1" />
            CSVエクスポート
          </Button>

          {/* 印刷ボタン（ブラウザ標準の印刷ダイアログ → PDF 保存も可） */}
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-3 w-3 mr-1" />
            印刷
          </Button>

          {/* アクションボタン */}
          {isEditMode && (
            <>
              {selectedShift?.status === 'APPROVED' && selectedShift?.plan_type === 'FIRST' ? (
                <>
                  <Button
                    size="sm"
                    onClick={handleApprove}
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    {saving ? '保存中...' : '保存'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDelete}
                    className="border-red-300 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    削除
                  </Button>
                </>
              ) : (
                <>
                  {/* Issue #165: 時間重複エラー表示 */}
                  {timeOverlapInfo.hasOverlap && (
                    <div className="relative group flex items-center text-red-600 text-sm mr-2 cursor-help">
                      <span className="mr-1">⚠</span>
                      時間重複あり（{timeOverlapInfo.overlaps.length}件）
                      {/* ホバーで詳細表示 */}
                      <div className="absolute top-full left-0 mt-2 hidden group-hover:block bg-white border border-red-300 rounded-lg shadow-lg p-3 min-w-[300px] max-w-[400px] z-50">
                        <div className="text-xs text-gray-700 font-medium mb-2 border-b pb-1">
                          重複シフト詳細:
                        </div>
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                          {timeOverlapInfo.overlaps.map((overlap, idx) => (
                            <div key={idx} className="text-xs bg-red-50 rounded p-2">
                              <div className="font-medium text-gray-800">
                                {overlap.staffName} - {overlap.date}
                              </div>
                              <div className="text-red-600 mt-1">
                                <div>
                                  ・{overlap.shift1.store_name}:{' '}
                                  {overlap.shift1.start_time?.slice(0, 5)}-
                                  {overlap.shift1.end_time?.slice(0, 5)}
                                </div>
                                <div>
                                  ・{overlap.shift2.store_name}:{' '}
                                  {overlap.shift2.start_time?.slice(0, 5)}-
                                  {overlap.shift2.end_time?.slice(0, 5)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <Button
                    size="sm"
                    onClick={handleSaveDraft}
                    disabled={saving || timeOverlapInfo.hasOverlap}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                    title={timeOverlapInfo.hasOverlap ? '時間重複があるため保存できません' : ''}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    {saving ? '保存中...' : '下書き保存'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApprove}
                    disabled={saving || timeOverlapInfo.hasOverlap}
                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50"
                    title={timeOverlapInfo.hasOverlap ? '時間重複があるため承認できません' : ''}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-1" />
                    )}
                    {saving ? '処理中...' : `${planType === 'SECOND' ? '第2案' : '第1案'}承認`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDelete}
                    className="border-red-300 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    削除
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* 店舗チェックボックス（表示フィルター） */}
      <div className="px-8 mb-4 print-hidden">
        <div className="flex flex-wrap gap-3">
          {availableStores.map(store => {
            const storeIdNum = parseInt(store.store_id)
            return (
              <label key={store.store_id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedStores.has(storeIdNum)}
                  onChange={e => {
                    const newSelected = new Set(selectedStores)
                    if (e.target.checked) {
                      newSelected.add(storeIdNum)
                    } else {
                      newSelected.delete(storeIdNum)
                    }
                    setSelectedStores(newSelected)
                  }}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm font-medium text-gray-700">{store.store_name}</span>
              </label>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-hidden mx-8 mb-4 print-area">
        <MultiStoreShiftTable
          year={year}
          month={month}
          shiftData={shiftData}
          staffMap={staffMap}
          storesMap={storesMap}
          selectedStores={selectedStores}
          readonly={isViewMode}
          onAddShift={isEditMode ? handleAddShift : undefined}
          onUpdateShift={isEditMode ? handleUpdateShift : undefined}
          onDeleteShift={isEditMode ? handleDeleteShift : undefined}
          onDayClick={handleDayClick}
          onShiftClick={isEditMode ? handleShiftClick : undefined}
          preferences={preferences}
          showPreferenceColoring={false}
        />
      </div>

      {/* タイムライン表示（ドラッグ・リサイズ可能なウィンドウ） */}
      {selectedDay && (
        <Rnd
          size={{ width: windowState.width, height: windowState.height }}
          position={{ x: windowState.x, y: windowState.y }}
          onDragStop={(e, d) => {
            setWindowState(prev => ({ ...prev, x: d.x, y: d.y }))
          }}
          onResizeStop={(e, direction, ref, delta, position) => {
            setWindowState(prev => ({
              ...prev,
              width: parseInt(ref.style.width),
              height: parseInt(ref.style.height),
              ...position,
            }))
          }}
          minWidth={1000}
          minHeight={400}
          dragHandleClassName="window-header"
          style={{ zIndex: 9999 }}
          resizeHandleStyles={{
            bottom: { cursor: 'ns-resize', height: '8px' },
            right: { cursor: 'ew-resize', width: '8px' },
            bottomRight: { cursor: 'nwse-resize', width: '16px', height: '16px' },
            bottomLeft: { cursor: 'nesw-resize', width: '16px', height: '16px' },
            topRight: { cursor: 'nesw-resize', width: '16px', height: '16px' },
            topLeft: { cursor: 'nwse-resize', width: '16px', height: '16px' },
          }}
        >
          <div className="flex flex-col h-full bg-white rounded-lg shadow-2xl border border-gray-300 overflow-hidden">
            {/* ウィンドウヘッダー */}
            <div className="window-header bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2 flex justify-between items-center cursor-move select-none">
              <div className="font-semibold text-sm">
                📅 {month}月{selectedDay}日 -{' '}
                {selectedStoreId === null ? '全店舗' : storesMap[selectedStoreId]?.store_name || ''}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleMaximize}
                  className="hover:bg-blue-700 p-1 rounded transition-colors"
                  title={windowState.isMaximized ? '元のサイズに戻す' : '最大化'}
                >
                  {windowState.isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button
                  onClick={closeDayView}
                  className="hover:bg-red-600 p-1 rounded transition-colors"
                  title="閉じる"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* ウィンドウコンテンツ */}
            <div className="flex-1 overflow-auto">
              <ShiftTableView
                date={selectedDay}
                year={year}
                month={month}
                shifts={dayShifts}
                onClose={closeDayView}
                editable={isEditMode}
                onUpdate={isEditMode ? handleUpdateShift : undefined}
                onDelete={isEditMode ? handleDeleteShift : undefined}
                onShiftClick={isEditMode ? handleShiftClick : undefined}
                storesMap={storesMap}
                storeName={
                  selectedStoreId === null ? undefined : storesMap[selectedStoreId]?.store_name
                }
              />
            </div>
          </div>
        </Rnd>
      )}

      {/* シフト編集ポップアップ */}
      <ShiftEditModal
        isOpen={modalState.isOpen}
        mode={modalState.mode}
        shift={modalState.shift}
        preferencesMap={preferencesMap}
        position={modalState.position}
        availableStores={availableStores}
        shiftPatterns={shiftPatterns}
        onClose={() =>
          setModalState({ isOpen: false, mode: 'add', shift: null, position: { x: 0, y: 0 } })
        }
        onSave={handleModalSave}
        onDelete={handleModalDelete}
      />
    </motion.div>
  )
}

export default FirstPlanEditor
