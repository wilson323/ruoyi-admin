/**
 * Gate 评审要素接口（页47；后端 GateElementController /api/v1/gate-elements）。
 *
 * path 不含 `/api/v1` 前缀（`requestIpd` 内部自动补全）。
 *
 * 后端真值（P1-6 补口 / R174-P0.8 / R175-A 全生命周期）：
 * - 列表只返回 enabled='1' 的启用要素（按 sortOrder 升序）；停用后从列表消失；
 * - 管理视图（/manage）返回全部生命周期（draft/published/archived + 停用），仅超管；
 * - 新建即 draft（enabled 强制 '0'）→ publish 转正（enabled '1'、version 递增）→ archive 归档；
 * - 新建（ipd:gate-element:add）/更新（edit）/停用（remove）/启用（update enabled='1'）均仅超管；
 * - 编码即身份：更新白名单不含 gateCode/elementCode；无删除接口（G-02 禁删，仅停用）；
 * - isVeto='1' 为否决项（命中无法提交通过），enabled='1' 为启用；
 * - 复制（copy）需指定 newElementCode；副本（duplicate）自动生成 "-DUP" 编码 + 「（副本）」名称；
 * - 回滚（revert）需指定 auditLogId；恢复（restore）将 archived 复活为 draft。
 */
import { ipdGet, ipdPost } from './http';

/** 适用 Gate（G1..G5）。 */
export type IpdGateCode = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export const IPD_GATE_CODES: IpdGateCode[] = ['G1', 'G2', 'G3', 'G4', 'G5'];

/** 生命周期（与后端 GateElementService.STATUS_* 对齐）。 */
export type IpdGateElementStatus = 'archived' | 'draft' | 'published';
export const IPD_GATE_ELEMENT_STATUSES: readonly IpdGateElementStatus[] = Object.freeze([
  'archived',
  'draft',
  'published',
]);

/** '1' 启用 / '0' 停用。 */
export type IpdGateElementEnabled = '0' | '1';

export interface IpdGateElement {
  /** '1' 启用 / '0' 停用 */
  enabled: IpdGateElementEnabled;
  elementCode: string;
  elementName: string;
  gateCode: string;
  id: string;
  /** '1' 否决项 / '0' 普通项 */
  isVeto: IpdGateElementEnabled;
  passStandard: null | string;
  sortOrder: null | number;
  /** 阈值 JSON 配置（键非空、值均为整数），如 {"minCustomerVerifications":3}；可空。 */
  thresholdJson?: string;
  /** 双否决位：'1' 需双签否决 / '0' 否；仅 isVeto='1' 时有意义（评审侧 P2-5.2 消费）。 */
  vetoDualRequired?: string;
  /** 仅 manage 视图返回：业务列表（listGateElements）不携带此字段 */
  status?: IpdGateElementStatus;
  /** 仅 manage 视图返回：乐观锁 */
  version?: null | number;
}

/** 新建白名单（后端 GateElementCreateReq）。 */
export interface IpdGateElementCreateReq {
  elementCode: string;
  elementName: string;
  enabled: IpdGateElementEnabled;
  gateCode: IpdGateCode | string;
  isVeto: IpdGateElementEnabled;
  passStandard?: null | string;
  sortOrder?: null | number;
  /** 阈值 JSON 配置（键非空、值均为整数），如 {"minCustomerVerifications":3}；可空。 */
  thresholdJson?: string;
  /** 双否决位：'1' 需双签否决 / '0' 否；仅 isVeto='1' 时有意义。 */
  vetoDualRequired?: string;
}

/** 更新白名单（后端 GateElementUpdateReq：编码不可改）。 */
export interface IpdGateElementUpdateReq {
  elementName: string;
  enabled: IpdGateElementEnabled;
  isVeto: IpdGateElementEnabled;
  passStandard?: null | string;
  sortOrder?: null | number;
  /** 阈值 JSON 配置（键非空、值均为整数），如 {"minCustomerVerifications":3}；可空。 */
  thresholdJson?: string;
  /** 双否决位：'1' 需双签否决 / '0' 否；仅 isVeto='1' 时有意义。 */
  vetoDualRequired?: string;
}

