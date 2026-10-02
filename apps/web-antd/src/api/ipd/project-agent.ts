/**
 * 项目智能体（W1）接口客户端。
 *
 * ipdGet / ipdPost / ipdPut 会再拼 `/api/v1`，这里只写资源路径；code=0/message 包络已在
 * requestIpd 层校验。ID（projectId / runId / modelConfigId / toolId / targetId）一律按字符串
 * 透传，不做数值转换；idempotencyKey 由调用方生成（crypto.randomUUID），本层不生成、不改写。
 *
 * 运行时端点：
 * - GET  /api/v1/projects/{projectId}/agent-capabilities  能力包 / 模型 / Skill / 工具清单（含不可用原因）
 * - POST /api/v1/projects/{projectId}/agent-runs          创建运行，返回 { runId, status }
 * - GET  /api/v1/projects/{projectId}/agent-runs          本人在该项目下的运行列表（可搜索）
 * - GET  /api/v1/agent-runs/{runId}                       运行详情（含配置快照）
 * - GET  /api/v1/agent-runs/{runId}/events?afterSeq=N     增量事件（nextSeq + terminal）
 * - POST /api/v1/agent-runs/{runId}/cancel                请求取消
 * - POST /api/v1/agent-runs/{runId}/artifacts/{artifactId}/apply  应用产物（W2；后端未接线时客户端仍按此路径）
 * - PUT  /api/v1/ai-feedback/{targetType}/{targetId}      点赞 / 点踩（幂等 upsert）
 *
 * 与既有 ai-copilot.ts（副驾 SSE 流）是两条独立链路：本模块不回落到副驾流。
 */
import { ipdGet, ipdPost, ipdPut } from './http';

/** 运行状态（后端状态机 7 态）。 */
export type AgentRunStatus =
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'WAITING_APPROVAL';

/** 运行事件类型（9 种，时间线只按这些真实事件渲染）。 */
export type AgentRunEventType =
  | 'ARTIFACT'
  | 'ERROR'
  | 'RUN_FINISHED'
  | 'RUN_STARTED'
  | 'SOURCE'
  | 'STEP'
  | 'TEXT_DELTA'
  | 'TOOL_CALL'
  | 'TOOL_RESULT';

/** 能力包内的 Skill（sha256 用于配置快照比对）。 */
export interface AgentSkillOption {
  name: string;
  version: string;
  sha256: string;
  available: boolean;
  reason: null | string;
}

/** 能力包内的工具（readOnly=true 表示只读工具）。 */
export interface AgentToolOption {
  id: string;
  name: string;
  readOnly: boolean;
  available: boolean;
  reason: null | string;
}

/** 能力包（code + version 共同定位，提交时两者都必须来自服务端返回值）。 */
export interface AgentCapabilityPack {
  code: string;
  version: string;
  name: string;
  description: string;
  stages: string[];
  actionCodes: string[];
  available: boolean;
  unavailableReason: null | string;
  skills: AgentSkillOption[];
  tools: AgentToolOption[];
}

/** 可选模型（id 即 modelConfigId，字符串）。 */
export interface AgentModelOption {
  id: string;
  name: string;
  available: boolean;
  reason: null | string;
}

/** 能力清单响应。 */
export interface ProjectAgentCapabilities {
  packs: AgentCapabilityPack[];
  models: AgentModelOption[];
}

/** 创建运行请求体。 */
export interface CreateAgentRunInput {
  capabilityPackCode: string;
  capabilityPackVersion: string;
  modelConfigId: string;
  skillNames: string[];
  toolIds: string[];
  actionCode?: string;
  message: string;
  /** 调用方生成的幂等键（同一次提交的重试必须复用同一个值）。 */
  idempotencyKey: string;
  /** 分拣页带上的需求单。成功后由服务端按回答里的唯一目录编码回写。 */
  requirementId?: string;
  /** 同一发送口的显式返工关联；三项须一起提供。 */
  previousRunId?: string;
  targetDocumentId?: string;
  baseVersionId?: string;
}

/** 创建 / 取消运行的回执。 */
export interface AgentRunReceipt {
  runId: string;
  status: AgentRunStatus;
}

/** 运行列表查询。字段均可空；cursor 是上一页最后的 runId。 */
export interface AgentRunListQuery {
  q?: string;
  status?: AgentRunStatus;
  actionCode?: string;
  cursor?: string;
  /** 默认 20，最大 50。 */
  limit?: number;
}

/**
 * 运行列表项。
 * inputChars 只表示当时输入长度，不是正文；本类型不接收提问原文或 inputDigest。
 */
export interface AgentRunListItem {
  runId: string;
  status: AgentRunStatus;
  actionCode: null | string;
  capabilityPackCode: string;
  capabilityPackVersion: string;
  createdAt: string;
  finishedAt: null | string;
  inputChars: number;
  artifactTitles: string[];
  artifactExcerpt: null | string;
}

