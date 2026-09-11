/**
 * 项目域 API（页07/08/09/11/12；后端 ProjectController /api/v1/projects）。
 *
 * path 不含 `/api/v1` 前缀（requestIpd 内部补齐）。
 *
 * 后端真值（G-04 以代码为准）：
 * - GET /projects?keyword= 返回裸 List<Project>，无分页；
 * - POST /projects 走 CODE-01 白名单 DTO，code/status/currentStage/source 服务端权威；
 * - targetMarkets 在后端是 JSON 数组字符串（'["SA","AE"]'），本模块对页面暴露 string[]、
 *   发送前 JSON.stringify；数值字段 Jackson 自动收 BigDecimal/Integer，日期传毫秒时间戳；
 * - POST /{id}/advance-stage 门禁失败返回 400/10001（message 拼接明细），配合 gate-checklist 渲染；
 * - 状态机 DRAFT→TEAMING→ACTIVE↔SUSPENDED→ARCHIVED，非法迁移由服务端拒绝；
 * - 存量导入（仅超管）missingHistoryAck 必须 true，返回 { project, markedCodes }。
 */
import { ipdGet, ipdPost } from './http';

export type ProjectLevel = 'A' | 'B' | 'S';
export type ProjectStage = 'CONCEPT' | 'DEV' | 'LAUNCH' | 'LIFECYCLE' | 'PLAN' | 'VALID';
export type TemplateType = 'HARDWARE' | 'SOFTWARE' | 'SOLUTION';
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | 'SUSPENDED' | 'TEAMING';

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
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
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
  const row = nested !== null && typeof nested === 'object' ? toRecord(nested) : outer;
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
    launchDate: row.launchDate === undefined || row.launchDate === null ? null : (row.launchDate as number | string),
    currentStage: asNullableString(row.currentStage),
    declaredStage: asNullableString(row.declaredStage),
    lifecycleStatus: asNullableString(row.lifecycleStatus),
    source: asNullableString(row.source),
    missingHistoryAck: asNullableString(row.missingHistoryAck),
    catchupStatus: asNullableString(row.catchupStatus),
    legacyEffectiveAt: row.legacyEffectiveAt === undefined || row.legacyEffectiveAt === null
      ? null : (row.legacyEffectiveAt as number | string),
    status: asString(row.status),
    mainGroupId: asNullableString(row.mainGroupId),
    createBy: asNullableString(row.createBy),
    createTime: row.createTime === undefined || row.createTime === null ? null : (row.createTime as number | string),
  };
}

/** targetMarkets 是 JSON 数组字符串；解析失败返回空数组（不抛错）。 */
export function parseTargetMarkets(raw: null | number | string | undefined): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** 页面 body → 后端 DTO：数组转 JSON 字符串，日期毫秒时间戳透传。 */
function toWire(body: ProjectCreateBody | LegacyImportBody): Record<string, unknown> {
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
    legacyEffectiveAt: 'legacyEffectiveAt' in body ? (body as LegacyImportBody).legacyEffectiveAt : undefined,
    declaredStage: 'declaredStage' in body ? (body as LegacyImportBody).declaredStage : undefined,
    missingHistoryAck: 'missingHistoryAck' in body ? (body as LegacyImportBody).missingHistoryAck : undefined,
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
  critical: null | boolean;
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
  return ipdGet<unknown>('/projects', keyword ? { keyword } : undefined).then((data) =>
    Array.isArray(data) ? data.map(normalizeProjectListItem) : [],
  );
}

/** 项目列表（keyword 可选，服务端模糊匹配）。 */
export function listProjects(keyword?: string): Promise<Project[]> {
  return ipdGet<unknown>('/projects', keyword ? { keyword } : undefined)
    .then((data) => (Array.isArray(data) ? data.map(normalizeProject) : []));
}

export function getProject(id: string): Promise<Project> {
  return ipdGet<unknown>(`/projects/${encodeURIComponent(id)}`).then(normalizeProject);
}

export function createProject(body: ProjectCreateBody): Promise<Project> {
  return ipdPost<unknown>('/projects', toWire(body)).then(normalizeProject);
}

/** 存量单条导入（仅超管；返回被标记历史缺失的动作编码）。 */
export function legacyImportProject(body: LegacyImportBody): Promise<LegacyImportResult> {
  return ipdPost<unknown>('/projects/legacy-import', toWire(body)).then((raw) => {
    const row = toRecord(raw);
    const marked = row.markedCodes;
    return {
      project: normalizeProject(row.project),
      markedCodes: Array.isArray(marked) ? marked.map(String) : [],
    };
  });
}

/** 状态流转（POST /{id}/status?target=；非法迁移由服务端拒绝）。 */
export function changeProjectStatus(id: string, target: ProjectStatus | string): Promise<Project> {
  return ipdPost<unknown>(`/projects/${encodeURIComponent(id)}/status`, undefined, { target }).then(normalizeProject);
}

/** 进入下一阶段（POST /{id}/advance-stage；门禁失败 400/10001 带 checklist 明细）。 */
export function advanceProjectStage(id: string): Promise<Project> {
  return ipdPost<unknown>(`/projects/${encodeURIComponent(id)}/advance-stage`).then(normalizeProject);
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
export function getGateChecklist(id: string, stage?: string): Promise<GateChecklistView> {
  return ipdGet<unknown>(`/projects/${encodeURIComponent(id)}/gate-checklist`, stage ? { stage } : undefined)
    .then((raw) => {
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
