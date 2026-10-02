/**
 * 项目智能体运行组合式函数（W1）。
 *
 * 职责：加载能力清单 → 创建运行 → AG-UI SSE 与持久化 seq 回放 → 取消。
 *
 * 隔离与迟到响应：
 * - 每次新运行 / 项目切换 / 作用域销毁都会递增令牌；异步回调写状态前先核对令牌，
 *   过期响应直接丢弃，不会把 A 项目的事件写进 B 项目的时间线；
 * - 轮询用串行 setTimeout 链（上一轮落地才排下一轮），不存在并发重叠请求。
 *
 * 游标语义：进行中的轮询仍用「已收到的最大 seq」作为 afterSeq。打开已结束的运行时，
 * 按事件页的 nextSeq 继续要下一页，直到该页 terminal 为 true。后端 nextSeq 是本页
 * 已交付的最大 seq（ProjectAgentRunService.events），不是 seq+1。
 *
 * 错误：统一经 ipdErrorText 转中文（优先透传后端 message），不吞错；SSE 网络故障有限重连后保留
 * 错误，由调用方显式 resume。本函数不回落到副驾 SSE 流。
 */
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';

import {
  cancelAgentRun,
  resumeAgentRun,
  createProjectAgentRun,
  fetchAgentRun,
  fetchAgentRunEvents,
  fetchProjectAgentCapabilities,
  isAgentRunCancellable,
  isAgentRunTerminal,
  type AgentRunDetail,
  type AgentRunResumeEntry,
  type AgentRunEvent,
  type AgentRunStatus,
  type CreateAgentRunInput,
  type ProjectAgentCapabilities,
} from '../../../../api/ipd/project-agent';
import { projectAgentSessionOwner, streamAgentRunEvents } from '../../../../api/ipd/project-agent-agui';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { ipdErrorText } from '../ipd-error-text';
import { agentInterruptPause, validateInterruptPayload } from './agui-interrupt';

/** 默认轮询间隔（毫秒）。 */
export const DEFAULT_AGENT_POLL_INTERVAL_MS = 400;

/** 组合式函数选项。 */
export interface UseProjectAgentRunOptions {
  /** 轮询间隔（毫秒）。默认 400，让已落库的文本增量尽快出现在界面上。 */
  pollIntervalMs?: number;
  /** 生产默认 AG-UI；poll 仅供显式兼容与确定性验证，不作失败回退。 */
  transport?: 'agui' | 'poll';
  /** 一次读取最多自动重连两次，失败后保留显式恢复入口。 */
  maxReconnects?: number;
  /** 默认从同用户、同项目的会话标识恢复，不保存正文。 */
  restoreSession?: boolean;
  /** projectId 变化时是否自动加载能力清单，默认 true。 */
  autoLoadCapabilities?: boolean;
}

/**
 * 生成幂等键：优先 crypto.randomUUID；非安全上下文（内网 http）退化为 getRandomValues 拼 v4 UUID。
 *
 * @returns RFC 4122 v4 格式字符串
 */
export function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 防御性补齐数组字段（后端缺字段时不让组件崩在 undefined.map 上）。 */
function normalizeCapabilities(raw: ProjectAgentCapabilities | null | undefined): ProjectAgentCapabilities {
  const packs = Array.isArray(raw?.packs) ? raw.packs : [];
  return {
    packs: packs.map((pack) => ({
      ...pack,
      actionCodes: Array.isArray(pack.actionCodes) ? pack.actionCodes : [],
      skills: Array.isArray(pack.skills) ? pack.skills : [],
      stages: Array.isArray(pack.stages) ? pack.stages : [],
      tools: Array.isArray(pack.tools) ? pack.tools : [],
    })),
    models: Array.isArray(raw?.models) ? raw.models : [],
  };
}

/** 错误 → 中文文案（无错误返回空串）。 */
function textOf(error: unknown, fallback: string): string {
  return error ? ipdErrorText(error, { fallback }) : '';
}

/**
 * 项目智能体运行状态机。
 *
 * @param projectId 当前项目 ID（ref / getter / 字符串）；变化即视为项目切换
 * @param options 轮询间隔与自动加载开关
 */
