/**
 * 多智能体/蜂群进度纯函数 VM 构建器（AG-UI 单轨，2026-09-29；2026-10-02 对齐 AgentScope 官方 2.0.3）。
 *
 * 折叠官方 AG-UI STEP_STARTED/STEP_FINISHED 事件帧 → SwarmProgressVm（步骤节拍）。
 * 官方 2.0.3 词表无 SUBAGENT_* wire 类型（后端亦从未产出，死分支已删）；子智能体语义由
 * Custom(name="subagent.*") 事件承载（官方 SubagentEventConverter 保留名族），接入时另行折叠。
 *
 * 零依赖纯函数（swarm-progress.test.ts 钉死行为）；镜像 ai-guide/guide-script.ts 先例范式。
 *
 * 注：当前后端尚无真实 swarm 生产者（chatStream 为单一 RAG 流），本 VM 由 useAgent 订阅在
 * 事件到达时增量构建；无事件时 tasks 为空，宿主渲染 null（优雅空态，不谎称有实时数据）。
 */

/** AG-UI 事件帧（type + 任意键，防御性消费；同 api/ipd/guide-script.ts GuideEvent 形态）。 */
export interface SwarmEvent {
  type: string;
  [key: string]: unknown;
}

/** 子任务状态（本地视觉词表；映射自任务生命周期）。 */
export type SwarmTaskStatus = 'error' | 'finished' | 'running';

/** 单个步骤节拍 VM（STEP_STARTED/FINISHED）。 */
export interface SwarmStepVm {
  stepName: string;
  status: 'finished' | 'running';
}

/** 单个任务 VM（步骤节拍归属；SUBAGENT_* 词表删除后由 STEP_* 惰性建任务）。 */
export interface SwarmTaskVm {
  subagentRunId: string;
  name: string;
  description: string;
  status: SwarmTaskStatus;
  /** 产出摘要（保留 VM 字段供渲染层；SUBAGENT_FINISHED 词表删除后暂无生产者写入）。 */
  outputSummary: string;
  /** 失败信息（保留 VM 字段供渲染层；SUBAGENT_ERROR 词表删除后暂无生产者写入）。 */
  errorMessage: string;
  /** 耗时毫秒（保留 VM 字段供渲染层；暂无生产者写入，UI 显示占位）。 */
  durationMs: null | number;
  steps: SwarmStepVm[];
}

/** 蜂群进度总览 VM（tasks + 派生计数）。 */
export interface SwarmProgressVm {
  tasks: SwarmTaskVm[];
  total: number;
  running: number;
  finished: number;
  errored: number;
}

/** 无 subagentRunId 的 STEP_* 归属的保留任务（主流程节拍，单智能体亦复用）。 */
export const MAIN_FLOW_RUN_ID = '';
export const MAIN_FLOW_NAME = '主流程';

/** 运行期对象判别（本地小判别防双轨 import，同 guide-script.ts / copilotkit-render.ts 先例形态）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function recount(vm: SwarmProgressVm): SwarmProgressVm {
  vm.total = vm.tasks.length;
  vm.running = vm.tasks.filter((t) => t.status === 'running').length;
  vm.finished = vm.tasks.filter((t) => t.status === 'finished').length;
  vm.errored = vm.tasks.filter((t) => t.status === 'error').length;
  return vm;
}

/**
 * 折叠 AG-UI 蜂群事件帧 → SwarmProgressVm（帧序保持，非法帧跳过不崩）。
 *
 * 语义：
 * - STEP_* 按 subagentRunId 归属任务；缺 subagentRunId 或任务未见 → 惰性建任务（步骤永不丢失），
 *   无 subagentRunId 归入保留「主流程」任务。
 */
export function foldSwarmEvents(events: SwarmEvent[]): SwarmProgressVm {
  const vm: SwarmProgressVm = {
    tasks: [],
    total: 0,
    running: 0,
    finished: 0,
    errored: 0,
  };
  const byId = new Map<string, SwarmTaskVm>();

  const ensureTask = (runId: string, name: string, description: string): SwarmTaskVm => {
    let task = byId.get(runId);
    if (!task) {
      task = {
        subagentRunId: runId,
        name: name || runId || MAIN_FLOW_NAME,
        description,
        status: 'running',
        outputSummary: '',
        errorMessage: '',
        durationMs: null,
        steps: [],
      };
      byId.set(runId, task);
      vm.tasks.push(task);
    }
    return task;
  };

  for (const event of events) {
    if (!isPlainRecord(event)) continue;
    const runId = asString(event.subagentRunId);
    switch (event.type) {
      case 'STEP_STARTED': {
        const task = ensureTask(runId, runId ? runId : MAIN_FLOW_NAME, '');
        task.steps.push({ stepName: asString(event.stepName), status: 'running' });
        break;
      }
      case 'STEP_FINISHED': {
        const task = ensureTask(runId, runId ? runId : MAIN_FLOW_NAME, '');
        const stepName = asString(event.stepName);
        const running = [...task.steps].reverse().find((s) => s.stepName === stepName && s.status === 'running');
        if (running) {
          running.status = 'finished';
        } else {
          task.steps.push({ stepName, status: 'finished' });
        }
        break;
      }
      default:
        break;
    }
  }
  return recount(vm);
}

/* -------------------------------------------------------------------------- */
/* 状态视觉映射：3 态 → Ant Tag preset tone（零新色值，同 guide-script.ts 惯例）。 */
/* -------------------------------------------------------------------------- */

/** 子任务状态 → Tag 视觉 tone（Ant Tag preset color）。 */
export type SwarmStatusTone = 'error' | 'processing' | 'success';

/** 状态展示元数据（label + tone）。 */
export interface SwarmStatusMeta {
  label: string;
  tone: SwarmStatusTone;
}

const SWARM_STATUS_META: Record<SwarmTaskStatus, SwarmStatusMeta> = {
  running: { label: '执行中', tone: 'processing' },
  finished: { label: '已完成', tone: 'success' },
  error: { label: '失败', tone: 'error' },
};

/** 状态元数据（未知值防御性回退：原样 label + processing tone）。 */
export function swarmStatusMeta(status: SwarmTaskStatus): SwarmStatusMeta {
  return SWARM_STATUS_META[status] ?? { label: status, tone: 'processing' };
}

/** 耗时格式化：<1s 显示 ms，≥1s 显示一位小数秒，null/非法显示占位（不谎报 0）。 */
export function formatDuration(ms: null | number): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
