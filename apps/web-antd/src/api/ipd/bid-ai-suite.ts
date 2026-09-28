/**
 * 招投标 AI 起草 / 应标完整性检查接口（AI-P2-2 #1/#2，后端 BidAiDraftController /
 * BidResponseCheckController）。
 *
 * 真值（2026-09-27 磁盘核实）：
 * - POST /api/v1/bid-invitations/ai-draft —— { projectId, title, brief } → 起草稿
 *   （已登记 AiDocument v1，docType=BID_INVITATION_DRAFT，status=GENERATED 待审核）；
 * - POST /api/v1/bid-invitations/{id}/ai-completeness-check —— { responseNote } →
 *   逐条检查表（MET/PARTIAL/MISSING + 证据）+ 总评；纯只读自检，零业务表写入。
 * 契约要点：
 * - 两口权限均 ipd:project:edit（与 createInvitation / submitResponse 同源）；
 * - 起草失败异常直通（不出半成品草稿）；检查解析不过即 FAIL:PARSE 拒答（不静默补表）；
 * - 起草结果走「预填 → PM 确认 → 正式创建招标单」人工流，检查结果仅供应标人补稿——
 *   二者均不代人工决策；ID 一律字符串透传（禁 Number()，19 位雪花精度）。
 */
import { ipdPost } from './http';

/** 招标书起草请求（projectId 为项目 id 字符串）。 */
export interface BidDraftRequest {
  /** PM 原始需求（必填，≤25000 字）。 */
  brief: string;
  projectId: string;
  /** 招标标题（必填，≤200 字）。 */
  title: string;
}

/** POST /bid-invitations/ai-draft 响应（BidAiDraftService.BidDraftView）。 */
export interface BidDraftView {
  content: string;
  /** 草稿文档 id（AiDocument v1，字符串 ID 契约）。 */
  docId: string;
  latencyMs: number;
  model: null | string;
  status: string;
  title: string;
  tokenPrompt: number;
  tokenCompletion: number;
}

/** 单条完整性检查行（后端 CheckRow；status 三值白名单）。 */
export interface BidCheckRow {
  evidence: string;
  requirement: string;
  status: 'MET' | 'MISSING' | 'PARTIAL';
}

/** POST /bid-invitations/{id}/ai-completeness-check 响应（BidResponseCheckService.CheckView）。 */
export interface BidCheckView {
  checks: BidCheckRow[];
  completionTokens: number;
  invitationId: string;
  invitationTitle: null | string;
  latencyMs: number;
  model: null | string;
  summary: string;
  tokenPrompt: number;
}

/**
 * AI 起草招标书（文档生成类；产出登记版本链 v1 待审核，不建招标单不发布）。
 * 对应 BidAiDraftController#aiDraft — POST /api/v1/bid-invitations/ai-draft
 */
export function draftBidInvitationDoc(projectId: string, title: string, brief: string): Promise<BidDraftView> {
  return ipdPost<BidDraftView>('/bid-invitations/ai-draft', { brief, projectId, title });
}

/**
 * 应标完整性检查（提交前自检，只读；后端每次调用落一行 AI_BID_CHECK 审计）。
 * 对应 BidResponseCheckController#aiCheck — POST /api/v1/bid-invitations/{id}/ai-completeness-check
 */
export function checkBidResponseCompleteness(invitationId: string, responseNote: string): Promise<BidCheckView> {
  return ipdPost<BidCheckView>(
    `/bid-invitations/${encodeURIComponent(invitationId)}/ai-completeness-check`,
    { responseNote },
  );
}
