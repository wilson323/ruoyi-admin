/**
 * 项目域 API（页07/08/09/11/12；后端 ProjectController /api/v1/projects）。
 *
 * path 不含 `/api/v1` 前缀（requestIpd 内部补齐）。
 *
 * 后端真值（G-04 以代码为准）：
 * - GET /projects?keyword= 返回 ProjectListItemView 数组，每行形如
 *   { project: Project, lastActivityAt, scenarioDaysRemaining, critical }
 *   —— project 字段是真正的项目主体，外层派生字段用于 P1-9.2 场景复核倒计时；
 *   normalizeProject 已处理包络解包（2026-09-07 实证，统一事实源，禁页面级
 *   自造解析——2026-09-10 ai-docs bug 反思后强制规约，见 docs/反思-ai-docs-bug-20260911.md）；
 * - POST /projects 走 CODE-01 白名单 DTO，code/status/currentStage/source 服务端权威；
 * - targetMarkets 在后端是 JSON 数组字符串（'["SA","AE"]'），本模块对页面暴露 string[]、
 *   发送前 JSON.stringify；数值字段 Jackson 自动收 BigDecimal/Integer，日期传毫秒时间戳；
 * - POST /{id}/advance-stage 门禁失败返回 400/10001（message 拼接明细），配合 gate-checklist 渲染；
 * - 状态机 DRAFT→TEAMING→ACTIVE↔SUSPENDED→ARCHIVED，非法迁移由服务端拒绝；
 * - 存量导入（仅超管）missingHistoryAck 必须 true，返回 { project, markedCodes }。
 */
import { ipdGet, ipdPost } from './http';

export type ProjectLevel = 'A' | 'B' | 'S';
export type ProjectStage =
  | 'CONCEPT'
  | 'DEV'
  | 'LAUNCH'
  | 'LIFECYCLE'
  | 'PLAN'
  | 'VALID';
export type TemplateType = 'HARDWARE' | 'SOFTWARE' | 'SOLUTION';
export type ProjectStatus =
  | 'ACTIVE'
  | 'ARCHIVED'
  | 'DRAFT'
  | 'SUSPENDED'
  | 'TEAMING';

export interface Project {
  id: string;
  code: null | string;
  name: string;
  productId: string;
  templateType: string;
  /** JSON 数组字符串；用 parseTargetMarkets 解析为 string[]。 */
  targetMarkets: null | string;
  level: string;
  levelCoefficient: null | string;
  levelCoefficientReason: null | string;
  targetSalesAmount: null | string;
  targetChannelCount: null | number;
  targetNps: null | number;
  targetSceneCount: null | number;
  launchDate?: null | number | string;
  currentStage: null | string;
  declaredStage: null | string;
  lifecycleStatus: null | string;
  source: null | string;
  missingHistoryAck: null | string;
  catchupStatus: null | string;
  legacyEffectiveAt?: null | number | string;
  status: string;
  mainGroupId: null | string;
  createBy?: null | string;
  createTime?: null | number | string;
}

/** 新建项目请求体（页08；targetMarkets 传数组，模块内转 JSON 字符串）。 */
export interface ProjectCreateBody {
  launchDate: null | number;
  level: ProjectLevel;
  /** S/B 必填（BR-INC-05 双签定值）；A 级传 null。 */
  levelCoefficient: null | number;
  levelCoefficientReason: null | string;
  /** 可选（2026-09-11 owner 拍板）：BR-ORG-01 归属语义不变，未选传 null；存量导入仍必填。 */
  mainGroupId: null | string;
  name: string;
  productId: string;
  targetChannelCount: number;
  targetMarkets: string[];
  targetNps: number;
  targetSalesAmount: number;
  targetSceneCount: number;
  templateType: TemplateType;
}

/** 存量导入请求体（页09，仅超管；missingHistoryAck 恒 true）。 */
export interface LegacyImportBody {
  declaredStage: ProjectStage;
  legacyEffectiveAt: number;
  level: ProjectLevel;
  levelCoefficient: null | number;
  levelCoefficientReason: null | string;
  mainGroupId: string;
  missingHistoryAck: true;
  name: string;
  productId: string;
  targetChannelCount: number;
  targetMarkets: string[];
  targetNps: number;
  targetSalesAmount: number;
  targetSceneCount: number;
  templateType: TemplateType;
}

