/**
 * 项目智能体时间线纯函数 VM（W1）。
 *
 * 只把后端真实事件折叠为可渲染条目：没有事件就没有条目，绝不补造「思考中 / 分析中」一类
 * 虚构步骤。payload 形态合同未定，这里按常见字段名防御性取值，取不到就留空，不猜测。
 *
 * 规则：
 * - 连续的 TEXT_DELTA 合并为一个文本块（被其他事件打断后另起一块）；
 * - SOURCE 链接只接受 http/https，其他协议只展示文字，防 javascript: 注入；
 * - ARTIFACT 只有 payload 里带字符串 artifactId 时才可定档（逻辑 ID）；点赞另看字符串 versionId；
 * - ARTIFACT 内容预览按常见字段名防御性取值（content / preview / summary / text / snippet），
 *   取不到则留空，不另开预览页、不编造正文；
 * - STEP 且 kind===INTENT 时保留计划 / 澄清布尔值，以及字符串数组 questions / steps；
 * - 运行时出现合同外的新 type 时跳过，不崩页面；编译期 never 检查保证合同内类型全部处理。
 */
import type { AgentRunEvent, AgentRunStatus } from '../../../../api/ipd/project-agent';

/** 摘要最大字符数（防长输出撑爆时间线）。 */
export const TIMELINE_SUMMARY_MAX = 500;

/** 意图步骤的三种展示态（只由已有事件推断，不发明步骤）。 */
export type IntentStepMark = '待执行' | '已完成' | '执行中';

/** 一次意图判断，字段全部来自 STEP.payload，缺了就留空。 */
export interface AgentIntentView {
  detail: string;
  needsClarification: boolean;
  needsPlan: boolean;
  questions: string[];
  steps: string[];
  title: string;
}

/** 条目公共字段。 */
interface TimelineBase {
  /** 渲染 key（基于 seq，稳定唯一）。 */
  key: string;
  /** 条目首个事件的 seq。 */
  seq: number;
  createdAt: string;
}

/** 时间线条目（判别联合）。 */
export type TimelineItem =
  | (TimelineBase & {
      kind: 'artifact';
      artifactId: null | string;
      artifactType: string;
      /** 内容预览（截断后）；无正文字段时为空串。 */
      preview: string;
      title: string;
      /** 版本行雪花 ID；非字符串或缺省时为 null，点赞不得改用逻辑 artifactId。 */
      versionId: null | string;
    })
  | (TimelineBase & { kind: 'error'; code: string; message: string })
  | (TimelineBase & { kind: 'run-finished'; status: AgentRunStatus | null })
  | (TimelineBase & { kind: 'intent' } & AgentIntentView)
  | (TimelineBase & { kind: 'run-started' })
  | (TimelineBase & { kind: 'source'; reference: string; title: string; url: null | string })
  | (TimelineBase & { kind: 'step'; detail: string; title: string })
  | (TimelineBase & { kind: 'text'; text: string })
  | (TimelineBase & { kind: 'tool-call'; summary: string; toolName: string })
  | (TimelineBase & { failed: boolean; kind: 'tool-result'; summary: string; toolName: string });

const RUN_STATUSES: readonly AgentRunStatus[] = [
  'PENDING',
  'RUNNING',
  'WAITING_APPROVAL',
  'CANCEL_REQUESTED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
];

/** 普通对象判别。 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 依次取第一个非空字符串字段。 */
function pickText(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return '';
}

/** 截断长文本。 */
function truncate(text: string): string {
  return text.length > TIMELINE_SUMMARY_MAX ? `${text.slice(0, TIMELINE_SUMMARY_MAX)}…` : text;
}

/** 任意值 → 摘要字符串（字符串直用，对象 JSON 化，均截断）。 */
function summarize(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return truncate(value);
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return '';
  }
}

/** 只放行 http/https 链接。 */
function safeUrl(value: string): null | string {
  return /^https?:\/\//i.test(value) ? value : null;
}

/**
 * 取出非空字符串 ID。
 *
 * @param value payload 字段
 * @returns 非空字符串；空白、数字或其他类型返回 null
 */
function stringId(value: unknown): null | string {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * 只接受纯字符串数组。
 *
 * 混入非字符串、或根本不是数组时返回空数组，不把数字或句子拆进去。
 *
 * @param value payload 中的 questions / steps
 */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const texts: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return [];
    texts.push(truncate(item));
  }
  return texts;
}

/**
 * 从 INTENT 步骤的 payload 取意图字段。
 *
 * @param payload STEP 事件载荷
 */
function intentView(payload: Record<string, unknown>): AgentIntentView {
  return {
    title: pickText(payload, 'title'),
    detail: truncate(pickText(payload, 'detail')),
    needsPlan: payload.needsPlan === true,
    needsClarification: payload.needsClarification === true,
    questions: stringList(payload.questions),
    steps: stringList(payload.steps),
  };
}

/** 文本增量取值：payload 可能直接是字符串，也可能是 { text | delta | content }。 */
function deltaText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  const record = asRecord(payload);
  for (const key of ['text', 'delta', 'content']) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

/** 运行结束状态（只认合同内 7 态）。 */
function finishedStatus(record: Record<string, unknown>): AgentRunStatus | null {
  const value = record.status;
  return RUN_STATUSES.find((s) => s === value) ?? null;
}

/**
 * 把按 seq 升序的事件折叠为时间线条目。
 *
 * @param events 已去重、升序的真实事件
 * @returns 渲染条目；空事件返回空数组
 */
