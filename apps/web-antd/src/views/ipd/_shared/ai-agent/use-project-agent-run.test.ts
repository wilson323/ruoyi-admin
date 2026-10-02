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
  resumeAgentRun,
  createProjectAgentRun,
  fetchAgentRun,
  fetchAgentRunEvents,
  fetchProjectAgentCapabilities,
  type AgentRunEvent,
  type AgentRunEventPage,
} from '../../../../api/ipd/project-agent';
import { streamAgentRunEvents } from '../../../../api/ipd/project-agent-agui';
import { createIdempotencyKey, useProjectAgentRun } from './use-project-agent-run';

vi.mock('../../../../api/ipd/project-agent', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    cancelAgentRun: vi.fn(),
    resumeAgentRun: vi.fn(),
    createProjectAgentRun: vi.fn(),
    fetchAgentRun: vi.fn(),
    fetchAgentRunEvents: vi.fn(),
    fetchProjectAgentCapabilities: vi.fn(),
  };
});

vi.mock('../../../../api/ipd/project-agent-agui', () => ({ streamAgentRunEvents: vi.fn(), projectAgentSessionOwner: () => sessionOwner.value }));

const sessionOwner = ref<string | null>('person-1');

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
  const state = scope.run(() => useProjectAgentRun(projectId, { pollIntervalMs, transport: 'poll' }))!;
  return { projectId, scope, state };
}

