/**
 * 业务配置接口（R149-A5 审批人配置管理；后端 BusinessConfigController 待交付）。
 *
 * 设计：
 * - 数据源：ipd_business_config 表（已存在 13 行种子，P0-7 ROOT-R1）；
 * - scope=GLOBAL：全局配置（仅超管可写，组长只读）
 * - scope=GROUP：按产品组覆盖（组长可写本组的配置项，超管可写所有）
 * - scope=PROJECT：按项目覆盖（PM 可写本项目的配置项，组长/超管可读）
 * - 字段对齐表结构：configKey / configValue / scope / scopeId / description；
 *   configValue 统一字符串承载（与后端 IpdBusinessConfig.configValue String 对齐）。
 *
 * 端点（后端待交付）：
 * - GET  /api/v1/business-config?scope&scopeId → 列表（按可见范围过滤，服务端权威）
 * - POST /api/v1/business-config               → 新增/更新（白名单 DTO，scope 决定权限）
 */
import { ipdGet, ipdPost } from './http';

export type BusinessConfigScope = 'GLOBAL' | 'GROUP' | 'PROJECT' | string;

export interface BusinessConfig {
  configKey: string;
  configValue: string;
  description: null | string;
  id: null | string;
  scope: BusinessConfigScope;
  scopeId: null | string;
  segment: string;
  updatedBy: null | string;
  updatedAt: null | string;
}

/** 新增/更新请求体（白名单 DTO；scope 必传；scopeId 对 GLOBAL 可为 null）。 */
export interface BusinessConfigUpsertReq {
  configKey: string;
  configValue: string;
  description?: null | string;
  scope: BusinessConfigScope;
  scopeId?: null | string;
}

/** 列表查询参数。 */
export interface BusinessConfigQuery {
  scope?: BusinessConfigScope;
  scopeId?: string;
}

/** 业务配置列表（按可见范围过滤，服务端权威；scope=GLOBAL 列出全局生效配置）。 */
export function listBusinessConfigs(query?: BusinessConfigQuery): Promise<BusinessConfig[]> {
  return ipdGet<BusinessConfig[]>('/business-config', query as Record<string, unknown>);
}

/** 新增/更新一条业务配置（POST；upsert 语义由后端按 (scope, scopeId, configKey) 唯一键保证）。 */
export function upsertBusinessConfig(body: BusinessConfigUpsertReq): Promise<BusinessConfig> {
  return ipdPost<BusinessConfig>('/business-config', body);
}
