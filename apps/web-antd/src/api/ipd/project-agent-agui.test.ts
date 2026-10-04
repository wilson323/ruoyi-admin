import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentAguiParser, streamAgentRunEvents } from './project-agent-agui';

vi.mock('../../store/ipd-auth', () => ({ useIpdAuthStore: () => ({ token: 'test-session', identity: { person: { id: 'person-1' } } }) }));
afterEach(() => vi.unstubAllGlobals());
const event = { seq: 1, type: 'TEXT_DELTA', payload: { text: '中文' }, createdAt: 'now' };
const frame = (value: unknown, id = 1) => `id: ${id}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`;
const custom = (value: unknown) => ({ type: 'CUSTOM', name: 'ipd_event', value });

describe('AG-UI persisted projection', () => {
  it('replays the real successful memory receipt before the durable terminal without losing the cursor', async () => {
    // 运行 2106434621112623106 的已核数据库顺序：回执 112，终态 115。
    const receipt = { ...event, seq: 112, type: 'MEMORY_RECEIPT', payload: {
      status: 'WRITTEN', saved: 0, extracted: 0, retryable: false,
    } };
    const finish = { ...event, seq: 115, type: 'RUN_FINISHED', payload: { status: 'SUCCEEDED' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      frame(custom(receipt), 112) + frame(custom(finish), 115),
      { headers: { 'content-type': 'text/event-stream' } },
    )));
    const seen: unknown[] = [];
    await streamAgentRunEvents('2106434621112623106', 111, value => {
      seen.push(value); return value.type === 'RUN_FINISHED';
    }, new AbortController().signal);
    expect(seen).toEqual([receipt, finish]);
    expect(() => createAgentAguiParser()(frame(custom({ ...event, type: 'UNKNOWN_EVENT' })))).toThrow('序号或内容异常');
  });

  it('ignores native interrupted RUN_FINISHED and delivers the durable clarification wait with trailing SSE ids', async () => {
    const interrupt = { id: 'q1', reason: 'tool_call', metadata: { toolName: 'request_clarification', toolInput: { kind: 'CLARIFICATION', questions: [] } } };
    const native = { type: 'RUN_FINISHED', outcome: { state: 'interrupted', interrupts: [interrupt] } };
    const agui = { ...event, seq: 51, type: 'STEP', payload: { kind: 'AGUI', events: [JSON.stringify(native)] } };
    const waiting = { ...event, seq: 52, type: 'STEP', payload: { kind: 'AWAIT_USER', reason: 'AGUI_INTERRUPT', interrupts: { q1: interrupt } } };
    const wire = `data:${JSON.stringify(native)}\n\ndata:${JSON.stringify(custom(agui))}\nid:51\n\ndata:${JSON.stringify(custom(waiting))}\nid:52\n\n`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(wire, { headers: { 'content-type': 'text/event-stream' } })));
    const seen: unknown[] = [];
    await streamAgentRunEvents('r', 50, value => { seen.push(value); return value.seq === 52; }, new AbortController().signal);
    expect(seen).toEqual([agui, waiting]);
    for (let split = 0; split <= wire.length; split += 1) {
      const parse = createAgentAguiParser();
      expect([...parse(wire.slice(0, split)), ...parse(wire.slice(split))]).toEqual([agui, waiting]);
    }
  });

  it('ignores official mapped frames and buffers split CRLF until the persisted projection is complete', () => {
    const parse = createAgentAguiParser();
    const wire = frame({ type: 'TEXT_MESSAGE_CONTENT', delta: '中文' }) + frame(custom(event));
    const split = wire.lastIndexOf('\r\n') + 1;
    expect(parse(wire.slice(0, split))).toEqual([]);
    expect(parse(wire.slice(split))).toEqual([event]);
  });
  it('ignores same-name native custom events without ids and consumes the durable final frame', () => {
    const parse = createAgentAguiParser();
    const forged = { ...event, seq: 900, type: 'RUN_FINISHED' };
    expect(parse(`data: ${JSON.stringify(custom(forged))}\n\n`)).toEqual([]);
    expect(parse(frame(custom(event)))).toEqual([event]);
  });
  it('does not deliver a native same-name fake terminal or cursor to the stream consumer', async () => {
    const forged = { ...event, seq: 900, type: 'RUN_FINISHED' };
    const wire = `data: ${JSON.stringify(custom(forged))}\n\n` + frame(custom(event));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(wire, { headers: { 'content-type': 'text/event-stream' } })));
    const consume = vi.fn(() => true);
    await streamAgentRunEvents('r', 0, consume, new AbortController().signal);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith(event);
  });
  it('rejects corrupted projection ids and malformed frames instead of advancing the cursor', () => {
    expect(() => createAgentAguiParser()(frame(custom(event), 2))).toThrow('序号');
    expect(() => createAgentAguiParser()('data: {bad}\n\n')).toThrow('格式');
  });
  it('uses bearer headers, preserves string ids and reads only the durable projection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      const bytes = new TextEncoder().encode(frame({ type: 'TEXT_MESSAGE_CONTENT', delta: '中文' }) + frame(custom(event)));
      controller.enqueue(bytes.slice(0, bytes.length - 7));
      controller.enqueue(bytes.slice(bytes.length - 7));
      controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const seen: unknown[] = [];
    await streamAgentRunEvents('9007199254740993', 7, (value) => { seen.push(value); return true; }, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent-runs/9007199254740993/events/stream?afterSeq=7', expect.objectContaining({ headers: { Accept: 'text/event-stream', Authorization: 'Bearer test-session' } }));
    expect(seen).toEqual([event]);
  });
  it('reports unexpected EOF as a transport failure and preserves HTTP business errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } })).mockResolvedValueOnce(new Response(JSON.stringify({ code: 30001, message: '没有项目权限' }), { status: 403, headers: { 'content-type': 'application/json' } })));
    await expect(streamAgentRunEvents('r', 0, () => false, new AbortController().signal)).rejects.toMatchObject({ kind: 'transport' });
    await expect(streamAgentRunEvents('r', 0, () => false, new AbortController().signal)).rejects.toMatchObject({ status: 403, code: 30001, envelopeMessage: '没有项目权限' });
  });
  it('abort closes the reader without issuing a business cancel request', async () => {
    const abort = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response(frame(custom(event)), { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    await streamAgentRunEvents('r', 0, () => { abort.abort(); return true; }, abort.signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
