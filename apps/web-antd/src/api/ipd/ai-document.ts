/**
 * AI 文档版本链接口（页14 项目详情-文档与交付物 / 页42 AI 文档助手）。
 *
 * 真值：AiDocumentController（P1-10.1，版本链 v1 锚点 / 人工改版 HEAD 校验 / sha256 摘要 / 审核落名）。
 * 已交付端点：POST 登记 v1、POST /{id}/revise、POST /{id}/versions/{versionId}/review、GET /{id}/versions。
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

/** 完整版本链 v1..vN 升序（链断裂后端按 409 报出）。 */
export async function listAiDocumentVersions(documentId: string): Promise<AiDocument[]> {
  const data = await ipdGet<unknown>(`/ai-documents/${documentId}/versions`);
  if (!Array.isArray(data)) throw new IpdRequestError('版本链数据格式异常，请稍后重试');
  return data.map((item) => parseAiDocument(item));
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