/** 运行时配置快照（服务端在创建时冻结）。 */
export interface AgentRunConfigSnapshot {
  capabilityPackCode: string;
  capabilityPackVersion: string;
  modelConfigId: string;
  skills: Array<{ name: string; sha256: string }>;
  toolIds: string[];
  previousRunId?: null | string;
  targetDocumentId?: null | string;
  baseVersionId?: null | string;
}

/** 运行详情。 */
export interface AgentRunDetail {
  artifactArchives?: Array<{ artifactId: string; documentId: string }>;
  runId: string;
  projectId: string;
  agentId: string;
  status: AgentRunStatus;
  actionCode: null | string;
  configSnapshot: AgentRunConfigSnapshot;
  errorCode: null | string;
  createdAt: string;
  finishedAt: null | string;
}

/** 单个运行事件（seq 为运行内单调递增序号，payload 形态随 type 变化）。 */
export interface AgentRunEvent {
  seq: number;
  type: AgentRunEventType;
  payload: unknown;
  createdAt: string;
}

/** 增量事件页（terminal=true 表示运行已结束，调用方应停止轮询）。 */
export interface AgentRunEventPage {
  events: AgentRunEvent[];
  nextSeq: number;
  terminal: boolean;
}

/** 反馈评级。 */
export type AiFeedbackRating = 'DOWN' | 'UP';

/** 反馈目标类型（合同 #6：仅 RUN_MESSAGE | ARTIFACT_VERSION）。 */
export type AiFeedbackTargetType = 'ARTIFACT_VERSION' | 'RUN_MESSAGE';

/** 反馈请求体。 */
export interface AiFeedbackInput {
  rating: AiFeedbackRating;
  reason?: string;
}

/** 反馈回执。 */
export interface AiFeedbackView {
  targetType: AiFeedbackTargetType;
  targetId: string;
  rating: AiFeedbackRating;
  reason: null | string;
  updatedAt: string;
}

/**
 * 应用产物回执（W2；对齐后端 ProjectAgentViews.ArtifactApply 七字段 / 合同 §8.1）。
 * 字段按字符串 ID 透传；apply 成功判据 = documentId 非空（合同 §8.1「回写 documentId」）。
 * indexStatus 如实返回，文档未向量化时为 NOT_INDEXED，**禁止假定 READY**（合同 §8.1）。
 */
export interface ApplyAgentArtifactReceipt {
  runId: string;
  artifactId: string;
  /** 产物版本行雪花 ID（亦为 ARTIFACT_VERSION 反馈的 targetId）。 */
  versionId: string;
  /** 产物版本号（数字，非雪花）。 */
  versionNo: number;
  /** 落库项目文档 ID；apply 成功判据（合同 §8.1），未应用时为 null。 */
  documentId: null | string;
  /** 文档库内码（GENERATED=待审核，界面不得把该码当主文案）。 */
  documentStatus: string;
  /** 索引状态（NOT_INDEXED=未向量化；禁止假定 READY）。 */
  indexStatus: string;
  /** 用户可见主状态（GENERATED → 待审核）。 */
  documentStatusLabel?: string;
}

/** 路径段编码：字符串 ID 原样透传，仅做 URL 安全转义。 */
function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * 查询项目可用的智能体能力。
 *
 * @param projectId 项目 ID（字符串）
 * @returns 能力包与模型清单；不可用项带服务端原因
 */
export function fetchProjectAgentCapabilities(projectId: string): Promise<ProjectAgentCapabilities> {
  return ipdGet<ProjectAgentCapabilities>(`/projects/${seg(projectId)}/agent-capabilities`);
}

/**
 * 创建一次项目智能体运行。
 *
 * @param projectId 项目 ID（字符串）
 * @param input 请求体；idempotencyKey 必须由调用方生成并在重试时复用
 * @returns 运行回执 { runId, status }
 */
export function createProjectAgentRun(projectId: string, input: CreateAgentRunInput): Promise<AgentRunReceipt> {
  return ipdPost<AgentRunReceipt>(`/projects/${seg(projectId)}/agent-runs`, input);
}

/**
 * 列出当前人在该项目下的智能体运行。
 *
 * 历史只来自这个接口。不要用本地缓存补记录，也不要读 inputDigest 或提问原文。
 *
 * @param projectId 项目 ID（字符串，原样进路径）
 * @param query q / status / actionCode / cursor / limit，空值不进查询串
 */
export function listProjectAgentRuns(
  projectId: string,
  query: AgentRunListQuery = {},
): Promise<AgentRunListItem[]> {
  return ipdGet<AgentRunListItem[]>(`/projects/${seg(projectId)}/agent-runs`, { ...query });
}

