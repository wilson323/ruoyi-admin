/**
 * 待办直达解析测试（R232 P2-04）：复用 NotificationService 既有载荷（sourceType/sourceId/actionUrl），
 * AI 任务单查直达审批卡深链；非 AI / 单查失败回退 actionUrl 手动找并存路径（不吞不卡死）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpdNotification } from '../../../../api/ipd/notification';
import {
  actionUrlFallback,
  aiTaskDeepLink,
  isAiTaskTodo,
  resolveAiTaskTodo,
} from './todo-link';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-27T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const aiRow: IpdNotification = {
  actionUrl: '/projects/200',
  content: 'AI 已为动作「C11」生成草稿',
  createTime: '2026-09-27 10:00:00',
  deliveryStatus: 'SENT',
  eventType: 'AI_PREPARED_GATE',
  id: '5001',
  kind: 'ACTION',
  readAt: null,
  readFlag: '0',
  sourceId: '2104',
  sourceType: 'ai_agent_task',
  title: 'AI 草稿待审: G1 评审材料',
};

const plainRow: IpdNotification = {
  ...aiRow,
  id: '5002',
  sourceId: '77',
  sourceType: 'gate_sign',
  title: 'Gate 签署待办',
};

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('isAiTaskTodo（NotificationService 载荷判定，零新格式）', () => {
  it('sourceType=ai_agent_task 且 sourceId 有值 → true', () => {
    expect(isAiTaskTodo(aiRow)).toBe(true);
  });
  it('其他 sourceType / sourceId 缺失 → false', () => {
    expect(isAiTaskTodo(plainRow)).toBe(false);
    expect(isAiTaskTodo({ ...aiRow, sourceId: null })).toBe(false);
    expect(isAiTaskTodo({ ...aiRow, sourceType: null })).toBe(false);
  });
});

describe('aiTaskDeepLink（审批卡落点）', () => {
  it('有 aiDocId → /ipd/ai-assistant?projectId=&docId=（直达 GENERATED 待审版本链）', () => {
    expect(
      aiTaskDeepLink({
        actionCode: 'C11', aiDocId: '9001', errorMsg: null, execMode: 'HUMAN_GATE',
        id: '2104', projectId: '200', resultSummary: 'ok', status: 'SUCCEEDED', triggerType: 'PASSIVE',
      }),
    ).toBe('/ipd/ai-assistant?projectId=200&docId=9001');
  });
  it('无 aiDocId → 落项目 AI 文档页（进度呈现）', () => {
    expect(
      aiTaskDeepLink({
        actionCode: 'C11', aiDocId: null, errorMsg: null, execMode: 'HUMAN_GATE',
        id: '2104', projectId: '200', resultSummary: null, status: 'RUNNING', triggerType: 'PASSIVE',
      }),
    ).toBe('/ipd/ai-assistant?projectId=200');
  });
});

describe('actionUrlFallback（手动找并存路径）', () => {
  it('NotificationService 发布口径 /projects/{id} 归一到应用路由 /ipd/projects/{id}/overview', () => {
    expect(actionUrlFallback(aiRow)).toBe('/ipd/projects/200/overview');
  });
  it('未知形态原样返回；完全缺席回工作台', () => {
    expect(actionUrlFallback({ ...aiRow, actionUrl: '/custom/path' })).toBe('/custom/path');
    expect(actionUrlFallback({ ...aiRow, actionUrl: null })).toBe('/ipd/workbench');
  });
});

describe('resolveAiTaskTodo（AI 任务直达 + fail 并存路径）', () => {
  it('AI 任务行单查成功 → source=ai-agent-task，深链带 docId', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({ id: '2104', projectId: '200', actionCode: 'C11', status: 'SUCCEEDED', resultSummary: 'ok', aiDocId: '9001', errorMsg: null, execMode: 'HUMAN_GATE', triggerType: 'PASSIVE' }),
    );
    vi.stubGlobal('fetch', fetcher);
    const target = await resolveAiTaskTodo(aiRow);
    expect(target.source).toBe('ai-agent-task');
    expect(target.deepLink).toBe('/ipd/ai-assistant?projectId=200&docId=9001');
    expect(target.task?.aiDocId).toBe('9001');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/ai-agent-tasks/2104');
  });

  it('单查失败（任务已删/越权/网络）→ 回退 actionUrl 手动找并存路径', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('50001 NOT_FOUND')));
    const target = await resolveAiTaskTodo(aiRow);
    expect(target.source).toBe('action-url');
    expect(target.task).toBeNull();
    expect(target.deepLink).toBe('/ipd/projects/200/overview');
  });

  it('非 AI 任务行 → 直接回退 actionUrl，不发单查请求', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const target = await resolveAiTaskTodo(plainRow);
    expect(target.source).toBe('action-url');
    expect(target.deepLink).toBe('/ipd/projects/200/overview');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
