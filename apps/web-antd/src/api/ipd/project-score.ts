/**
 * 项目绩效评分接口（页31 项目绩效评定 / 页32 项目详情-KPI；P3-2.1/2.2/2.3；AC-KPI-16/16b/16c/18）。
 *
 * 真值：ProjectScoreController（/api/v1/project-scores/...） + ProjectScoreTaskController（评审任务）。
 * 规则：自评 0.2 + 市场组长 0.4 + 研发组长 0.4；两 PM 项目分独立；
 * 评定人为双 PM 自评 + 各自产品组长（无技术委员会 / 评审上级）；
 * 权重参数后台可改，三者之和 = 1.0。
 */
import { ipdGet, ipdPost } from './http';

export type ScoreRole = 'RD_LEADER' | 'SELF' | 'MARKET_LEADER';

export interface ProjectScore {
  comment?: null | string;
  createTime?: null | string;
  id: string;
  period: string;
  personId: string;
  projectId: string;
  role: ScoreRole;
  score: number;
  weightSelf?: null | number | string;
  weightMarketLeader?: null | number | string;
  weightRdLeader?: null | number | string;
  weightedScore?: null | number | string;
}

/** 项目评分列表（projectId + period 必填）。 */
export function listProjectScores(projectId: string, period: string): Promise<ProjectScore[]> {
  return ipdGet<ProjectScore[]>('/project-scores/list', { projectId, period });
}

/** 提交自评 / 组长评（按 role 决定谁能写）；幂等（同一 projectId+period+role 仅一次提交）。 */
export function submitProjectScore(req: Omit<ProjectScore, 'comment' | 'createTime' | 'id' | 'weightedScore'> & { comment?: null | string }): Promise<ProjectScore> {
  return ipdPost<ProjectScore>('/project-scores/submit', req);
}

/** 当前评分任务列表（评定人在途评分项）。 */
export function listMyScoreTasks(): Promise<ProjectScore[]> {
  return ipdGet<ProjectScore[]>('/project-score-tasks/my');
}
