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

/**
 * R215 GAP-F1：修改招标条件请求（BidController#modifyInvitation，query 参数，全可选）。
 * 注意：后端 @RequestParam 只读 query string（BidController.java:126-133），JSON body 会被静默忽略；
 * expireAt 必须 yyyy-MM-dd HH:mm:ss（@DateTimeFormat pattern @:130），禁 ISO 带 T/Z 串。
 */
export interface ModifyBidInvitationBody {
  content?: string;
  /** 有效期截止（yyyy-MM-dd HH:mm:ss，与实体 BidInvitation.expireAt 同格式） */
  expireAt?: string;
  title?: string;
}

/**
 * 修改招标条件（发起人本人在有效期内；AC-TEAM-13，service 层校验 createBy 与 OPEN 状态）。
 * 对应 BidController#modifyInvitation — PUT /api/v1/bid-invitations/{id}/modify?title=&content=&expireAt=
 * ipdPut 无 query 形参（http.ts:32）→ 参照 select 的 URL 内联拼法；空值不拼，逐值 encodeURIComponent
 * （空格编为 %20，Spring 侧按 RFC 3986 解码；不用 URLSearchParams 的 + 号形态，避免容器解码差异）。
 */
export function modifyBidInvitation(id: string, body: ModifyBidInvitationBody): Promise<BidInvitation> {
  const parts: string[] = [];
  if (body.title !== undefined && body.title !== '') parts.push(`title=${encodeURIComponent(body.title)}`);
  if (body.content !== undefined && body.content !== '') parts.push(`content=${encodeURIComponent(body.content)}`);
  if (body.expireAt !== undefined && body.expireAt !== '') parts.push(`expireAt=${encodeURIComponent(body.expireAt)}`);
  const query = parts.length > 0 ? `?${parts.join('&')}` : '';
  return ipdPut(`/bid-invitations/${encodeURIComponent(id)}/modify${query}`);
}

/**
 * 超管强制指派（AC-TEAM-09：仅 EXPIRED 挂起超 30 日的招标单；requireAdmin + ipd:bid-invitation:admin-assign）。
 * 对应 BidController#adminAssign — PUT /api/v1/bid-invitations/{id}/admin-assign?targetPersonId=
 * targetPersonId 为后端 Long（@RequestParam @:143），前端 string 透传禁 Number()（19 位雪花精度）。
 */
export function adminAssignBidInvitation(id: string, targetPersonId: string): Promise<BidInvitation> {
  return ipdPut(`/bid-invitations/${encodeURIComponent(id)}/admin-assign?targetPersonId=${encodeURIComponent(targetPersonId)}`);
}

/**
 * R215 GAP-F2：招标单「校验型创建」请求体（BidP231Controller.CreateBidInvitationRequest）。
 * 后端真值：dto/CreateBidInvitationRequest.java:30-60 + service/BidP231Validator.java（防绕过二重校验）。
 * 契约要点：
 * - projectId：后端 Long @NotNull（:32-33）。前端一律 string 透传，禁 Number()/InputNumber——
 *   19 位雪花超 2^53 会精度截断；JSON 字符串形态由后端 Jackson String→Long 无损收编。
 * - expireAt：DTO 无 @DateTimeFormat，但全局 spring.jackson.date-format=yyyy-MM-dd HH:mm:ss
 *   （ruoyi-admin application.yml:150）→ 与既有 POST /bid-invitations 现网口径一致（准备包 §F2 施工核对点闭环）。
 * - targetPersonId：ONE_TO_ONE 必填；PUBLIC 必须整键缺省——后端 Validator 对 PUBLIC 显式拒填
 *   （BidP231Validator「PUBLIC 模式禁止指定 targetPersonId」），传 null 亦拒。
 * - requiredLevel(L1..L5)/slaDays(1..90)：PUBLIC 选填，后端写入 content 扩展字段；ONE_TO_ONE 模式忽略。
 * - slaDays 是计数非 ID，允许 number；ID 类字段禁数值化红线不变。
 */