beforeEach(() => {
  sessionOwner.value = 'person-1';
  sessionStorage.clear();
  vi.mocked(streamAgentRunEvents).mockReset();
  vi.mocked(resumeAgentRun).mockReset();
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

  it('keeps history recovery serial while its detail is loading', async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchAgentRun>>>();
    vi.mocked(fetchAgentRun).mockReturnValueOnce(pending.promise);
    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce(page([ev(1, 'RUN_FINISHED')], true));
    const { state } = setup();
    const opened = state.openRun('run-recovering');
    expect(state.polling.value).toBe(true);
    state.resume();
    expect(fetchAgentRunEvents).not.toHaveBeenCalled();
    pending.resolve({
      runId: 'run-recovering', projectId: 'p-1', agentId: 'a-1', status: 'SUCCEEDED',
      actionCode: null, configSnapshot: { capabilityPackCode: 'x', capabilityPackVersion: '1', modelConfigId: 'm-1', skills: [], toolIds: [] },
      errorCode: null, createdAt: 'x', finishedAt: 'y',
    });
    expect(await opened).toBe(true);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(1);
    expect(state.polling.value).toBe(false);
  });

  it('does not overwrite terminal history while its remaining events are replaying', async () => {
    const pending = deferred<AgentRunEventPage>();
    const actualDetail = await fetchAgentRun('run-ended');
    vi.mocked(fetchAgentRun).mockResolvedValueOnce({ ...actualDetail, status: 'SUCCEEDED', finishedAt: 'y' });
    vi.mocked(fetchAgentRunEvents).mockReturnValueOnce(pending.promise);
    const { state } = setup();
    const opened = state.openRun('run-ended');
    await vi.waitFor(() => expect(fetchAgentRunEvents).toHaveBeenCalledTimes(1));
    expect(state.active.value).toBe(false);
    expect(await state.startRun(INPUT)).toBe(false);
    expect(createProjectAgentRun).not.toHaveBeenCalled();
    state.resume();
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(1);
    pending.resolve(page([ev(1, 'RUN_FINISHED')], true));
    expect(await opened).toBe(true);
    expect(state.runId.value).toBe('run-ended');
    expect(state.events.value.map((event) => event.seq)).toEqual([1]);
    expect(state.polling.value).toBe(false);
  });

  it('releases the recovery channel after detail failure and allows an explicit retry', async () => {
    vi.mocked(fetchAgentRun).mockRejectedValueOnce(new Error('network disconnected'));
    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce(page([ev(1, 'RUN_FINISHED')], true));
    const { state } = setup();
    expect(await state.openRun('run-recovering')).toBe(false);
    expect(state.polling.value).toBe(false);
    expect(state.pollError.value).toBeInstanceOf(Error);
    state.resume();
    await vi.waitFor(() => expect(state.terminal.value).toBe(true));
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(1);
    expect(state.pollError.value).toBeNull();
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


describe('default AG-UI transport and session recovery', () => {
  function setupAgui(restoreSession = false) {
    const scope = effectScope();
    const state = scope.run(() => useProjectAgentRun(ref('p-1'), { pollIntervalMs: 1000, restoreSession }))!;
    return { scope, state };
  }

  it('reconnects from consumed seq, dedupes replay and never recreates or polls the run', async () => {
    vi.mocked(streamAgentRunEvents)
      .mockImplementationOnce(async (_id, _cursor, consume) => { consume(ev(1)); throw new TypeError('offline'); })
      .mockImplementationOnce(async (_id, _cursor, consume) => { consume(ev(1)); consume(ev(2, 'RUN_FINISHED')); });
    const { scope, state } = setupAgui();
    expect(await state.startRun(INPUT)).toBe(true);
    await vi.waitFor(() => expect(streamAgentRunEvents).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(streamAgentRunEvents).toHaveBeenNthCalledWith(2, 'run-1', 1, expect.any(Function), expect.any(AbortSignal));
    expect(state.events.value.map((event) => event.seq)).toEqual([1, 2]);
    expect(state.terminal.value).toBe(true);
    expect(state.pollError.value).toBeNull();
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
    expect(fetchAgentRunEvents).not.toHaveBeenCalled();
    scope.stop();
  });

  it('limits automatic reconnections and resumes explicitly without changing the consumed cursor', async () => {
    vi.mocked(streamAgentRunEvents).mockRejectedValue(new TypeError('offline'));
    const { scope, state } = setupAgui();
    await state.startRun(INPUT);
    await vi.advanceTimersByTimeAsync(5000);
    expect(streamAgentRunEvents).toHaveBeenCalledTimes(3);
    expect(state.polling.value).toBe(false);
    expect(state.pollError.value).toBeInstanceOf(TypeError);
    vi.mocked(streamAgentRunEvents).mockImplementationOnce(async (_id, _cursor, consume) => { consume(ev(1, 'RUN_FINISHED')); });
    state.resume();
    await vi.waitFor(() => expect(state.terminal.value).toBe(true));
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('does not retry authorization failures or silently fall back to polling', async () => {
    vi.mocked(streamAgentRunEvents).mockRejectedValueOnce(new IpdRequestError('denied', 403, 30001, 'http'));
    const { scope, state } = setupAgui();
    await state.startRun(INPUT);
    await vi.advanceTimersByTimeAsync(5000);
    expect(streamAgentRunEvents).toHaveBeenCalledTimes(1);
    expect(state.polling.value).toBe(false);
    expect(fetchAgentRunEvents).not.toHaveBeenCalled();
    scope.stop();
  });

  it('stops reading at waiting approval and refreshes authoritative detail', async () => {
    vi.mocked(fetchAgentRun).mockResolvedValueOnce({ ...(await fetchAgentRun('run-1')), status: 'WAITING_APPROVAL', pauseSeq: 1 });
    vi.mocked(streamAgentRunEvents).mockImplementationOnce(async (_id, _cursor, consume) => {
      expect(consume({ ...ev(1), payload: { kind: 'AWAIT_USER' } })).toBe(false);
    });
    const { scope, state } = setupAgui();
    await state.startRun(INPUT);
    await vi.waitFor(() => expect(state.status.value).toBe('WAITING_APPROVAL'));
    expect(state.polling.value).toBe(false);
    expect(state.terminal.value).toBe(false);
    scope.stop();
  });

  it('accepts an empty stream close after the waiting approval event was already consumed', async () => {
    const actualDetail = await fetchAgentRun('run-1');
    vi.mocked(fetchAgentRun).mockResolvedValue({ ...actualDetail, status: 'WAITING_APPROVAL', pauseSeq: 1 });
    vi.mocked(streamAgentRunEvents)
      .mockImplementationOnce(async (_id, _cursor, consume) => { consume({ ...ev(1), payload: { kind: 'AWAIT_USER' } }); })
      .mockRejectedValueOnce(new IpdRequestError('closed', 0, 0, 'transport'));
    const { scope, state } = setupAgui();
    await state.startRun(INPUT);
    await vi.waitFor(() => expect(state.status.value).toBe('WAITING_APPROVAL'));
    state.resume();
    await vi.advanceTimersByTimeAsync(5000);
    expect(streamAgentRunEvents).toHaveBeenCalledTimes(2);
    expect(state.polling.value).toBe(false);
    expect(state.pollError.value).toBeNull();
    scope.stop();
  });

  it('persists only scoped identifiers and restores the same run after scope disposal without cancelling', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(streamAgentRunEvents).mockImplementationOnce(async (_id, _cursor, _consume, currentSignal) => {
      signal = currentSignal;
      await new Promise<void>((resolve) => currentSignal.addEventListener('abort', () => resolve()));
    }).mockImplementationOnce(async (_id, _cursor, consume) => { consume(ev(1, 'RUN_FINISHED')); });
    const first = setupAgui(true);
    await first.state.startRun(INPUT);
    expect(sessionStorage.getItem('ipd.agent-run:person-1:p-1')).toBe(JSON.stringify({ projectId: 'p-1', owner: 'person-1', runId: 'run-1' }));
    first.scope.stop();
    expect(signal?.aborted).toBe(true);
    expect(cancelAgentRun).not.toHaveBeenCalled();
    const second = setupAgui(true);
    await vi.waitFor(() => expect(second.state.terminal.value).toBe(true));
    expect(second.state.runId.value).toBe('run-1');
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
    expect(streamAgentRunEvents).toHaveBeenLastCalledWith('run-1', 0, expect.any(Function), expect.any(AbortSignal));
    second.scope.stop();
  });

  it('replays old waiting and resumed events before displaying only the authoritative current pause', async () => {
    const base = await fetchAgentRun('run-1');
    vi.mocked(fetchAgentRun).mockResolvedValue({ ...base, status: 'WAITING_APPROVAL', pauseSeq: 9 });
    const oldPause = { ...ev(2), payload: { kind: 'AWAIT_USER', reason: 'AGUI_INTERRUPT', interrupts: { old: { id: 'old', reason: 'tool_call' } } } };
    const current = { ...ev(9), payload: { kind: 'AWAIT_USER', reason: 'AGUI_INTERRUPT', interrupts: { current: { id: 'current', reason: 'input_required', responseSchema: { type: 'string' } } } } };
    vi.mocked(streamAgentRunEvents).mockImplementationOnce(async (_id, _cursor, consume) => {
      expect(consume(oldPause)).toBe(false);
      expect(consume({ ...ev(3), payload: { kind: 'AGUI_RESUMED' } })).toBe(false);
      expect(consume(current)).toBe(true);
    });
    const { scope, state } = setupAgui();
    expect(await state.openRun('run-1')).toBe(true);
    await vi.waitFor(() => expect(state.polling.value).toBe(false));
    expect(state.events.value.map((event) => event.seq)).toEqual([2, 3, 9]);
    expect(state.pendingInterrupt.value?.interrupts.map((interrupt) => interrupt.id)).toEqual(['current']);
    scope.stop();
  });

  it('replays a succeeded history through previous waits and resumes to the real terminal event', async () => {
    const base = await fetchAgentRun('run-1');
    vi.mocked(fetchAgentRun).mockResolvedValue({ ...base, status: 'SUCCEEDED', pauseSeq: null });
    vi.mocked(streamAgentRunEvents).mockImplementationOnce(async (_id, _cursor, consume) => {
      expect(consume({ ...ev(2), payload: { kind: 'AWAIT_USER', reason: 'AGUI_INTERRUPT', interrupts: { old: { id: 'old', reason: 'tool_call' } } } })).toBe(false);
      expect(consume({ ...ev(3), payload: { kind: 'AGUI_RESUMED' } })).toBe(false);
      expect(consume(ev(10, 'RUN_FINISHED'))).toBe(true);
    });
    const { scope, state } = setupAgui();
    expect(await state.openRun('run-1')).toBe(true);
    await vi.waitFor(() => expect(state.terminal.value).toBe(true));
    expect(state.events.value.map((event) => event.seq)).toEqual([2, 3, 10]);
    expect(state.pendingInterrupt.value).toBeNull();
    scope.stop();
  });

  it('does not treat a truncated replay containing an old wait as the current completed pause', async () => {
    const base = await fetchAgentRun('run-1');
    vi.mocked(fetchAgentRun).mockResolvedValue({ ...base, status: 'WAITING_APPROVAL', pauseSeq: 9 });
    vi.mocked(streamAgentRunEvents).mockImplementation(async (_id, _cursor, consume) => {
      consume({ ...ev(2), payload: { kind: 'AWAIT_USER', reason: 'AGUI_INTERRUPT', interrupts: { old: { id: 'old', reason: 'tool_call' } } } });
      throw new IpdRequestError('truncated', 0, 0, 'transport');
    });
    const { scope, state } = setupAgui();
    await state.openRun('run-1');
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.pendingInterrupt.value).toBeNull();
    expect(state.pollError.value).toBeInstanceOf(IpdRequestError);
    expect(streamAgentRunEvents).toHaveBeenCalledTimes(3);
    scope.stop();
  });

  it('answers every native interrupt on the same run and resumes from its durable waiting cursor', async () => {
    const base = await fetchAgentRun('run-1');
    vi.mocked(fetchAgentRun).mockResolvedValueOnce({ ...base, status: 'WAITING_APPROVAL', pauseSeq: 7 });
    vi.mocked(resumeAgentRun).mockResolvedValueOnce({ runId: 'run-1', status: 'RUNNING' });
    const wait = { ...ev(7), payload: { kind: 'AWAIT_USER', reason: 'AGUI_INTERRUPT', interrupts: { tool: { id: 'tool', reason: 'tool_call' }, input: { id: 'input', reason: 'input_required', responseSchema: { type: 'string' } } } } };
    vi.mocked(streamAgentRunEvents)
      .mockImplementationOnce(async (_id, _cursor, consume) => { consume(wait); })
      .mockImplementationOnce(async (_id, _cursor, consume) => { consume(ev(8, 'RUN_FINISHED')); });
    const { scope, state } = setupAgui();
    await state.startRun(INPUT);
    await vi.waitFor(() => expect(state.pendingInterrupt.value?.seq).toBe(7));
    expect(await state.respondToInterrupt([{ interruptId: 'tool', status: 'resolved', payload: { approved: true } }])).toBe(false);
    expect(resumeAgentRun).not.toHaveBeenCalled();
    const entries = [{ interruptId: 'tool', status: 'resolved' as const, payload: { approved: false } }, { interruptId: 'input', status: 'resolved' as const, payload: '中国市场' }];
    expect(await state.respondToInterrupt(entries)).toBe(true);
    await vi.waitFor(() => expect(state.terminal.value).toBe(true));
    expect(resumeAgentRun).toHaveBeenCalledWith('run-1', { expectedPauseSeq: 7, aguiInput: { threadId: 'run-1', runId: 'run-1', messages: [], tools: [], context: [], state: {}, forwardedProps: {}, resume: entries } });
    expect(streamAgentRunEvents).toHaveBeenLastCalledWith('run-1', 7, expect.any(Function), expect.any(AbortSignal));
    expect(state.events.value.map((event) => event.seq)).toEqual([7, 8]);
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
    expect(cancelAgentRun).not.toHaveBeenCalled();
    scope.stop();
  });

  it('preserves the pause after rejected/stale approval and never replaces it with a new run', async () => {
    const base = await fetchAgentRun('run-1');
    vi.mocked(fetchAgentRun).mockResolvedValueOnce({ ...base, status: 'WAITING_APPROVAL', pauseSeq: 7 });
    vi.mocked(streamAgentRunEvents).mockImplementationOnce(async (_id, _cursor, consume) => { consume({ ...ev(7), payload: { kind: 'AWAIT_USER', reason: 'AGUI_INTERRUPT', interrupts: { tool: { id: 'tool', reason: 'tool_call' } } } }); });
    vi.mocked(resumeAgentRun).mockRejectedValueOnce(new IpdRequestError('这个问题已更新，请恢复运行记录', 409, 0, 'http'));
    const { scope, state } = setupAgui();
    await state.startRun(INPUT);
    await vi.waitFor(() => expect(state.pendingInterrupt.value?.seq).toBe(7));
    expect(await state.respondToInterrupt([{ interruptId: 'tool', status: 'resolved', payload: { approved: true } }])).toBe(false);
    expect(state.responseErrorText.value).toContain('状态已变更');
    expect(state.runId.value).toBe('run-1');
    expect(state.pendingInterrupt.value?.seq).toBe(7);
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
    expect(cancelAgentRun).not.toHaveBeenCalled();
    scope.stop();
  });

  it('clears state immediately on logout and ignores late stream events without cancelling the backend', async () => {
    let consume: ((event: AgentRunEvent) => boolean) | undefined;
    let signal: AbortSignal | undefined;
    const waiting = deferred<void>();
    vi.mocked(streamAgentRunEvents).mockImplementationOnce(async (_id, _cursor, onEvent, currentSignal) => {
      consume = onEvent;
      signal = currentSignal;
      onEvent(ev(1));
      await waiting.promise;
    });
    const { scope, state } = setupAgui(true);
    await state.startRun(INPUT);
    expect(state.events.value).toHaveLength(1);
    sessionOwner.value = null;
    expect(signal?.aborted).toBe(true);
    expect(state.runId.value).toBeNull();
    expect(state.events.value).toEqual([]);
    expect(state.capabilities.value).toBeNull();
    consume?.(ev(2, 'RUN_FINISHED'));
    waiting.resolve();
    await Promise.resolve();
    expect(state.events.value).toEqual([]);
    expect(cancelAgentRun).not.toHaveBeenCalled();
    scope.stop();
  });

  it('restores only the next owner run and invalidates old detail and capability responses', async () => {
    const oldDetail = deferred<Awaited<ReturnType<typeof fetchAgentRun>>>();
    const oldCaps = deferred<{ packs: never[]; models: never[] }>();
    const actualDetail = await fetchAgentRun('old-run');
    vi.mocked(fetchAgentRun).mockReturnValueOnce(oldDetail.promise).mockResolvedValueOnce({ ...actualDetail, runId: 'new-run' });
    vi.mocked(fetchProjectAgentCapabilities).mockReturnValueOnce(oldCaps.promise).mockResolvedValueOnce({ packs: [], models: [] });
    vi.mocked(streamAgentRunEvents).mockImplementationOnce(async (_id, _cursor, consume) => { consume(ev(1, 'RUN_FINISHED')); });
    sessionStorage.setItem('ipd.agent-run:person-1:p-1', JSON.stringify({ projectId: 'p-1', owner: 'person-1', runId: 'old-run' }));
    sessionStorage.setItem('ipd.agent-run:person-2:p-1', JSON.stringify({ projectId: 'p-1', owner: 'person-2', runId: 'new-run' }));
    const { scope, state } = setupAgui(true);
    expect(state.runId.value).toBe('old-run');
    sessionOwner.value = 'person-2';
    expect(state.runId.value).toBe('new-run');
    await vi.waitFor(() => expect(state.terminal.value).toBe(true));
    oldDetail.resolve({ ...actualDetail, runId: 'old-run', status: 'FAILED' });
    oldCaps.resolve({ packs: [], models: [] });
    await Promise.resolve();
    expect(state.runId.value).toBe('new-run');
    expect(state.detail.value?.runId).toBe('new-run');
    expect(streamAgentRunEvents).toHaveBeenCalledTimes(1);
    expect(streamAgentRunEvents).toHaveBeenCalledWith('new-run', 0, expect.any(Function), expect.any(AbortSignal));
    scope.stop();
  });

  it('does not restore a saved identifier for another owner or project', async () => {
    sessionStorage.setItem('ipd.agent-run:person-1:p-1', JSON.stringify({ projectId: 'p-2', owner: 'person-2', runId: 'other' }));
    const { scope, state } = setupAgui(true);
    await Promise.resolve();
    expect(state.runId.value).toBeNull();
    expect(streamAgentRunEvents).not.toHaveBeenCalled();
    scope.stop();
  });
});
