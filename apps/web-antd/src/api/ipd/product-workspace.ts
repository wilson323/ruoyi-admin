/**
 * 产品空间聚合 API（页16-17；后端 ProductWorkspaceController /api/v1/products/{id}/workspace）。
 *
 * 后端真值（G-04 以代码为准，2026-09-06 ProductWorkspaceController.java）：
 * - GET /products/{id}/workspace → { product, projects[], demands[](≤100), metrics }；
 * - product：id/productCode/productName/modelCode/source/groupId/status/projectId
 *   （无 current_version/product_line/owner_name/lifecycle_status，展示层按产品组名+状态映射补齐）；
 * - projects：id/name/code/status(ACTIVE|ARCHIVED…)/currentStage/launchDate/updatedAt；
 * - demands：id/title/customerName/submitterName/source/status/projectId/createdAt；
 * - metrics：feedback(=demands 数)/themes(恒 0，demand-themes P1 未落地)/
 *   activeProjects(ACTIVE)/closedProjects(ARCHIVED)。
 *
 * 原型对照（ZK-IPD ClosurePages ProductWorkspacePage，G1 门禁 2026-09-06）：
 * - 需求主题（themes）与原始反馈归并（demand-themes POST）后端未落地：主题区永远空态、
 *   反馈列表不渲染归并 checkbox；
 * - 产品退市面板（/retirement/readiness）后端未交付：整块不渲染；
 * - 「切换并查看」适配：原型切全局当前项目后跳 /projects，本项目无全局项目上下文，
 *   改为跳该项目详情页 /ipd/projects/{id}/overview。
 */
import { ipdGet } from './http';

/** 产品工作区条目产品视图。 */
export interface WorkspaceProduct {
  groupId: null | string;
  id: string;
  modelCode: null | string;
  productCode: string;
  productName: string;
  projectId: null | string;
  source: null | string;
  status: string;
}

/** 产品关联的 IPD 项目/迭代。 */
export interface WorkspaceProject {
  code: null | string;
  currentStage: null | string;
  id: string;
  launchDate: null | number | string;
  name: string;
  status: string;
  updatedAt: null | number | string;
}

/** 产品关联的原始客户反馈（需求池条目投影）。 */
export interface WorkspaceDemand {
  createdAt: null | number | string;
  customerName: null | string;
  id: string;
  projectId: null | string;
  source: string;
  status: string;
  submitterName: null | string;
  title: null | string;
}

export interface WorkspaceMetrics {
  activeProjects: number;
  closedProjects: number;
  feedback: number;
  themes: number;
}

export interface ProductWorkspace {
  demands: WorkspaceDemand[];
  metrics: WorkspaceMetrics;
  product: WorkspaceProduct;
  projects: WorkspaceProject[];
}

/** 产品工作区聚合视图。 */
export function fetchProductWorkspace(id: string): Promise<ProductWorkspace> {
  return ipdGet<ProductWorkspace>(`/products/${id}/workspace`);
}