export function buildTimelineItems(events: readonly AgentRunEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const event of events) {
    const base: TimelineBase = { key: `seq-${event.seq}`, seq: event.seq, createdAt: event.createdAt };
    const payload = asRecord(event.payload);
    const type = event.type;
    switch (type) {
      case 'RUN_STARTED': {
        items.push({ ...base, kind: 'run-started' });
        break;
      }
      case 'STEP': {
        if (payload.kind === 'INTENT') {
          items.push({ ...base, kind: 'intent', ...intentView(payload) });
        } else {
          items.push({
            ...base,
            kind: 'step',
            title: pickText(payload, 'title', 'name', 'step', 'stepName'),
            detail: truncate(pickText(payload, 'detail', 'description', 'message')),
          });
        }
        break;
      }
      case 'TOOL_CALL': {
        items.push({
          ...base,
          kind: 'tool-call',
          toolName: pickText(payload, 'toolName', 'name', 'toolId'),
          summary: summarize(payload.arguments ?? payload.args ?? payload.input),
        });
        break;
      }
      case 'TOOL_RESULT': {
        items.push({
          ...base,
          kind: 'tool-result',
          toolName: pickText(payload, 'toolName', 'name', 'toolId'),
          summary: summarize(payload.summary ?? payload.output ?? payload.result),
          failed: payload.success === false || (payload.error != null && payload.error !== ''),
        });
        break;
      }
      case 'SOURCE': {
        const url = pickText(payload, 'url', 'href');
        items.push({
          ...base,
          kind: 'source',
          title: pickText(payload, 'title', 'name'),
          url: url ? safeUrl(url) : null,
          reference: pickText(payload, 'ref', 'sourceRef', 'id') || url,
        });
        break;
      }
      case 'TEXT_DELTA': {
        const text = deltaText(event.payload);
        const last = items.at(-1);
        if (last?.kind === 'text') {
          last.text += text;
        } else {
          items.push({ ...base, kind: 'text', text });
        }
        break;
      }
      case 'ARTIFACT': {
        const id = payload.artifactId;
        items.push({
          ...base,
          kind: 'artifact',
          artifactId: typeof id === 'string' && id.trim() !== '' ? id : null,
          title: pickText(payload, 'title', 'name'),
          artifactType: pickText(payload, 'artifactType', 'kind', 'type'),
          versionId: stringId(payload.versionId),
          preview: truncate(
            pickText(payload, 'content', 'preview', 'summary', 'text', 'snippet'),
          ),
        });
        break;
      }
      case 'ERROR': {
        items.push({
          ...base,
          kind: 'error',
          code: pickText(payload, 'code', 'errorCode'),
          message: truncate(pickText(payload, 'message', 'detail')),
        });
        break;
      }
      case 'RUN_FINISHED': {
        items.push({ ...base, kind: 'run-finished', status: finishedStatus(payload) });
        break;
      }
      default: {
        // 编译期穷尽：合同新增 type 未处理时此处报错；运行时出现合同外 type 则跳过
        const unhandled: never = type;
        void unhandled;
        break;
      }
    }
  }
  return items;
}

/**
 * 把本次运行里模型写出的正文按时间顺序拼成一段。
 *
 * 只拼 kind===text（来自 TEXT_DELTA）。INTENT / SKILL_LOADED / AWAIT_USER 等 STEP
 * 的 title、detail、技能提示词一律不进这段，避免对话气泡把技能执行规约当成正文。
 * 连续 TEXT_DELTA 已在 buildTimelineItems 里合并；这里再把被步骤打断的多段接上，
 * 供对话栏用同一段原文做思考/回答拆分。不补造模型没写过的字。
 *
 * @param events 后端事件（可为空）
 * @returns 模型正文；没有文本事件时为空字符串
 */
export function timelineTranscript(events: readonly AgentRunEvent[]): string {
  return buildTimelineItems(events)
    .flatMap((item) => (item.kind === 'text' ? [item.text] : []))
    .join('');
}

/**
 * 从事件里取出最近一次意图判断，供中间栏和对话共用。
 *
 * 只读 kind===INTENT 的 STEP。没有意图事件时返回 null，不补一句默认结论。
 *
 * @param events 后端事件（可为空）
 */
export function intentFromEvents(events: readonly AgentRunEvent[]): AgentIntentView | null {
  let found: AgentIntentView | null = null;
  for (const item of buildTimelineItems(events)) {
    if (item.kind !== 'intent') continue;
    found = {
      title: item.title,
      detail: item.detail,
      needsPlan: item.needsPlan,
      needsClarification: item.needsClarification,
      questions: item.questions,
      steps: item.steps,
    };
  }
  return found;
}

/**
 * 按已有事件给计划步骤标展示状态。
 *
 * 正文 TEXT_DELTA 已开始时，只把最后一步标成执行中；运行成功终态则全部标已完成。
 * 不新增步骤，条数与传入的 steps 一致。
 *
 * @param events 同一次运行的事件
 * @param count 意图 payload 里的步骤条数
 */
export function intentStepMarks(events: readonly AgentRunEvent[], count: number): IntentStepMark[] {
  if (count <= 0) return [];
  const succeeded = events.some((event) => {
    if (event.type !== 'RUN_FINISHED') return false;
    return asRecord(event.payload).status === 'SUCCEEDED';
  });
  if (succeeded) return Array.from({ length: count }, () => '已完成');
  const wrote = buildTimelineItems(events).some((item) => item.kind === 'text' && item.text.trim() !== '');
  return Array.from({ length: count }, (_, index) =>
    wrote && index === count - 1 ? '执行中' : '待执行',
  );
}
