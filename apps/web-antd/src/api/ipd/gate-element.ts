/**
 * Gate 评审要素接口（页47；后端 GateElementController /api/v1/gate-elements）。
 *
 * path 不含 `/api/v1` 前缀（`requestIpd` 内部自动补全）。
 *
 * 后端真值（P1-6 补口 / BR-GATE-01b 配套）：
 * - 列表只返回 enabled='1' 的启用要素（按 sortOrder 升序）；停用后从列表消失；
 * - 新建（ipd:gate-element:add）/更新（edit）/停用（remove）均仅超管；
 * - 编码即身份：更新白名单不含 gateCode/elementCode；无删除接口（G-02 禁删，仅停用）；
 * - isVeto='1' 为否决项（命中无法提交通过），enabled='1' 为启用。
 */
import { ipdGet, ipdPost } from './http';

/** 适用 Gate（G1..G5）。 */
export type IpdGateCode = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export const IPD_GATE_CODES: IpdGateCode[] = ['G1', 'G2', 'G3', 'G4', 'G5'];

export interface IpdGateElement {
  elementCode: string;
  elementName: string;
  /** '1' 启用 / '0' 停用 */
  enabled: string;
  gateCode: string;
  id: string;
  /** '1' 否决项 / '0' 普通项 */
  isVeto: string;
  passStandard: null | string;
  sortOrder: null | number;
}

/** 新建白名单（后端 GateElementCreateReq）。 */
export interface IpdGateElementCreateReq {
  elementCode: string;
  elementName: string;
  enabled: string;
  gateCode: IpdGateCode | string;
  isVeto: string;
  passStandard?: null | string;
  sortOrder?: null | number;
}

/** 更新白名单（后端 GateElementUpdateReq：编码不可改）。 */
export interface IpdGateElementUpdateReq {
  elementName: string;
  enabled: string;
  isVeto: string;
  passStandard?: null | string;
  sortOrder?: null | number;
}

function normalize(raw: unknown): IpdGateElement {
  const row = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    elementCode: String(row.elementCode ?? ''),
    elementName: String(row.elementName ?? ''),
    enabled: String(row.enabled ?? ''),
    gateCode: String(row.gateCode ?? ''),
    id: row.id === undefined || row.id === null ? '' : String(row.id),
    isVeto: String(row.isVeto ?? ''),
    passStandard: row.passStandard === undefined || row.passStandard === null ? null : String(row.passStandard),
    sortOrder: row.sortOrder === undefined || row.sortOrder === null ? null : Number(row.sortOrder),
  };
}

/** 查询评审要素列表（?gate 可选过滤 G1..G5；仅含启用要素）。 */
export async function listGateElements(gate?: string): Promise<IpdGateElement[]> {
  const data = await ipdGet<unknown[]>('/gate-elements', gate ? { gate } : undefined);
  return Array.isArray(data) ? data.map(normalize) : [];
}

/** 新建评审要素（要素编码全局唯一，重复时后端拒绝）。 */
export function createGateElement(req: IpdGateElementCreateReq): Promise<IpdGateElement> {
  return ipdPost<unknown>('/gate-elements', req).then(normalize);
}

/** 更新评审要素（编码不可改）。 */
export function updateGateElement(id: string, req: IpdGateElementUpdateReq): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/update`, req).then(normalize);
}

/** 停用评审要素（禁删：在途判定引用证据链）。 */
export function disableGateElement(id: string): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/disable`).then(normalize);
}
