/**
 * AI 模型配置接口（页48；后端 AiModelConfigController /api/v1/ai-models）。
 *
 * path 不含 `/api/v1` 前缀（`requestIpd` 内部自动补全）。
 *
 * 后端真值（P4-2.1 / AC-AI-01）：
 * - 列表/详情为脱敏视图：密钥仅 maskedKey 掩码（前4****后4），明文/密文均不出服务端；
 * - 读需 ipd:ai-model:list（内部角色）；写/启停/连通测试（edit）仅超管；
 * - enabled='1' 表示全局唯一生效配置（enable 时原生效配置自动让位）；
 * - 更新时 apiKey 留空表示不修改密钥；连接测试结果由后端拼入 maskedKey 字段返回。
 */
import { ipdGet, ipdPost } from './http';

/** 脱敏视图（temperature/maxTokens 由后端 config_json 展开；BigDecimal 序列化为字符串）。 */
export interface IpdAiModelView {
  /** '1' 生效中 / '0' 未生效 */
  enabled: string;
  endpoint: string;
  id: string;
  maskedKey: string;
  maxTokens: null | number;
  model: string;
  provider: string;
  temperature: null | string;
}

/** 保存白名单（后端 AiModelSaveReq；apiKey 明文进密文出，仅写入不回显）。 */
export interface IpdAiModelSaveReq {
  /** 新建必填（≥8 位）；更新留空/省略表示不修改密钥。 */
  apiKey?: string;
  endpoint: string;
  maxTokens?: null | number;
  model: string;
  provider: string;
  temperature?: null | number;
}

function normalize(raw: unknown): IpdAiModelView {
  const row = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    enabled: String(row.enabled ?? ''),
    endpoint: String(row.endpoint ?? ''),
    id: row.id === undefined || row.id === null ? '' : String(row.id),
    maskedKey: String(row.maskedKey ?? ''),
    maxTokens: row.maxTokens === undefined || row.maxTokens === null ? null : Number(row.maxTokens),
    model: String(row.model ?? ''),
    provider: String(row.provider ?? ''),
    temperature: row.temperature === undefined || row.temperature === null ? null : String(row.temperature),
  };
}

/** 配置列表（脱敏，按更新时间倒序）。 */
export async function listAiModels(): Promise<IpdAiModelView[]> {
  const data = await ipdGet<unknown[]>('/ai-models');
  return Array.isArray(data) ? data.map(normalize) : [];
}

/** 配置详情（脱敏）。 */
export async function getAiModel(id: string): Promise<IpdAiModelView> {
  return normalize(await ipdGet<unknown>(`/ai-models/${id}`));
}

/** 新建配置（apiKey 必填，模型名重复时后端拒绝）。 */
export function createAiModel(req: IpdAiModelSaveReq): Promise<IpdAiModelView> {
  return ipdPost<unknown>('/ai-models', req).then(normalize);
}

/** 更新配置（apiKey 留空不改密钥）。 */
export function updateAiModel(id: string, req: IpdAiModelSaveReq): Promise<IpdAiModelView> {
  return ipdPost<unknown>(`/ai-models/${id}/update`, req).then(normalize);
}

/** 启用（全局至多一条生效，原生效配置自动停用）。 */
export function enableAiModel(id: string): Promise<IpdAiModelView> {
  return ipdPost<unknown>(`/ai-models/${id}/enable`).then(normalize);
}

/** 连接测试（失败消息白名单化，不泄露凭证；结果文本在返回值 maskedKey 字段中）。 */
export function testAiModel(id: string): Promise<IpdAiModelView> {
  return ipdPost<unknown>(`/ai-models/${id}/test`).then(normalize);
}
