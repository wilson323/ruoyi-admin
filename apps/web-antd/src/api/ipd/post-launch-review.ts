/**
 * 上市复盘 API（BR-KPI-08 上市后 30 日提醒/90 日升级；后端 PostLaunchReviewController
 * /api/v1/post-launch-reviews；R215 WP3.1 批次2 = ORPHAN-A9 接线）。
 *
 * 后端真值（fab011b1 P2-5.6 done）：
 * - GET  /pending?projectId=   查当前 PENDING 复盘；**无待办时 service 抛业务异常**（code!=0），
 *                              前端 catch IpdRequestError 区分「无待办」与「权限/网络错误」；
 * - POST /                     生成/复用 90 天复盘待办（幂等：同项目已有 PENDING 直接返回旧记录）；
 * - POST /{id}/complete        完成复盘（COMPLETED 终态不可重复；四项正文可缺省）。
 * ID 一律字符串化（19 位雪花 ID 不走 JSON number）。
 */
import { ipdGet, ipdPost } from './http';

/** 复盘视图（PostLaunchReviewView）。 */
export interface PostLaunchReviewView {
  id: string;
  projectId: string;
  scheduledAt: null | string;
  /** PENDING / COMPLETED（终态）。 */
  status: string;
  assigneeId: null | string;
  actualRevenue: null | number | string;
  customerFeedback: null | string;
  kpiAchievement: null | string;
  lessons: null | string;
  completedAt: null | string;
}

/** 完成复盘入参（四项均为复盘正文，可缺省；金额由前端按千分位解析后传数字）。 */
export interface CompleteReviewInput {
  actualRevenue?: number;
  customerFeedback?: string;
  kpiAchievement?: string;
  lessons?: string;
}

/**
 * 查项目当前 PENDING 复盘（GET /post-launch-reviews/pending?projectId=）。
 * 无待办时后端抛业务异常 → 调用方 catch IpdRequestError 呈现「暂无待办复盘」空态。
 */
export function fetchPendingReview(projectId: string): Promise<PostLaunchReviewView> {
  return ipdGet<PostLaunchReviewView>('/post-launch-reviews/pending', { projectId });
}

/** 生成/复用 90 天复盘待办（POST /post-launch-reviews；幂等）。launchDate 格式 yyyy-MM-dd。 */
export function scheduleReview(
  projectId: string,
  launchDate: string,
): Promise<PostLaunchReviewView> {
  return ipdPost<PostLaunchReviewView>('/post-launch-reviews', { projectId, launchDate });
}

/** 完成复盘（POST /post-launch-reviews/{id}/complete；COMPLETED 终态）。 */
export function completeReview(
  id: string,
  input: CompleteReviewInput = {},
): Promise<PostLaunchReviewView> {
  return ipdPost<PostLaunchReviewView>(
    `/post-launch-reviews/${encodeURIComponent(id)}/complete`,
    input,
  );
}
