/**
 * useProjectAgentRun 行为测试（单测层，接口替身；不是联调证据）。
 *
 * 覆盖：能力加载与后端原因透传、创建→轮询→seq 去重→terminal 即停、
 * 项目切换 / 作用域销毁丢弃迟到响应、取消、轮询失败不吞错且可恢复、重复发起拦截、幂等键格式。
 */
import { effectScope, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import {
  cancelAgentRun,
  createProjectAgentRun,
  fetchAgentRun,
  fetchAgentRunEvents,
  fetchProjectAgentCapabilities,
  type AgentRunEvent,
  type AgentRunEventPage,
} from '../../../../api/ipd/project-agent';
import { createIdempotencyKey, useProjectAgentRun } from './use-project-agent-run';

vi.mock('../../../../api/ipd/project-agent', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    cancelAgentRun: vi.fn(),
    createProjectAgentRun: vi.fn(),
    fetchAgentRun: vi.fn(),
    fetchAgentRunEvents: vi.fn(),
    fetchProjectAgentCapabilities: vi.fn(),
  };
});

const INPUT = {
  capabilityPackCode: 'ipd.market',
  capabilityPackVersion: '1.0.0',
  modelConfigId: 'm-1',
  skillNames: ['swot'],
  toolIds: ['t-1'],
  message: '做竞品分析',
  idempotencyKey: 'key-1',
};

/** 构造事件。 */
function ev(seq: number, type: AgentRunEvent['type'] = 'STEP'): AgentRunEvent {
  return { seq, type, payload: { title: `步骤${seq}` }, createdAt: '2026-09-29T00:00:00Z' };
}

/** 构造事件页。 */
function page(events: AgentRunEvent[], terminal = false): AgentRunEventPage {
  return { events, nextSeq: events.at(-1)?.seq ?? 0, terminal };
}

