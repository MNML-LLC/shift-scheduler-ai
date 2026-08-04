import React, { useRef, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { isHoliday, getHolidayName } from '../../utils/holidays'
import { getDaysInMonth, getDayOfWeek, isoToJSTDateString } from '../../utils/dateUtils'

// 契約種別コードから表示名へのマップ
const EMPLOYMENT_TYPE_NAMES = {
  FULL_TIME: '正社員',
  PART_TIME: 'アルバイト',
  CONTRACT: '業務委託',
  TEMPORARY: '派遣社員',
}

// 契約種別のソート順（小さいほど先に表示）
const EMPLOYMENT_TYPE_ORDER = {
  FULL_TIME: 1,
  CONTRACT: 2,
  TEMPORARY: 3,
  PART_TIME: 4, // アルバイトは最後
}

/**
 * マルチストアシフトテーブル（読み取り専用）
 * 縦軸: 日付、横軸: 店舗別グループ化されたスタッフ
 * 各セルに勤務時間を表示（応援勤務の場合は店舗コードも表示）
 */
const MultiStoreShiftTable = ({
  year,
  month,
  shiftData,
  staffMap,
  storesMap,
  selectedStores, // 選択された店舗IDのSet
  onDayClick,
  conflicts = [], // 希望シフトとの不一致情報
  onConflictClick, // conflictセルがクリックされたときのコールバック
  hopeShifts = [], // 希望シフトデータ
  onCellClick, // セルクリック時のコールバック（全セル対応）
  preferences = [], // 希望シフトのpreferredDays/ngDays情報
  onShiftClick, // シフト追加・編集用のコールバック
  showPreferenceColoring = true, // 希望シフトベースの色分けを表示するか（第一案ではfalse）
  commentsMap = new Map(), // 月次コメント（staff_id -> comment）
  diffMap = null, // 第1案との差分マップ（key: `${staff_id}_YYYY-MM-DD_${shift_id}` → 'added'|'removed'|'modified'|'unchanged'）
}) => {
  const headerScrollRef = useRef(null)
  const bodyScrollRef = useRef(null)

  // コメントツールチップの状態管理
  const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 })

  const showTooltip = (e, content) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({
      visible: true,
      content,
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
    })
  }

  const hideTooltip = () => {
    setTooltip(prev => ({ ...prev, visible: false }))
  }

  // ヘッダーとボディのスクロールを同期
  const handleHeaderScroll = e => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollLeft = e.target.scrollLeft
    }
  }

  const handleBodyScroll = e => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.target.scrollLeft
    }
  }

  // ===============================================
  // パフォーマンス最適化: O(n)検索をO(1)に変換するMap
  // ===============================================

  // Issue #165: shiftData を Map 化（キー: "YYYY-MM-DD_staffId" → 配列）
  // 1日に複数店舗でシフトがある場合に対応
  const shiftDataMap = useMemo(() => {
    const map = new Map()
    shiftData.forEach(shift => {
      if (shift.shift_date) {
        const dateStr = shift.shift_date.substring(0, 10)
        const key = `${dateStr}_${shift.staff_id}`
        if (!map.has(key)) {
          map.set(key, [])
        }
        map.get(key).push(shift)
      }
    })
    return map
  }, [shiftData])

  // conflicts を Map 化（キー: "date_staffId"）
  const conflictsMap = useMemo(() => {
    const map = new Map()
    conflicts.forEach(c => {
      const key = `${c.date}_${c.staffId}`
      map.set(key, c)
    })
    return map
  }, [conflicts])

  // hopeShifts を Map 化（キー: "YYYY-MM-DD_staffId"）
  const hopeShiftsMap = useMemo(() => {
    const map = new Map()
    hopeShifts.forEach(hope => {
      if (hope.shift_date) {
        const dateStr = hope.shift_date.substring(0, 10)
        const key = `${dateStr}_${hope.staff_id}`
        map.set(key, hope)
      }
    })
    return map
  }, [hopeShifts])

  // preferences を Map 化（キー: "staffId_YYYY-MM-DD"）
  const preferencesMap = useMemo(() => {
    const map = new Map()
    preferences.forEach(pref => {
      const prefDate = isoToJSTDateString(pref.preference_date)
      const key = `${pref.staff_id}_${prefDate}`
      map.set(key, pref)
    })
    return map
  }, [preferences])

  // 月の日数を計算（JST対応）
  const daysInMonth = getDaysInMonth(year, month)
  const dates = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  // 時刻をHH:MM形式にフォーマット
  const formatTime = time => {
    if (!time) return ''
    return time.substring(0, 5)
  }

  // 店舗IDから店舗コードを取得
  const getStoreCode = storeId => {
    if (!storesMap || !storeId) return ''
    const store = storesMap[storeId]
    return store ? store.store_code : ''
  }

  // 店舗IDから店舗名を取得
  const getStoreName = storeId => {
    if (!storesMap || !storeId) return ''
    const store = storesMap[storeId]
    return store ? store.store_name : ''
  }

  // Issue #165: 日付とスタッフIDからシフト配列を検索（O(1) Map lookup）
  // 複数店舗勤務の場合は複数のシフトが返される
  const getShiftsForDateAndStaff = (date, staffId) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
    return shiftDataMap.get(`${dateStr}_${staffId}`) || []
  }

  // 後方互換性のため、最初のシフトのみを返す関数も用意
  const getShiftForDateAndStaff = (date, staffId) => {
    const shifts = getShiftsForDateAndStaff(date, staffId)
    return shifts.length > 0 ? shifts[0] : null
  }

  // 勤務時間を計算
  const calculateHours = (startTime, endTime) => {
    if (!startTime || !endTime) return 0
    const [startH, startM] = startTime.split(':').map(Number)
    const [endH, endM] = endTime.split(':').map(Number)
    return Math.abs((endH * 60 + endM - startH * 60 - startM) / 60)
  }

  // スタッフごとの月間合計を計算（全シフトを集計、フィルターに依存しない）
  const getStaffMonthlyTotal = staffId => {
    let totalDays = 0
    let totalHours = 0
    dates.forEach(date => {
      const shift = getShiftForDateAndStaff(date, staffId)
      // シフトがあればカウント（店舗フィルターの選択状態に関係なく全シフトの合計を表示）
      if (shift) {
        totalDays++
        totalHours += calculateHours(shift.start_time, shift.end_time)
      }
    })
    return { totalDays, totalHours }
  }

  // スタッフリストを取得（全スタッフを常に表示）
  const allStaff = Object.entries(staffMap)
    .map(([id, info]) => ({ staff_id: parseInt(id), ...info }))
    .filter(staff => staff.is_active !== false) // 在籍中のスタッフのみ
    .sort((a, b) => a.staff_id - b.staff_id)

  // 店舗ごとにスタッフをグループ化（全店舗・全スタッフ）
  const storeGroups = []
  const storeIdSet = new Set(allStaff.map(s => s.store_id))

  // 店舗IDでソート（店舗名順）
  const sortedStoreIds = Array.from(storeIdSet).sort((a, b) => {
    const nameA = getStoreName(a) || ''
    const nameB = getStoreName(b) || ''
    return nameA.localeCompare(nameB, 'ja')
  })

  sortedStoreIds.forEach(storeId => {
    // 選択されている店舗のみ表示
    if (selectedStores && selectedStores.has(parseInt(storeId))) {
      const staffInStore = allStaff
        .filter(s => parseInt(s.store_id) === parseInt(storeId))
        .sort((a, b) => {
          // 契約種別でソート（FULL_TIME, CONTRACT, TEMPORARY, PART_TIMEの順）
          const orderA = EMPLOYMENT_TYPE_ORDER[a.employment_type] ?? 99
          const orderB = EMPLOYMENT_TYPE_ORDER[b.employment_type] ?? 99
          if (orderA !== orderB) {
            return orderA - orderB
          }
          // 同じ契約種別の場合は名前でソート
          return (a.staff_name || '').localeCompare(b.staff_name || '', 'ja')
        })
      if (staffInStore.length > 0) {
        storeGroups.push({
          storeId,
          storeName: getStoreName(storeId),
          staff: staffInStore,
        })
      }
    }
  })

  // 日付と店舗IDから、その店舗の日別サマリーを計算
  const getStoreDailySummary = (date, storeId) => {
    let staffCount = 0
    let totalHours = 0

    // 全スタッフをチェック（所属に関係なく、その店舗で勤務している人をカウント）
    allStaff.forEach(staff => {
      const shift = getShiftForDateAndStaff(date, staff.staff_id)
      // シフトがあり、その店舗のシフトで、選択されている場合のみカウント
      if (
        shift &&
        parseInt(shift.store_id) === parseInt(storeId) &&
        selectedStores &&
        selectedStores.size > 0 &&
        selectedStores.has(parseInt(shift.store_id))
      ) {
        staffCount++
        totalHours += calculateHours(shift.start_time, shift.end_time)
      }
    })

    return { staffCount, totalHours }
  }

  // 日付の全体サマリーを計算（選択された全店舗の合計）
  const getOverallDailySummary = date => {
    let staffCount = 0
    let totalHours = 0

    allStaff.forEach(staff => {
      const shift = getShiftForDateAndStaff(date, staff.staff_id)
      // シフトがあればカウント（チェックボックスの選択状態に関係なく全店舗の合計を表示）
      if (shift) {
        staffCount++
        totalHours += calculateHours(shift.start_time, shift.end_time)
      }
    })

    return { staffCount, totalHours }
  }

  // 全体の月間合計を計算
  const getOverallMonthlyTotal = () => {
    let totalDays = 0
    let totalHours = 0

    dates.forEach(date => {
      allStaff.forEach(staff => {
        const shift = getShiftForDateAndStaff(date, staff.staff_id)
        // シフトがあればカウント（チェックボックスの選択状態に関係なく全店舗の合計を表示）
        if (shift) {
          totalDays++
          totalHours += calculateHours(shift.start_time, shift.end_time)
        }
      })
    })

    return { totalDays, totalHours }
  }

  // 店舗の月間合計を計算
  const getStoreMonthlyTotal = storeId => {
    let totalDays = 0
    let totalHours = 0

    dates.forEach(date => {
      // 全スタッフをチェック（所属に関係なく、その店舗で勤務している人をカウント）
      allStaff.forEach(staff => {
        const shift = getShiftForDateAndStaff(date, staff.staff_id)
        // シフトがあり、その店舗のシフトで、選択されている場合のみカウント
        if (
          shift &&
          parseInt(shift.store_id) === parseInt(storeId) &&
          selectedStores &&
          selectedStores.size > 0 &&
          selectedStores.has(parseInt(shift.store_id))
        ) {
          totalDays++
          totalHours += calculateHours(shift.start_time, shift.end_time)
        }
      })
    })

    return { totalDays, totalHours }
  }

  // 特定の日付とスタッフに対してconflictを取得（O(1) Map lookup）
  const getConflict = (date, staffId) => {
    return conflictsMap.get(`${date}_${staffId}`)
  }

  // 特定の日付とスタッフに対してhopeShiftを取得（O(1) Map lookup）
  const getHopeShift = (date, staffId) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
    return hopeShiftsMap.get(`${dateStr}_${staffId}`)
  }

  // ★変更: 新API形式（1日1レコード）でのスタッフ希望シフト情報取得
  // 指定した日付のスタッフの希望情報を取得（O(1) Map lookup）
  const getStaffPreferenceForDate = (date, staffId) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
    return preferencesMap.get(`${staffId}_${dateStr}`)
  }

  // その日が勤務希望日かチェック（is_ng=false）
  const isPreferredDay = (date, staffId) => {
    const pref = getStaffPreferenceForDate(date, staffId)
    return pref && !pref.is_ng
  }

  // その日がNG日かチェック（is_ng=true）
  const isNgDay = (date, staffId) => {
    const pref = getStaffPreferenceForDate(date, staffId)
    return pref && pref.is_ng
  }

  // セルの背景色を決定（希望シフトとの関係で判定）
  const getCellBackgroundColor = (date, staffId) => {
    // 希望シフトベースの色分けが無効の場合（第一案）
    if (!showPreferenceColoring) {
      return 'bg-white'
    }

    // NGの日は薄グレー
    if (isNgDay(date, staffId)) {
      return 'bg-gray-100'
    }
    // 希望日は薄緑
    if (isPreferredDay(date, staffId)) {
      return 'bg-green-50'
    }
    // 希望登録なし
    return 'bg-white'
  }

  // 時刻を分に変換するヘルパー関数
  const parseTimeToMinutes = timeStr => {
    if (!timeStr) return 0
    const parts = timeStr.split(':').map(Number)
    return parts[0] * 60 + (parts[1] || 0)
  }

  // シフトの時間帯が希望時間内かチェック
  const isShiftWithinPreferenceTime = (shift, pref) => {
    // 希望シフトに時間指定がない場合は日付だけで判定（従来通り）
    if (!pref.start_time && !pref.end_time) {
      return true
    }

    const shiftStart = parseTimeToMinutes(shift.start_time)
    const shiftEnd = parseTimeToMinutes(shift.end_time)
    const prefStart = parseTimeToMinutes(pref.start_time)
    const prefEnd = parseTimeToMinutes(pref.end_time)

    // シフトが希望時間内に完全に収まっているかチェック
    return shiftStart >= prefStart && shiftEnd <= prefEnd
  }

  // シフトカードの色分け（雇用形態別ロジック）- シフトの時間帯も考慮
  const getShiftCardColor = (date, staffId, shift = null) => {
    // 希望シフトベースの色分けが無効の場合（第一案）
    if (!showPreferenceColoring) {
      return 'bg-gray-100 border border-gray-300'
    }

    const staff = staffMap[staffId]
    const employmentType = staff?.employment_type || ''
    const isNg = isNgDay(date, staffId)
    const pref = getStaffPreferenceForDate(date, staffId)
    const isPreferred = pref && !pref.is_ng

    // 【PART_TIMEの場合】アルバイト・パートは希望日のみ勤務可能
    if (employmentType === 'PART_TIME') {
      if (isPreferred) {
        // 希望日だが、時間帯もチェック
        if (shift && pref && !isShiftWithinPreferenceTime(shift, pref)) {
          // 希望時間外に配置 → 赤色（要修正）
          return 'bg-red-200 border border-red-500'
        }
        // 希望日・希望時間内に配置 → 緑色（OK）
        return 'bg-green-100 border border-green-400'
      } else {
        // 希望日以外に配置 → 赤色（要修正）
        return 'bg-red-200 border border-red-500'
      }
    }

    // 【FULL_TIMEの場合】正社員はNG日以外なら勤務可能
    if (isNg) {
      // NG日に配置 → 赤色（要修正）
      return 'bg-red-200 border border-red-500'
    } else {
      // NG日以外に配置 → 緑色（OK）
      return 'bg-green-100 border border-green-400'
    }
  }

  // 曜日を取得（JST対応）
  const getWeekday = date => {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    const dayOfWeek = getDayOfWeek(year, month, date)
    return weekdays[dayOfWeek]
  }

  // 曜日の色（JST対応）
  const getWeekdayColor = date => {
    const dayOfWeek = getDayOfWeek(year, month, date)
    if (dayOfWeek === 0) return 'text-red-600'
    if (dayOfWeek === 6) return 'text-blue-600'
    return 'text-gray-700'
  }

  // テーブル幅を計算（列幅の合計）
  const tableWidth = useMemo(() => {
    let width = 90 + 80 // 日付列 + 全体サマリー列
    storeGroups.forEach(group => {
      width += 80 // 店舗サマリー列
      width += group.staff.length * 100 // スタッフ列
    })
    return width
  }, [storeGroups])

  return (
    <>
      {/* コメントツールチップ（Portal経由でbody直下にレンダリング） */}
      {tooltip.visible &&
        createPortal(
          <div
            className="fixed px-2 py-1.5 bg-yellow-400 text-black text-[0.65rem] rounded-lg shadow-xl whitespace-pre-wrap max-w-xs min-w-[150px] border-2 border-yellow-500"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translateX(-50%)',
              zIndex: 99999,
            }}
          >
            <div className="font-bold text-yellow-800 mb-0.5 text-[0.6rem]">
              📝 スタッフコメント
            </div>
            <div className="text-black leading-snug">{tooltip.content}</div>
            {/* 矢印（上向き） */}
            <div
              className="absolute border-6 border-transparent border-b-yellow-400"
              style={{
                bottom: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                borderWidth: '6px',
              }}
            ></div>
          </div>,
          document.body
        )}
      <div className="flex flex-col h-full bg-white rounded-lg shadow-lg border border-gray-200">
        {/* テーブルヘッダー（固定・横スクロール同期） */}
        <div
          ref={headerScrollRef}
          onScroll={handleHeaderScroll}
          className="overflow-x-auto flex-shrink-0 border-b-2 border-gray-300 scrollbar-hide"
          style={{ overflowY: 'hidden' }}
        >
          <table
            className="border-collapse text-xs"
            style={{ tableLayout: 'fixed', width: `${tableWidth}px` }}
          >
            <colgroup>
              <col style={{ width: '90px' }} />
              <col style={{ width: '80px' }} />
              {storeGroups.map(group => (
                <React.Fragment key={group.storeId}>
                  <col style={{ width: '80px' }} />
                  {group.staff.map(staff => (
                    <col key={staff.staff_id} style={{ width: '100px' }} />
                  ))}
                </React.Fragment>
              ))}
            </colgroup>
            <thead className="bg-gray-50">
              {/* 1行目: 店舗名 */}
              <tr>
                <th
                  rowSpan={2}
                  className="px-1 py-1 text-center font-semibold text-gray-700 border-b border-r-2 border-gray-300 sticky left-0 z-20 bg-gray-50"
                >
                  <div className="text-sm font-bold">
                    {year}年{month}月
                  </div>
                </th>
                <th
                  rowSpan={2}
                  className="px-1 py-1 text-center font-semibold text-gray-700 border-b border-r-2 border-gray-400 bg-blue-100 sticky left-[90px] z-20"
                >
                  <div className="text-sm leading-tight">📊全体</div>
                </th>
                {storeGroups.map(group => (
                  <th
                    key={group.storeId}
                    colSpan={1 + group.staff.length}
                    className="px-2 py-2 text-center font-bold text-gray-800 border-b border-r-2 border-gray-400 bg-blue-50"
                  >
                    <div className="text-base leading-tight font-bold">🏪{group.storeName}</div>
                  </th>
                ))}
              </tr>
              {/* 2行目: サマリー + スタッフ名 */}
              <tr>
                {storeGroups.map(group => (
                  <React.Fragment key={group.storeId}>
                    <th className="px-1 py-1 text-center font-semibold text-gray-700 border-b border-r border-gray-300 bg-gray-100">
                      <div className="text-xs leading-tight">Σ{group.storeName}</div>
                    </th>
                    {group.staff.map(staff => {
                      const comment = commentsMap.get(staff.staff_id)
                      return (
                        <th
                          key={staff.staff_id}
                          className="px-1 py-1 text-center font-semibold text-gray-700 border-b border-r border-gray-200"
                        >
                          <div className="text-xs leading-tight flex items-center justify-center gap-1">
                            {staff.name}
                            {comment && (
                              <span
                                className="inline-flex items-center justify-center w-5 h-5 bg-yellow-400 text-black rounded-full text-sm font-bold cursor-help animate-pulse shadow-md border-2 border-yellow-500"
                                onMouseEnter={e => showTooltip(e, comment)}
                                onMouseLeave={hideTooltip}
                              >
                                💬
                              </span>
                            )}
                          </div>
                          <div className="text-[0.65rem] text-gray-500 font-normal leading-tight">
                            {EMPLOYMENT_TYPE_NAMES[staff.employment_type] ||
                              staff.employment_type ||
                              '-'}
                          </div>
                        </th>
                      )
                    })}
                  </React.Fragment>
                ))}
              </tr>
              {/* 月間合計行 */}
              <tr className="bg-gray-100 font-semibold">
                <td className="px-1 py-1 border-r-2 border-gray-300 text-center text-gray-700 sticky left-0 z-20 bg-gray-100 text-sm">
                  月合計
                </td>
                {(() => {
                  const overallMonthly = getOverallMonthlyTotal()
                  return (
                    <td className="px-1 py-1 border-r-2 border-gray-400 text-center bg-blue-100 sticky left-[90px] z-20">
                      <div className="text-gray-800 text-xs leading-tight">
                        {overallMonthly.totalDays}名
                      </div>
                    </td>
                  )
                })()}
                {storeGroups.map(group => {
                  const storeMonthly = getStoreMonthlyTotal(group.storeId)
                  return (
                    <React.Fragment key={group.storeId}>
                      <td className="px-1 py-1 border-r border-gray-300 text-center bg-gray-100">
                        <div className="text-gray-800 text-xs leading-tight">
                          {storeMonthly.totalDays}名
                        </div>
                      </td>
                      {group.staff.map(staff => {
                        const { totalDays } = getStaffMonthlyTotal(staff.staff_id)
                        return (
                          <td
                            key={staff.staff_id}
                            className="px-1 py-1 border-r border-gray-200 text-center"
                          >
                            <div className="text-gray-800 text-xs leading-tight">{totalDays}日</div>
                          </td>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </tr>
            </thead>
          </table>
        </div>

        {/* テーブルボディ（縦横スクロール可能・横スクロール同期） */}
        <div
          ref={bodyScrollRef}
          onScroll={handleBodyScroll}
          className="overflow-x-auto overflow-y-auto flex-1"
        >
          <table
            className="border-collapse text-xs"
            style={{ tableLayout: 'fixed', width: `${tableWidth}px` }}
          >
            <colgroup>
              <col style={{ width: '90px' }} />
              <col style={{ width: '80px' }} />
              {storeGroups.map(group => (
                <React.Fragment key={group.storeId}>
                  <col style={{ width: '80px' }} />
                  {group.staff.map(staff => (
                    <col key={staff.staff_id} style={{ width: '100px' }} />
                  ))}
                </React.Fragment>
              ))}
            </colgroup>
            <tbody>
              {dates.map((date, index) => {
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
                const holiday = isHoliday(year, month, date)
                const holidayName = getHolidayName(year, month, date)
                const weekday = getWeekday(date)
                const overallSummary = getOverallDailySummary(date)
                const rowBgColor = index % 2 === 0 ? 'bg-white' : 'bg-gray-25'

                return (
                  <tr key={date} className={rowBgColor}>
                    {/* 日付セル */}
                    <td className="px-1 py-1 border-r-2 border-b border-gray-200 bg-gray-50 sticky left-0 z-20">
                      <div className="flex items-center gap-1">
                        <span
                          className={`font-bold text-base leading-tight ${getWeekdayColor(date)}`}
                        >
                          {date}({weekday})
                        </span>
                        {holiday && (
                          <span className="text-[0.65rem] text-red-600 font-medium leading-tight">
                            {holidayName}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 全体サマリーセル */}
                    <td
                      className="px-1 py-1 border-r-2 border-b border-gray-400 text-center bg-blue-50 cursor-pointer hover:bg-blue-100 sticky left-[90px] z-20"
                      onClick={() => onDayClick && onDayClick(date)}
                    >
                      <div className="font-semibold text-gray-800 text-xs leading-tight">
                        {overallSummary.staffCount}名
                      </div>
                    </td>

                    {/* 店舗ごとのグループ */}
                    {storeGroups.map(group => {
                      const storeSummary = getStoreDailySummary(date, group.storeId)
                      return (
                        <React.Fragment key={group.storeId}>
                          {/* 店舗の日別サマリーセル */}
                          <td
                            className="px-1 py-1 border-r border-b border-gray-300 text-center bg-gray-50 cursor-pointer hover:bg-gray-100"
                            onClick={() => onDayClick && onDayClick(date, group.storeId)}
                          >
                            <div className="font-semibold text-gray-800 text-xs leading-tight">
                              {storeSummary.staffCount}名
                            </div>
                          </td>

                          {/* スタッフごとのシフトセル（Issue #165: 複数シフト対応） */}
                          {group.staff.map(staff => {
                            // Issue #165: 複数シフトを取得
                            const allShifts = getShiftsForDateAndStaff(date, staff.staff_id)
                            // チェックボックスは「所属店舗」を意味する
                            // スタッフがグループに含まれている時点で所属店舗でのフィルタリングは完了
                            // そのスタッフの全シフト（他店舗での稼働含む）を表示する
                            const visibleShifts = allShifts
                            const shift = visibleShifts.length > 0 ? visibleShifts[0] : null
                            const hasMultipleShifts = visibleShifts.length > 1
                            const totalHours = visibleShifts.reduce(
                              (sum, s) => sum + calculateHours(s.start_time, s.end_time),
                              0
                            )
                            const conflict = getConflict(date, staff.staff_id)
                            const hopeShift = getHopeShift(date, staff.staff_id)
                            const cellBgColor = getCellBackgroundColor(date, staff.staff_id)
                            const shouldShowShift = visibleShifts.length > 0

                            // 第1案との差分ハイライト（shift 単位で判定）
                            const getDiffClass = shiftId => {
                              if (!diffMap || shiftId == null) return ''
                              const type = diffMap.get(`${staff.staff_id}_${dateStr}_${shiftId}`)
                              return (
                                {
                                  added: 'ring-2 ring-green-400',
                                  modified: 'ring-2 ring-yellow-400',
                                  removed: 'ring-2 ring-red-400',
                                }[type] || ''
                              )
                            }

                            // セルクリックハンドラ
                            const handleCellClick = e => {
                              // 新しいonShiftClickがある場合はそれを優先
                              if (onShiftClick) {
                                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`

                                if (shouldShowShift && shift) {
                                  // 既存シフトがある → 編集モード
                                  onShiftClick({
                                    mode: 'edit',
                                    shift: {
                                      ...shift,
                                      date: dateStr,
                                      staff_name: staff.name,
                                      store_name: getStoreName(shift.store_id),
                                    },
                                    allShifts: visibleShifts, // Issue #165: 複数シフトも渡す
                                    date: dateStr,
                                    staffId: staff.staff_id,
                                    storeId: shift.store_id,
                                    event: e,
                                  })
                                } else {
                                  // 空セル → 新規追加モード
                                  // 選択されている店舗から最初のものを使用（複数店舗選択時）
                                  const storeId =
                                    staff.store_id ||
                                    (selectedStores && selectedStores.size > 0
                                      ? Array.from(selectedStores)[0]
                                      : null)

                                  if (storeId) {
                                    onShiftClick({
                                      mode: 'add',
                                      shift: {
                                        date: dateStr,
                                        staff_id: staff.staff_id,
                                        store_id: storeId,
                                        staff_name: staff.name,
                                        store_name: getStoreName(storeId),
                                      },
                                      date: dateStr,
                                      staffId: staff.staff_id,
                                      storeId: storeId,
                                      event: e,
                                    })
                                  }
                                }
                              } else if (onCellClick) {
                                // 従来のonCellClickコールバック
                                onCellClick({
                                  date,
                                  staffId: staff.staff_id,
                                  shift: shouldShowShift ? shift : null,
                                  allShifts: visibleShifts, // Issue #165: 複数シフトも渡す
                                  hopeShift,
                                  conflict,
                                  staff,
                                })
                              }
                            }

                            return (
                              <td
                                key={staff.staff_id}
                                className={`px-1 py-1 border-r border-b border-gray-200 ${cellBgColor} ${hasMultipleShifts ? 'bg-amber-50 border-amber-300' : ''} ${onCellClick ? 'cursor-pointer hover:opacity-80' : ''}`}
                                onClick={handleCellClick}
                              >
                                {shouldShowShift ? (
                                  <div className="relative group">
                                    {hasMultipleShifts ? (
                                      // Issue #165: 複数シフト表示（1セル内に縦並び、各シフトは3行形式）
                                      <div className="space-y-1">
                                        {visibleShifts.map((s, idx) => (
                                          <div
                                            key={s.shift_id || idx}
                                            className={`px-1 py-1 rounded ${getShiftCardColor(date, staff.staff_id, s)} ${getDiffClass(s.shift_id)} relative cursor-pointer hover:ring-2 hover:ring-blue-400`}
                                            onClick={e => {
                                              // 各シフトカードをクリックしたら、そのシフトを編集
                                              e.stopPropagation()
                                              if (onShiftClick) {
                                                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
                                                onShiftClick({
                                                  mode: 'edit',
                                                  shift: {
                                                    ...s,
                                                    date: dateStr,
                                                    staff_name: staff.name,
                                                    store_name: getStoreName(s.store_id),
                                                  },
                                                  allShifts: visibleShifts,
                                                  date: dateStr,
                                                  staffId: staff.staff_id,
                                                  storeId: s.store_id,
                                                  event: e,
                                                })
                                              }
                                            }}
                                          >
                                            {s.modified_flag && (
                                              <div className="absolute top-0 right-0 text-xs bg-yellow-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[0.65rem] leading-none">
                                                !
                                              </div>
                                            )}
                                            {/* 1行目: バッジ（応援勤務の場合のみ店舗コード表示） */}
                                            <div className="text-[0.6rem] leading-tight">
                                              {s.store_id !== staff.store_id && (
                                                <span className="bg-indigo-600 text-white px-1 py-0.5 rounded text-[0.6rem] font-bold">
                                                  {getStoreCode(s.store_id)}
                                                </span>
                                              )}
                                            </div>
                                            {/* 2行目: 開始-終了時間 */}
                                            <div className="font-semibold text-gray-800 text-xs leading-tight">
                                              {formatTime(s.start_time)}-{formatTime(s.end_time)}
                                            </div>
                                            {/* 3行目: 合計時間 */}
                                            <div className="text-xs text-gray-600 leading-tight">
                                              {calculateHours(s.start_time, s.end_time).toFixed(1)}h
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      // 単一シフト表示（3行固定: バッジ（応援時のみ）、時間、合計）
                                      <div
                                        className={`px-1 py-1 rounded ${getShiftCardColor(date, staff.staff_id, shift)} ${getDiffClass(shift.shift_id)} relative`}
                                      >
                                        {shift.modified_flag && (
                                          <div className="absolute top-0 right-0 text-xs bg-yellow-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[0.65rem] leading-none">
                                            !
                                          </div>
                                        )}
                                        {/* 1行目: バッジ（応援勤務の場合のみ店舗コード表示） */}
                                        <div className="text-[0.6rem] leading-tight">
                                          {shift.store_id !== staff.store_id && (
                                            <span className="bg-indigo-600 text-white px-1 py-0.5 rounded text-[0.6rem] font-bold">
                                              {getStoreCode(shift.store_id)}
                                            </span>
                                          )}
                                        </div>
                                        {/* 2行目: 開始-終了時間 */}
                                        <div className="font-semibold text-gray-800 text-xs leading-tight">
                                          {formatTime(shift.start_time)}-
                                          {formatTime(shift.end_time)}
                                        </div>
                                        {/* 3行目: 合計時間 */}
                                        <div className="text-xs text-gray-600 leading-tight">
                                          {calculateHours(shift.start_time, shift.end_time).toFixed(
                                            1
                                          )}
                                          h
                                        </div>
                                      </div>
                                    )}
                                    {/* Issue #165: 既存シフトがある場合でも別店舗シフト追加ボタン */}
                                    {onShiftClick && (
                                      <button
                                        className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 hover:bg-blue-600 text-white rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-sm"
                                        title="別店舗のシフトを追加"
                                        onClick={e => {
                                          e.stopPropagation()
                                          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
                                          const storeId =
                                            staff.store_id ||
                                            (selectedStores && selectedStores.size > 0
                                              ? Array.from(selectedStores)[0]
                                              : null)
                                          if (storeId) {
                                            onShiftClick({
                                              mode: 'add',
                                              shift: {
                                                date: dateStr,
                                                staff_id: staff.staff_id,
                                                store_id: storeId,
                                                staff_name: staff.name,
                                                store_name: getStoreName(storeId),
                                              },
                                              existingShifts: visibleShifts, // 既存シフト情報も渡す
                                              date: dateStr,
                                              staffId: staff.staff_id,
                                              storeId: storeId,
                                              event: e,
                                            })
                                          }
                                        }}
                                      >
                                        +
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  // 空セル
                                  <div
                                    className={`py-2 flex items-center justify-center ${onShiftClick ? 'group' : ''}`}
                                  >
                                    {onShiftClick && (
                                      <div className="text-gray-300 group-hover:text-gray-500 transition-colors text-xl font-light">
                                        +
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                            )
                          })}
                        </React.Fragment>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

export default MultiStoreShiftTable
