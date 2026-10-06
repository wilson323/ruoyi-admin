/**
 * AI 文档版本链接口（页14 项目详情-文档与交付物 / 页42 AI 文档助手）。
 *
 * 真值：AiDocumentController（P1-10.1 版本链 + P4-2.2 生成端点 + P4-2.3 归档/拒绝/历史/diff）。
 * 已交付端点：POST /generate、POST 登记 v1、POST /{id}/revise、
 *   POST /{id}/versions/{versionId}/review、
 *   POST /{id}/versions/{versionId}/archive（P4-2.3，REQUIRED REVIEWED）、
 *   POST /{id}/versions/{versionId}/reject（P4-2.3，comment 必填）、
 *   GET /{id}/versions、GET /{id}/history、GET /{id}/diff?from=&to=。
 * P1-3 已交付：GET /ai-documents?projectId=X（按项目列文档链头）——列表区由 documents.vue 调此封装。
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
import { ipdGet, ipdPost, ipdUpload } from './http';

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
  /** 退回意见。只属于这一版；没有意见时为空。 */
  reviewComment?: null | string;
  reviewedAt: null | string;
  reviewedBy: null | string;
  status: string;
  title: string;
  tokenCompletion: null | number;
  tokenPrompt: null | number;
  versionNo: number;
}

/**
 * AI-P1-1：promptType 模板枚举（真值：后端 org.ruoyi.ipd.domain.PromptType，逐值照抄禁止自造）。
 * 口径 = 卡面 7 值（PRD/MRD/BRD/CHARTER/TEST_REPORT/RELEASE_NOTE/REVIEW）
 * + AI-P3 场景包·复盘起草（US-L1-09）：RETROSPECTIVE。
 * 后端语义：非空但非法 → PARAM_INVALID 拒绝（不降级）；null/空/缺省 → 裸 prompt 直传老逻辑。
 * 与审计 aiRole 白名单（draft/precheck/summarize…）正交，不可混用。
 */
export const AI_DOCUMENT_PROMPT_TYPES = [
  'PRD',
  'MRD',
  'BRD',
  'CHARTER',
  'TEST_REPORT',
  'RELEASE_NOTE',
  'REVIEW',
  'RETROSPECTIVE',
] as const;

export type AiDocumentPromptType = (typeof AI_DOCUMENT_PROMPT_TYPES)[number];