/** 可手动决议的 Promise（模拟迟到响应）。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** 在独立作用域里创建组合式函数（模拟组件生命周期）。 */
function setup(projectId = ref<null | string>('p-1'), pollIntervalMs = 1000) {
  const scope = effectScope();
  const state = scope.run(() => useProjectAgentRun(projectId, { pollIntervalMs }))!;
  return { projectId, scope, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchProjectAgentCapabilities).mockResolvedValue({ packs: [], models: [] });
  vi.mocked(createProjectAgentRun).mockResolvedValue({ runId: 'run-1', status: 'PENDING' });
  vi.mocked(fetchAgentRun).mockImplementation(async (runId) => ({
    runId,
    projectId: 'p-1',
    agentId: 'a-1',
    status: 'RUNNING',
    actionCode: null,
    configSnapshot: { capabilityPackCode: 'x', capabilityPackVersion: '1', modelConfigId: 'm-1', skills: [], toolIds: [] },
    errorCode: null,
    createdAt: 'x',
    finishedAt: null,
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('capabilities loading', () => {
  it('auto-loads capabilities for the current project', async () => {
    const { state } = setup();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(fetchProjectAgentCapabilities).toHaveBeenCalledWith('p-1');
    await vi.waitFor(() => expect(state.capabilities.value).toEqual({ packs: [], models: [] }));
  });

  it('surfaces the backend reason when the feature switch is off (no silent fallback)', async () => {
    vi.mocked(fetchProjectAgentCapabilities).mockRejectedValue(
      new IpdRequestError('x', 403, 30001, 'http', '项目智能体功能未开启'),
    );
    const { state } = setup();
    await vi.waitFor(() => expect(state.capabilitiesErrorText.value).toBe('项目智能体功能未开启'));
    expect(state.capabilities.value).toBeNull();
  });

  it('drops a late capabilities response after the project switched', async () => {
    const first = deferred<{ packs: never[]; models: never[] }>();
    vi.mocked(fetchProjectAgentCapabilities)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ packs: [], models: [{ id: 'm-b', name: 'B', available: true, reason: null }] });
    const { projectId, state } = setup();
    projectId.value = 'p-2';
    await nextTick();
    await vi.waitFor(() => expect(state.capabilities.value?.models[0]?.id).toBe('m-b'));
    first.resolve({ packs: [], models: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(state.capabilities.value?.models[0]?.id).toBe('m-b');
  });
});

describe('run lifecycle', () => {
  it('creates the run, dedupes events by seq, advances the cursor and stops at terminal', async () => {
    vi.mocked(fetchAgentRunEvents)
      .mockResolvedValueOnce(page([ev(1, 'RUN_STARTED'), ev(2)]))
      .mockResolvedValueOnce(page([ev(2), ev(3, 'TEXT_DELTA')]))
      .mockResolvedValueOnce(page([ev(4, 'RUN_FINISHED')], true));
    vi.mocked(fetchAgentRun).mockResolvedValue({
      runId: 'run-1',
      projectId: 'p-1',
      agentId: 'a-1',
      status: 'SUCCEEDED',
      actionCode: null,
      configSnapshot: { capabilityPackCode: 'x', capabilityPackVersion: '1', modelConfigId: 'm-1', skills: [], toolIds: [] },
      errorCode: null,
      createdAt: 'x',
      finishedAt: 'y',
    });
    const { state } = setup();
    expect(await state.startRun(INPUT)).toBe(true);
    expect(createProjectAgentRun).toHaveBeenCalledWith('p-1', INPUT);
    await vi.waitFor(() => expect(state.events.value.map((e) => e.seq)).toEqual([1, 2]));
    expect(fetchAgentRunEvents).toHaveBeenNthCalledWith(1, 'run-1', 0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchAgentRunEvents).toHaveBeenNthCalledWith(2, 'run-1', 2);
    expect(state.events.value.map((e) => e.seq)).toEqual([1, 2, 3]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchAgentRunEvents).toHaveBeenNthCalledWith(3, 'run-1', 3);
    expect(state.terminal.value).toBe(true);
    expect(state.status.value).toBe('SUCCEEDED');
    expect(state.polling.value).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(3);
  });

  it('ignores events whose seq is not an integer instead of inventing order', async () => {
    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce(
      page([ev(1), { ...ev(2), seq: Number.NaN }, { ...ev(3), seq: '3' as unknown as number }], true),
    );
    const { state } = setup();
    await state.startRun(INPUT);
    await vi.waitFor(() => expect(state.terminal.value).toBe(true));
    expect(state.events.value.map((e) => e.seq)).toEqual([1]);
  });

  it('refuses to start a second run while one is active', async () => {
    vi.mocked(fetchAgentRunEvents).mockResolvedValue(page([]));
    const { state } = setup();
    await state.startRun(INPUT);
    expect(await state.startRun({ ...INPUT, idempotencyKey: 'key-2' })).toBe(false);
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
  });

  it('keeps the submit error (backend message) and does not start polling', async () => {
    vi.mocked(createProjectAgentRun).mockRejectedValue(new IpdRequestError('x', 409, 50002, 'http', '能力包版本已变更'));
    const { state } = setup();
    expect(await state.startRun(INPUT)).toBe(false);
    expect(state.submitErrorText.value).toBe('能力包版本已变更');
    expect(fetchAgentRunEvents).not.toHaveBeenCalled();
  });
});

describe('isolation of late responses', () => {
  it('discards an in-flight poll response after the project switched', async () => {
    const late = deferred<AgentRunEventPage>();
    vi.mocked(fetchAgentRunEvents).mockReturnValueOnce(late.promise);
    const { projectId, state } = setup();
    await state.startRun(INPUT);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(1);

    projectId.value = 'p-2';
    await nextTick();
    late.resolve(page([ev(1), ev(2)]));
    await vi.advanceTimersByTimeAsync(5000);

    expect(state.runId.value).toBeNull();
    expect(state.events.value).toEqual([]);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(1);
  });

  it('discards late responses and stops the timer when the scope is disposed (unmount)', async () => {
    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce(page([ev(1)]));
    const late = deferred<AgentRunEventPage>();
    vi.mocked(fetchAgentRunEvents).mockReturnValueOnce(late.promise);
    const { scope, state } = setup();
    await state.startRun(INPUT);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(2);

    scope.stop();
    late.resolve(page([ev(2)]));
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.events.value).toEqual([]);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(2);
  });

  it('openRun replaces the timeline with that run, starting events at afterSeq 0', async () => {
    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce(page([ev(1, 'RUN_STARTED')]));
    const { state } = setup();
    await state.startRun(INPUT);
    await vi.waitFor(() => expect(state.events.value).toHaveLength(1));

    vi.mocked(fetchAgentRun).mockResolvedValueOnce({
      runId: '9007199254740993',
      projectId: 'p-1',
      agentId: 'a-1',
      status: 'SUCCEEDED',
      actionCode: 'C02',
      configSnapshot: {
        capabilityPackCode: 'x',
        capabilityPackVersion: '1',
        modelConfigId: 'm-1',
        skills: [],
        toolIds: [],
      },
      errorCode: null,
      createdAt: 'x',
      finishedAt: 'y',
    });
    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce(page([ev(1, 'STEP'), ev(2, 'RUN_FINISHED')], true));
    expect(await state.openRun('9007199254740993')).toBe(true);
    expect(fetchAgentRun).toHaveBeenCalledWith('9007199254740993');
    expect(fetchAgentRunEvents).toHaveBeenLastCalledWith('9007199254740993', 0);
    expect(state.runId.value).toBe('9007199254740993');
    expect(state.events.value.map((event) => event.seq)).toEqual([1, 2]);
    expect(state.events.value[0]!.type).toBe('STEP');
    expect(state.terminal.value).toBe(true);
  });

  it('openRun drains more than 200 events by nextSeq before marking a finished run terminal', async () => {
    vi.mocked(fetchAgentRun).mockResolvedValueOnce({
      runId: 'run-ended',
      projectId: 'p-1',
      agentId: 'a-1',
      status: 'SUCCEEDED',
      actionCode: 'C02',
      configSnapshot: {
        capabilityPackCode: 'x',
        capabilityPackVersion: '1',
        modelConfigId: 'm-1',
        skills: [],
        toolIds: [],
      },
      errorCode: null,
      createdAt: 'x',
      finishedAt: 'y',
    });
    vi.mocked(fetchAgentRunEvents)
      .mockResolvedValueOnce({ events: Array.from({ length: 200 }, (_, i) => ev(i + 1)), nextSeq: 200, terminal: false })
      .mockResolvedValueOnce({
        events: [...Array.from({ length: 100 }, (_, i) => ev(i + 201)), ev(301, 'RUN_FINISHED')],
        nextSeq: 301,
        terminal: true,
      });
    const { state } = setup();
    expect(await state.openRun('run-ended')).toBe(true);
    expect(fetchAgentRunEvents).toHaveBeenNthCalledWith(1, 'run-ended', 0);
    expect(fetchAgentRunEvents).toHaveBeenNthCalledWith(2, 'run-ended', 200);
    expect(state.events.value.map((event) => event.seq)).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
    expect(state.terminal.value).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(2);
  });

  it('openRun reports incomplete history when a finished run cursor does not advance', async () => {
    vi.mocked(fetchAgentRun).mockResolvedValueOnce({
      runId: 'run-stuck',
      projectId: 'p-1',
      agentId: 'a-1',
      status: 'FAILED',
      actionCode: null,
      configSnapshot: {
        capabilityPackCode: 'x',
        capabilityPackVersion: '1',
        modelConfigId: 'm-1',
        skills: [],
        toolIds: [],
      },
      errorCode: null,
      createdAt: 'x',
      finishedAt: 'y',
    });
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [ev(4)],
      nextSeq: 4,
      terminal: false,
    });
    const { state } = setup();
    expect(await state.openRun('run-stuck')).toBe(false);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(2);
    expect(fetchAgentRunEvents).toHaveBeenLastCalledWith('run-stuck', 4);
    expect(state.events.value.map((event) => event.seq)).toEqual([4]);
    expect(state.terminal.value).toBe(false);
    expect(state.pollError.value).toBeInstanceOf(Error);
  });

  it('openRun on a live run fetches one page, then polls from the received seq', async () => {
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({ events: [ev(1)], nextSeq: 5, terminal: false });
    const { state } = setup();
    expect(await state.openRun('run-live')).toBe(true);
    await vi.waitFor(() => expect(fetchAgentRunEvents).toHaveBeenCalledTimes(2));
    expect(fetchAgentRunEvents).toHaveBeenNthCalledWith(1, 'run-live', 0);
    expect(fetchAgentRunEvents).toHaveBeenNthCalledWith(2, 'run-live', 1);
    expect(state.terminal.value).toBe(false);
  });

  it('discards a late create response after the project switched', async () => {
    const late = deferred<{ runId: string; status: 'PENDING' }>();
    vi.mocked(createProjectAgentRun).mockReturnValueOnce(late.promise);
    const { projectId, state } = setup();
    const started = state.startRun(INPUT);
    projectId.value = 'p-2';
    await nextTick();
    late.resolve({ runId: 'run-late', status: 'PENDING' });
    expect(await started).toBe(false);
    expect(state.runId.value).toBeNull();
    expect(fetchAgentRunEvents).not.toHaveBeenCalled();
  });
});

describe('cancel and error recovery', () => {
  it('cancels the run and keeps polling until the stream reports terminal', async () => {
    vi.mocked(fetchAgentRunEvents)
      .mockResolvedValueOnce(page([ev(1, 'RUN_STARTED')]))
      .mockResolvedValueOnce(page([ev(2, 'RUN_FINISHED')], true));
    vi.mocked(cancelAgentRun).mockResolvedValue({ runId: 'run-1', status: 'CANCEL_REQUESTED' });
    const { state } = setup();
    await state.startRun(INPUT);
    await vi.waitFor(() => expect(state.events.value).toHaveLength(1));
    state.status.value = 'RUNNING';

    await state.cancel();
    expect(cancelAgentRun).toHaveBeenCalledWith('run-1');
    expect(state.status.value).toBe('CANCEL_REQUESTED');

    await vi.advanceTimersByTimeAsync(1000);
    expect(state.terminal.value).toBe(true);
  });

  it('stops polling on error, exposes the text, and resumes on demand', async () => {
    vi.mocked(fetchAgentRunEvents)
      .mockRejectedValueOnce(new IpdRequestError('x', 0, 0, 'transport'))
      .mockResolvedValueOnce(page([ev(1)], true));
    const { state } = setup();
    await state.startRun(INPUT);
    await vi.waitFor(() => expect(state.pollErrorText.value).toBe('无法连接服务，请检查网络后重试'));
    expect(state.polling.value).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(1);

    state.resume();
    await vi.waitFor(() => expect(state.terminal.value).toBe(true));
    expect(state.pollErrorText.value).toBe('');
    expect(state.events.value.map((e) => e.seq)).toEqual([1]);
  });
});

describe('createIdempotencyKey', () => {
  it('returns a v4 UUID, also when randomUUID is unavailable (insecure context)', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(createIdempotencyKey()).toMatch(uuid);
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      const a = createIdempotencyKey();
      expect(a).toMatch(uuid);
      expect(createIdempotencyKey()).not.toBe(a);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: original });
    }
  });
});