/** 启用按钮专用：仅修改 enabled='1'，其它字段由后端保持现状。 */
export interface IpdGateElementEnableReq {
  elementName?: string;
  enabled: '1';
  isVeto?: IpdGateElementEnabled;
  passStandard?: null | string;
  sortOrder?: null | number;
}

function normalize(raw: unknown): IpdGateElement {
  const row = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const statusRaw = row.status;
  let status: IpdGateElementStatus | undefined;
  if (statusRaw === 'draft' || statusRaw === 'published' || statusRaw === 'archived') {
    status = statusRaw;
  }
  const versionRaw = row.version;
  const thresholdRaw = row.thresholdJson;
  const vetoDualRaw = row.vetoDualRequired;
  return {
    enabled: row.enabled === '1' ? '1' : '0',
    elementCode: String(row.elementCode ?? ''),
    elementName: String(row.elementName ?? ''),
    gateCode: String(row.gateCode ?? ''),
    id: row.id === undefined || row.id === null ? '' : String(row.id),
    isVeto: row.isVeto === '1' ? '1' : '0',
    passStandard: row.passStandard === undefined || row.passStandard === null ? null : String(row.passStandard),
    sortOrder: row.sortOrder === undefined || row.sortOrder === null ? null : Number(row.sortOrder),
    ...(thresholdRaw === undefined || thresholdRaw === null ? {} : { thresholdJson: String(thresholdRaw) }),
    ...(vetoDualRaw === undefined || vetoDualRaw === null ? {} : { vetoDualRequired: String(vetoDualRaw) }),
    ...(status ? { status } : {}),
    ...(versionRaw === undefined || versionRaw === null ? {} : { version: Number(versionRaw) }),
  };
}

/** 业务侧列表查询（?gate 可选过滤 G1..G5；仅含启用要素）。 */
export async function listGateElements(gate?: string): Promise<IpdGateElement[]> {
  const data = await ipdGet<unknown[]>('/gate-elements', gate ? { gate } : undefined);
  return Array.isArray(data) ? data.map(normalize) : [];
}

/** 管理视图列表（?gate 可选过滤；含全部生命周期 draft/published/archived + 停用）。仅超管。 */
export async function listGateElementsForManage(gate?: string): Promise<IpdGateElement[]> {
  const data = await ipdGet<unknown[]>('/gate-elements/manage', gate ? { gate } : undefined);
  return Array.isArray(data) ? data.map(normalize) : [];
}

/** 新建评审要素（要素编码全局唯一，重复时后端拒绝；新建即 draft）。 */
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

/** 启用评审要素（草稿/已停用 → 启用；走 update + enabled='1'，后端保持其它字段现状）。 */
export function enableGateElement(id: string): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/update`, { enabled: '1' } satisfies IpdGateElementEnableReq).then(normalize);
}

/** 发布草稿到 in-use（仅 DRAFT 可发）。 */
export function publishGateElement(id: string): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/publish`).then(normalize);
}

/** 归档要素（draft/published → archived；运营期下架保留审计链）。 */
export function archiveGateElement(id: string): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/archive`).then(normalize);
}

/** 复制要素为新编码草稿（?newElementCode=X；保留原要素历史）。 */
export function copyGateElement(id: string, newElementCode: string): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/copy`, undefined, { newElementCode }).then(normalize);
}

/** 复制为副本草稿（编码自动生成 "源编码-DUP"，名称追加「（副本）」；源要素零改动）。 */
export function duplicateGateElement(id: string): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/duplicate`).then(normalize);
}

/** 回滚要素到指定审计快照（?auditLogId=X；高危操作）。 */
export function revertGateElement(id: string, auditLogId: string | number): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/revert`, undefined, { auditLogId }).then(normalize);
}

/** 恢复归档要素（archived → draft，需人工复核后重新 publish）。 */
export function restoreGateElement(id: string): Promise<IpdGateElement> {
  return ipdPost<unknown>(`/gate-elements/${id}/restore`).then(normalize);
}