/** AI 生成入参（P4-2.2 AiGenerateReq）：prompt = PM 录入的原始资料/生成指令（≤ 30000 字符）。 */
export interface AiDocumentGenerateInput {
  docType?: null | string;
  projectId: string;
  prompt: string;
  /** AI-P1-1 模板类型：不传/null/undefined → 不带该键（裸 prompt 老逻辑，旧调用零破坏）。 */
  promptType?: AiDocumentPromptType | null;
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

/** 导入终稿入参（POST /{id}/import，multipart）：file 为系统外定稿（docx/pdf/md/txt，≤20MB）。 */
export interface AiDocumentImportInput {
  baseVersionId: string;
  file: File;
  title?: null | string;
}

/** 人工拒绝入参（P4-2.3 RejectReq）：comment 必填，前端 Modal + Form rule 双重校验。 */
export interface AiDocumentRejectInput {
  comment: string;
}

/**
 * 字段级 diff 单条（P4-2.3 GET /ai-documents/{id}/diff 归一化后的行）。
 *
 * 注意：`changeType` 是前端推导的，**后端 FieldDiff 没有这个字段**——后端只有
 * `field / fromValue / toValue / fromSha256 / toSha256`（AiDocumentService.FieldDiff）。
 * 后端 `title`/`content` 恒非空（`createGenerated` 与两条 revise 路径均强制），
 * 因此 `added` / `removed` 目前不可达，保留作前向兼容；`unchanged` 已删除——
 * 差异列表里不列相等行，相等行在归一化阶段直接丢弃。
 */
export interface AiDocumentDiffField {
  changeType: 'added' | 'modified' | 'removed';
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

/**
 * 时间字段兼容层（R215 B4 实测）：后端 Date 序列化实为 epoch 毫秒数字
 * （/versions createTime 与 /history createdAt 均现形 1790261069000），
 * 早期代码只认字符串→时间全显「待补充」。现数字/字符串两态都收，无效值退回 null。
 */
export function toTimeText(value: unknown): null | string {
  if (value == null) return null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) {
    let ms = Number(value);
    if (ms < 1e12) ms *= 1000; // 秒级时间戳补齐
    const raw = new Date(ms);
    if (Number.isNaN(raw.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}T${pad(raw.getHours())}:${pad(raw.getMinutes())}:${pad(raw.getSeconds())}`;
  }
  if (typeof value === 'string') {
    const normalized = normalizeDateTime(value);
    return Number.isNaN(new Date(normalized).getTime()) ? null : normalized;
  }
  return null;
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
    createTime: toTimeText(record.createTime),
    docType: typeof record.docType === 'string' ? record.docType : null,
    id: record.id,
    model: typeof record.model === 'string' ? record.model : null,
    parentVersionId: isIdString(record.parentVersionId) ? record.parentVersionId : null,
    projectId: record.projectId,
    reviewComment: typeof record.reviewComment === 'string' ? record.reviewComment : null,
    reviewedAt: toTimeText(record.reviewedAt),
    reviewedBy: isIdString(record.reviewedBy) ? record.reviewedBy : null,
    status: record.status,
    title: record.title,
    tokenCompletion: typeof record.tokenCompletion === 'number' ? record.tokenCompletion : null,
    tokenPrompt: typeof record.tokenPrompt === 'number' ? record.tokenPrompt : null,
    versionNo: record.versionNo,
  };
}

function isChangeType(value: unknown): value is AiDocumentDiffField['changeType'] {
  return value === 'added' || value === 'modified' || value === 'removed';
}

function textOrNull(value: unknown): null | string {
  return typeof value === 'string' ? value : null;
}

/**
 * 把后端 FieldDiff（differences/fromValue/toValue）或旧 fields 契约收成同一条。
 * 非法 changeType、非字符串 from/to 直接丢掉，不把坏行当成差异。
 */
function toDiffField(value: unknown): AiDocumentDiffField | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.field !== 'string' || record.field.length === 0) return null;
  if (isChangeType(record.changeType)) {
    const fromOk = record.from === null || record.from === undefined || typeof record.from === 'string';
    const toOk = record.to === null || record.to === undefined || typeof record.to === 'string';
    if (!fromOk || !toOk) return null;
    return { changeType: record.changeType, field: record.field, from: textOrNull(record.from), to: textOrNull(record.to) };
  }
  if (!('fromValue' in record) && !('toValue' in record)) return null;
  const from = textOrNull(record.fromValue);
  const to = textOrNull(record.toValue);
  // 相等行不是差异：后端只产出不相等的字段（AiDocumentService#diff 的 safeEq 判据），
  // 这里防御性丢弃，避免旧契约的「单条 unchanged」形态混进差异列表。
  if (from === to) return null;
  const changeType: AiDocumentDiffField['changeType'] =
    from == null ? 'added' : to == null ? 'removed' : 'modified';
  return { changeType, field: record.field, from, to };
}

/**
 * AI 生成（P4-2.2，AC-AI-02）：PM 录入原始资料 → 模型润色/补齐/标准化 → 登记 v1 待审核（BR-AI-02）。
 * AI-P1-1：可选 promptType（AiDocumentPromptType）按后端字段名上送，后端套内置模板；
 * 不传/undefined/null 时请求体不带该键（旧调用向后兼容，零破坏）。
 * 护栏在服务端：60s 超时 / 并发限流（40011）/ 月度 token 预算（40013）；
 * 输出透传不过滤（BR-AI-04），风险把控在人工审核 + UI 风险提示。
 */
export async function generateAiDocument(input: AiDocumentGenerateInput): Promise<AiDocument> {
  return parseAiDocument(await ipdPost('/ai-documents/generate', {
    docType: input.docType ?? undefined,
    projectId: input.projectId,
    prompt: input.prompt,
    // AI-P1-1：按后端字段名 promptType 上送；不传/undefined/null → undefined，
    // JSON.stringify 丢弃该键（老 payload 形态，后端 null → 裸 prompt 直传）。
    promptType: input.promptType ?? undefined,
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

/**
 * 人工审计「导入终稿」（POST /ai-documents/{id}/import，multipart）：
 * 把系统外定稿（docx/pdf/md/txt）解析为正文，沿版本链追加 v(n+1) 待审核；
 * 之后沿用原审核/定档链传给下一节点。基准非当前链头 → 409（50002），与改版同语义。
 */
export async function importAiDocumentFinalVersion(documentId: string, input: AiDocumentImportInput): Promise<AiDocument> {
  if (!/^\d+$/.test(input.baseVersionId)) {
    throw new IpdRequestError('基准版本 ID 必须为纯数字');
  }
  const form = new FormData();
  form.append('file', input.file);
  form.append('baseVersionId', input.baseVersionId);
  if (input.title) form.append('title', input.title);
  return parseAiDocument(await ipdUpload(`/ai-documents/${documentId}/import`, form));
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
 * 退回修改。comment 必填，写在 versionId 这一版。
 * 链头待审核或已审核可退回；已退回不覆盖原意见。
 */
export async function rejectAiDocumentVersion(documentId: string, versionId: string, input: AiDocumentRejectInput): Promise<AiDocument> {
  return parseAiDocument(await ipdPost(`/ai-documents/${documentId}/versions/${versionId}/reject`, {
    comment: input.comment,
  }));
}

/**
 * P1-3：按项目 ID 列 AI 文档（页14 项目详情-文档与交付物列表区）。
 * 路径：GET /api/v1/ai-documents?projectId=X；后端沿用 ipd:ai-document:list 读码（内部四角色全员可读）。
 * 返回每条文档链的 v1 链头（parent_version_id IS NULL）；如需看每条链的全部版本，调 listAiDocumentVersions(documentId)。
 */
export async function listAiDocumentsByProject(projectId: number | string): Promise<AiDocument[]> {
  const id = String(projectId);
  if (!/^\d+$/.test(id)) {
    throw new IpdRequestError('项目 ID 必须为纯数字');
  }
  const data = await ipdGet<unknown>('/ai-documents', { projectId: id });
  if (!Array.isArray(data)) throw new IpdRequestError('文档列表数据格式异常，请稍后重试');
  return data.map((item) => parseAiDocument(item));
}

/** 完整版本链 v1..vN 升序（链断裂后端按 409 报出）。 */
export async function listAiDocumentVersions(documentId: string): Promise<AiDocument[]> {
  const data = await ipdGet<unknown>(`/ai-documents/${documentId}/versions`);
  if (!Array.isArray(data)) throw new IpdRequestError('版本链数据格式异常，请稍后重试');
  return data.map((item) => parseAiDocument(item));
}

/**
 * 版本链回溯视图单行（P4-2.3 GET /api/v1/ai-documents/{id}/history，AC-AI-05）：
 * 后端 HistoryItem 投影——比 /versions 多 reviewedBy/archivedAt（谁审的、何时归档），
 * 专为历史侧栏渲染。ID/人为后端 Long→字符串序列化（IPD 约定字符串 ID 透传）。
 */
export interface AiDocumentHistoryItem {
  archivedAt: null | string;
  author: null | string;
  createdAt: string;
  reviewedBy: null | string;
  status: string;
  versionId: string;
  versionNo: number;
}

/**
 * 版本链回溯视图（R215 B4 真接）：原实现返 /versions 同构数据属冒充封装
 * （history 端点因此长期挂在契约孤儿清单），现改调真正的 /history 端点，
 * 补齐 reviewedBy/archivedAt 审计字段。链断时后端按 409/STATE_CONFLICT 报出。
 */
export async function getAiDocumentHistory(documentId: string): Promise<AiDocumentHistoryItem[]> {
  const data = await ipdGet<unknown>(`/ai-documents/${documentId}/history`);
  if (!Array.isArray(data)) throw new IpdRequestError('历史视图数据格式异常，请稍后重试');
  return data.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      archivedAt: toTimeText(record.archivedAt),
      author: record.author == null ? null : String(record.author),
      createdAt: toTimeText(record.createdAt) ?? '',
      reviewedBy: record.reviewedBy == null ? null : String(record.reviewedBy),
      status: String(record.status ?? ''),
      versionId: String(record.versionId ?? ''),
      versionNo: Number(record.versionNo ?? 0),
    };
  });
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
  // 只认后端真实键名 differences。原实现还有一个 fields 兜底分支，而 fields 是
  // 归一化后的前端类型、后端从不返回——兜底会让契约变更静默通过，故删除。
  if (!Array.isArray(record.differences)) throw new IpdRequestError('Diff 响应缺少差异列表');
  const fields = record.differences
    .map(toDiffField)
    .filter((field): field is AiDocumentDiffField => field !== null);
  // 防错配：后端回传的版本 ID 必须与本次请求一致，否则展示的就是另一对版本的对照。
  // 后端 Long 经 @Primary ObjectMapper 恒序列化为字符串，String() 兜住数字形态。
  if (record.fromVersionId != null && String(record.fromVersionId) !== fromVersionId) {
    throw new IpdRequestError('Diff 响应版本与请求不一致（from）');
  }
  if (record.toVersionId != null && String(record.toVersionId) !== toVersionId) {
    throw new IpdRequestError('Diff 响应版本与请求不一致（to）');
  }
  return { fields, fromVersionId, toVersionId };
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
