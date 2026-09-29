/**
 * 引导帧解析纯函数（C4a）：AG-UI 帧 → 步骤 VM / 门禁 VM / chips / pageContext 摘要。
 *
 * 契约：C2 在 GET /guide-events 的 STATE_DELTA op.value 增 guideSteps/advanceGate 两键
 * （Track C C2.4 wire 形状）；stepState 词表锁定 PENDING|DONE|NA|HISTORICAL_MISSING|
 * NOT_INSTANTIATED（C2.3）。零依赖纯函数（guide-script.test.ts 钉死行为）。
 */
import type { GuideEvent } from '../../../../api/ipd/guide-script';

/** 命令降级步骤（C3 CommandDegrader 输出，C2 wire 复用）。 */
export interface DegradedStepVm {
  command: string;
  skillNames: string[];
  stepPrompt: string;
}

/** 单动作引导步骤 VM（C2 GuideStepView 前端镜像，字段全量映射）。 */
export interface GuideStepVm {
  actionCode: string;
  actionName: string;
  sortOrder: number;
  bindLevel: string;
  aiMode: string;
  skillNames: string[];
  commandChain: string[];
  degradedSteps: DegradedStepVm[];
  guidePrompt: string;
  stepState: string;
  blocking: boolean;
}

/** 推进门禁 VM（C2 AdvanceGateView 前端镜像）。 */
export interface AdvanceGateVm {
  nextSubStageCode: string | null;
  advanceAllowed: boolean;
  pendingBlockingCodes: string[];
}

/** AgUiCopilotRun.lookup 仅认的两键之一（projectId/pageContext）。 */
export const GUIDE_CONTEXT_KEY = 'pageContext';
/** 与 AgUiCopilotRun.MAX_PAGE_CONTEXT 同口径，超限截断防后端丢弃。 */
export const MAX_CONTEXT_CHARS = 4000;

/** 运行期对象判别（本地小判别防双轨 import，同 copilotkit-render.ts 先例形态）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** STATE_DELTA 帧 → /subStageGuide op.value.guideSteps（非法帧跳过不崩）。 */
export function parseGuideSteps(events: GuideEvent[]): GuideStepVm[] {
  for (const event of events) {
    if (event.type !== 'STATE_DELTA') continue;
    const patch = event.delta;
    if (!Array.isArray(patch)) continue;
    for (const op of patch) {
      if (!isPlainRecord(op) || op.path !== '/subStageGuide') continue;
      const value = op.value;
      if (!isPlainRecord(value) || !Array.isArray(value.guideSteps)) continue;
      return value.guideSteps.filter(isPlainRecord).map((s, i) => ({
        actionCode: String(s.actionCode ?? ''),
        actionName: String(s.actionName ?? ''),
        sortOrder: Number(s.sortOrder ?? i),
        bindLevel: String(s.bindLevel ?? 'NONE'),
        aiMode: String(s.aiMode ?? ''),
        skillNames: Array.isArray(s.skillNames) ? s.skillNames.map(String) : [],
        commandChain: Array.isArray(s.commandChain)
          ? s.commandChain.map(String)
          : [],
        degradedSteps: Array.isArray(s.degradedSteps)
          ? s.degradedSteps.filter(isPlainRecord).map((d) => ({
              command: String(d.command ?? ''),
              skillNames: Array.isArray(d.skillNames)
                ? d.skillNames.map(String)
                : [],
              stepPrompt: String(d.stepPrompt ?? ''),
            }))
          : [],
        guidePrompt: String(s.guidePrompt ?? ''),
        stepState: String(s.stepState ?? 'PENDING'),
        blocking: s.blocking === true,
      }));
    }
  }
  return [];
}

