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
 * ✅ 契约对齐（R215 GAP-F8，2026-09-25 头注纠偏）：SopTemplateController 实有 9 端点
 * （list :44 / current :52 / get :60 / copy :68 / update :75 / publish :83 / revert :90 /
 *  instantiate :97 / instances :106），此前头注自称「9 函数均已对齐」系虚标——实测仅 7 export。
 * 本文件现 8 函数 = 版本链读写 7 + instances 快照读口（本轮 F8 补齐）；
 * instantiate（POST /{templateId}/instantiate，query projectId 无 body）域归属钉死随 GAP-B2
 * 等 owner 拍板，本卡不接、不虚标（准备包 gap-f7-f11-change-plans.md §F8 纠偏①③）。
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

// ----- 实例快照读口（R215 GAP-F8；controller :96-111。instantiate 归 GAP-B2 未接）-----

/** 实例状态值域（SopTemplateInstance.Status :65-69：ACTIVE|SUPERSEDED|ARCHIVED；未知值 string 兜底）。 */
export type IpdSopInstanceStatus = 'ACTIVE' | 'ARCHIVED' | 'SUPERSEDED' | string;

/**
 * 项目实例快照（domain/SopTemplateInstance.java:24-59）。
 * id/templateId/projectId/instanceVersion 均 Long（雪花双形态）→ 一律 string 透传
 * （instanceVersion 理论可超 2^53，同样不做数值化）；snapshotJson 为不可变 JSON 串
 * （快照点动作目录全集，BR-IPD-SOP-03），解析兜底在视图层、api 层原样透传；
 * instantiatedAt（java.util.Date → ISO 串，JacksonConfig 未定制其序列化）与
 * instantiatedBy（Person ID，后端即 String）原样透传，严禁日期运算；
 * delFlag/tenantId 展示无意义，不建模。
 */
export interface IpdSopInstance {
  id: string;
  instanceVersion: string;
  instantiatedAt: null | string;
  instantiatedBy: null | string;
  projectId: string;
  snapshotJson: string;
  status: IpdSopInstanceStatus;
  templateId: string;
}

/** 实例行归一（仿 normalizeItem 范式；全字段 string 透传，无计数类 Number 点）。 */
function normalizeInstance(raw: unknown): IpdSopInstance {
  const row = toRecord(raw);
  return {
    id: row.id === undefined || row.id === null ? '' : String(row.id),
    instanceVersion:
      row.instanceVersion === undefined || row.instanceVersion === null
        ? ''
        : String(row.instanceVersion),
    instantiatedAt: row.instantiatedAt == null ? null : String(row.instantiatedAt),
    instantiatedBy: row.instantiatedBy == null ? null : String(row.instantiatedBy),
    projectId: row.projectId === undefined || row.projectId === null ? '' : String(row.projectId),
    snapshotJson: String(row.snapshotJson ?? ''),
    status: String(row.status ?? ''),
    templateId: row.templateId === undefined || row.templateId === null ? '' : String(row.templateId),
  };
}

/**
 * 按项目列出 SOP 实例快照（controller :106-111，权限注解码 ipd:sop-template:list + requireInternal；
 * service listInstancesByProject :418-429 项目成员 IDOR fail-closed、SUPER_ADMIN 豁免，instanceVersion 倒序）。
 * projectId 必填（@RequestParam Long :108）：空串在 api 层显式拒绝、不发请求
 * （准备包「不发请求 / PARAM_INVALID 透传」二选一，本实现锁定前者）。
 * query 按 URL 内联模板拼串（stage-action.ts:166 同款；projectId 数字串经 encodeURIComponent 防注入）。
 * 对应 SopTemplateController#listInstances — GET /sop-templates/instances?projectId=
 */
export async function listSopTemplateInstances(projectId: string): Promise<IpdSopInstance[]> {
  const pid = String(projectId ?? '').trim();
  if (!pid) {
    throw new Error('projectId 必填：GET /sop-templates/instances 需携带项目 ID');
  }
  const rows = await ipdGet<unknown[]>(
    `/sop-templates/instances?projectId=${encodeURIComponent(pid)}`,
  );
  return Array.isArray(rows) ? rows.map(normalizeInstance) : [];
}