/**
 * 查询运行详情（含配置快照与失败码）。
 *
 * @param runId 运行 ID（字符串）
 */
export function fetchAgentRun(runId: string): Promise<AgentRunDetail> {
  return ipdGet<AgentRunDetail>(`/agent-runs/${seg(runId)}`);
}

/**
 * 按序号增量拉取运行事件。
 *
 * @param runId 运行 ID（字符串）
 * @param afterSeq 只返回 seq 大于该值的事件；首轮传 0
 */
export function fetchAgentRunEvents(runId: string, afterSeq: number): Promise<AgentRunEventPage> {
  return ipdGet<AgentRunEventPage>(`/agent-runs/${seg(runId)}/events`, { afterSeq });
}

/**
 * 请求取消运行（服务端先置 CANCEL_REQUESTED，最终状态以事件流 terminal 为准）。
 *
 * @param runId 运行 ID（字符串）
 */
export function cancelAgentRun(runId: string): Promise<AgentRunReceipt> {
  return ipdPost<AgentRunReceipt>(`/agent-runs/${seg(runId)}/cancel`);
}

/**
 * 将运行产物应用到项目（W2 合同路径）。
 *
 * <p>路径固定为 `POST /api/v1/agent-runs/{runId}/artifacts/{artifactId}/apply`，
 * 不另起别名。后端 W2 未接线时调用会失败，由调用方展示错误，不得改走副驾流。
 *
 * @param runId 运行 ID（字符串，须来自服务端）
 * @param artifactId 产物 ID（字符串，须来自 ARTIFACT 事件 payload）
 * @returns 应用回执；ID 原样透传
 */
export function applyAgentRunArtifact(
  runId: string,
  artifactId: string,
): Promise<ApplyAgentArtifactReceipt> {
  return ipdPost<ApplyAgentArtifactReceipt>(
    `/agent-runs/${seg(runId)}/artifacts/${seg(artifactId)}/apply`,
  );
}

/**
 * 提交或覆盖 AI 反馈（PUT 幂等：同一目标重复提交以最后一次为准）。
 *
 * @param targetType 反馈目标类型
 * @param targetId 持久化目标 ID（字符串，必须来自服务端）
 * @param input 评级与可选原因
 */
export function saveAiFeedback(
  targetType: AiFeedbackTargetType,
  targetId: string,
  input: AiFeedbackInput,
): Promise<AiFeedbackView> {
  return ipdPut<AiFeedbackView>(`/ai-feedback/${seg(targetType)}/${seg(targetId)}`, input);
}

/** 未穷尽分支哨兵：新增 union 成员而未处理时编译期报错。 */
function assertNever(value: never): never {
  throw new Error(`未处理的枚举值：${String(value)}`);
}

/**
 * 运行状态是否已终结（终结态不再有新事件，轮询应停止）。
 *
 * @param status 运行状态
 */
export function isAgentRunTerminal(status: AgentRunStatus): boolean {
  switch (status) {
    case 'CANCELLED':
    case 'FAILED':
    case 'SUCCEEDED': {
      return true;
    }
    case 'CANCEL_REQUESTED':
    case 'PENDING':
    case 'RUNNING':
    case 'WAITING_APPROVAL': {
      return false;
    }
    default: {
      return assertNever(status);
    }
  }
}

/**
 * 运行状态中文标签与 Ant Tag 色调。
 *
 * @param status 运行状态
 */
export function agentRunStatusMeta(status: AgentRunStatus): { color: string; label: string } {
  switch (status) {
    case 'PENDING': {
      return { color: 'default', label: '排队中' };
    }
    case 'RUNNING': {
      return { color: 'processing', label: '运行中' };
    }
    case 'WAITING_APPROVAL': {
      return { color: 'warning', label: '等待审批' };
    }
    case 'CANCEL_REQUESTED': {
      return { color: 'warning', label: '取消中' };
    }
    case 'SUCCEEDED': {
      return { color: 'success', label: '已完成' };
    }
    case 'FAILED': {
      return { color: 'error', label: '失败' };
    }
    case 'CANCELLED': {
      return { color: 'default', label: '已取消' };
    }
    default: {
      return assertNever(status);
    }
  }
}

/**
 * 运行是否处于可取消阶段（已请求取消或已终结时不再展示取消入口）。
 *
 * @param status 运行状态
 */
export function isAgentRunCancellable(status: AgentRunStatus): boolean {
  switch (status) {
    case 'PENDING':
    case 'RUNNING':
    case 'WAITING_APPROVAL': {
      return true;
    }
    case 'CANCEL_REQUESTED':
    case 'CANCELLED':
    case 'FAILED':
    case 'SUCCEEDED': {
      return false;
    }
    default: {
      return assertNever(status);
    }
  }
}
