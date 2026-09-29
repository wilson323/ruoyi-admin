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
import type { CopilotStreamDone } from './ai-copilot';
import {
  chatCopilot,
  createSseFrameParser,
  parseStreamDone,
  registerCopilotPageContext,
  streamCopilot,
} from './ai-copilot';

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
  it('SSE 已收到 delta 后读流中断：保留增量并通过 onError 报告传输失败', async () => {
    const onDelta = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame('delta', '已收到')));
        },
        pull(controller) {
          controller.error(new Error('connection lost'));
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )));

    await expect(streamCopilot({ message: '测试' }, {
      onDelta, onDone: vi.fn(), onError, onMeta: vi.fn(),
    })).resolves.toBeUndefined();
    expect(onDelta).toHaveBeenCalledWith('已收到');
    expect(onError).toHaveBeenCalledExactlyOnceWith({ code: 'TRANSPORT', message: '响应流中断，请重试' });
  });

  it('主动取消 SSE 读取时不报告传输故障', async () => {
    const abort = new AbortController();
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          abort.abort();
          controller.error(new Error('aborted'));
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )));

    await expect(streamCopilot({ message: '测试' }, {
      onDelta: vi.fn(), onDone: vi.fn(), onError, onMeta: vi.fn(),
    }, abort.signal)).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

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

  it('SSE 解析器：done 帧 fillPayload（R221 对话即填表）透传不丢', () => {
    const parse = createSseFrameParser();
    const doneData = {
      latencyMs: 3,
      status: 'ok',
      tokenCompletion: 2,
      tokenPrompt: 1,
      fillPayload: {
        fields: { remark: 'AI 建议值' },
        mode: 'suggest',
        scene: 'stage-action-fields',
      },
    };
    const frames = parse(frame('done', doneData));
    expect(frames).toHaveLength(1);
    const done = frames[0]!.data as CopilotStreamDone;
    expect(done.fillPayload).toMatchObject({
      fields: { remark: 'AI 建议值' },
      mode: 'suggest',
      scene: 'stage-action-fields',
    });
  });

  it('SSE 解析器：done 帧 card（P2-01 AI 卡片信封）四键透传不丢，fillPayload 兼容共存', () => {
    const parse = createSseFrameParser();
    const doneData = {
      latencyMs: 3,
      status: 'ok',
      tokenCompletion: 2,
      tokenPrompt: 1,
      fillPayload: {
        fields: { remark: 'AI 建议值' },
        mode: 'suggest',
        scene: 'stage-action-fields',
      },
      card: {
        type: 'gate.precheck',
        version: 1,
        data: { gateCode: 'G1' },
        sourceRefs: { reviewIds: [1, 2] },
      },
    };
    const frames = parse(frame('done', doneData));
    expect(frames).toHaveLength(1);
    const done = parseStreamDone(frames[0]!.data);
    expect(done.card).toMatchObject({
      type: 'gate.precheck',
      version: 1,
      data: { gateCode: 'G1' },
      sourceRefs: { reviewIds: [1, 2] },
    });
    expect(done.fillPayload).toMatchObject({
      fields: { remark: 'AI 建议值' },
      mode: 'suggest',
      scene: 'stage-action-fields',
    });
  });

  it('done 帧 card 缺席（P2-01 可选超集兼容）→ 原样透传逐字节一致，fillPayload 不丢', () => {
    const raw = {
      latencyMs: 3,
      status: 'ok',
      tokenCompletion: 2,
      tokenPrompt: 1,
      fillPayload: {
        fields: { remark: 'AI 建议值' },
        mode: 'suggest',
        scene: 'stage-action-fields',
      },
    };
    const done = parseStreamDone(raw);
    expect(done).toBe(raw); // 同引用：card 键缺席零改动（逐字节一致）
    expect(done.card).toBeUndefined();
    expect(done.fillPayload?.mode).toBe('suggest');
  });

  it('done 帧 card 非法（缺键/非对象/null/数组）→ 置 null 忽略，其余字段不丢', () => {
    const base = { latencyMs: 3, status: 'ok', tokenCompletion: 2, tokenPrompt: 1 };
    for (const badCard of [{ type: 'gate.precheck', version: 1 }, 'oops', null, [1, 2]]) {
      const done = parseStreamDone({ ...base, card: badCard });
      expect(done.card).toBeNull();
      expect(done.status).toBe('ok');
      expect(done.tokenPrompt).toBe(1);
    }
  });

  it('streamCopilot done 帧携非法 card 不断流：四帧照常分发、card 置 null', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        sseResponse(
          frame('meta', metaFixture) +
            frame('delta', '好') +
            frame('done', {
              status: 'ok',
              tokenPrompt: 10,
              tokenCompletion: 2,
              latencyMs: 50,
              card: { type: 'gate.precheck', version: 1 },
            }),
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const seen: string[] = [];
    const doneCards: unknown[] = [];
    await streamCopilot(
      { message: '我的待办' },
      {
        onDelta: (t) => seen.push(t),
        onDone: (d) => {
          seen.push(`done:${d.status}`);
          doneCards.push(d.card);
        },
        onError: () => seen.push('error'),
        onMeta: (m) => seen.push(`meta:${m.intent}`),
      },
    );
    expect(seen).toEqual(['meta:TASKS', '好', 'done:ok']);
    expect(doneCards).toEqual([null]);
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

// ============================================================
//  R232 P2-03 fillContext：pageContext 随请求上送（载荷断言）
// ============================================================

describe('R232 P2-03 fillContext：pageContext 随请求上送', () => {
  const noopHandlers = {
    onDelta: () => {},
    onDone: () => {},
    onError: () => {},
    onMeta: () => {},
  };
  /** 键面 = 后端 fillPagePath 解析面（AiCopilotService.java L317-325）：scene/actionCode/stageActionId。 */
  const ctx = { actionCode: 'C08', scene: 'stage-action-fields', stageActionId: 9001 };

  beforeEach(() => registerCopilotPageContext(null));
  afterEach(() => registerCopilotPageContext(null));

  it('streamCopilot 显式传 pageContext：JSON 载荷随 GET query 上送（字段名对齐 AiCopilotReq.pageContext）', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        sseResponse(frame('done', { status: 'ok', tokenPrompt: 0, tokenCompletion: 0, latencyMs: 1 })),
      );
    vi.stubGlobal('fetch', fetcher);
    await streamCopilot(
      { message: '帮我填一下', pageContext: ctx, projectId: '9140001' },
      noopHandlers,
    );
    const query = new URL(String(fetcher.mock.calls[0]![0]), 'http://test.local').searchParams;
    expect(query.get('message')).toBe('帮我填一下');
    expect(query.get('projectId')).toBe('9140001');
    // 载荷断言：JSON round-trip 三键逐键一致（后端不读的键一个不发明）
    expect(JSON.parse(String(query.get('pageContext')))).toEqual({
      actionCode: 'C08',
      scene: 'stage-action-fields',
      stageActionId: 9001,
    });
  });

  it('fillContext 注册表：input 未传时以宿主页面注册上下文上送；清除后不再上送', async () => {
    // 每次调用返回全新 Response（同一 Response 的流只能读一次，复用会 locked）
    const fetcher = vi.fn().mockImplementation(async () => sseResponse(''));
    vi.stubGlobal('fetch', fetcher);
    registerCopilotPageContext(ctx);
    await streamCopilot({ message: '帮我填一下' }, noopHandlers);
    const sent = JSON.parse(
      String(new URL(String(fetcher.mock.calls[0]![0]), 'http://test.local').searchParams.get('pageContext')),
    );
    expect(sent).toEqual({ actionCode: 'C08', scene: 'stage-action-fields', stageActionId: 9001 });
    // 注册表清除（页面卸载路径）→ 与改造前逐字节一致：不带 pageContext 键
    registerCopilotPageContext(null);
    await streamCopilot({ message: '帮我填一下' }, noopHandlers);
    expect(new URL(String(fetcher.mock.calls[1]![0]), 'http://test.local').searchParams.has('pageContext')).toBe(false);
  });

  it('input.pageContext 显式优先于注册上下文（双通道兼容：助手侧显式上送不断链）', async () => {
    const fetcher = vi.fn().mockResolvedValue(sseResponse(''));
    vi.stubGlobal('fetch', fetcher);
    registerCopilotPageContext({ actionCode: 'X99', scene: 'stage-action-fields' });
    await streamCopilot({ message: '帮我填一下', pageContext: ctx }, noopHandlers);
    expect(
      JSON.parse(String(new URL(String(fetcher.mock.calls[0]![0]), 'http://test.local').searchParams.get('pageContext'))),
    ).toEqual({ actionCode: 'C08', scene: 'stage-action-fields', stageActionId: 9001 });
  });
});
