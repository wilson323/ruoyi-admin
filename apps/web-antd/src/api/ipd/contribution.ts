/**
 * 贡献度接口（页35 贡献度评定；P3-6.1/6.2；BR-INC-09）。
 *
 * 真值：ContributionController（/api/v1/contributions）。
 *
 * ✅ 2026-09-08 契约对齐（全局梳理）：原 `/versions`、`/current`、`/submit`
 *   均为臆造路径。现对齐后端真端点组（单项目视图 + 保存/预览/调整/确认）：
 *   - GET  /api/v1/contributions/{projectId}                     — 当前贡献度视图
 *   - POST /api/v1/contributions/{projectId}/preview             — 公式预览（不改库）
 *   - POST /api/v1/contributions/{projectId}/save                — 双 PM 五维自评保存
 *   - POST /api/v1/contributions/{projectId}/market-share        — 调市场 PM 比例（0.40-0.65）
 *   - POST /api/v1/contributions/{projectId}/confirm             — 组长确认（APPROVE/REJECT）
 *
 * ✅ 2026-09-08 后端补交：归档版本可追溯端点已交付（BR-INC-09）：
 *   - GET  /api/v1/contributions/{projectId}/versions — 历次确认归档快照（versionNo 降序）
 *
 * 规则：市场 PM 40-65% / 研发 PM 35-60%（联动）；上市 90 天复盘三方评定；
 * 奖金引用同一版本；退出/移交不静默重新分配。
 */
import { ipdGet, ipdPost } from './http';

/** ContributionView（ContributionController 真值）。 */
export interface ContributionView {
  id: null | number | string;
  projectId: null | number | string;
  /** DRAFT / CONFIRMED（组长 APPROVE 后确认）。 */
  status: null | string;
  /** 市场 PM 比例（0.40-0.65 区间）。 */
  marketShare: null | number | string;
  /** 研发 PM 比例（与市场联动，35-60%）。 */
  rdShare: null | number | string;
  /** 权重和是否合法（=1.0）。 */
  weightsValid: boolean;
  /** 五维：主动性。 */
  dimInitiation: null | number | string;
  /** 五维：创新性。 */
  dimInnovation: null | number | string;
  /** 五维：上市达成。 */
  dimLaunch: null | number | string;
  /** 五维：市场结果。 */
  dimMarketResult: null | number | string;
  /** 五维：领导力。 */
  dimLeadership: null | number | string;
  /** 贡献度系数（联动负反馈 tierDelta）。 */
  tierCoefficient: null | number | string;
  marketComment: null | string;
  rdComment: null | string;
  leaderId: null | number | string;
  /** APPROVE / REJECT。 */
  leaderDecision: null | string;
  leaderDecidedAt: null | string;
  leaderOpinion: null | string;
  submittedAt: null | string;
  createTime: null | string;
  updateTime: null | string;
}

/** 五维自评保存请求（ContributionSaveReq：role + 五维 0-100 + comment ≤500）。 */
export interface ContributionSaveReq {
  comment?: string;
  dimInnovation: number | string;
  dimInitiation: number | string;
  dimLaunch: number | string;
  dimLeadership: number | string;
  dimMarketResult: number | string;
  role: string;
}

/**
 * 查询项目当前贡献度视图。
 *
 * ✅ `GET /api/v1/contributions/{projectId}`（ContributionService.get）。
 * 权限：ipd:incentive:contribution:query。
 */
export function getContribution(projectId: string): Promise<ContributionView> {
  return ipdGet<ContributionView>(`/contributions/${projectId}`);
}

/**
 * 公式预览（不改库；返回 tierCoefficient 与联动比例）。
 *
 * ✅ `POST /api/v1/contributions/{projectId}/preview`。
 */
export function previewContribution(projectId: string, req: ContributionSaveReq): Promise<ContributionView> {
  return ipdPost<ContributionView>(`/contributions/${projectId}/preview`, req);
}

/**
 * 双 PM 五维自评保存（DRAFT）。
 *
 * ✅ `POST /api/v1/contributions/{projectId}/save`（@Valid：五维 0-100，comment ≤500）。
 */
export function saveContribution(projectId: string, req: ContributionSaveReq): Promise<ContributionView> {
  return ipdPost<ContributionView>(`/contributions/${projectId}/save`, req);
}

/**
 * 调整市场 PM 比例（区间 [0.40, 0.65]，研发联动；仅超管/组长）。
 *
 * ✅ `POST /api/v1/contributions/{projectId}/market-share?marketShare=`。
 */
export function adjustMarketShare(projectId: string, marketShare: number | string): Promise<ContributionView> {
  return ipdPost<ContributionView>(`/contributions/${projectId}/market-share`, undefined, { marketShare });
}

/**
 * 产品组长确认（APPROVE → CONFIRMED；REJECT → 退回 DRAFT）。
 *
 * ✅ `POST /api/v1/contributions/{projectId}/confirm?decision=&opinion=`。
 */
export function confirmContribution(
  projectId: string,
  decision: 'APPROVE' | 'REJECT',
  opinion?: string,
): Promise<ContributionView> {
  const query: Record<string, unknown> = { decision };
  if (opinion) query.opinion = opinion;
  return ipdPost<ContributionView>(`/contributions/${projectId}/confirm`, undefined, query);
}

/** 确认归档快照（ContributionVersionView；BR-INC-09 归档版本可追溯）。 */
export interface ContributionVersion {
  id: null | number | string;
  projectId: null | number | string;
  /** 确认版次（同项目从 1 递增；REJECT 退回后重确认产生新版本）。 */
  versionNo: null | number;
  /** 恒为 CONFIRMED（归档点即确认点）。 */
  status: null | string;
  marketShare: null | number | string;
  rdShare: null | number | string;
  dimInitiation: null | number | string;
  dimInnovation: null | number | string;
  dimLaunch: null | number | string;
  dimMarketResult: null | number | string;
  dimLeadership: null | number | string;
  tierCoefficient: null | number | string;
  marketComment: null | string;
  rdComment: null | string;
  leaderId: null | number | string;
  leaderDecision: null | string;
  leaderDecidedAt: null | string;
  leaderOpinion: null | string;
  submittedAt: null | string;
  archivedBy: null | number | string;
  archivedAt: null | string;
}

/**
 * 历次确认归档快照（versionNo 降序，最新确认在前；每次组长 APPROVE 归档一份）。
 *
 * ✅ `GET /api/v1/contributions/{projectId}/versions`（ContributionService.listVersions）。
 * 权限：ipd:incentive:contribution:query。
 */
export function listContributionVersions(projectId: string): Promise<ContributionVersion[]> {
  return ipdGet<ContributionVersion[]>(`/contributions/${projectId}/versions`);
}
