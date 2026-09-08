/**
 * 项目绩效评分接口（页31 项目绩效评定 / 页32 项目详情-KPI；P3-2.1/2.2/2.3；AC-KPI-16/16b/16c/18）。
 *
 * 真值：ProjectScoreController（/api/v1/project-scores）。
 *
 * ✅ 2026-09-08 契约对齐（全局梳理）：原 `/list`、`/submit`、`/project-score-tasks/my`
 *   均为臆造路径。现对齐后端真端点（三角色评分「一人一项目」汇总视图）：
 *   - GET  /api/v1/project-scores/{projectId}/{personId}         — 评分视图（自评+双组长并排）
 *   - GET  /api/v1/project-scores/{projectId}/{personId}/settle  — 结算（锁定三角色齐备的最新版本）
 *   - POST /api/v1/project-scores                                 — 单组件提交（幂等，重提生成新版本）
 *
 * ✅ 2026-09-08 后端补交：评定人在途任务列表端点已交付
 *   - GET  /api/v1/project-score-tasks/my — 我的在途评分待办（自评 + 我当组长的成员评审，PENDING）
 *
 * 规则：自评 0.2 + 市场组长 0.4 + 研发组长 0.4，三者之和 = 1.0；
 * 两 PM 项目分独立；权重参数后台可改。
 */
import { ipdGet, ipdPost } from './http';

/** 评分组件（ProjectScoreArchiveService.COMPONENTS 三值；权重 0.2/0.4/0.4）。 */
export type ScoreComponent = 'MARKET_LEADER' | 'RD_LEADER' | 'SELF';

/** ProjectScoreView（ProjectScoreArchiveService 真值：一人一项目三角色汇总）。 */
export interface ProjectScoreView {
  projectId: null | number | string;
  personId: null | number | string;
  /** 被评 PM 角色（MARKET_PM / RD_PM；双 PM 独立评分）。 */
  pmRole: null | string;
  /** 评分版本号（重提自增）。 */
  versionNo: null | number;
  /** 规则版本（权重参数版本）。 */
  ruleVersion: null | number;
  selfScore: null | number | string;
  marketLeaderScore: null | number | string;
  rdLeaderScore: null | number | string;
  weightedScore: null | number | string;
  /** 是否已结算（三角色齐备的最新版本被锁定）。 */
  settled: boolean;
}

/**
 * 查询某项目某 PM 的评分视图（三角色并排 + 加权 + 版本）。
 *
 * ✅ `GET /api/v1/project-scores/{projectId}/{personId}`（ProjectScoreArchiveService.view）。
 * 权限：ipd:kpi:query。
 */
export function getProjectScore(projectId: string, personId: string): Promise<ProjectScoreView> {
  return ipdGet<ProjectScoreView>(`/project-scores/${projectId}/${personId}`);
}

/**
 * 结算当前版本（锁定三角色齐备的最新版本）。
 *
 * ✅ `GET /api/v1/project-scores/{projectId}/{personId}/settle`（settleVersion）。
 */
export function settleProjectScore(projectId: string, personId: string): Promise<ProjectScoreView> {
  return ipdGet<ProjectScoreView>(`/project-scores/${projectId}/${personId}/settle`);
}

/**
 * 提交单组件评分（幂等：同 projectId + personId + componentType 重提生成新版本）。
 *
 * ✅ `POST /api/v1/project-scores`（ProjectScoreSubmitReq；score 0-100，reason ≤500）。
 */
export function submitProjectScore(req: {
  componentType: ScoreComponent;
  personId: string;
  projectId: string;
  reason?: string;
  score: number | string;
}): Promise<ProjectScoreView> {
  return ipdPost<ProjectScoreView>('/project-scores', req);
}

/** 我的在途评分待办（MyScoreTaskView；SELF_SCORING=我的自评 / LEADER_REVIEW=我当组长的成员评审）。 */
export interface MyScoreTask {
  projectId: null | number | string;
  /** 项目编码。 */
  projectCode: null | string;
  /** 被评人（SELF=自己；LEADER_REVIEW=被评成员）。 */
  personId: null | number | string;
  personName: null | string;
  /** SELF_SCORING / LEADER_REVIEW。 */
  targetType: null | string;
  /** 截止时间（上市+30/90 日）。 */
  dueAt: null | string;
  /** 恒为 PENDING（在途；DONE/CANCELLED 不返回）。 */
  status: null | string;
  actionUrl: null | string;
  /** dueAt 已过今天。 */
  overdue: boolean;
}

/**
 * 我的在途评分待办（PENDING；dueAt 升序）。
 *
 * ✅ `GET /api/v1/project-score-tasks/my`（ProjectScoreScheduleService.myTasks）。
 * 权限：ipd:kpi:query。
 */
export function listMyScoreTasks(): Promise<MyScoreTask[]> {
  return ipdGet<MyScoreTask[]>('/project-score-tasks/my');
}
