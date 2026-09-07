/**
 * AI 文档版本链接口（页14 项目详情-文档与交付物 / 页42 AI 文档助手）。
 *
 * 真值：AiDocumentController（P1-10.1 版本链 + P4-2.2 生成端点 + P4-2.3 归档/拒绝/历史/diff）。
 * 已交付端点：POST /generate、POST 登记 v1、POST /{id}/revise、
 *   POST /{id}/versions/{versionId}/review、
 *   POST /{id}/versions/{versionId}/archive（P4-2.3，REQUIRED REVIEWED）、
 *   POST /{id}/versions/{versionId}/reject（P4-2.3，comment 必填）、
 *   GET /{id}/versions、GET /{id}/history、GET /{id}/diff?from=&to=。
 * 未交付：按项目列出文档的 GET 端点——列表区由页面挂占位（G-06），不在本层封装。
 * 历史版本只读：内容与摘要无任何 HTTP 更新通道，修正 = 产生新版本。
 *
 * 自 2026-09-06 根因分析：原 IPD_ERROR_TEXTS + ipdApiErrorText 内联副本已迁入
 * `_shared/ipd-error-text.ts` 的 ai_document 域默认表。本文件保留 ipdApiErrorText
 * 导出仅为消费方/测试向后兼容；新代码请直接 `import { ipdErrorText } from '.../ipd-error-text'`
 * 并传 `domain: 'ai_document'`。
 *
 * 治理依据：docs/ipd-系统说明/前端架构规约-20260906.md §3
 * 守护机制：scripts/check-ipd-frontend-drift.sh
 */
import { ipdErrorText } from '../../views/ipd/_shared/ipd-error-text';
import { IpdRequestError } from './auth';
import { ipdGet, ipdPost } from './http';

export interface AiDocument {
  content: string;
  /** 内容摘要 sha256 hex（64 字符），版本不可变锚点 */
  contentSha256: null | string;
  createTime: null | string;
  docType: null | string;
  id: string;
  model: null | string;
  parentVersionId: null | string;
  projectId: string;
  reviewedAt: null | string;
  reviewedBy: null | string;
  status: string;
  title: string;
  tokenCompletion: null | number;
  tokenPrompt: null | number;
  versionNo: number;
}

/** AI 生成入参（P4-2.2 AiGenerateReq）：prompt = PM 录入的原始资料/生成指令（≤ 30000 字符）。 */
export interface AiDocumentGenerateInput {
  docType?: null | string;
  projectId: string;
  prompt: string;
  title: string;
}

/** 登记 AI 原始输出 v1 的入参（AiDocumentController.CreateReq）。 */
export interface AiDocumentCreateInput {
  content: string;
  docType?: null | string;
  model?: null | string;
  projectId: string;
  title: string;
  tokenCompletion?: null | number;
  tokenPrompt?: null | number;
}

/** 人工改版入参（ReviseReq）；baseVersionId 为乐观锁基准，非当前链头即 409 状态冲突。 */
export interface AiDocumentReviseInput {
  baseVersionId: string;
  content: string;
  title?: null | string;
}

/** 人工拒绝入参（P4-2.3 RejectReq）：comment 必填，前端 Modal + Form rule 双重校验。 */
export interface AiDocumentRejectInput {
  comment: string;
}

/** 字段级 diff 单条（P4-2.3 AiDocumentDiffResp.FieldDiff）。 */
export interface AiDocumentDiffField {
  changeType: 'added' | 'modified' | 'removed' | 'unchanged';
  field: string;
  from: null | string;
  to: null | string;
}

/** 字段级 diff 整体（P4-2.3 GET /ai-documents/{id}/diff?from=&to=）。 */
export interface AiDocumentDiff {
  fields: AiDocumentDiffField[];
  fromVersionId: string;
  toVersionId: string;
}

const isIdString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value);

/** 全局 date-format 为 "yyyy-MM-dd HH:mm:ss"，空格分隔在部分引擎无法解析，转 ISO 形态。 */
export function normalizeDateTime(value: string): string {
  return value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value;
}

