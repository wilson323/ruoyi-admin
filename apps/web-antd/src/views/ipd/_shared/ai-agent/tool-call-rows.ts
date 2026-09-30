/**
 * 把时间线里的工具调用与紧随的结果收成一张卡（对齐 21st AiToolCall 的状态机）。
 *
 * 只消费 timeline-model 已折叠的真实条目，不补造未发生的工具。
 */
import type { TimelineItem } from './timeline-model';

/** 会话里可证据化的工具状态（待确认 / 已拒绝需要后端字段，这里不编造）。 */
export type ToolCallVisualState = 'completed' | 'error' | 'pending' | 'running';

/** 一张工具卡的展示模型。 */
export interface ToolCallCardModel {
  error: string;
  input: string;
  key: string;
  name: string;
  output: string;
  state: ToolCallVisualState;
}

/** 时间线渲染行：普通条目，或合并后的工具卡。 */
export type TimelineRow =
  | { card: ToolCallCardModel; kind: 'tool' }
  | { item: TimelineItem; kind: 'plain' };

type ToolCallItem = Extract<TimelineItem, { kind: 'tool-call' }>;
type ToolResultItem = Extract<TimelineItem, { kind: 'tool-result' }>;

/**
 * 由调用与可选结果决定卡片状态。
 *
 * @param call 工具调用条目；孤立结果时为空
 * @param result 工具结果条目；调用尚未返回时为空
 * @param running 运行仍在轮询事件
 */
function cardFrom(
  call: ToolCallItem | null,
  result: ToolResultItem | null,
  running: boolean,
): ToolCallCardModel {
  const name = call?.toolName || result?.toolName || '未命名工具';
  const failed = result?.failed === true;
  let state: ToolCallVisualState = 'pending';
  if (result) {
    state = failed ? 'error' : 'completed';
  } else if (running) {
    state = 'running';
  }
  return {
    key: call?.key ?? result?.key ?? name,
    name,
    state,
    input: call?.summary ?? '',
    output: result && !failed ? result.summary : '',
    error: failed ? result?.summary || '工具执行失败' : '',
  };
}

/** 同名（或任一侧未命名）的结果才并入前一条调用。 */
function canPair(call: ToolCallItem, result: ToolResultItem): boolean {
  return call.toolName === '' || result.toolName === '' || result.toolName === call.toolName;
}

/**
 * 将时间线条目收成渲染行。连续的调用+结果合并为一张卡。
 *
 * @param items buildTimelineItems 的输出
 * @param running 是否仍在等待后续事件
 */
export function foldTimelineRows(items: readonly TimelineItem[], running: boolean): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (item.kind === 'tool-call') {
      const next = items[index + 1];
      if (next?.kind === 'tool-result' && canPair(item, next)) {
        rows.push({ kind: 'tool', card: cardFrom(item, next, running) });
        index += 1;
      } else {
        rows.push({ kind: 'tool', card: cardFrom(item, null, running) });
      }
      continue;
    }
    if (item.kind === 'tool-result') {
      rows.push({ kind: 'tool', card: cardFrom(null, item, running) });
      continue;
    }
    rows.push({ kind: 'plain', item });
  }
  return rows;
}
