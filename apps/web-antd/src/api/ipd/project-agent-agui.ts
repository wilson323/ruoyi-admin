/** 官方 AG-UI SSE 消费；ipd_event 为数据库事件的唯一界面投影，映射帧不重复渲染。 */
import type { AgentRunEvent } from './project-agent';

import { useIpdAuthStore } from '../../store/ipd-auth';
import { IpdRequestError } from './auth';

export function projectAgentSessionOwner(): string | null {
  return useIpdAuthStore().identity?.person.id ?? null;
}

const EVENT_TYPES = new Set(['ARTIFACT', 'ERROR', 'RUN_FINISHED', 'RUN_STARTED', 'SOURCE', 'STEP', 'TEXT_DELTA', 'TOOL_CALL', 'TOOL_RESULT']);

/** 兼容 CRLF、分片 UTF-8、多行 data；只在完整 CUSTOM 投影被消费后推进游标。 */
export function createAgentAguiParser(): (chunk: string) => AgentRunEvent[] {
  let buffer = '';
  return (chunk) => {
    buffer = (buffer + chunk).replaceAll('\r\n', '\n');
    const events: AgentRunEvent[] = [];
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end < 0) return events;
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const lines = frame.split('\n');
      const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      let parsed: { type?: string; name?: string; value?: AgentRunEvent };
      try { parsed = JSON.parse(data); } catch { throw new IpdRequestError('运行事件格式异常', 0, 0, 'protocol'); }
      if (!parsed || parsed.type !== 'CUSTOM' || parsed.name !== 'ipd_event') continue;
      const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim();
      // 原生 CUSTOM 可能同名；仅服务器最后的持久化投影帧带 SSE ID，才可推进游标。
      if (id === undefined) continue;
      const event = parsed.value;
      if (!event || !Number.isSafeInteger(event.seq) || event.seq <= 0 || !EVENT_TYPES.has(event.type)
        || typeof event.createdAt !== 'string' || id !== String(event.seq)) {
        throw new IpdRequestError('运行事件序号或内容异常', 0, 0, 'protocol');
      }
      events.push(event);
    }
  };
}

/** 返回 true 的消费者已收到终态/待批准事件，只关闭读取；绝不取消后台运行。 */
export async function streamAgentRunEvents(
  runId: string,
  afterSeq: number,
  onEvent: (event: AgentRunEvent) => boolean,
  signal: AbortSignal,
): Promise<void> {
  const token = useIpdAuthStore().token;
  const response = await fetch(`/api/v1/agent-runs/${encodeURIComponent(runId)}/events/stream?afterSeq=${afterSeq}`, {
    method: 'GET', credentials: 'omit', signal,
    headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
    const envelope = await response.json().catch(() => null) as null | { code?: number; message?: string };
    throw new IpdRequestError(envelope?.message ?? '运行事件流不可用', response.status, envelope?.code ?? 0, 'http', envelope?.message);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new IpdRequestError('运行事件流为空', 0, 0, 'protocol');
  const parse = createAgentAguiParser();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) return;
      if (done) throw new IpdRequestError('运行事件连接已断开，请恢复读取', 0, 0, 'transport');
      for (const event of parse(decoder.decode(value, { stream: true }))) {
        if (signal.aborted || onEvent(event)) return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
