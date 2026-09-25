/**
 * AI 副驾 API 契约测试（R215 AI 融合批次3 = AI-FUSION-B3；AiCopilotController）。
 *
 * 重点覆盖：
 * - chatCopilot：POST /ai-copilot/chat，body 四字段（docType/history 可缺省丢弃）；
 * - createSseFrameParser：四帧序列 / 半包分片 / CRLF 归一化 / 冒号空格两形态 / delta 字符串；
 * - streamCopilot：SSE URL query + Bearer 头 + ReadableStream 逐帧分发 + 非 event-stream 错误通道。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIpdAuthStore } from '../../store/ipd-auth';
import { chatCopilot, createSseFrameParser, streamCopilot } from './ai-copilot';

const LF = String.fromCharCode(10);

/** 构造一帧 SSE 文本（后端 SseEmitter 输出形态：event:name + data:json + 空行）。 */
const frame = (event: string, data: unknown): string =>
  `event:${event}${LF}data:${JSON.stringify(data)}${LF}${LF}`;

const envelope = (data: unknown): Response =>
  new Response(
    JSON.stringify({ code: 0, message: 'ok', data, timestamp: '2026-09-24T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const metaFixture = {
  intent: 'TASKS',
  answer: null,
  data: [{ type: 'TODO', title: '补交 Gate2 材料', hint: '今日截止', url: '/ipd/workbench' }],
  sources: ['项目周报 v3'],
  tokenPrompt: 0,
  tokenCompletion: 0,
  latencyMs: 0,
};

const sseResponse = (text: string): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream;charset=UTF-8' } },
  );

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AI 副驾 API（R215 B3）', () => {
  it('chatCopilot → POST /ai-copilot/chat，body 含 projectId/message/history/docType，视图透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ ...metaFixture, answer: '解释文本', tokenPrompt: 120, tokenCompletion: 30, latencyMs: 800 }));
    vi.stubGlobal('fetch', fetcher);
    const r = await chatCopilot({
      docType: 'MRD',
      history: [{ content: '上一问', role: 'user' }],
      message: '我的待办',
      projectId: '9140001',
    });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/ai-copilot/chat');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({
      docType: 'MRD',
      history: [{ content: '上一问', role: 'user' }],
      message: '我的待办',
      projectId: '9140001',
    });
    expect(r.intent).toBe('TASKS');
    expect(r.sources).toEqual(['项目周报 v3']);
  });

  it('chatCopilot 缺省字段从 body 丢弃（后端 record 可空）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(metaFixture));
    vi.stubGlobal('fetch', fetcher);
    await chatCopilot({ message: '闲聊' });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ message: '闲聊' });
  });

  it('SSE 解析器：四帧序列一次喂入，delta 为字符串、meta 为对象', () => {
    const parse = createSseFrameParser();
    const text =
      frame('meta', metaFixture) +
      frame('delta', '第一段') +
      frame('delta', '第二段') +
      frame('done', { status: 'ok', tokenPrompt: 120, tokenCompletion: 8, latencyMs: 900 });
    const frames = parse(text);
    expect(frames).toHaveLength(4);
    expect(frames[0]).toMatchObject({ event: 'meta' });
    expect((frames[0]!.data as typeof metaFixture).intent).toBe('TASKS');
    expect(frames[1]).toEqual({ data: '第一段', event: 'delta' });
    expect(frames[2]).toEqual({ data: '第二段', event: 'delta' });
    expect(frames[3]!.data).toEqual({ status: 'ok', tokenPrompt: 120, tokenCompletion: 8, latencyMs: 900 });
  });

  it('SSE 解析器：半包分片不吐帧、凑齐才吐；CRLF 归一化分帧', () => {
    const parse = createSseFrameParser();
    const CR = String.fromCharCode(13);
    const text = frame('delta', 'ok') + frame('error', { code: '50001', message: '越权' });
    expect(parse(text.slice(0, 10))).toHaveLength(0); // 半包留在 buffer
    const frames = parse(text.slice(10));
    expect(frames.map((f) => f.event)).toEqual(['delta', 'error']);
    expect(frames[1]!.data).toEqual({ code: '50001', message: '越权' });
    // CRLF 行尾（后端经代理改写时可能出现）
    const parse2 = createSseFrameParser();
    const crlfText = `event:delta${CR}${LF}data:"x"${CR}${LF}${CR}${LF}`;
    expect(parse2(crlfText)).toEqual([{ data: 'x', event: 'delta' }]);
  });

  it('SSE 解析器：冒号后空格形态（event: name）与多行 data', () => {
    const parse = createSseFrameParser();
    const lines = `event: done${LF}data:{"a":1,${LF}data: "b":2}${LF}${LF}`;
    const frames = parse(lines);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ data: { a: 1, b: 2 }, event: 'done' });
  });

  it('streamCopilot → SSE URL query + Bearer 头，四帧逐段分发到 handlers', async () => {
    useIpdAuthStore().token = 'tok-abc';
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        sseResponse(frame('meta', metaFixture) + frame('delta', '你') + frame('delta', '好') + frame('done', { status: 'ok', tokenPrompt: 10, tokenCompletion: 2, latencyMs: 50 })),
      );
    vi.stubGlobal('fetch', fetcher);
    const seen: string[] = [];
    await streamCopilot(
      { message: '我的待办', projectId: '9140001' },
      {
        onDelta: (t) => seen.push(t),
        onDone: (d) => seen.push(`done:${d.status}`),
        onError: () => seen.push('error'),
        onMeta: (m) => seen.push(`meta:${m.intent}`),
      },
    );
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/ai-copilot/chat/stream?message=' + encodeURIComponent('我的待办') + '&projectId=9140001');
    expect(fetcher.mock.calls[0]![1].headers.Authorization).toBe('Bearer tok-abc');
    expect(fetcher.mock.calls[0]![1].headers.Accept).toBe('text/event-stream');
    expect(seen).toEqual(['meta:TASKS', '你', '好', 'done:ok']);
  });

  it('streamCopilot 非 event-stream 响应（网关 JSON 错误）→ onError 不抛异常', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"code":30001}', { status: 403, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const errors: unknown[] = [];
    await streamCopilot({ message: 'hi' }, {
      onDelta: () => {},
      onDone: () => {},
      onError: (e) => errors.push(e),
      onMeta: () => {},
    });
    expect(errors).toEqual([{ code: '403', message: 'AI 副驾暂不可用，请稍后重试' }]);
  });
});
