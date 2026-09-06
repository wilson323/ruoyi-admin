/**
 * 月度津贴接口（页33 津贴台账；P3-3.1/3.2/3.3；AC-INC-03~08；BR-INC-03）。
 *
 * 真值：AllowanceLedgerController（/api/v1/allowance/...；本月状态扫描口径）。
 * 规则：L1~L5 基数（1000/1500/2000/2500/3000）× 绑定项目数，封顶 2 倍；
 * 综合分 < 60 停发；附加项目 60 天无产出待确认停发单；不乘绩效系数。
 */
import { ipdGet } from './http';

export type AllowanceStatus = 'ACTIVE' | 'FROZEN' | 'PENDING_CONFIRM';

export interface AllowanceLedger {
  amount: null | number | string;
  capReached?: boolean;
  createTime?: null | string;
  id: string;
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  period: string;
  personId: string;
  projectCount: number;
  projectIds: null | string[];
  status: AllowanceStatus;
}

/** 月度津贴台账列表（period 必填 YYYY-MM；personId 可选按角色范围）。 */
export function listAllowances(period: string, personId?: string): Promise<AllowanceLedger[]> {
  return ipdGet<AllowanceLedger[]>('/allowance/ledger', personId ? { period, personId } : { period });
}

/** 当月综合分 < 60 命中扫描结果（停发提示）。 */
export function getAllowancePendingStop(period: string): Promise<AllowanceLedger[]> {
  return ipdGet<AllowanceLedger[]>('/allowance/pending-stop', { period });
}
