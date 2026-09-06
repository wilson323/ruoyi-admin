/**
 * Gate 材料齐套性接口（[CONSISTENCY-15] 2026-09-06）。
 *
 * 真值：GateMaterialChecker.listMaterialStatus（独立模块，未动 GateReviewService）。
 * 数据语义：指定 gate 下所有 stage-action 的 deliverables 上传齐套性。
 * 用途：gate-panel.vue 提交 Gate 前弹窗「3/5 交付物已上传」+ 阻断提示。
 *
 * 注意事项：当前 stub 后端返回固定 {total:0, uploaded:0, missing:0, isReady:true, items:[]}——
 * 由兄弟流补真 SQL 后契约不变。
 */
import { ipdGet } from './http';

export interface GateMaterialItem {
  actionCode: string;
  actionId: number;
  actionName: string;
  uploaded: number;
}

export interface GateMaterialStatus {
  gateId: number;
  isReady: boolean;
  items: GateMaterialItem[];
  missing: number;
  projectId: number;
  total: number;
  uploaded: number;
}

/** Gate 材料齐套性视图（GET /api/v1/gates/{gateId}/materials?projectId=）。 */
export function getGateMaterialStatus(gateId: number, projectId: number): Promise<GateMaterialStatus> {
  return ipdGet<GateMaterialStatus>(`/gates/${gateId}/materials`, { projectId });
}
