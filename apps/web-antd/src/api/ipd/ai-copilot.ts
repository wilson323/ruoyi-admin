/**
 * AI 副驾 API（R215 AI 融合批次3 = AI-FUSION-B3；AiCopilotController）。
 *
 * 契约（后端 2026-09-23 AI-STRAT-1 Phase 2 / L0-4 真流式）：
 * - POST /ai-copilot/chat：同步问答（code=0 包络，走 ipdPost）；
 * - GET /ai-copilot/chat/stream：SSE 真流式。事件四帧：
 *   meta（AiCopilotResp，真流式时 answer 空）/ delta（answer 增量 token 字符串）/
 *   done（{status,tokenPrompt,tokenCompletion,latencyMs}）/ error（{code,message}）。
 *   鉴权走 Authorization Bearer header（sa-token 上下文，URL 不收 token）——
 *   EventSource 无法带自定义 header，必须 fetch + ReadableStream 自解析（requestIpd
 *   是 JSON 包络专用同样不可复用，15s 超时也会掐断 60s 流）。
 * - history 多轮上下文只传 role+content，后端最大 8 轮，超出由前端裁剪。
 * - docType 可空：非空时 RAG 检索限定文档类型（R184 阶段 3）。
 */
import { useIpdAuthStore } from '../../store/ipd-auth';

import { ipdPost } from './http';

/** 多轮上下文条目（role=user|assistant；历史最大 8 轮，超出由前端裁剪）。 */
export interface CopilotTurn {
  content: string;
  role: 'assistant' | 'user';
}

/** 意图兜底返回的结构化数据项（待办条目 / 当前推进项 / 闲聊留空）。 */
export interface CopilotDataItem {
  hint: null | string;
  title: null | string;
  type: null | string;
  url: null | string;
}

/** AiCopilotResp 透传（intent：TASKS/ADVANCE/CHITCHAT）。 */
export interface CopilotChatView {
  answer: null | string;
  data: CopilotDataItem[] | null;
  intent: string;
  latencyMs: number;
  sources: string[] | null;
  tokenCompletion: number;
  tokenPrompt: number;
}

export interface CopilotChatInput {
  docType?: string;
  history?: CopilotTurn[];
  message: string;
  projectId?: string;
}

/** 同步问答：POST /ai-copilot/chat（包络校验复用 authenticatedRequest 链路）。 */
export function chatCopilot(input: CopilotChatInput): Promise<CopilotChatView> {
  return ipdPost<CopilotChatView>('/ai-copilot/chat', {
    docType: input.docType,
    history: input.history,
    message: input.message,
    projectId: input.projectId,
  });
}

/** SSE done 帧载荷。 */
export interface CopilotStreamDone {
  latencyMs: number;
  status: string;
  tokenCompletion: number;
  tokenPrompt: number;
}

/** SSE error 帧载荷（同步前置 IpdBusinessException 或异步流式失败）。 */
export interface CopilotStreamError {
  code: string;
  message: string;
}

export interface CopilotStreamHandlers {
  onDelta: (token: string) => void;
  onDone: (done: CopilotStreamDone) => void;
  onError: (error: CopilotStreamError) => void;
  onMeta: (meta: CopilotChatView) => void;
}

/** SSE 单帧解析结果（data 已 JSON.parse：meta/done/error 为对象，delta 为字符串）。 */
export interface SseFrame {
  data: unknown;
  event: string;
}

/**
 * SSE 帧解析器（纯函数工厂，可单测）：吸收任意分片的 text/event-stream 字节，
 * 按「空行分帧、event:/data: 行解析、多行 data join」吐出完整帧。
 * 兼容 `event: name` 与 `event:name` 两种冒号后空格形态（规范均允许）。
 */
export function createSseFrameParser(): (chunk: string) => SseFrame[] {
  // 行分隔符用字符常量构造，避免源码层转义序列在工具链中被展开
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const CRLF = CR + LF;
  const FRAME_SEP = LF + LF;
  let buffer = '';
  return (chunk: string) => {
    // 归一化 CRLF 为 LF（跨 chunk 边界的 CR+LF 也覆盖），分帧只需按 LF+LF
    buffer = (buffer + chunk).replaceAll(CRLF, LF);
    const frames: SseFrame[] = [];
    for (;;) {
      const sep = buffer.indexOf(FRAME_SEP);
      if (sep === -1) break;
      const rawFrame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + FRAME_SEP.length);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of rawFrame.split(LF)) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (dataLines.length === 0) continue;
      const raw = dataLines.join(LF);
      try {
        frames.push({ data: JSON.parse(raw), event });
      } catch {
        // 非 JSON data（理论不出现：SseEmitter 统一 Jackson 序列化）按原文透传
        frames.push({ data: raw, event });
      }
    }
    return frames;
  };
}

/**
 * SSE 真流式问答：fetch + ReadableStream 逐帧分发。
 * 非 2xx / 非 event-stream 响应与传输异常统一走 onError（后端契约：鉴权失败也推
 * error 帧而非 JSON，二者在前端合并为一处处理）。
 */
export async function streamCopilot(
  input: { message: string; projectId?: string },
  handlers: CopilotStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const params = new URLSearchParams({ message: input.message });
  if (input.projectId) params.set('projectId', input.projectId);
  const token = useIpdAuthStore().token;
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`/api/v1/ai-copilot/chat/stream?${params.toString()}`, {
      credentials: 'omit',
      headers,
      method: 'GET',
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) return;
    handlers.onError({ code: 'TRANSPORT', message: cause instanceof Error ? cause.message : '网络异常' });
    return;
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
    handlers.onError({ code: String(response.status), message: 'AI 副驾暂不可用，请稍后重试' });
    return;
  }
  const parse = createSseFrameParser();
  const reader = response.body?.getReader();
  if (!reader) {
    handlers.onError({ code: 'NO_BODY', message: '响应流为空' });
    return;
  }
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const frame of parse(decoder.decode(value, { stream: true }))) {
      if (frame.event === 'meta') handlers.onMeta(frame.data as CopilotChatView);
      else if (frame.event === 'delta') handlers.onDelta(String(frame.data));
      else if (frame.event === 'done') handlers.onDone(frame.data as CopilotStreamDone);
      else if (frame.event === 'error')
        handlers.onError(frame.data as CopilotStreamError);
    }
  }
}
