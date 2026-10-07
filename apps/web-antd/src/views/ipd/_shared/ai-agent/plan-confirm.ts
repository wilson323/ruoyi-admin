/**
 * 未绑定动作的计划确认。
 *
 * 只读当前运行的 actionCode 和 STEP 事件：澄清等待不出按钮；
 * 已绑定动作的计划只出固定句。步骤只取事件里已有的字符串数组，不切句、不改字。
 */
import type { AgentRunEvent } from '../../../../api/ipd/project-agent';

/** 已绑定动作的计划卡固定句。 */
export const BOUND_PLAN_SENTENCE = '步骤来自动作技能，本次按此执行';

/** 确认后新运行正文的第一行。 */
export const CONFIRMED_PLAN_LEAD = '按已确认计划执行';

/** 计划卡该怎么交互。 */
export type PlanConfirmView =
  | { kind: 'bound' }
  | { kind: 'none' }
  | { kind: 'unbound'; steps: string[] };

/** 一轮里和人确认有关的步骤。普通 STEP（技能加载等）不算。 */
interface RelatedStep {
  kind: 'AWAIT_USER' | 'INTENT';
  needsPlan: boolean;
  reason: string;
  seq: number;
  /** 纯字符串数组才保留；不是数组或混有非字符串时为 null。 */
  steps: string[] | null;
}

/** 普通对象判别。 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 取出 payload.steps。必须整列都是字符串，否则当作没有步骤。
 *
 * @param payload STEP 载荷
 * @returns 原文字符串拷贝；不合格时 null
 */
function rawSteps(payload: Record<string, unknown>): string[] | null {
  const value = payload.steps;
  if (!Array.isArray(value)) return null;
  const steps: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    steps.push(item);
  }
  return steps;
}

/**
 * 按 seq 收集意图判断和等待用户的步骤。
 *
 * @param events 当前这一次运行的事件
 */
function relatedSteps(events: readonly AgentRunEvent[]): RelatedStep[] {
  const related: RelatedStep[] = [];
  for (const event of events) {
    if (event.type !== 'STEP') continue;
    const payload = asRecord(event.payload);
    const kind = payload.kind;
    if (kind !== 'INTENT' && kind !== 'AWAIT_USER') continue;
    related.push({
      kind,
      needsPlan: payload.needsPlan === true,
      reason: typeof payload.reason === 'string' ? payload.reason : '',
      seq: event.seq,
      steps: rawSteps(payload),
    });
  }
  related.sort((left, right) => left.seq - right.seq);
  return related;
}

/**
 * 计划确认要用的步骤：优先最新相关步骤自带的数组，否则回退同一轮意图里的数组。
 *
 * @param related 已按 seq 排好的相关步骤
 * @param latest 最新一条相关步骤
 */
function confirmationSteps(related: readonly RelatedStep[], latest: RelatedStep): string[] {
  if (latest.steps !== null) return latest.steps;
  for (let index = related.length - 1; index >= 0; index -= 1) {
    const step = related[index];
    if (step?.kind === 'INTENT' && step.steps !== null) return step.steps;
  }
  return [];
}

/**
 * 判断计划卡要不要按钮或固定句。
 *
 * 最新相关步骤是澄清等待时什么都不加。计划确认看两种事件：
 * AWAIT_USER 且 reason 为 PLAN_CONFIRM，或同一轮 INTENT 的 needsPlan 为真。
 * 当前运行 actionCode 非空则只出固定句。
 *
 * @param events 当前运行事件
 * @param actionCode 当前运行详情里的动作码；空表示未绑定
 */
export function planConfirmView(
  events: readonly AgentRunEvent[],
  actionCode: null | string | undefined,
): PlanConfirmView {
  const related = relatedSteps(events);
  const latest = related.at(-1);
  if (!latest) return { kind: 'none' };
  if (latest.kind === 'AWAIT_USER' && latest.reason === 'CLARIFICATION') return { kind: 'none' };
  const planConfirm = (latest.kind === 'AWAIT_USER' && latest.reason === 'PLAN_CONFIRM')
    || (latest.kind === 'INTENT' && latest.needsPlan);
  if (!planConfirm) return { kind: 'none' };
  const waiting = latest.kind === 'AWAIT_USER' && latest.reason === 'PLAN_CONFIRM';
  const bound = typeof actionCode === 'string' && actionCode.trim() !== '';
  if (bound && !waiting) return { kind: 'bound' };
  return { kind: 'unbound', steps: confirmationSteps(related, latest) };
}

/**
 * 拼出「开始执行」的新运行正文：第一行固定，后面每行一条原字步骤。
 *
 * @param steps 事件里的步骤字符串，调用方不得改写
 */
export function confirmedPlanMessage(steps: readonly string[]): string {
  return [CONFIRMED_PLAN_LEAD, ...steps].join('\n');
}