export function useProjectAgentRun(
  projectId: MaybeRefOrGetter<null | string | undefined>,
  options: UseProjectAgentRunOptions = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_AGENT_POLL_INTERVAL_MS;
  const autoLoad = options.autoLoadCapabilities ?? true;
  const transport = options.transport ?? 'agui';
  const maxReconnects = options.maxReconnects ?? 2;
  const restoreSession = options.restoreSession ?? transport === 'agui';

  const capabilities = shallowRef<null | ProjectAgentCapabilities>(null);
  const capabilitiesLoading = ref(false);
  const capabilitiesError = shallowRef<unknown>(null);

  const runId = ref<null | string>(null);
  const status = ref<AgentRunStatus | null>(null);
  const detail = shallowRef<AgentRunDetail | null>(null);
  const events = shallowRef<AgentRunEvent[]>([]);
  const terminal = ref(false);
  const polling = ref(false);
  const submitting = ref(false);
  const cancelling = ref(false);
  const submitError = shallowRef<unknown>(null);
  const pollError = shallowRef<unknown>(null);
  const cancelError = shallowRef<unknown>(null);
  const detailError = shallowRef<unknown>(null);
  const responding = ref(false);
  const responseError = shallowRef<unknown>(null);
  const consumedPauses = ref(new Set<number>());
  const pendingInterrupt = computed(() => {
    if (terminal.value || status.value !== 'WAITING_APPROVAL') return null;
    const pause = agentInterruptPause(events.value);
    return pause && pause.seq === detail.value?.pauseSeq && !consumedPauses.value.has(pause.seq) ? pause : null;
  });

  let capToken = 0;
  let runToken = 0;
  let cursor = 0;
  let disposed = false;
  let timer: null | ReturnType<typeof setTimeout> = null;
  const seenSeqs = new Set<number>();
  let streamController: AbortController | null = null;
  let reconnects = 0;
  const sessionKey = (pid: string, owner: string) => `ipd.agent-run:${owner}:${pid}`;
  function rememberRun(id: string): void {
    if (!restoreSession) return;
    const pid = toValue(projectId);
    const owner = projectAgentSessionOwner();
    if (!pid || !owner) return;
    try { sessionStorage.setItem(sessionKey(pid, owner), JSON.stringify({ projectId: pid, owner, runId: id })); } catch { /* 禁用存储时仍能使用服务器历史。 */ }
  }

  /** 清除待执行的下一轮轮询。 */
  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** 作废当前运行（令牌递增 → 所有在途回调失效）并清空运行态。 */
  function resetRun(): void {
    runToken += 1;
    streamController?.abort();
    streamController = null;
    reconnects = 0;
    clearTimer();
    runId.value = null;
    status.value = null;
    detail.value = null;
    events.value = [];
    seenSeqs.clear();
    cursor = 0;
    terminal.value = false;
    polling.value = false;
    submitting.value = false;
    cancelling.value = false;
    submitError.value = null;
    pollError.value = null;
    cancelError.value = null;
    detailError.value = null;
    responding.value = false;
    responseError.value = null;
    consumedPauses.value.clear();
  }

  /** 令牌是否仍有效（未被新运行 / 项目切换 / 销毁作废）。 */
  function alive(token: number): boolean {
    return !disposed && token === runToken;
  }

  /** 加载能力清单；过期响应丢弃，失败保留错误供展示后端原因。 */
  async function loadCapabilities(): Promise<void> {
    const token = ++capToken;
    const pid = toValue(projectId);
    if (!pid) {
      capabilities.value = null;
      capabilitiesLoading.value = false;
      return;
    }
    capabilitiesLoading.value = true;
    capabilitiesError.value = null;
    try {
      const data = await fetchProjectAgentCapabilities(pid);
      if (disposed || token !== capToken) return;
      capabilities.value = normalizeCapabilities(data);
    } catch (error) {
      if (disposed || token !== capToken) return;
      capabilities.value = null;
      capabilitiesError.value = error;
    } finally {
      if (!disposed && token === capToken) capabilitiesLoading.value = false;
    }
  }

  /** 合并一页事件：非整数 seq 丢弃，已见 seq 去重，升序排列；返回是否有新事件。 */
  function mergeEvents(incoming: AgentRunEvent[] | undefined): boolean {
    const fresh: AgentRunEvent[] = [];
    for (const event of Array.isArray(incoming) ? incoming : []) {
      const seq = event?.seq;
      if (!Number.isSafeInteger(seq) || seenSeqs.has(seq)) continue;
      seenSeqs.add(seq);
      fresh.push(event);
      if (seq > cursor) cursor = seq;
    }
    if (fresh.length === 0) return false;
    events.value = [...events.value, ...fresh].sort((a, b) => a.seq - b.seq);
    return true;
  }

  /** 刷新运行详情以取得权威状态；失败只记录错误，不中断轮询。 */
  async function refreshDetail(token: number, id: string): Promise<void> {
    try {
      const data = await fetchAgentRun(id);
      if (!alive(token)) return;
      detail.value = data;
      status.value = data.status;
      detailError.value = null;
    } catch (error) {
      if (alive(token)) detailError.value = error;
    }
  }

  /** 排下一轮轮询。 */
  function schedule(token: number, delay: number): void {
    clearTimer();
    if (!alive(token)) return;
    timer = setTimeout(() => {
      timer = null;
      void readEvents(token);
    }, delay);
  }

  /** 单轮轮询：拉增量事件 → 去重合并 → terminal 即停，否则按间隔排下一轮。 */
  async function pollOnce(token: number): Promise<void> {
    const id = runId.value;
    if (!alive(token) || !id) return;
    polling.value = true;
    try {
      const page = await fetchAgentRunEvents(id, cursor);
      if (!alive(token)) return;
      const changed = mergeEvents(page?.events);
      if (page?.terminal === true) {
        terminal.value = true;
        polling.value = false;
        await refreshDetail(token, id);
        return;
      }
      if (changed) await refreshDetail(token, id);
      if (!alive(token)) return;
      if (pendingInterrupt.value) { polling.value = false; return; }
      schedule(token, pollIntervalMs);
    } catch (error) {
      if (!alive(token)) return;
      pollError.value = error;
      polling.value = false;
    }
  }

  /** AG-UI 读取仅消费持久化投影；网络失败从已消费 seq 重连，不重建运行。 */
  async function streamOnce(token: number): Promise<void> {
    const id = runId.value;
    if (!alive(token) || !id) return;
    polling.value = true;
    const controller = new AbortController();
    streamController = controller;
    let paused = false;
    try {
      await streamAgentRunEvents(id, cursor, (event) => {
        if (!alive(token)) return true;
        if (!mergeEvents([event])) return false;
        if (event.type === 'ERROR' || event.type === 'RUN_FINISHED') terminal.value = true;
        const payload = event.payload as { kind?: string; status?: string } | null;
        paused = status.value === 'WAITING_APPROVAL' && event.seq === detail.value?.pauseSeq
          && event.type === 'STEP' && (payload?.kind === 'AWAIT_USER' || payload?.status === 'WAITING_APPROVAL');
        return terminal.value || paused;
      }, controller.signal);
      if (!alive(token) || controller.signal.aborted) return;
      if (!terminal.value && !paused) throw new IpdRequestError('运行事件连接已断开，请恢复读取', 0, 0, 'transport');
      polling.value = false;
      reconnects = 0;
      pollError.value = null;
      await refreshDetail(token, id);
    } catch (error) {
      if (!alive(token) || controller.signal.aborted) return;
      // 已读到待批准事件后，服务器关闭空回放流属于正常暂停，而非网络故障。
      if (error instanceof IpdRequestError && error.kind === 'transport') {
        await refreshDetail(token, id);
        if (!alive(token)) return;
        const hasAwaitEvent = events.value.some((event) => {
          const payload = event.payload as { kind?: string; status?: string } | null;
          return event.seq === detail.value?.pauseSeq && event.type === 'STEP'
            && (payload?.kind === 'AWAIT_USER' || payload?.status === 'WAITING_APPROVAL');
        });
        if (!detailError.value && status.value === 'WAITING_APPROVAL' && typeof detail.value?.pauseSeq === 'number'
          && detail.value.pauseSeq <= cursor && hasAwaitEvent) {
          polling.value = false;
          pollError.value = null;
          return;
        }
      }
      pollError.value = error;
      const retryable = !(error instanceof IpdRequestError) || error.kind === 'transport' || error.status >= 500;
      if (retryable && reconnects < maxReconnects) {
        reconnects += 1;
        schedule(token, pollIntervalMs * reconnects);
      } else polling.value = false;
    } finally {
      if (streamController === controller) streamController = null;
    }
  }

  function readEvents(token: number): Promise<void> {
    return transport === 'agui' ? streamOnce(token) : pollOnce(token);
  }

  /** 是否存在进行中的运行（已创建且未终结）。 */
  const active = computed(
    () => runId.value !== null && !terminal.value && (status.value === null || !isAgentRunTerminal(status.value)),
  );

  /**
   * 创建运行并开始轮询。进行中或提交中时拒绝重复发起。
   *
   * @param input 请求体（idempotencyKey 由调用方生成，重试同一次提交时复用）
   * @returns 是否创建成功
   */
  async function startRun(input: CreateAgentRunInput): Promise<boolean> {
    const pid = toValue(projectId);
    if (!pid || submitting.value || active.value || polling.value) return false;
    resetRun();
    const token = runToken;
    submitting.value = true;
    try {
      const receipt = await createProjectAgentRun(pid, input);
      if (!alive(token)) return false;
      runId.value = receipt.runId;
      rememberRun(receipt.runId);
      status.value = receipt.status;
      submitting.value = false;
      void readEvents(token);
      return true;
    } catch (error) {
      if (alive(token)) {
        submitError.value = error;
        submitting.value = false;
      }
      return false;
    }
  }

  /**
   * 打开已有运行：用详情和事件替换当前面板，不把上一轮事件留下来。
   * 已结束的运行按 nextSeq 翻页，直到事件页 terminal；进行中的运行只取第一页再轮询。
   *
   * @param id 列表里的 runId（字符串）
   * @returns 详情落地且事件页处理完时为 true
   */
  async function openRun(id: string): Promise<boolean> {
    if (!id) return false;
    resetRun();
    const token = runToken;
    runId.value = id;
    // 历史恢复也占用事件读取通道，避免重试或取消启动重叠轮询。
    polling.value = true;
    try {
      const data = await fetchAgentRun(id);
      if (!alive(token)) return false;
      if (data.projectId !== toValue(projectId)) throw new IpdRequestError('运行不属于当前项目', 403, 0, 'protocol');
      rememberRun(id);
      detail.value = data;
      status.value = data.status;
      events.value = [];
      seenSeqs.clear();
      cursor = 0;
      if (transport === 'agui') {
        void readEvents(token);
        return true;
      }
      let after = 0;
      const ended = isAgentRunTerminal(data.status);
      while (alive(token)) {
        const page = await fetchAgentRunEvents(id, after);
        if (!alive(token)) return false;
        mergeEvents(page?.events);
        if (page?.terminal === true) {
          terminal.value = true;
          polling.value = false;
          return true;
        }
        const next = page?.nextSeq;
        if (!ended) break;
        if (typeof next !== 'number' || !Number.isSafeInteger(next) || next <= after || next !== cursor) {
          throw new Error('运行记录尚未完整加载，请重试');
        }
        after = next;
      }
      if (!alive(token)) return false;
      void readEvents(token);
      return true;
    } catch (error) {
      if (alive(token)) {
        pollError.value = error;
        polling.value = false;
      }
      return false;
    }
  }

  /** 请求取消；最终状态以事件流 terminal 与详情为准，轮询中断过则自动恢复。 */
  async function cancel(): Promise<void> {
    const id = runId.value;
    if (!id || cancelling.value || terminal.value || !status.value || !isAgentRunCancellable(status.value)) return;
    const token = runToken;
    cancelling.value = true;
    cancelError.value = null;
    try {
      const receipt = await cancelAgentRun(id);
      if (!alive(token)) return;
      status.value = receipt.status;
      if (!terminal.value && !polling.value && timer === null) {
        pollError.value = null;
        void readEvents(token);
      }
    } catch (error) {
      if (alive(token)) cancelError.value = error;
    } finally {
      if (alive(token)) cancelling.value = false;
    }
  }

  /** 回答官方中断，在同一 runId 与已消费游标上继续；读取重试 resume() 不承载业务回答。 */
  async function respondToInterrupt(entries: AgentRunResumeEntry[]): Promise<boolean> {
    const pause = pendingInterrupt.value;
    const id = runId.value;
    if (!pause || !id || responding.value || polling.value) return false;
    responseError.value = null;
    const ids = entries.map((entry) => entry.interruptId);
    if (new Set(ids).size !== ids.length || ids.length !== pause.interrupts.length || pause.interrupts.some((interrupt) => !ids.includes(interrupt.id))) {
      responseError.value = new Error('请回答本次运行里的所有问题。');
      return false;
    }
    for (const interrupt of pause.interrupts) {
      const entry = entries.find((item) => item.interruptId === interrupt.id)!;
      if (interrupt.expiresAt && Date.parse(interrupt.expiresAt) <= Date.now()) {
        responseError.value = new Error('这个问题已过期，请恢复运行记录后查看。');
        return false;
      }
      const error = entry.status === 'cancelled'
        ? (entry.payload === undefined ? '' : '未回答时请不要提交回答内容。')
        : entry.status === 'resolved' ? validateInterruptPayload(interrupt, entry.payload) : '回答状态不正确。';
      if (error) { responseError.value = new Error(error); return false; }
    }
    const token = runToken;
    responding.value = true;
    try {
      const receipt = await resumeAgentRun(id, { expectedPauseSeq: pause.seq, aguiInput: {
        threadId: id, runId: id, messages: [], tools: [], context: [], state: {}, forwardedProps: {}, resume: entries,
      } });
      if (!alive(token)) return false;
      if (receipt.runId !== id) throw new IpdRequestError('恢复运行编号不一致', 0, 0, 'protocol');
      consumedPauses.value.add(pause.seq);
      status.value = receipt.status;
      pollError.value = null;
      terminal.value = false;
      reconnects = 0;
      void readEvents(token);
      return true;
    } catch (error) {
      if (alive(token)) responseError.value = error;
      return false;
    } finally { if (alive(token)) responding.value = false; }
  }

  /** 轮询失败后手动恢复（清除错误并立即拉一轮）。 */
  function resume(): void {
    if (!runId.value || terminal.value || polling.value) return;
    pollError.value = null;
    reconnects = 0;
    void readEvents(runToken);
  }

  watch(
    [() => toValue(projectId), () => transport === 'agui' ? projectAgentSessionOwner() : null],
    () => {
      resetRun();
      capToken += 1;
      capabilities.value = null;
      capabilitiesError.value = null;
      capabilitiesLoading.value = false;
      const sessionOwner = transport === 'agui' ? projectAgentSessionOwner() : null;
      if (autoLoad && (transport === 'poll' || sessionOwner)) void loadCapabilities();
      if (restoreSession) {
        const pid = toValue(projectId);
        const owner = projectAgentSessionOwner();
        if (pid && owner) {
          try {
            const saved = JSON.parse(sessionStorage.getItem(sessionKey(pid, owner)) ?? 'null');
            if (saved?.projectId === pid && saved.owner === owner && typeof saved.runId === 'string' && saved.runId) void openRun(saved.runId);
          } catch { /* 存储不可读时由服务器历史恢复。 */ }
        }
      }
    },
    { immediate: true, flush: 'sync' },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      resetRun();
      capToken += 1;
      disposed = true;
    });
  }

  return {
    active,
    pendingInterrupt,
    responding,
    responseErrorText: computed(() => textOf(responseError.value, '回答提交失败')),
    respondToInterrupt,
    cancel,
    cancelError,
    cancelErrorText: computed(() => textOf(cancelError.value, '取消运行失败')),
    cancelling,
    capabilities,
    capabilitiesError,
    capabilitiesErrorText: computed(() => textOf(capabilitiesError.value, '智能体能力加载失败')),
    capabilitiesLoading,
    detail,
    detailErrorText: computed(() => textOf(detailError.value, '运行状态刷新失败')),
    events,
    loadCapabilities,
    openRun,
    pollError,
    pollErrorText: computed(() => textOf(pollError.value, '运行事件拉取失败')),
    polling,
    resetRun,
    resume,
    runId,
    startRun,
    status,
    submitError,
    submitErrorText: computed(() => textOf(submitError.value, '发起运行失败')),
    submitting,
    terminal,
  };
}

/** 组合式函数返回类型（供组件 props 标注）。 */
export type ProjectAgentRunState = ReturnType<typeof useProjectAgentRun>;
