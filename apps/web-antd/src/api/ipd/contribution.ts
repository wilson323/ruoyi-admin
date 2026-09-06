/**
 * 贡献度接口（页35 贡献度评定；P3-6.1/6.2；BR-INC-09）。
 *
 * 真值：ContributionController（/api/v1/contribution/...）。
 * 规则：市场 PM 40-65% / 研发 PM 35-60%；上市 90 天复盘三方评定；
 * 归档版本可追溯；变更走审核；奖金引用同一版本；退出/移交不静默重新分配。
 */
import { ipdGet, ipdPost } from './http';

export interface ContributionVersion {
  archivedAt?: null | string;
  contributionMarketMin: number | string;
  contributionRdMax: number | string;
  id: string;
  marketPmShare: number | string;
  period: string;
  projectId: string;
  rdPmShare: number | string;
  status: 'DRAFT' | 'CONFIRMED';
  version: number;
}

/** 项目贡献度版本列表（含历史归档；projectId + period 必填）。 */
export function listContributionVersions(projectId: string, period: string): Promise<ContributionVersion[]> {
  return ipdGet<ContributionVersion[]>('/contribution/versions', { projectId, period });
}

/** 当前生效版本（按 projectId 解析最新 CONFIRMED）。 */
export function getCurrentContribution(projectId: string, period: string): Promise<ContributionVersion> {
  return ipdGet<ContributionVersion>(`/contribution/current`, { projectId, period });
}

/** 提交新版贡献度（产品组长评审入口；走变更审核不静默覆盖）。 */
export function submitContribution(version: Omit<ContributionVersion, 'archivedAt' | 'id' | 'status' | 'version'>): Promise<ContributionVersion> {
  return ipdPost<ContributionVersion>('/contribution/submit', version);
}
