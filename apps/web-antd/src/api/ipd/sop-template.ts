/**
 * SOP 模板接口（页46；后端 SopTemplateController /api/v1/sop-templates）。
 *
 * path 不含 `/api/v1` 前缀——`ipdGet/ipdPost → authenticatedRequest → requestIpd`
 * 内部会自动补 `/api/v1` 前缀；此处只需传业务相对路径。
 *
 * 后端真值（P1-3.3 / BR-IPD-07）：
 * - 读（版本列表/详情）需 ipd:sop-template:list（内部角色）；写（copy/update/publish/revert）仅超管；
 * - 版本生命周期：DRAFT --publish--> PUBLISHED --被新版本替代--> ARCHIVED；
 * - 发布只影响此后实例化的项目，在研项目保持原版本（AC-IPD-27）。
 * - ID 一律按字符串处理（Long 序列化可能为数字，这里归一化为字符串）。
 *
 * ⚠️ 2026-09-10 HTTP 真活验证发现 copy/update/publish/revert 4 个写接口后端路由缺失，
 * 本文件暂时把这 4 个函数 stub 为 reject，等后端补 controller 后再恢复真实调用。
 */
import { ipdGet, ipdPost } from './http';

/** 版本状态（未知值由页面按「待补充」兜底展示）。 */
export type IpdSopStatus = 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';

/** 版本列表轻量视图（不含正文，仅 contentLen 字符长度）。 */
export interface IpdSopTemplateItem {
  actionCode: string;
  contentLen: number;
  id: string;
  status: string;
  title: string;
  version: number;
}

/** 版本详情（含全文；在研项目按快照取历史版本也走详情）。 */
export interface IpdSopTemplateDetail extends IpdSopTemplateItem {
  content: string;
}

/** draft 编辑白名单（后端 SopTemplateSaveReq：title 去空格 2-128 字，content ≥2 字）。 */
export interface IpdSopTemplateSaveReq {
  content: string;
  title: string;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeItem(raw: unknown): IpdSopTemplateItem {
  const row = toRecord(raw);
  return {
    actionCode: String(row.actionCode ?? ''),
    contentLen: Number(row.contentLen ?? 0),
    id: row.id === undefined || row.id === null ? '' : String(row.id),
    status: String(row.status ?? ''),
    title: String(row.title ?? ''),
    version: Number(row.version ?? 0),
  };
}

/** 版本列表（?actionCode 必填；version 倒序，不含正文）。 */
export async function listSopTemplates(actionCode: string): Promise<IpdSopTemplateItem[]> {
  const data = await ipdGet<unknown[]>('/sop-templates', { actionCode });
  return Array.isArray(data) ? data.map(normalizeItem) : [];
}

/** 版本详情（含全文；在研项目按快照取历史版本也走详情）。 */
export async function getSopTemplate(id: string): Promise<IpdSopTemplateDetail> {
  const raw = await ipdGet<unknown>(`/sop-templates/${id}`);
  const row = toRecord(raw);
  return { ...normalizeItem(row), content: String(row.content ?? '') };
}

/** 深管取当前生效的 SOP（PUBLISHED 全文）；无模板时后端返回 404/50001。 */
export async function currentSopTemplate(actionCode: string): Promise<IpdSopTemplateDetail> {
  const raw = await ipdGet<unknown>('/sop-templates/current', { actionCode });
  const row = toRecord(raw);
  return { ...normalizeItem(row), content: String(row.content ?? '') };
}

// ----- 4 个写端点（后端 P1-3.3 / SopTemplateController 已补齐 09-10；发布仅影响新项目，在研保持原版本）-----

/**
 * 复制当前/历史版本为 draft（仅超管；已有 draft 时后端 409）。
 */
export function copySopTemplate(id: string): Promise<IpdSopTemplateItem> {
  return ipdPost<unknown>(`/sop-templates/${id}/copy`).then(normalizeItem);
}

/**
 * 编辑 draft（仅 DRAFT 可改；title/content 白名单）。
 */
export function updateSopTemplate(
  id: string,
  req: IpdSopTemplateSaveReq,
): Promise<IpdSopTemplateItem> {
  return ipdPost<unknown>(`/sop-templates/${id}/update`, req).then(normalizeItem);
}

/**
 * 发布 draft（旧 PUBLISHED 自动 ARCHIVED；仅影响此后实例化的项目）。
 */
export function publishSopTemplate(id: string): Promise<IpdSopTemplateItem> {
  return ipdPost<unknown>(`/sop-templates/${id}/publish`).then(normalizeItem);
}

/**
 * 历史恢复：指定版本复制为新 draft（走正常 publish 流程后才生效）。
 */
export function revertSopTemplate(id: string): Promise<IpdSopTemplateItem> {
  return ipdPost<unknown>(`/sop-templates/${id}/revert`).then(normalizeItem);
}
