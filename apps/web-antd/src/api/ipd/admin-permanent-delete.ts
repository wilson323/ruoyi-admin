/**
 * 超管永久清除工作台接口封装（R215 GAP-F10；卡 eedf10f1，owner 拍板方案 A 做前端界面）。
 *
 * 后端真值：ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/AdminPermanentDeleteController.java
 * （基路径 /api/v1/admin/permanent-delete :40）：
 * - POST /{entityType}/{id} 执行永久清除（@SaCheckPermission ipd:permanent-delete:execute :56
 *   + requireAdmin 仅超管 :61，service :95 二次兜底；entityType @Pattern person|project|kpi_record :58、
 *   id Long @NotNull :59；body ExecuteReq{confirmCode @NotBlank @Size(max=64)} :88-89，
 *   值必须恰等于 "PERMANENT_DELETE_CONFIRMED" = PermanentDeleteService.REQUIRED_CONFIRM_CODE :49）
 * - GET  /audit 审计对账（同注解码 :75 + requireAdmin :79；query entityType 选填 :77、
 *   limit 默认 50 :78，service 钳制 [1,200] 且按 create_time 倒序 :202-208）
 *
 * 契约口径：
 * - 出参 execute 为 Map{auditId/entityId/operatorId(Long→string), entityType, operatorName,
 *   permanentlyDeleted:true}（controller :63-69）——ID 类一律 String() 归一透传，禁任何数值化
 *   （19 位雪花 >2^53，Number() 即碎精度，hr-sync.test.ts:85-87 金标准）；
 * - audit 行为 PermanentDeleteAudit（domain :43-83，继承 BaseEntity）：id/operatorId/entityId
 *   Long→string；deletedAt 为 java.util.Date（Jackson 默认 ISO 串）→ string 原样透传禁日期运算；
 *   originalDataJson 为被删实体完整 JSON 快照串——api 层仅 string 透传，JSON.parse 容错在视图层；
 * - entityType 白名单三值双保险：TS 联合类型编译期拒 + 运行时守卫（scenario 暂未建模，
 *   后端 @Pattern 兜底 400，service :82-85 同语义）；limit 为分页计数类，是本域唯一 Number 语境；
 * - confirmCode 只属 POST body；GET /audit 严禁携带（准备包本卡禁止项）。
 */
import { ipdGet, ipdPost } from './http';

/** 实体类型白名单（PermanentDeleteService.ALLOWED_ENTITY_TYPES :52；scenario 暂未建模）。 */
export const PERMANENT_DELETE_ENTITY_TYPES = ['person', 'project', 'kpi_record'] as const;

/** 实体类型（白名单三值；TS 编译期拒白名单外取值）。 */
export type PermanentDeleteEntityType = (typeof PERMANENT_DELETE_ENTITY_TYPES)[number];

/** 运行时白名单守卫（视图不可达兜底：绕过类型层强行传入即抛错，不发请求）。 */
function assertEntityType(entityType: string): void {
  if (!(PERMANENT_DELETE_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    throw new Error(
      `entityType 仅允许 person|project|kpi_record（scenario 暂未建模），实际：${entityType}`,
    );
  }
}

/** 执行响应（controller Map.of :63-69 归一：ID 类 string，permanentlyDeleted 严格布尔）。 */
export interface PermanentDeleteResult {
  auditId: string;
  entityType: string;
  entityId: string;
  operatorId: string;
  operatorName: string;
  permanentlyDeleted: boolean;
}

/** 审计行（PermanentDeleteAudit 归一：ID 类 string，deletedAt ISO 串透传，快照原文 string）。 */
export interface PermanentDeleteAuditRow {
  id: string;
  operatorId: string;
  operatorName: string;
  entityType: string;
  entityId: string;
  originalDataJson: string;
  deletedAt: null | string;
  ipAddress: string;
  tenantId: string;
  delFlag: string;
}

/** audit 行归一（仿 person-sync normalizeJob 范式；Date 字段 string 透传不做 Date()）。 */
function normalizeAuditRow(raw: unknown): PermanentDeleteAuditRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id ?? ''),
    operatorId: String(row.operatorId ?? ''),
    operatorName: String(row.operatorName ?? ''),
    entityType: String(row.entityType ?? ''),
    entityId: String(row.entityId ?? ''),
    originalDataJson: row.originalDataJson == null ? '' : String(row.originalDataJson),
    deletedAt: row.deletedAt == null ? null : String(row.deletedAt),
    ipAddress: String(row.ipAddress ?? ''),
    tenantId: String(row.tenantId ?? ''),
    delFlag: String(row.delFlag ?? ''),
  };
}

/**
 * 执行永久清除（仅 SUPER_ADMIN；物理删除不可逆，审计永久保留）。
 * confirmCode 必须由操作人手工敲入字面量 "PERMANENT_DELETE_CONFIRMED"（后端 :89-92 严格相等校验，
 * 错码 → PARAM_INVALID code≠0 抛 IpdRequestError 不吞）；id 为 Long 主键（雪花按 string 透传）。
 * 对应 AdminPermanentDeleteController#execute — POST /admin/permanent-delete/{entityType}/{id}
 */
export async function executePermanentDelete(
  entityType: PermanentDeleteEntityType,
  id: string,
  confirmCode: string,
): Promise<PermanentDeleteResult> {
  assertEntityType(entityType);
  const r = await ipdPost<unknown>(
    `/admin/permanent-delete/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`,
    { confirmCode },
  );
  const row = (r ?? {}) as Record<string, unknown>;
  return {
    auditId: String(row.auditId ?? ''),
    entityType: String(row.entityType ?? ''),
    entityId: String(row.entityId ?? ''),
    operatorId: String(row.operatorId ?? ''),
    operatorName: String(row.operatorName ?? ''),
    permanentlyDeleted: row.permanentlyDeleted === true,
  };
}

/**
 * 列出清除审计（仅 SUPER_ADMIN；javadoc :73 自证「前端对账视图用」）。
 * entityType 选填过滤（缺省=全量）；limit 缺省不发参数（后端默认 50，service 钳 [1,200]）。
 * 对应 AdminPermanentDeleteController#audit — GET /admin/permanent-delete/audit
 */
export async function listPermanentDeleteAudit(
  entityType?: PermanentDeleteEntityType,
  limit?: number,
): Promise<PermanentDeleteAuditRow[]> {
  const query: Record<string, unknown> = {};
  if (entityType) query.entityType = entityType;
  if (limit !== undefined) query.limit = limit;
  const rows = await ipdGet<unknown[]>('/admin/permanent-delete/audit', query);
  return (rows ?? []).map(normalizeAuditRow);
}
