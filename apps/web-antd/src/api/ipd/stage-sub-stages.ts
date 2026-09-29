/** 小阶段目录：服务端返回平铺列表，ID 保持字符串。 */
import { ipdGet, ipdPost } from './http';

export interface SubStageAction {
  actionCode: string;
  actionName: string;
  skillNames: string[];
  sortOrder: number;
  subStageCode: string;
}

export interface SubStage {
  actions: SubStageAction[];
  code: string;
  gateCode: null | string;
  id: string;
  isGate: string;
  name: string;
  ownerRole: string;
  skillHint: null | string;
  sortOrder: number;
  stageCode: string;
}

export function fetchSubStages(): Promise<SubStage[]> {
  return ipdGet<SubStage[]>('/ipd/stage/sub-stages');
}

export interface SubStageProgress {
  projectId: string;
  currentStage: string;
  currentSubStageCode: null | string;
  version: number;
  gateResult: null | string;
  replayed: boolean;
  advanced: boolean;
}

export function fetchSubStageProgress(projectId: string): Promise<SubStageProgress> {
  return ipdGet<SubStageProgress>('/ipd/stage/sub-stages/progress', { projectId });
}

export function advanceSubStage(projectId: string, targetSubStageCode: string, expectedVersion: number): Promise<SubStageProgress> {
  return ipdPost<SubStageProgress>('/ipd/stage/sub-stages/advance', undefined, {
    projectId,
    targetSubStageCode,
    expectedVersion,
  });
}
