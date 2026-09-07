/**
 * 国别认证清单模板库接口（看板卡 P0-10.18 / 后端 CertTemplateController /api/v1/cert-templates）。
 *
 * 后端真值（P1-7.1 / BR-IPD-05b）：
 * - 一行 = 一条具体认证项（如 SABER-SASO、CE-EMC），country_code + cert_name 复合识别；
 * - 超管维护（ipd:cert-template:add/remove）；其他角色只读（list/resolve/country-counts）；
 * - 删除走 POST /cert-templates/{id}/remove（软删除）；无更新接口——变更即新增新版；
 * - /resolve?markets=SA,AE 按目标市场代码自动带出认证项；/country-counts 返回各国当前项数。
 *
 * 与 v3 规格的差异（规格与代码冲突以代码为准，登记差异）：
 * - 规格 v3 §18 描述 country 与 item 的两层结构（country 维度 + item 子表 + applies_to/evidence_field 等字段）；
 *   后端落地为单层 cert_templates 行（countryCode + countryName + certName + certAuthority + requirementDesc + isMandatory）；
 *   适用动作 / 必填证据字段在 P1-7.2 后续版本补齐，本期 UI 不渲染。
 */
import { ipdGet, ipdPost } from './http';

/** 国别认证项（单层实体）。 */
export interface CertTemplate {
  /** 认证机构 */
  certAuthority: null | string;
  /** 认证名称（如 SABER、IECEE、CE-EMC） */
  certName: string;
  /** 国家/地区代码（如 SA / AE / EU / US） */
  countryCode: string;
  /** 国家中文名（如 沙特阿拉伯） */
  countryName: string;
  /** 主键 */
  id: string;
  /** 是否强制（1 是 / 0 否） */
  isMandatory: null | string;
  /** 要求说明 */
  requirementDesc: null | string;
}

/** 新建认证项白名单（后端 CertTemplateCreateReq）。 */
export interface CreateCertTemplateBody {
  certAuthority?: null | string;
  certName: string;
  countryCode: string;
  countryName: string;
  isMandatory?: null | string;
  requirementDesc?: null | string;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeCert(raw: unknown): CertTemplate {
  const row = toRecord(raw);
  return {
    certAuthority: row.certAuthority === undefined || row.certAuthority === null
      ? null : String(row.certAuthority),
    certName: String(row.certName ?? ''),
    countryCode: String(row.countryCode ?? ''),
    countryName: String(row.countryName ?? ''),
    id: row.id === undefined || row.id === null ? '' : String(row.id),
    isMandatory: row.isMandatory === undefined || row.isMandatory === null
      ? null : String(row.isMandatory),
    requirementDesc: row.requirementDesc === undefined || row.requirementDesc === null
      ? null : String(row.requirementDesc),
  };
}

/** 全部认证项（裸 List 全量；前端按 countryCode 分组）。 */
export async function listCertTemplates(): Promise<CertTemplate[]> {
  const data = await ipdGet<unknown[]>('/cert-templates');
  return Array.isArray(data) ? data.map(normalizeCert) : [];
}

/** 按目标市场自动带出认证项（项目选定 target_markets 后走这里）。 */
export function resolveCertTemplates(markets: string[]): Promise<CertTemplate[]> {
  return ipdGet<unknown[]>('/cert-templates/resolve', { markets: markets.join(',') })
    .then((data) => (Array.isArray(data) ? data.map(normalizeCert) : []));
}

/** 各国当前认证项数量（{ SA: 5, AE: 3, EU: 8 }）。 */
export async function listCertCountryCounts(): Promise<Record<string, number>> {
  const data = await ipdGet<unknown>('/cert-templates/country-counts');
  const row = toRecord(data);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) out[key] = num;
  }
  return out;
}

/** 新建认证项（仅超管）。 */
export function createCertTemplate(body: CreateCertTemplateBody): Promise<CertTemplate> {
  return ipdPost<unknown>('/cert-templates', body).then(normalizeCert);
}

/** 删除认证项（软删除走删除审核；本接口仅超管直删，非首选用法）。 */
export function removeCertTemplate(id: string): Promise<unknown> {
  return ipdPost<unknown>(`/cert-templates/${encodeURIComponent(id)}/remove`);
}