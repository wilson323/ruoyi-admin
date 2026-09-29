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

/** 仅接受后端约定的字符串 ID；禁止将大整数 number 静默转成已失真的字符串。 */
function parseSubStages(value: unknown): SubStage[] {
  if (!Array.isArray(value)) throw new Error('小阶段目录响应格式错误');
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('小阶段目录响应格式错误');
    }
    const stage = raw as Record<string, unknown>;
    if (typeof stage.id !== 'string' || !stage.id
      || typeof stage.code !== 'string' || typeof stage.name !== 'string'
      || typeof stage.stageCode !== 'string' || !Array.isArray(stage.actions)) {
      throw new Error('小阶段目录响应格式错误');
    }
    for (const rawAction of stage.actions) {
      if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) {
        throw new Error('小阶段目录响应格式错误');
      }
      const action = rawAction as Record<string, unknown>;
      if (typeof action.actionCode !== 'string' || typeof action.actionName !== 'string'
        || typeof action.subStageCode !== 'string' || !Array.isArray(action.skillNames)
        || !action.skillNames.every((name) => typeof name === 'string')) {
        throw new Error('小阶段目录响应格式错误');
      }
    }
    return stage as unknown as SubStage;
  });
}

export async function fetchSubStages(): Promise<SubStage[]> {
  return parseSubStages(await ipdGet<unknown>('/ipd/stage/sub-stages'));
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
