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
 * - MEMORY_RECEIPT 只在 WRITE_FAILED 时留一条信息性提示（memory-note，非 error）；
 *   WRITTEN 是系统内部账，不产生任何可见条目；
 * - 运行时出现合同外的新 type 时跳过，不崩页面；编译期 never 检查保证合同内类型全部处理。
 */
import type { AgentRunEvent, AgentRunStatus } from '../../../../api/ipd/project-agent';

/** 摘要最大字符数（防长输出撑爆时间线）。 */
export const TIMELINE_SUMMARY_MAX = 500;

/** 意图步骤没有逐项执行回执，展示待核实。 */
export type IntentStepMark = '待核实';

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

/** 来源条目里可展示的一条出处。缺必填字段的知识库行不进入这里。 */
export type SourceEvidenceView = {
  kindLabel: '产品知识库' | '项目已审核文档';
  sourceName: string;
};

/** 检索结果和「没有命中」分开。没有 retrievalStatus 时保持未知，不编原因。 */
export type SourceRetrieval = 'failed' | 'hit' | 'no-hit' | 'partial' | 'unauthorized' | 'unknown';

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
  | (TimelineBase & { kind: 'memory-note'; retryable: boolean; text: string })
  | (TimelineBase & { kind: 'run-finished'; status: AgentRunStatus | null })
  | (TimelineBase & { kind: 'intent' } & AgentIntentView)
  | (TimelineBase & { kind: 'run-started' })
  | (TimelineBase & {
      evidence: SourceEvidenceView[];
      kind: 'source';
      outcomeText: string;
      reasonText: string;
      reference: string;
      retrieval: SourceRetrieval;
      title: string;
      url: null | string;
    })
  | (TimelineBase & { kind: 'step'; detail: string; title: string })
  | (TimelineBase & { kind: 'text'; text: string })
  | (TimelineBase & { kind: 'tool-call'; toolCallId: null | string; summary: string; toolName: string })
  | (TimelineBase & { failed: boolean; kind: 'tool-result'; toolCallId: null | string; summary: string; toolName: string });

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

const SOURCE_REASONS: Record<string, string> = {
  AMBIGUOUS_TOOLS: '工具不唯一',
  CANCELLED: '查询已取消',
  EMPTY_RESULT: '没有返回内容',
  INVALID_QUERY: '查询无法执行',
  NO_CLIENT: '没有连上知识库',
  NO_ENDPOINT: '没有可用地址',
  NO_TOOLS: '没有可用工具',
  PROTOCOL_OR_TRANSPORT: '连接没有完成',
  REMOTE_IS_ERROR: '知识库返回了错误',
  TIMEOUT: '查询超时',
  TOOLS_CAPABILITY_MISSING: '知识库服务暂未提供查询能力',
  UNSUPPORTED_SCHEMA: '工具参数不受支持',
};

/**
 * 只翻译来源事件上已有的 reasonCode。
 *
 * 不从 preview 或异常原文反推。未知码留空。
 *
 * @param code 来源事件 reasonCode
 * @returns 给页面的短句；没有可展示原因时为空
 */
function sourceReasonText(code: string): string {
  return Object.prototype.hasOwnProperty.call(SOURCE_REASONS, code) ? SOURCE_REASONS[code]! : '';
}

/**
 * 读取 hits。数组看长度，数字看本身；缺字段返回 null，不能当成 0。
 *
 * @param value 来源事件 hits
 */
