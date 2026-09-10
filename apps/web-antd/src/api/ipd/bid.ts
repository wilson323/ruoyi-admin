/**
 * 招标组队域接口封装（看板卡 P0-10.19 招标单列表 / P0-10.20 发起招标 / P0-10.21 应标 / P0-10.22 遴选）。
 *
 * 后端真值：ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/BidController.java（P2-3.1 / P2-3.2）。
 * 约定：
 * - ID 一律按字符串传递（雪花 ID 经 BigNumberSerializer 序列化为字符串，前端不做数值化）；
 * - expireAt 后端已就地标注 yyyy-MM-dd HH:mm:ss；其余时间字段前端兼容字符串与毫秒时间戳；
 * - code=0 包络由 http.ts 校验；业务错误码语义以 ApiV1ErrorCode.java 为准；
 * - 应标 decision=reject 成功时后端返回 code=0 且 data=null（BR-TEAM-03 拒绝不留痕），判定成功不要检查 data 非空。
 */
import { ipdGet, ipdPost, ipdPut } from './http';

/** 招标方式：ONE_TO_ONE 定向邀请（指定研发PM）/ PUBLIC 公开征集。 */
export type BidMode = 'ONE_TO_ONE' | 'PUBLIC' | string;

/** 招标单状态机：OPEN → SELECTED / EXPIRED → CLOSED（BR-REC-03，不可逆）。 */
export type BidStatus = 'CLOSED' | 'EXPIRED' | 'OPEN' | 'SELECTED' | string;

/** 应标状态机：PENDING → ACCEPTED（遴选中标）/ REJECTED（遴选落选）/ WITHDRAWN（本人撤回）。 */
export type BidResponseStatus = 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'WITHDRAWN' | string;

/** 招标单（BidInvitation）。 */
export interface BidInvitation {
  content: null | string;
  createBy: null | string;
  createTime: null | string;
  /** 招标方式 */
  mode: BidMode;
  id: string;
  projectId: null | string;
  /** 遴选选定的应标记录 ID（仅 SELECTED 后有值） */
  selectedResponseId: null | string;
  status: BidStatus;
  /** 定向邀请的目标研发PM ID（PUBLIC 时为空） */
  targetPersonId: null | string;
  title: null | string;
  /** 有效期截止时间（yyyy-MM-dd HH:mm:ss） */
  expireAt: null | string;
}

/** 应标记录（BidResponse）。decision 仅提交请求时携带，后端不入库。 */
export interface BidResponse {
  createBy: null | string;
  createTime: null | string;
  decision?: 'accept' | 'reject' | string;
  id: string;
  invitationId: string;
  /** 应标说明（承载 spec 页21 solution_summary，40-500 字） */
  responseNote: null | string;
  /** 研发PM ID（应标时以会话用户为准，服务端权威） */
  rdPmId: null | string;
  /** 应标时间 */
  respondedAt: null | string;
  status: BidResponseStatus;
}

/** MyBatis-Plus IPage 分页包络。 */
export interface IpdPage<T> {
  current: number;
  pages: number;
  records: T[];
  size: number;
  total: number;
}

export interface ListBidInvitationsParams {
  pageNo?: number;
  pageSize?: number;
  projectId?: string;
  status?: string;
}

/** 创建招标单请求体（BidController#createInvitation，仅接收实体已有字段）。 */
export interface CreateBidInvitationBody {
  content: string;
  /** 有效期截止（yyyy-MM-dd HH:mm:ss） */
  expireAt: string;
  mode: 'ONE_TO_ONE' | 'PUBLIC';
  targetPersonId?: null | string;
  title: string;
}

/** 提交应标请求体（BidController#submitResponse）。 */
export interface SubmitBidResponseBody {
  decision: 'accept' | 'reject';
  invitationId: string;
  /** decision=accept 必填（40-500 字）；reject 不需要 */
  responseNote?: string;
}

/**
 * 分页查询招标单。
 * 对应 BidController#listInvitations — GET /api/v1/bid-invitations
 */
export function listBidInvitations(params: ListBidInvitationsParams = {}): Promise<IpdPage<BidInvitation>> {
  return ipdGet('/bid-invitations', { ...params });
}

/**
 * 招标单详情。
 * 对应 BidController#getInvitation — GET /api/v1/bid-invitations/{id}
 */
