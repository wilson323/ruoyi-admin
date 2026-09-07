/**
 * 系统参数接口（页45 参数配置；后端 SystemConfigController /api/v1/system-configs）。
 *
 * path 不含 `/api/v1` 前缀（`ipdGet/ipdPut → authenticatedRequest → requestIpd`
 * 内部会自动补 `/api/v1` 前缀；此处只需传业务相对路径）。
 *
 * 后端真值（P0-3.2 解阻塞：参数后台化；P0-3.3 增补版本链；PERF-02 写后立即失效缓存）：
 * - GET / —— 裸 List<SystemConfig>（仅超管，~55 条种子；value_type ∈ STRING/NUMBER/JSON/BOOL）；
 * - GET /{key:.+} —— 单点读取（任何已登录会话可读，业务方依赖的热路径），value 缺省回退 "";
 * - PUT /{key:.+} —— 更新（仅超管；同事务写版本链；UpdateReq.value @NotBlank @Size(max=2000)）；
 * - GET /{key:.+}/versions?limit —— 仅超管：某 key 的不可变版本历史（最新在前）；
 * - GET /{key:.+}/as-of?time=ISO-8601 —— 仅超管：时点解析，返回命中版本或回退源
 *   （VERSION / FACTORY_DEFAULT / NONE）。
 * - 规格 §4 / §5 要求的 draft/publish/revert 三阶段接口、6 项涉钱参数高亮目录、PM/组长/超管可见范围
 *   后端均未交付——页面按控制器能返回的真值渲染（真值见 README-IPD-OVERRIDE.md）；
 *   6 项涉钱键已在前端做静态高亮（P0-10.45 规格映射；G-08 红线字段）：
 *     bonus.poolBase / bonus.salesSource / bonus.performanceScoreStrategy /
 *     bonus.multiProjectSplit / bonus.launchAnchor / bonus.coefficientDecider。
 * - ID 一律按字符串处理（后端 Long 序列化可能为数字）。
 */
import { ipdGet, ipdPut } from './http';

export interface IpdSystemConfig {
  /** 主键 */
  id: string;
  /** 参数键（如 bonus.salesSource / allowance.L3 / gate.signDeadlineDays） */
  configKey: string;
  /** 当前值（不可变由服务端实现层保证；PUT 后立即 invalidate 缓存） */
  configValue: string;
  /** 默认值（页面只读展示；与 configValue 区分） */
  defaultValue: null | string;
  /** STRING / NUMBER / JSON / BOOL（决定输入形态与校验） */
  valueType: 'BOOL' | 'JSON' | 'NUMBER' | 'STRING' | string;
  /** 描述（用于页面说明列；可空） */
  description: null | string;
  /** 备注（可空；与 description 不同源：人为注解） */
  remark: null | string;
}

export interface IpdSystemConfigVersion {
  id: string;
  configKey: string;
  configValue: string;
  version: number;
  effectiveFrom: null | string;
  effectiveTo: null | string;
  isImmutable: null | boolean;
  changedBy: null | string;
  changeReason: null | string;
  createTime: null | string;
}

/** PUT /{key} 入参白名单（与后端 UpdateReq 字段对齐；@NotBlank @Size(max=2000)）。 */
export interface IpdSystemConfigUpdateReq {
  value: string;
}

/** 时点解析回退源（与后端 resolveAsOf 返回 source 字段一致）。 */
export type IpdSystemConfigAsOfSource = 'NONE' | 'FACTORY_DEFAULT' | 'VERSION';

