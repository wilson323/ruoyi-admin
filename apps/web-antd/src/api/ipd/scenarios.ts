/**
 * 落地场景接口（R149 录入/展示界面；后端 LandedScenarioController）。
 *
 * 设计：
 * - 落地场景（landed）= 项目级"已落地销售/部署的场景"登记，与产品空间阶段的"立项场景清单"区分；
 * - 单条登记 POST /api/v1/scenarios/landed（白名单 DTO：projectId / scenarioCode / scenarioName /
 *   landedDate / landingAmount），返回单条记录；
 * - 列表 GET /api/v1/scenarios/landed（projectId 必填，与后端 @RequestParam Long projectId 对齐），
 *   返回该项目下的落地场景列表；
 * - 批量导入 POST /api/v1/scenarios/landed/import，body 为落地场景创建请求数组，
 *   返回 { imported: number, skipped: number, errors: string[] }。
 *
 * 权限：MARKET_PM / RD_PM / GROUP_LEADER / SUPER_ADMIN 可见可写；
 * GUEST 不可见（portal 走独立端点）。
 */
import { ipdGet, ipdPost } from './http';

/** 落地场景视图（后端 LandedScenarioView 字段对齐）。 */
export interface LandedScenario {
  amount: null | number | string;
  id: null | string;
  landedDate: null | string;
  projectCode: null | string;
  projectId: null | string;
  projectName: null | string;
  recordedBy: null | string;
  recordedAt: null | string;
  scenarioCode: null | string;
  scenarioName: null | string;
  segment: string;
}

/** 单条登记请求体。 */
export interface LandedScenarioCreateReq {
  landedDate: string;
  landingAmount: number;
  projectId: string;
  scenarioCode: string;
  scenarioName: string;
}

/**
 * 列表查询参数。
 * projectId 与后端 LandedScenarioController.list @RequestParam 必填对齐；缺参勿调用。
 */
export interface LandedScenarioQuery {
  projectId: string;
}

/** 批量导入返回（按字段语义对应；后端契约可在 R149 后端落地时调整）。 */
export interface LandedScenarioImportResult {
  errors: string[];
  imported: number;
  skipped: number;
}

/**
 * 按项目查询落地场景列表。
 *
 * @param query - 必含 projectId（字符串 ID）
 * @returns 该项目下的落地场景列表
 */
export function listLandedScenarios(query: LandedScenarioQuery): Promise<LandedScenario[]> {
  return ipdGet<LandedScenario[]>('/scenarios/landed', { projectId: query.projectId });
}

/** 新增一条落地场景。 */
export function createLandedScenario(body: LandedScenarioCreateReq): Promise<LandedScenario> {
  return ipdPost<LandedScenario>('/scenarios/landed', body);
}

/** 批量导入（接收 JSON 文件解析后的数组）。 */
export function importLandedScenarios(
  rows: LandedScenarioCreateReq[],
): Promise<LandedScenarioImportResult> {
  return ipdPost<LandedScenarioImportResult>('/scenarios/landed/import', { rows });
}