export function getBidInvitation(id: string): Promise<BidInvitation> {
  return ipdGet(`/bid-invitations/${encodeURIComponent(id)}`);
}

/**
 * 创建招标单（创建即 OPEN，后端无草稿态）。
 * 对应 BidController#createInvitation — POST /api/v1/bid-invitations
 */
export function createBidInvitation(body: CreateBidInvitationBody): Promise<BidInvitation> {
  return ipdPost('/bid-invitations', body);
}

/**
 * 发布招标单（后端当前仅做 OPEN 状态校验，无草稿态可发布；UI 暂未提供发布入口）。
 * 对应 BidController#publishInvitation — PUT /api/v1/bid-invitations/{id}/publish
 */
export function publishBidInvitation(id: string): Promise<BidInvitation> {
  return ipdPut(`/bid-invitations/${encodeURIComponent(id)}/publish`);
}

/**
 * P1-5.2：预演生成 confirmToken（6 字符随机 + 24h 过期）。
 * 对应 BidController#preSelectToken — POST /api/v1/bid-invitations/{id}/pre-select-token
 * 前端先调此端点拿 token 与预演信息，再展示「将向 N 名应标者发送落选通知」，
 * 用户在 UI 勾选「已确认」后，把 token 提交到 /select。
 */
export interface PreSelectTokenView {
  expiresAt: string;
  /** 6 字符随机 token，24h 过期 */
  token: string;
}
export async function preSelectBidInvitationToken(invitationId: string): Promise<PreSelectTokenView> {
  return ipdPost(`/bid-invitations/${encodeURIComponent(invitationId)}/pre-select-token`, {});
}

/**
 * 遴选应标（3 选 1 原子提交：中标行置 ACCEPTED，同单其余 PENDING 行批量置 REJECTED，招标单置 SELECTED）。
 * 对应 BidController#selectResponse — PUT /api/v1/bid-invitations/{id}/select?responseId=&confirmToken=
 * confirmToken 由 preSelectBidInvitationToken 预演生成（24h 过期），防误触提交。
 */
export function selectBidInvitation(invitationId: string, responseId: string, confirmToken: string): Promise<BidInvitation> {
  return ipdPut(`/bid-invitations/${encodeURIComponent(invitationId)}/select?responseId=${encodeURIComponent(responseId)}&confirmToken=${encodeURIComponent(confirmToken)}`);
}

/**
 * 撤回招标单（创建后 24 小时内可撤回，撤回后状态置 CLOSED）。
 * 对应 BidController#withdrawInvitation — PUT /api/v1/bid-invitations/{id}/withdraw
 */
export function withdrawBidInvitation(id: string): Promise<BidInvitation> {
  return ipdPut(`/bid-invitations/${encodeURIComponent(id)}/withdraw`);
}

/**
 * 关闭招标单（OPEN/SELECTED → CLOSED，关闭后不再接受应标）。
 * 对应 BidController#closeInvitation — PUT /api/v1/bid-invitations/{id}/close
 */
export function closeBidInvitation(id: string): Promise<BidInvitation> {
  return ipdPut(`/bid-invitations/${encodeURIComponent(id)}/close`);
}

/**
 * 查询招标单应标列表（隐私过滤：发起人可见全量，其他人仅可见本人应标）。
 * 对应 BidController#listResponses — GET /api/v1/bid-invitations/{id}/responses
 */
export function listBidResponses(invitationId: string): Promise<BidResponse[]> {
  return ipdGet(`/bid-invitations/${encodeURIComponent(invitationId)}/responses`);
}

/**
 * 提交应标（decision=reject 成功时 data 为 null，属 BR-TEAM-03 的 204 语义，不是失败）。
 * 对应 BidController#submitResponse — POST /api/v1/bid-responses
 */
export function submitBidResponse(body: SubmitBidResponseBody): Promise<BidResponse | null> {
  return ipdPost('/bid-responses', body);
}

/**
 * 撤回应标（仅应标本人，状态 PENDING 时可撤回；撤回后可重新应标）。
 * 对应 BidController#withdrawResponse — PUT /api/v1/bid-responses/{id}/withdraw
 */
export function withdrawBidResponse(id: string): Promise<BidResponse> {
  return ipdPut(`/bid-responses/${encodeURIComponent(id)}/withdraw`);
}
