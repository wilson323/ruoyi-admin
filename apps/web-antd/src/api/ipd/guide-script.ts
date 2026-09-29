/**
 * 引导帧序列 API（C4a）：GET /api/v1/ipd/stage/sub-stages/guide-events。
 *
 * Track A A4.2 端点（零新写端点，requestIpd 已剥 code=0 包络）；C2 并行开发中，
 * 下发面在 STATE_DELTA op.value 增 guideSteps/advanceGate 两键（C2.4 wire 契约）。
 * 路径契约由 guide-script.test.ts 钉死（/api/v1 + /ipd/... 全等）。
 */
import { ipdGet } from './http';

/** AG-UI 事件帧（type + 任意键，防御性消费）。 */
export interface GuideEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * 小阶段引导帧序列（GET /guide-events）。
 * 非数组响应防御性归一为 []（不崩不断对话流）。
 */
export async function fetchGuideEvents(
  subStageCode: string,
  projectId?: string,
): Promise<GuideEvent[]> {
  const data = await ipdGet<unknown>('/ipd/stage/sub-stages/guide-events', {
    projectId,
    subStageCode,
  });
  return Array.isArray(data) ? (data as GuideEvent[]) : [];
}