export interface IpdSystemConfigAsOf {
  asOf: null | string;
  key: string;
  source: IpdSystemConfigAsOfSource;
  value: null | string;
  version: null | number;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalize(raw: unknown): IpdSystemConfig {
  const row = toRecord(raw);
  const idValue = row.id;
  const valueType = String(row.valueType ?? 'STRING');
  return {
    id: idValue === undefined || idValue === null ? '' : String(idValue),
    configKey: String(row.configKey ?? ''),
    configValue: String(row.configValue ?? ''),
    defaultValue: typeof row.defaultValue === 'string' ? row.defaultValue : null,
    valueType: valueType === 'STRING' || valueType === 'NUMBER' || valueType === 'JSON' || valueType === 'BOOL'
      ? valueType
      : valueType,
    description: typeof row.description === 'string' ? row.description : null,
    remark: typeof row.remark === 'string' ? row.remark : null,
  };
}

function normalizeVersion(raw: unknown): IpdSystemConfigVersion {
  const row = toRecord(raw);
  const idValue = row.id;
  return {
    id: idValue === undefined || idValue === null ? '' : String(idValue),
    configKey: String(row.configKey ?? ''),
    configValue: String(row.configValue ?? ''),
    version: Number(row.version ?? 0),
    effectiveFrom: row.effectiveFrom === undefined || row.effectiveFrom === null ? null : String(row.effectiveFrom),
    effectiveTo: row.effectiveTo === undefined || row.effectiveTo === null ? null : String(row.effectiveTo),
    isImmutable: typeof row.isImmutable === 'boolean' ? row.isImmutable : null,
    changedBy: row.changedBy === undefined || row.changedBy === null ? null : String(row.changedBy),
    changeReason: typeof row.changeReason === 'string' ? row.changeReason : null,
    createTime: row.createTime === undefined || row.createTime === null ? null : String(row.createTime),
  };
}

/** 参数列表（仅超管；按实现层默认排序：通常 config_key 升序）。 */
export async function listSystemConfigs(): Promise<IpdSystemConfig[]> {
  const data = await ipdGet<unknown[]>('/system-configs');
  return Array.isArray(data) ? data.map(normalize) : [];
}

/** 单点读取（任何已登录会话；热路径）。 */
export async function getSystemConfig(key: string): Promise<{ key: string; value: string }> {
  const raw = await ipdGet<Record<string, unknown>>(
    `/system-configs/${encodeURIComponent(key)}`,
  );
  return { key: String(raw.key ?? key), value: String(raw.value ?? '') };
}

/** 更新参数（仅超管；同事务写版本链；写后立即失效缓存 PERF-02）。 */
export async function updateSystemConfig(
  key: string,
  req: IpdSystemConfigUpdateReq,
): Promise<{ key: string; value: string; invalidated: boolean }> {
  const raw = await ipdPut<Record<string, unknown>>(
    `/system-configs/${encodeURIComponent(key)}`,
    { value: req.value },
  );
  return {
    key: String(raw.key ?? key),
    value: String(raw.value ?? ''),
    invalidated: raw.invalidated === 'true' || raw.invalidated === true,
  };
}

/** 版本链（仅超管；limit 默认 20；最新在前；configValue 不可变）。 */
export async function listSystemConfigVersions(
  key: string,
  limit = 20,
): Promise<IpdSystemConfigVersion[]> {
  const data = await ipdGet<unknown[]>(
    `/system-configs/${encodeURIComponent(key)}/versions`,
    { limit },
  );
  return Array.isArray(data) ? data.map(normalizeVersion) : [];
}

/** 时点解析（仅超管；time 须 ISO-8601）。 */
export async function resolveSystemConfigAsOf(
  key: string,
  time: string,
): Promise<IpdSystemConfigAsOf> {
  const raw = await ipdGet<Record<string, unknown>>(
    `/system-configs/${encodeURIComponent(key)}/as-of`,
    { time },
  );
  const sourceValue = String(raw.source ?? 'NONE');
  const source: IpdSystemConfigAsOfSource =
    sourceValue === 'VERSION' || sourceValue === 'FACTORY_DEFAULT' || sourceValue === 'NONE'
      ? sourceValue
      : 'NONE';
  return {
    key: String(raw.key ?? key),
    source,
    value: typeof raw.value === 'string' ? raw.value : null,
    version: typeof raw.version === 'number' ? raw.version : null,
    asOf: typeof raw.asOf === 'string' ? raw.asOf : null,
  };
}