/** 收敛为前端契约：ID 一律字符串、token/版本号一律数字；格式异常直接拒绝，不做静默修补。 */
export function parseAiDocument(data: unknown): AiDocument {
  const record = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
  if (
    !record ||
    !isIdString(record.id) ||
    !isIdString(record.projectId) ||
    typeof record.title !== 'string' ||
    typeof record.content !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.versionNo !== 'number'
  ) {
    throw new IpdRequestError('文档数据格式异常，请稍后重试');
  }
  return {
    content: record.content,
    contentSha256: typeof record.contentSha256 === 'string' ? record.contentSha256 : null,
    createTime: typeof record.createTime === 'string' ? normalizeDateTime(record.createTime) : null,
    docType: typeof record.docType === 'string' ? record.docType : null,
    id: record.id,
    model: typeof record.model === 'string' ? record.model : null,
    parentVersionId: isIdString(record.parentVersionId) ? record.parentVersionId : null,
    projectId: record.projectId,
    reviewedAt: typeof record.reviewedAt === 'string' ? normalizeDateTime(record.reviewedAt) : null,
    reviewedBy: isIdString(record.reviewedBy) ? record.reviewedBy : null,
    status: record.status,
    title: record.title,
    tokenCompletion: typeof record.tokenCompletion === 'number' ? record.tokenCompletion : null,
    tokenPrompt: typeof record.tokenPrompt === 'number' ? record.tokenPrompt : null,
    versionNo: record.versionNo,
  };
}

function isDiffField(value: unknown): value is AiDocumentDiffField {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.field === 'string'
    && (record.changeType === 'added'
      || record.changeType === 'modified'
      || record.changeType === 'removed'
      || record.changeType === 'unchanged')
    && (record.from === null || record.from === undefined || typeof record.from === 'string')
    && (record.to === null || record.to === undefined || typeof record.to === 'string');
}

function parseDiffField(record: Record<string, unknown>): AiDocumentDiffField {
  return {
    changeType: record.changeType as AiDocumentDiffField['changeType'],
    field: typeof record.field === 'string' ? record.field : String(record.field ?? ''),
    from: typeof record.from === 'string' ? record.from : null,
    to: typeof record.to === 'string' ? record.to : null,
  };
}

/**
 * AI 生成（P4-2.2，AC-AI-02）：PM 录入原始资料 → 模型润色/补齐/标准化 → 登记 v1 待审核（BR-AI-02）。
 * 护栏在服务端：60s 超时 / 并发限流（40011）/ 月度 token 预算（40013）；
 * 输出透传不过滤（BR-AI-04），风险把控在人工审核 + UI 风险提示。
 */
export async function generateAiDocument(input: AiDocumentGenerateInput): Promise<AiDocument> {
  return parseAiDocument(await ipdPost('/ai-documents/generate', {
    docType: input.docType ?? undefined,
    projectId: input.projectId,
    prompt: input.prompt,
    title: input.title,
  }));
}

/** 登记 AI 原始输出 v1（版本链首环）。 */
export async function registerAiDocument(input: AiDocumentCreateInput): Promise<AiDocument> {
  return parseAiDocument(await ipdPost('/ai-documents', {
    content: input.content,
    docType: input.docType ?? undefined,
    model: input.model ?? undefined,
    projectId: input.projectId,
    title: input.title,
    tokenCompletion: input.tokenCompletion ?? undefined,
    tokenPrompt: input.tokenPrompt ?? undefined,
  }));
}

/** 人工改版：基于 baseVersionId 追加 v(n+1)；基准非当前最新版 → 409（code 50002）。 */
export async function reviseAiDocument(documentId: string, input: AiDocumentReviseInput): Promise<AiDocument> {
  return parseAiDocument(await ipdPost(`/ai-documents/${documentId}/revise`, {
    baseVersionId: input.baseVersionId,
    content: input.content,
    title: input.title ?? undefined,
  }));
}

/** 人工审核通过（BR-AI-03：AI 输出未经审核不生效）；已审核行幂等返回。 */
export async function reviewAiDocumentVersion(documentId: string, versionId: string): Promise<AiDocument> {
  return parseAiDocument(await ipdPost(`/ai-documents/${documentId}/versions/${versionId}/review`));
}