export interface CreateBidInvitationP231Body {
  content?: string;
  /** 有效期截止（yyyy-MM-dd HH:mm:ss，须未来时间 @Future） */
  expireAt: string;
  mode: 'ONE_TO_ONE' | 'PUBLIC';
  /** 所属项目雪花 ID（string 透传禁 Number()） */
  projectId: string;
  /** 公开征集应标者等级门槛 L1..L5（选填，仅 PUBLIC 生效） */
  requiredLevel?: string;
  /** 公开征集响应 SLA 天数 1..90（选填，仅 PUBLIC 生效；计数字段允许 number） */
  slaDays?: number;
  /** 受邀研发PM 雪花 ID（ONE_TO_ONE 必填；PUBLIC 禁填——调用方须整键省略） */
  targetPersonId?: string;
  /** 招标标题（≤200） */
  title: string;
}

/**
 * 校验型创建招标单（AC-TEAM-01/02；BR-TEAM-03；创建即 OPEN）。
 * 对应 BidP231Controller#createValidated — POST /api/v1/bid-invitations/p231-create（BidP231Controller.java:42-47）
 * 权限 ipd:bid-invitation:create + requireProjectCreator + 项目同组校验（service 层）。
 * 与旧口 POST /bid-invitations（createBidInvitation，保留一个迭代）的差异：
 * 本口带 projectId 必填、mode/targetPersonId 互斥语义、expireAt @Future 与 requiredLevel/slaDays 扩展。
 */
export function createBidInvitationP231(body: CreateBidInvitationP231Body): Promise<BidInvitation> {
  return ipdPost('/bid-invitations/p231-create', body);
}

/**
 * R215 GAP-F9：我的应标分页参数（BidController#listByRdPm query 形态，@RequestParam 默认 1/20；
 * pageSize 有 service 侧 200 硬上限（javadoc:167），超限由后端钳制/拒绝，前端不重复该逻辑）。
 */
export interface ListMyBidResponsesParams {
  pageNo?: number;
  pageSize?: number;
}

/**
 * 分页查询某研发 PM 的全部应标（R215 GAP-F9「我的应标」；BidController#listByRdPm
 * — GET /api/v1/bid-responses/by-rd-pm/{rdPmId}?pageNo=&pageSize=，@GetMapping :170、
 * 权限注解 ipd:project:query 在 :169，纠偏节⑤行号微偏；requireInternal :176）。
 * - rdPmId 是 Person ID：调用方从 /auth/me 的 person.id（string）取，禁复用 vben userStore
 *   被污染的数值态 userId（store/ipd-auth.ts:135 `as unknown as number` 类型面诱导算术，
 *   19 位雪花一经算术即精度碎）；本函数 path 段 encodeURIComponent + string 透传禁 Number()；
 * - IDOR 三分支放行（本人 / SUPER_ADMIN / 关联项目在职 ProjectMember，service javadoc:166 +
 *   W5-E-2.4 :175），服务端会话推导，前端不拼任何绕过参数；
 * - IPage 包络归一：records[].id/invitationId/rdPmId String()（BigNumberSerializer number/string
 *   双形态），total/pages/size/current 计数类 Number()。
 */
export async function listBidResponsesByRdPm(
  rdPmId: string,
  params: ListMyBidResponsesParams = {},
): Promise<IpdPage<BidResponse>> {
  // 以 unknown 收包络再逐字段归一（后端 IPage 的 Long 字段是 number/string 双形态，
  // 直接按 BidResponse 形状断言会被 BigNumberSerializer 的 number 下发骗过类型面）
  const page = await ipdGet<Record<string, unknown> | null>(
    `/bid-responses/by-rd-pm/${encodeURIComponent(rdPmId)}`,
    { ...params },
  );
  const rows = Array.isArray(page?.records) ? (page.records as unknown[]) : [];
  return {
    current: Number(page?.current ?? 1),
    pages: Number(page?.pages ?? 0),
    records: rows.map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      return {
        createBy: r.createBy == null ? null : String(r.createBy),
        createTime: r.createTime == null ? null : String(r.createTime),
        id: String(r.id ?? ''),
        invitationId: String(r.invitationId ?? ''),
        rdPmId: r.rdPmId == null ? null : String(r.rdPmId),
        responseNote: r.responseNote == null ? null : String(r.responseNote),
        respondedAt: r.respondedAt == null ? null : String(r.respondedAt),
        status: String(r.status ?? ''),
      };
    }),
    size: Number(page?.size ?? 0),
    total: Number(page?.total ?? 0),
  };
}
