import SubmissionRepository from '../../repositories/shift/SubmissionRepository.js'
import ShiftPlanRepository from '../../repositories/shift/ShiftPlanRepository.js'
import ShiftRepository from '../../repositories/shift/ShiftRepository.js'

/**
 * 参照系（一覧・詳細・サマリー）を集約するサービス。
 * ルート層はここに委譲するだけで、HTTP・SQL の両方を意識しなくて良い。
 */

/**
 * 月次コメント一覧
 */
export async function listMonthlyComments(params) {
  return SubmissionRepository.findMonthlyComments(params)
}

/**
 * シフト提出状況一覧
 */
export async function listSubmissions(params) {
  return SubmissionRepository.findSubmissions(params)
}

/**
 * シフト計画一覧
 */
export async function listPlans(params) {
  return ShiftPlanRepository.findList(params)
}

/**
 * 月別サマリー
 */
export async function getSummary(params) {
  return ShiftPlanRepository.findSummary(params)
}

/**
 * シフト計画詳細（承認者名まで含む）
 */
export async function getPlanDetail(params) {
  return ShiftPlanRepository.findDetailById(params)
}

/**
 * シフト一覧
 */
export async function listShifts(params) {
  return ShiftRepository.searchShifts(params)
}

/**
 * 単一シフト詳細
 */
export async function getShiftById(params) {
  return ShiftRepository.findShiftById(params)
}

export default {
  listMonthlyComments,
  listSubmissions,
  listPlans,
  getSummary,
  getPlanDetail,
  listShifts,
  getShiftById,
}