function hitCount(value: unknown): null | number {
  if (Array.isArray(value)) return value.length;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 区分部分查到、没有查成和没有命中。
 *
 * FAILED 优先于 hits，避免旧事件里的命中数组被说成没找到。
 * 没有 retrievalStatus 时不编「没有查成」。
 *
 * @param payload SOURCE 事件载荷
 */
function sourceRetrieval(payload: Record<string, unknown>): {
  outcomeText: string;
  reasonText: string;
  retrieval: SourceRetrieval;
} {
  const status = pickText(payload, 'retrievalStatus');
  if (status === 'UNAUTHORIZED') return { retrieval: 'unauthorized', outcomeText: '无权查看', reasonText: '' };
  if (status === 'FAILED') {
    return { retrieval: 'failed', outcomeText: '没有查成', reasonText: sourceReasonText(pickText(payload, 'reasonCode')) };
  }
  if (status === 'PARTIAL') return { retrieval: 'partial', outcomeText: '部分查到', reasonText: '' };
  const hits = hitCount(payload.hits);
  if (status === 'NO_HIT' || (status === 'SUCCESS' && hits === 0)) {
    return { retrieval: 'no-hit', outcomeText: '没有命中', reasonText: '' };
  }
  if (status === 'SUCCESS') return { retrieval: 'hit', outcomeText: '已查到', reasonText: '' };
  return { retrieval: 'unknown', outcomeText: '', reasonText: '' };
}

/**
 * 只保留合同里合格的出处。
 *
 * 知识库行必须带完整标识且 reviewStatus 为 NOT_PROJECT_DOCUMENT。
 *
 * @param payload SOURCE 事件载荷
 */
function sourceEvidence(payload: Record<string, unknown>): SourceEvidenceView[] {
  if (!Array.isArray(payload.sourceEvidence)) return [];
  const evidence: SourceEvidenceView[] = [];
  for (const item of payload.sourceEvidence) {
    const row = asRecord(item);
    const sourceName = pickText(row, 'sourceName');
    const documentId = pickText(row, 'documentId');
    const sourceType = pickText(row, 'sourceType');
    const reviewStatus = pickText(row, 'reviewStatus');
    if (sourceType === 'PROJECT_DOCUMENT' && documentId && sourceName && reviewStatus === 'REVIEWED') {
      evidence.push({ kindLabel: '项目已审核文档', sourceName });
      continue;
    }
    if (
      sourceType === 'KNOWLEDGE_FRAGMENT'
      && documentId
      && pickText(row, 'knowledgeId')
      && pickText(row, 'fragmentId')
      && sourceName
      && reviewStatus === 'NOT_PROJECT_DOCUMENT'
    ) {
      evidence.push({ kindLabel: '产品知识库', sourceName });
    }
  }
  return evidence;
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
        if (payload.kind === 'EXECUTION_OWNER') break;
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
          toolCallId: stringId(payload.toolCallId),
          toolName: pickText(payload, 'toolName', 'name', 'toolId'),
          summary: summarize(payload.arguments ?? payload.args ?? payload.input),
        });
        break;
      }
      case 'TOOL_RESULT': {
        items.push({
          ...base,
          kind: 'tool-result',
          toolCallId: stringId(payload.toolCallId),
          toolName: pickText(payload, 'toolName', 'name', 'toolId'),
          summary: summarize(payload.summary ?? payload.output ?? payload.result),
          failed: payload.state === 'ERROR' || payload.state === 'FAILED' || payload.success === false || (payload.error != null && payload.error !== ''),
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
          evidence: sourceEvidence(payload),
          ...sourceRetrieval(payload),
        });
        break;
      }
      case 'TEXT_DELTA': {
        const text = deltaText(event.payload);
        if (payload.replace === true) {
          // 原生最终消息是正文权威；工具、来源和步骤证据保持原顺序。
          for (let index = items.length - 1; index >= 0; index--) {
            if (items[index]?.kind === 'text') items.splice(index, 1);
          }
          items.push({ ...base, kind: 'text', text });
          break;
        }
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
      case 'MEMORY_RECEIPT': {
        // 长期记忆写入是回答交付之后的后台副作用，失败不改判本轮运行终态。
        if (pickText(payload, 'status') !== 'WRITE_FAILED') break;
        // retryable 只表示允许重试，不证明存在自动调度；页面不承诺自动补写。
        const retryable = payload.retryable === true;
        items.push({
          ...base,
          kind: 'memory-note',
          retryable,
          text: '本次记忆没有写入',
        });
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
 * 当前事件只记录意图步骤，尚无逐步骤执行回执。
 * 运行成功、正文或工具调用均不能证明某项专业步骤已完成。
 */
export function intentStepMarks(_events: readonly AgentRunEvent[], count: number): IntentStepMark[] {
  return Array.from({ length: Math.max(0, count) }, () => '待核实');
}

/** 与后端 ProjectAgentErrorTexts 固定安全文案一致；历史详情没有 ERROR 事件时也能说明原因。 */
export function agentRunFailureText(code: string | null | undefined): string {
  const texts: Readonly<Record<string, string>> = {
    SCOPE_REJECTED: '运行身份校验失败',
    MODEL_UNAVAILABLE: '所选模型当前不可用',
    KERNEL_ERROR: '智能体装配失败，请稍后重试',
    STREAM_ERROR: '模型输出中断，请稍后重试',
    RUN_TIMEOUT: '运行超时，已终止',
    AGENT_BUSY: '智能体繁忙，请稍后重试',
    ARTIFACT_PERSIST: '产物没有保存下来，请稍后重试',
    COMPLETION_REJECTED: '没有取得可交付正文、检索依据不足或结论越权，产物未生成',
  };
  return code && Object.prototype.hasOwnProperty.call(texts, code)
    ? texts[code]! : '智能体执行失败，请稍后重试';
}
