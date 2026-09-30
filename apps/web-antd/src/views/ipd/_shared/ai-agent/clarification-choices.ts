/**
 * 把意图里的澄清问题变成可点选项。
 *
 * 带成对「」的句子拆成两侧选项；没有引号时整句就是一个选项。每个选项单独可点，不丢后面的项。
 */
import type { AgentRunEvent } from '../../../../api/ipd/project-agent';

/** 判定需要澄清、但事件表明内核仍在往下写时的诚实说明。 */
export const CLARIFICATION_STILL_RUNNING = '判定为先澄清，当前仍会继续生成。';

/** 一个可点选项，question 是它来自的那句澄清。 */
export interface ClarificationChoice {
  option: string;
  question: string;
}

const QUOTED_OPTION = /「([^」]+)」/g;

/**
 * 从澄清问题里取出全部可点选项。
 *
 * @param questions INTENT 载荷里的问题原文
 * @returns 每个选项都带着原问题，供发送短句使用
 */
export function clarificationChoices(questions: readonly string[]): ClarificationChoice[] {
  const choices: ClarificationChoice[] = [];
  for (const question of questions) {
    const text = question.trim();
    if (text === '') continue;
    const quoted = [...text.matchAll(QUOTED_OPTION)]
      .map((match) => match[1]?.trim() ?? '')
      .filter((option) => option !== '');
    if (quoted.length >= 2) {
      for (const option of quoted) choices.push({ option, question: text });
      continue;
    }
    choices.push({ option: text, question: text });
  }
  return choices;
}

/**
 * 点选项后走现有发送口的正文。
 *
 * @param option 用户点中的那一项，不是问题列表的第一项
 * @param question 该项所在的原问题
 */
export function clarificationSendText(option: string, question: string): string {
  const brief = question.trim();
  const short = brief.length > 42 ? `${brief.slice(0, 42)}…` : brief;
  return `已选：${option}。${short}`;
}

/** 普通对象判别。 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 澄清已经被判定，但运行没有停在等待用户，并且已经写出正文或工具事件。
 *
 * 有 AWAIT_USER 时内核按闸门停住，不说「仍会继续」。
 *
 * @param events 同一次运行的事件
 * @param needsClarification INTENT 上的澄清布尔值
 */
export function clarificationStillGenerating(
  events: readonly AgentRunEvent[],
  needsClarification: boolean,
): boolean {
  if (!needsClarification) return false;
  let awaited = false;
  let generated = false;
  for (const event of events) {
    if (event.type === 'STEP' && asRecord(event.payload).kind === 'AWAIT_USER') awaited = true;
    if (event.type === 'TEXT_DELTA' || event.type === 'TOOL_CALL' || event.type === 'TOOL_RESULT') {
      generated = true;
    }
  }
  return generated && !awaited;
}

/**
 * 选项序号徽章（对齐 21st Question Tool：A、B、C…）。
 *
 * @param index 从 0 起的选项下标
 */
export function clarificationOptionBadge(index: number): string {
  return String.fromCharCode(65 + Math.max(0, index % 26));
}

/**
 * 这次运行的澄清已经结束：等过用户，随后又写了 RUN_FINISHED。
 *
 * 历史回读时禁用选项，避免对已结束运行再点一次。
 *
 * @param events 同一次运行的事件
 */
export function clarificationOptionsLocked(events: readonly AgentRunEvent[]): boolean {
  let awaited = false;
  let finished = false;
  for (const event of events) {
    if (event.type === 'STEP' && asRecord(event.payload).kind === 'AWAIT_USER') awaited = true;
    if (event.type === 'RUN_FINISHED') finished = true;
  }
  return awaited && finished;
}
