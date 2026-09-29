/**
 * 待办直达解析（R232 P2-04）——复用 NotificationService 既有载荷，零新通知格式。
 *
 * <p>真值（后端 GenerateExecutor L74-76 / GatePrepExecutor L154-156 发布口径）：
 * {@code publishDaily(receiver, eventType, KIND_ACTION, "ai_agent_task", task.getId(),
 * title, content, actionUrl, day)} —— sourceType 恒为 {@link AI_TASK_SOURCE_TYPE}、
 * sourceId 恒为 ai_agent_tasks.id、actionUrl 为 /projects/{projectId} 兜底。
 *
 * <p>直达路径（跨设备不靠会话回放）：通知行（notification_events 持久化）→
 * sourceId 单查 GET /ai-agent-tasks/{taskId} → aiDocId → AI 文档审核页深链
 * （/ipd/ai-assistant?projectId=&docId=，落到 ai_documents GENERATED 待审审批卡）。
 * 解析失败/非 AI 任务通知 → 回退 actionUrl「待办列表手动找」并存路径（计划 fail 口径）。
 */
import type { IpdNotification } from '../../../../api/ipd/notification';
import type { AiAgentTaskView } from '../../../../api/ipd/stage-action';
import { fetchAiAgentTask } from '../../../../api/ipd/stage-action';

/** NotificationService 发布口径的 AI 任务 sourceType 字面量（不发明新格式）。 */
export const AI_TASK_SOURCE_TYPE = 'ai_agent_task';

/** 直达解析结果。 */
export interface AiTaskTodoTarget {
  /** 落点深链（AI 审批卡 / actionUrl 兜底）。 */
  deepLink: string;
  /** 解析来源：ai-agent-task=任务单查直达；action-url=回退手动找并存路径。 */
  source: 'action-url' | 'ai-agent-task';
  /** 命中任务单查时的只读投影（回退路径为 null）。 */
  task: null | AiAgentTaskView;
}

/** 是否 AI 执行任务待办（sourceType + sourceId 双有值才可直达）。 */
export function isAiTaskTodo(notification: IpdNotification): boolean {
  return (
    notification.sourceType === AI_TASK_SOURCE_TYPE &&
    notification.sourceId != null &&
    notification.sourceId !== ''
  );
}

/**
 * 任务 → AI 文档审核页深链（审批卡落点）。
 * aiDocId 有值直达版本链（docId 查询参数）；无值落项目 AI 文档页（进度呈现，无需人审）。
 */
export function aiTaskDeepLink(task: AiAgentTaskView): string {
  const base = `/ipd/ai-assistant?projectId=${encodeURIComponent(task.projectId)}`;
  return task.aiDocId ? `${base}&docId=${encodeURIComponent(task.aiDocId)}` : base;
}

/**
 * 手动找并存路径：NotificationService 既有 actionUrl（发布口径恒为 /projects/{projectId}，
 * 见 GenerateExecutor/StageActionService/ContributionService 同形）。
 * 该形态不是应用路由（应用路由为 /ipd/projects/:projectId/*），故归一到项目概览页；
 * 未知形态原样返回（宿主 router.push 失败不吞页），完全缺席回工作台待办列表。
 */
export function actionUrlFallback(notification: IpdNotification): string {
  const url = notification.actionUrl ?? '';
  // AC-PROD-09 旧通知已持久化为原型路由；正式需求池位于 /ipd/requirements。
  if (url === '/demands/pool?status=SUBMITTED') {
    return '/ipd/requirements?status=SUBMITTED';
  }
  const matched = /^\/projects\/(\d+)$/.exec(url);
  if (matched) {
    return `/ipd/projects/${matched[1]}/overview`;
  }
  return url || '/ipd/workbench';
}

/**
 * 待办直达解析：AI 任务通知单查任务行推深链；任何失败（任务已删/越权/网络）回退 actionUrl，
 * 绝不让用户卡死在弹层（fail 口径：「通知载荷不兼容→回退待办列表手动找并存路径」）。
 *
 * @param notification 收件箱行（IpdNotification，NotificationService 载荷原样）
 */
export async function resolveAiTaskTodo(
  notification: IpdNotification,
): Promise<AiTaskTodoTarget> {
  const fallback: AiTaskTodoTarget = {
    deepLink: actionUrlFallback(notification),
    source: 'action-url',
    task: null,
  };
  if (!isAiTaskTodo(notification)) {
    return fallback;
  }
  try {
    const task = await fetchAiAgentTask(String(notification.sourceId));
    return { deepLink: aiTaskDeepLink(task), source: 'ai-agent-task', task };
  } catch {
    return fallback;
  }
}
