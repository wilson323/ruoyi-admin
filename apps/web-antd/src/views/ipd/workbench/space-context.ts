/**
 * 工作台·产品空间（=工作空间）共享契约。
 *
 * 概念关系：产品空间即工作空间；不同产品空间对应不同的工作空间内容与数据范围。
 * - SpaceScope：当前产品空间的项目数据范围（待办快捷入口按此过滤，体现数据范围隔离）。
 *   status 语义（禁止假绿）：
 *   - loading —— workspace（GET /products/{id}/workspace）拉取中，范围未知；
 *   - error —— workspace 拉取失败，范围未知（禁止当空渲染成 0/成功）；
 *   - ready —— projects 为后端返回序真值（不排序臆断）。
 * - StageActionStats：动作级进度聚合，来源 listStageActions 真值。
 *   已知约束（flow.vue 头注）：无 stageId→阶段编码映射端点，因此只做动作级聚合，
 *   禁止按 stageId 猜阶段分组。
 */
import type { WorkspaceProject } from '../../../api/ipd/product-workspace';
import type { StageAction } from '../../../api/ipd/stage-action';

/** 当前产品空间的项目数据范围（todo 快捷入口过滤依据）。 */
export type SpaceScope =
  | { projects: WorkspaceProject[]; status: 'ready' }
  | { status: 'error' | 'loading' };

/** 动作级进度聚合（listStageActions 真值）。 */
export interface StageActionStats {
  /** 阻断待办：isBlocking='1' 且未闭环（status 非 DONE/NA）。 */
  blockingPending: number;
  /** 已完成：status=DONE。 */
  done: number;
  /** 进行中：status=IN_PROGRESS。 */
  inProgress: number;
  /** 动作总数。 */
  total: number;
}

/** 由真实动作列表聚合进度（无动作真值时全 0 属实，不属假绿）。 */
export function summarizeStageActions(actions: StageAction[]): StageActionStats {
  const stats: StageActionStats = {
    blockingPending: 0,
    done: 0,
    inProgress: 0,
    total: actions.length,
  };
  for (const action of actions) {
    if (action.status === 'DONE') stats.done += 1;
    if (action.status === 'IN_PROGRESS') stats.inProgress += 1;
    const closed = action.status === 'DONE' || action.status === 'NA';
    if (action.isBlocking === '1' && !closed) stats.blockingPending += 1;
  }
  return stats;
}