/**
 * 归档（P4-2.3 archive）：服务端前置要求目标版本为 REVIEWED（BR-AI-03：未审核不得归档）。
 * 前端状态机校验挡住 GENERATED 行；服务端 409 兜底；UI 仅在 REVIEWED 行渲染按钮。
 */
export async function archiveAiDocumentVersion(documentId: string, versionId: string): Promise<AiDocument> {
  return parseAiDocument(await ipdPost(`/ai-documents/${documentId}/versions/${versionId}/archive`));
}

/**
 * 审核拒绝（P4-2.3 reject）：comment 必填，后端 400 抛错；前端 Modal + Form rule 双重拦截。
 * 拒绝后状态变更为 REJECTED，不可再走 review/archive；版本链只读。
 */
export async function rejectAiDocumentVersion(documentId: string, versionId: string, input: AiDocumentRejectInput): Promise<AiDocument> {
  return parseAiDocument(await ipdPost(`/ai-documents/${documentId}/versions/${versionId}/reject`, {
    comment: input.comment,
  }));
}

/** 完整版本链 v1..vN 升序（链断裂后端按 409 报出）。 */
export async function listAiDocumentVersions(documentId: string): Promise<AiDocument[]> {
  const data = await ipdGet<unknown>(`/ai-documents/${documentId}/versions`);
  if (!Array.isArray(data)) throw new IpdRequestError('版本链数据格式异常，请稍后重试');
  return data.map((item) => parseAiDocument(item));
}

/**
 * 版本链回溯视图（P4-2.3 GET /api/v1/ai-documents/{id}/history）：
 * 后端按时间倒序 + 关键字段投影；前端目前与 listAiDocumentVersions 同构，
 * 保留独立封装便于后续后端扩展（如分组、按操作人筛选）切换实现。
 */
export async function getAiDocumentHistory(documentId: string): Promise<AiDocument[]> {
  return listAiDocumentVersions(documentId);
}

/**
 * 字段级 diff（P4-2.3 GET /api/v1/ai-documents/{id}/diff?from=&to=）：
 * 任意两版本对比，支持同基线多版互比；query 串透传字符串版 ID。
 */
export async function getAiDocumentDiff(documentId: string, fromVersionId: string, toVersionId: string): Promise<AiDocumentDiff> {
  if (!/^\d+$/.test(fromVersionId) || !/^\d+$/.test(toVersionId)) {
    throw new IpdRequestError('版本 ID 必须为纯数字');
  }
  const data = await ipdGet<unknown>(`/ai-documents/${documentId}/diff`, { from: fromVersionId, to: toVersionId });
  const record = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
  if (!record) throw new IpdRequestError('Diff 响应数据格式异常');
  const fieldsRaw = Array.isArray(record.fields) ? record.fields : [];
  const fields = fieldsRaw.filter(isDiffField).map((field): AiDocumentDiffField => parseDiffField(field as unknown as Record<string, unknown>));
  return {
    fields,
    fromVersionId: typeof record.fromVersionId === 'string' ? record.fromVersionId : fromVersionId,
    toVersionId: typeof record.toVersionId === 'string' ? record.toVersionId : toVersionId,
  };
}

/**
 * 业务错误码 → 中文文案（向后兼容 shim，原内联表已迁入 _shared/ipd-error-text.ts）。
 *
 * 新代码请直接：
 *   import { ipdErrorText } from '../views/ipd/_shared/ipd-error-text';
 *   ipdErrorText(error, { domain: 'ai_document', fallback: '...' });
 *
 * 行为差异说明（与原内联实现相比，行为更严格）：
 * 1. 未知业务码不再回退到 error.message —— 统一走 options.fallback，
 *    避免向用户暴露后端原始字符串（与 bid/project 域策略一致）。
 * 2. transport 类型统一返回 "无法连接服务，请检查网络后重试"，
 *    不再透传 IpdRequestError.message（与 _shared 默认文案一致）。
 * 3. 错误码→文案总表见 _shared/ipd-error-text.ts IPD_COMMON_CODE_TEXTS / IPD_DOMAIN_DEFAULTS.ai_document。
 */
export function ipdApiErrorText(error: unknown, fallback = '操作失败，请稍后重试'): string {
  return ipdErrorText(error, { domain: 'ai_document', fallback });
}
