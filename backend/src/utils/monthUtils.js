/**
 * 年月・週番号・曜日の純粋計算ユーティリティ。
 *
 * new Date() を使う関数もあるが、いずれもタイムゾーンに依存しない用途
 * （年/月/日から Date を作って dow を取り出すだけ）に限定して使う。
 * shift_date の文字列変換は utils/timeUtils.js の formatDateToYYYYMMDD を使うこと。
 */

/**
 * 前月を計算
 * @param {number} year
 * @param {number} month 1-12
 * @returns {{year:number, month:number}}
 */
export function getPreviousMonth(year, month) {
  if (month === 1) {
    return { year: year - 1, month: 12 }
  }
  return { year, month: month - 1 }
}

/**
 * 指定年月の末日（日）を整数演算のみで取得する。
 * JST/UTC のオフセットずれを避けるため new Date() を使わない。
 */
export function getLastDayOfMonth(year, month) {
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return daysInMonth[month - 1]
}

/**
 * 指定日について「その月で dow が何回目に登場するか」と dow を返す。
 * 曜日ベースのシフトマッピング（例: 「第2月曜日」）に使う。
 *
 * @param {Date} date
 * @returns {{weekNumber:number, dayOfWeek:number}}
 */
export function getWeekInfo(date) {
  const y = date.getFullYear()
  const m = date.getMonth()
  const dayOfWeek = date.getDay()
  const dayOfMonth = date.getDate()

  let weekNumber = 0
  for (let d = 1; d <= dayOfMonth; d++) {
    if (new Date(y, m, d).getDay() === dayOfWeek) {
      weekNumber++
    }
  }
  return { weekNumber, dayOfWeek }
}

export default {
  getPreviousMonth,
  getLastDayOfMonth,
  getWeekInfo,
}