export interface LegacyImportResult {
  markedCodes: string[];
  project: Project;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
function asString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
function asNullableString(value: unknown): null | string {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}
function asNullableNumber(value: unknown): null | number {
  if (value === undefined || value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeProject(raw: unknown): Project {
  const outer = toRecord(raw);
  // 真机 2026-09-07 实证：GET /projects 列表行是 {project:{...}} 包裹（头注「裸 List」已漂移）——
  // 不解开则 id/code/name 全空、表格全「待补充」；平铺形态（单查/创建返回）直通不受影响。
  const nested = (outer as Record<string, unknown>).project;
  const row =
    nested !== null && typeof nested === 'object' ? toRecord(nested) : outer;
  return {
    id: asString(row.id),
    code: asNullableString(row.code),
    name: asString(row.name),
    productId: asString(row.productId),
    templateType: asString(row.templateType),
    targetMarkets: asNullableString(row.targetMarkets),
    level: asString(row.level),
    levelCoefficient: asNullableString(row.levelCoefficient),
    levelCoefficientReason: asNullableString(row.levelCoefficientReason),
    targetSalesAmount: asNullableString(row.targetSalesAmount),
    targetChannelCount: asNullableNumber(row.targetChannelCount),
    targetNps: asNullableNumber(row.targetNps),
    targetSceneCount: asNullableNumber(row.targetSceneCount),
    launchDate:
      row.launchDate === undefined || row.launchDate === null
        ? null
        : (row.launchDate as number | string),
    currentStage: asNullableString(row.currentStage),
    declaredStage: asNullableString(row.declaredStage),
    lifecycleStatus: asNullableString(row.lifecycleStatus),
    source: asNullableString(row.source),
    missingHistoryAck: asNullableString(row.missingHistoryAck),
    catchupStatus: asNullableString(row.catchupStatus),
    legacyEffectiveAt:
      row.legacyEffectiveAt === undefined || row.legacyEffectiveAt === null
        ? null
        : (row.legacyEffectiveAt as number | string),
    status: asString(row.status),
    mainGroupId: asNullableString(row.mainGroupId),
    createBy: asNullableString(row.createBy),
    createTime:
      row.createTime === undefined || row.createTime === null
        ? null
        : (row.createTime as number | string),
  };
}

/** targetMarkets 是 JSON 数组字符串；解析失败返回空数组（不抛错）。 */
export function parseTargetMarkets(
  raw: null | number | string | undefined,
): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** 页面 body → 后端 DTO：数组转 JSON 字符串，日期毫秒时间戳透传。 */
function toWire(
  body: LegacyImportBody | ProjectCreateBody,
): Record<string, unknown> {
  return {
    name: body.name,
    productId: body.productId,
    templateType: body.templateType,
    targetMarkets: JSON.stringify(body.targetMarkets),
    level: body.level,
    levelCoefficient: body.levelCoefficient,
    levelCoefficientReason: body.levelCoefficientReason,
    targetSalesAmount: body.targetSalesAmount,
    targetChannelCount: body.targetChannelCount,
    targetNps: body.targetNps,
    targetSceneCount: body.targetSceneCount,
    mainGroupId: body.mainGroupId,
    launchDate: 'launchDate' in body ? body.launchDate : null,
    legacyEffectiveAt:
      'legacyEffectiveAt' in body
        ? (body as LegacyImportBody).legacyEffectiveAt
        : undefined,
    declaredStage:
      'declaredStage' in body
        ? (body as LegacyImportBody).declaredStage
        : undefined,
    missingHistoryAck:
      'missingHistoryAck' in body
        ? (body as LegacyImportBody).missingHistoryAck
        : undefined,
  };
}

// ---------- P1-9.2 项目列表项（派生 3 字段，场景复核倒计时） ----------

/**
 * 项目列表项视图（后端 ProjectListItemView 真值：project 包裹 + 派生 3 字段；前端平铺后与 Project 字段直接同层）。
 * - lastActivityAt = max(stage_action / kpi / gate_review 的 update_time)；
 * - scenarioDaysRemaining = 14 - (today - lastActivityAt) 天（≤3 天临界）；
 * - critical = scenarioDaysRemaining ≤ 3（后端已推送通知，前端横幅告警）。
 */
export interface ProjectListItem extends Project {
  critical: boolean | null;
  lastActivityAt: null | number | string;
  scenarioDaysRemaining: null | number;
}

function normalizeProjectListItem(raw: unknown): ProjectListItem {
  const outer = toRecord(raw);
  return {
    ...normalizeProject(outer),
    critical: typeof outer.critical === 'boolean' ? outer.critical : null,
    lastActivityAt:
      outer.lastActivityAt === undefined || outer.lastActivityAt === null
        ? null
        : (outer.lastActivityAt as number | string),
    scenarioDaysRemaining: asNullableNumber(outer.scenarioDaysRemaining),
  };
}

/** 项目列表（含 P1-9.2 派生 3 字段；项目空间列表页专用）。 */
export function listProjectItems(keyword?: string): Promise<ProjectListItem[]> {
  return ipdGet<unknown>('/projects', keyword ? { keyword } : undefined).then(
    (data) => (Array.isArray(data) ? data.map(normalizeProjectListItem) : []),
  );
}

/**
 * 业务编号 → 数字主键 缓存与翻译器。
 *
 * 后端 @PathVariable Long id 期望雪花 ID（数字串），但页面/路由常承载业务编号
 * （形如 "PRJ-2026-001"）。getProject / listStageActions 等端点内部若直接拼
 * 业务编号会触发 Spring MethodArgumentTypeMismatchException → 500。
 *
 * 自适配策略（保守三层判别，避免误判测 试占位符/异常值）：
 * - 纯数字串 → 雪花 id，直传；
 * - 长度 < 5 或仅字母单字 → 非业务编号形态（如 'x' / 'ab'），直传（后端 404/500 由调用方 catch）；
 * - 其他（含 'PRJ-2026-001' / 形如 'AAAA-2026-NNN'） → 业务编号，走 listProjects 模糊查询。
 *
 * 缓存按 code 维度，避免同一会话重复打后端。
 */
const codeToIdCache = new Map<string, string>();

/** 纯数字串 → 视为已为数字主键，直接透传。 */
function looksLikeProjectId(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * 是否像业务编号：长度 ≥ 5 且不是纯数字。覆盖 'PRJ-2026-001' 这类典型形态，
 * 同时避免 'x' / 'ab' / '99999' 这类短/纯数字误判为业务编号。
 */
function looksLikeProjectCode(value: string): boolean {
  return value.length >= 5 && !looksLikeProjectId(value);
}

/** 业务编号 → 数字主键。命中缓存直返；否则调 listProjects(keyword=code) 找首条。 */
export async function codeToId(code: string): Promise<string> {
  const cached = codeToIdCache.get(code);
  if (cached) return cached;
  const list = await listProjects(code);
  const row = list.find((p) => p.code === code) ?? list[0];
  if (!row || !row.id) {
    throw new Error(`未找到业务编号 ${code} 对应的项目`);
  }
  codeToIdCache.set(code, row.id);
  return row.id;
}

/** 项目列表（keyword 可选，服务端模糊匹配）。 */
export function listProjects(keyword?: string): Promise<Project[]> {
  return ipdGet<unknown>('/projects', keyword ? { keyword } : undefined).then(
    (data) => (Array.isArray(data) ? data.map(normalizeProject) : []),
  );
}

/**
 * 项目详情（idOrCode 自适配）：
 * - 纯数字串视为雪花 id，直接走 GET /projects/{id}（后端 @PathVariable Long id）；
 * - 其他值（含业务编号）走 codeToId 翻译成 id 后再请求；
 *   - 调用方传 'PRJ-2026-001' 也能正确命中项目，浏览器流页因此可恢复。
 */
export async function getProject(idOrCode: string): Promise<Project> {
  const id = looksLikeProjectCode(idOrCode)
    ? await codeToId(idOrCode)
    : idOrCode;
  return ipdGet<unknown>(`/projects/${encodeURIComponent(id)}`).then(
    normalizeProject,
  );
}

export function createProject(body: ProjectCreateBody): Promise<Project> {
  return ipdPost<unknown>('/projects', toWire(body)).then(normalizeProject);
}

/** 存量单条导入（仅超管；返回被标记历史缺失的动作编码）。 */
export function legacyImportProject(
  body: LegacyImportBody,
): Promise<LegacyImportResult> {
  return ipdPost<unknown>('/projects/legacy-import', toWire(body)).then(
    (raw) => {
      const row = toRecord(raw);
      const marked = row.markedCodes;
      return {
        project: normalizeProject(row.project),
        markedCodes: Array.isArray(marked) ? marked.map(String) : [],
      };
    },
  );
}

/** 状态流转（POST /{id}/status?target=；非法迁移由服务端拒绝）。 */
export function changeProjectStatus(
  id: string,
  target: ProjectStatus | string,
): Promise<Project> {
  return ipdPost<unknown>(
    `/projects/${encodeURIComponent(id)}/status`,
    undefined,
    { target },
  ).then(normalizeProject);
}

/** 进入下一阶段（POST /{id}/advance-stage；门禁失败 400/10001 带 checklist 明细）。 */
export function advanceProjectStage(id: string): Promise<Project> {
  return ipdPost<unknown>(
    `/projects/${encodeURIComponent(id)}/advance-stage`,
  ).then(normalizeProject);
}

// ---------- 阶段门禁清单（页12） ----------

export interface GateChecklistItem {
  code: string;
  name: string;
  ok: boolean;
  reason: string;
  stage: string;
  status: null | string;
}

export interface GateChecklistView {
  configVersion: null | string;
  items: GateChecklistItem[];
  level: null | string;
  projectId: string;
  stage: null | string;
}

/** 门禁清单（stage 缺省取当前阶段）。 */
export function getGateChecklist(
  id: string,
  stage?: string,
): Promise<GateChecklistView> {
  return ipdGet<unknown>(
    `/projects/${encodeURIComponent(id)}/gate-checklist`,
    stage ? { stage } : undefined,
  ).then((raw) => {
    const row = toRecord(raw);
    const items = Array.isArray(row.items) ? row.items : [];
    return {
      projectId: asString(row.projectId),
      level: asNullableString(row.level),
      stage: asNullableString(row.stage),
      configVersion: asNullableString(row.configVersion),
      items: items.map((item) => {
        const it = toRecord(item);
        return {
          code: asString(it.code),
          name: asString(it.name),
          stage: asString(it.stage),
          status: asNullableString(it.status),
          ok: it.ok === true,
          reason: asString(it.reason),
        };
      }),
    };
  });
}

// ---------- R215 WP3.1 批次3（ORPHAN-A2 认证项 / A3 基线·上市日期·成员·存量批量） ----------
// 后端真值（ProjectController / ProjectMemberController 2026-09 实码）：
// - GET  /{id}/cert-items                  ProjectCertListView（含 unknownMarkets 提示）；
// - POST /{id}/cert-items/sync             按当前目标市场重新带出模板项（只增不重置 DONE）→ 新增条数；
// - POST /{id}/cert-items                  手工补充（AC-PROD-12 白名单 5 字段）→ 新建项；
// - POST /{id}/cert-items/{itemId}/status?target=  状态流转（PENDING|IN_PROGRESS|DONE|NA；
//        DONE 后不被 sync 重置；@Version 乐观锁并发保护）；
// - POST /{id}/baselines                   DRAFT 期内更新四基准（立项后服务端锁定）；
// - POST /{id}/launch-date                 L08 上市日期初次录入（launchDate 已存在拒绝→双签流程；
//        body {launchDate:yyyy-MM-dd, reason≤500}）；
// - GET/POST /projects/{projectId}/members 在组成员列表 / 绑定成员（P2-4.1 评级快照；
//        role 仅 MARKET_PM|RD_PM 且须与人员 personType 一致=AC-TEAM-10；
//        绑第 threshold 个项目 approvalRef 必填=AC-TEAM-11；Controller 无权限码注解，
//        服务端 requireProjectCreator 角色门 + IpdIdorGuard 组归属断言（跨组 30001/403））；
// - POST /projects/legacy-import/batch     批量导入（超管；错误行隔离不回滚成功行）→ 逐行结果。
// Long 字段后端全局序列化为字符串（雪花 ID 不走 JSON number）；bind 的 personId
// 为请求体 Long，按接线规约显式 Number()（19 位以内业务人员 ID 实测无损）。

/** 项目认证清单项（后端 domain ProjectCertItem；source=AUTO|MANUAL，status=PENDING|IN_PROGRESS|DONE|NA）。 */
export interface ProjectCertItemView {
  id: string;
  projectId: string;
  templateId: null | string;
  countryCode: string;
  countryName: string;
  certName: string;
  certAuthority: null | string;
  requirementDesc: null | string;
  /** '1' 强制 / '0' 可选。 */
  isMandatory: null | string;
  source: string;
  status: string;
  catalogVersion: null | string;
}

/** 认证清单视图（ProjectCertListView；unknownMarkets=无法映射的目标市场 token）。 */
export interface ProjectCertListView {
  projectId: string;
  catalogVersion: null | string;
  unknownMarkets: string[];
  items: ProjectCertItemView[];
}

function normalizeCertItem(raw: unknown): ProjectCertItemView {
  const row = toRecord(raw);
  return {
    id: asString(row.id),
    projectId: asString(row.projectId),
    templateId: asNullableString(row.templateId),
    countryCode: asString(row.countryCode),
    countryName: asString(row.countryName),
    certName: asString(row.certName),
    certAuthority: asNullableString(row.certAuthority),
    requirementDesc: asNullableString(row.requirementDesc),
    isMandatory: asNullableString(row.isMandatory),
    source: asString(row.source),
    status: asString(row.status),
    catalogVersion: asNullableString(row.catalogVersion),
  };
}

/** 认证清单（GET /projects/{id}/cert-items；含未知市场提示）。 */
export function listProjectCertItems(id: string): Promise<ProjectCertListView> {
  return ipdGet<unknown>(`/projects/${encodeURIComponent(id)}/cert-items`).then(
    (raw) => {
      const row = toRecord(raw);
      return {
        projectId: asString(row.projectId),
        catalogVersion: asNullableString(row.catalogVersion),
        unknownMarkets: Array.isArray(row.unknownMarkets)
          ? row.unknownMarkets.map(String)
          : [],
        items: Array.isArray(row.items) ? row.items.map(normalizeCertItem) : [],
      };
    },
  );
}

/** 按当前目标市场同步认证模板项（只增不重置 DONE）→ 新增条数。 */
export function syncProjectCertItems(id: string): Promise<number> {
  return ipdPost<unknown>(
    `/projects/${encodeURIComponent(id)}/cert-items/sync`,
  ).then((raw) => (typeof raw === 'number' ? raw : Number(raw ?? 0) || 0));
}

/** 手工补充认证项入参（AC-PROD-12 白名单；isMandatory '1'|'0' 可缺省默认 '1'）。 */
export interface ProjectCertManualBody {
  certAuthority?: string;
  certName: string;
  countryCode: string;
  countryName: string;
  isMandatory?: string;
}

/** 手工补充认证项（POST /projects/{id}/cert-items）→ 新建项。 */
export function addProjectCertItem(
  id: string,
  body: ProjectCertManualBody,
): Promise<ProjectCertItemView> {
  return ipdPost<unknown>(
    `/projects/${encodeURIComponent(id)}/cert-items`,
    body,
  ).then(normalizeCertItem);
}

/** 认证项状态流转（POST /{id}/cert-items/{itemId}/status?target=；DONE 后不被 sync 重置）。 */
export function changeProjectCertItemStatus(
  id: string,
  itemId: string,
  target: string,
): Promise<ProjectCertItemView> {
  return ipdPost<unknown>(
    `/projects/${encodeURIComponent(id)}/cert-items/${encodeURIComponent(itemId)}/status`,
    undefined,
    { target },
  ).then(normalizeCertItem);
}

/** 四基准补丁（P1-2.2：仅 DRAFT 期可改，立项后服务端锁定；销售额为数字，Jackson 收 BigDecimal）。 */
export interface ProjectBaselineBody {
  targetChannelCount: number;
  targetNps: number;
  targetSalesAmount: number;
  targetSceneCount: number;
}

/** 更新四基准（POST /projects/{id}/baselines）→ 更新后项目。 */
export function updateProjectBaselines(
  id: string,
  body: ProjectBaselineBody,
): Promise<Project> {
  return ipdPost<unknown>(
    `/projects/${encodeURIComponent(id)}/baselines`,
    body,
  ).then(normalizeProject);
}

/** 上市日期初次录入（POST /projects/{id}/launch-date；已存在则拒绝走双签）。launchDate 格式 yyyy-MM-dd；reason 必填 ≤500 字。 */
export function recordProjectLaunchDate(
  id: string,
  launchDate: string,
  reason: string,
): Promise<Project> {
  return ipdPost<unknown>(`/projects/${encodeURIComponent(id)}/launch-date`, {
    launchDate,
    reason,
  }).then(normalizeProject);
}

/** 项目成员视图（ProjectMemberController.MemberView；锁定快照供津贴台账 P3-3 取数）。 */
export interface ProjectMemberView {
  id: string;
  projectId: string;
  personId: string;
  /** MARKET_PM | RD_PM（AC-TEAM-10 与人员 personType 强一致）。 */
  role: string;
  memberType: null | string;
  approvalRef: null | string;
  lockedLevel: null | string;
  lockedAmount: null | string;
  joinDate: null | string;
  exitDate: null | string;
  exitReason: null | string;
  bonusEligible: null | string;
}

function normalizeMember(raw: unknown): ProjectMemberView {
  const row = toRecord(raw);
  return {
    id: asString(row.id),
    projectId: asString(row.projectId),
    personId: asString(row.personId),
    role: asString(row.role),
    memberType: asNullableString(row.memberType),
    approvalRef: asNullableString(row.approvalRef),
    lockedLevel: asNullableString(row.lockedLevel),
    lockedAmount: asNullableString(row.lockedAmount),
    joinDate: asNullableString(row.joinDate),
    exitDate: asNullableString(row.exitDate),
    exitReason: asNullableString(row.exitReason),
    bonusEligible: asNullableString(row.bonusEligible),
  };
}

/** 在组成员列表（GET /projects/{projectId}/members；含锁定快照）。 */
export function listProjectMembers(
  projectId: string,
): Promise<ProjectMemberView[]> {
  return ipdGet<unknown>(
    `/projects/${encodeURIComponent(projectId)}/members`,
  ).then((data) => (Array.isArray(data) ? data.map(normalizeMember) : []));
}

/** 绑定成员入参（personId 为后端 Long，字符串透传防 19 位雪花精度损失；approvalRef 绑第 threshold 个项目时服务端强制）。 */
export interface ProjectMemberBindBody {
  approvalRef?: string;
  personId: string;
  /** MARKET_PM | RD_PM（服务端校验与人员 personType 一致）。 */
  role: string;
}

/** 绑定成员（POST /projects/{projectId}/members；评级快照原子写入）→ 成员视图。 */
export function bindProjectMember(
  projectId: string,
  body: ProjectMemberBindBody,
): Promise<ProjectMemberView> {
  return ipdPost<unknown>(
    `/projects/${encodeURIComponent(projectId)}/members`,
    {
      personId: body.personId,
      role: body.role,
      approvalRef: body.approvalRef === '' ? undefined : body.approvalRef,
    },
  ).then(normalizeMember);
}

/** 批量导入逐行结果（LegacyImportRowResult：错误行隔离，不回滚已成功行）。 */
export interface LegacyImportRowOutcome {
  index: number;
  ok: boolean;
  projectId: null | string;
  error: null | string;
  markedCodes: string[];
}

/** 批量存量导入（POST /projects/legacy-import/batch；仅超管）→ 逐行结果。 */
export function legacyImportProjectsBatch(
  rows: LegacyImportBody[],
): Promise<LegacyImportRowOutcome[]> {
  return ipdPost<unknown>(
    '/projects/legacy-import/batch',
    rows.map(toWire),
  ).then((data) =>
    Array.isArray(data)
      ? data.map((raw) => {
          const row = toRecord(raw);
          return {
            index:
              typeof row.index === 'number'
                ? row.index
                : Number(row.index ?? 0) || 0,
            ok: row.ok === true,
            projectId: asNullableString(row.projectId),
            error: asNullableString(row.error),
            markedCodes: Array.isArray(row.markedCodes)
              ? row.markedCodes.map(String)
              : [],
          };
        })
      : [],
  );
}