/** STATE_DELTA → /subStageGuide op.value.advanceGate（无/非法 → null）。 */
export function parseAdvanceGate(events: GuideEvent[]): AdvanceGateVm | null {
  for (const event of events) {
    if (event.type !== 'STATE_DELTA') continue;
    const patch = event.delta;
    if (!Array.isArray(patch)) continue;
    for (const op of patch) {
      if (!isPlainRecord(op) || op.path !== '/subStageGuide') continue;
      const value = op.value;
      if (!isPlainRecord(value) || !isPlainRecord(value.advanceGate)) continue;
      const gate = value.advanceGate;
      return {
        nextSubStageCode:
          typeof gate.nextSubStageCode === 'string'
            ? gate.nextSubStageCode
            : null,
        advanceAllowed: gate.advanceAllowed !== false,
        pendingBlockingCodes: Array.isArray(gate.pendingBlockingCodes)
          ? gate.pendingBlockingCodes.map(String)
          : [],
      };
    }
  }
  return null;
}

/** TEXT_MESSAGE_CONTENT 帧 delta 拼接（引导开场文本；帧序保持）。 */
export function extractGuideText(events: GuideEvent[]): string {
  return events
    .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
    .map((e) => (typeof e.delta === 'string' ? e.delta : ''))
    .join('');
}

/**
 * chips：从步骤派生「序号+动作名+第一步引导」建议（默认 3 条，点击=填入输入框）。
 * 格式钉死：`${i+1}. ${actionName}（技能 ${skillNames[0]}）：${guidePrompt}`；
 * 无技能动作标「（结构化登记）」（D-9：留空+结构化登记，不硬凑技能）。
 */
export function buildGuideSuggestions(
  steps: GuideStepVm[],
  limit = 3,
): string[] {
  return steps.slice(0, limit).map((step, i) => {
    const head = `${i + 1}. ${step.actionName}`;
    const skill =
      step.skillNames.length > 0
        ? `（技能 ${step.skillNames[0]}）`
        : '（结构化登记）';
    return `${head}${skill}：${step.guidePrompt}`;
  });
}

/**
 * agent 上下文摘要（useAgentContext value 恒 JSON 字符串；>MAX_CONTEXT_CHARS 截断）。
 * 超限时截断 guidePrompt 字段本身（保 JSON 可解析，优于整串硬切）。
 */
export function buildGuideContextValue(
  subStageCode: string,
  step: GuideStepVm | null,
): string {
  const build = (guidePrompt: string) =>
    JSON.stringify({
      subStageCode,
      currentAction: step
        ? {
            actionCode: step.actionCode,
            actionName: step.actionName,
            guidePrompt,
            skillNames: step.skillNames,
            degradedStepPrompts: step.degradedSteps.map((d) => d.stepPrompt),
          }
        : null,
    });
  let json = build(step?.guidePrompt ?? '');
  if (step && json.length > MAX_CONTEXT_CHARS) {
    const overflow = json.length - MAX_CONTEXT_CHARS;
    const trimmed = step.guidePrompt.slice(
      0,
      Math.max(0, step.guidePrompt.length - overflow - 2),
    );
    json = build(`${trimmed}…`);
  }
  return json;
}

/* -------------------------------------------------------------------------- */
/* stepState 四态视觉映射（C4a 步骤卡片样式）：词表 5 值 → 4 视觉 tone，         */
/* HISTORICAL_MISSING 与 NOT_INSTANTIATED 共享 missing tone（label 区分）。      */
/* tone 词表沿用 ipd-state-machines 惯例（default/processing/success/warning/   */
/* cyan），零新色值（Ant Tag preset color）。                                    */
/* -------------------------------------------------------------------------- */

/** stepState → Tag 视觉 tone（Ant Tag preset color）。 */
export type StepStateTone = 'cyan' | 'default' | 'processing' | 'success' | 'warning';

/** stepState 展示元数据（label + 四态 tone）。 */
export interface StepStateMeta {
  label: string;
  tone: StepStateTone;
}

const STEP_STATE_META: Record<string, StepStateMeta> = {
  PENDING: { label: '待处理', tone: 'default' },
  DONE: { label: '已完成', tone: 'success' },
  NA: { label: '不适用', tone: 'cyan' },
  HISTORICAL_MISSING: { label: '历史缺失', tone: 'warning' },
  NOT_INSTANTIATED: { label: '未实例化', tone: 'warning' },
};

/** stepState 元数据（未知值防御性回退：原样 label + default tone）。 */
export function stepStateMeta(state: string): StepStateMeta {
  return STEP_STATE_META[state] ?? { label: state, tone: 'default' };
}
