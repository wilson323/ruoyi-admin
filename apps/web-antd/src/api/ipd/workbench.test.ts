/**
 * 工作台聚合 API 契约测试（页03；后端 WorkbenchController /api/v1/workbench）。
 *
 * 重点覆盖：
 * - fetchWorkbenchSummary：projectId 可选；不带时不发查询串，带时编码；
 * - 载荷透传 stats / tasks / deletionPending / currentAdvance；
 * - 错误传播。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { fetchWorkbenchSummary } from './workbench';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-07T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const summaryFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  stats: { pending: 5, overdue: 2, unread: 3, completed: 7 },
  tasks: [],
  deletionPending: 0,
  currentAdvance: null,
  ...overrides,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('workbench API — fetchWorkbenchSummary', () => {
  it('无 projectId：GET /workbench/summary 不带查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(summaryFixture()));
    vi.stubGlobal('fetch', fetcher);
    await fetchWorkbenchSummary();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/workbench/summary');
  });

  it('传 projectId：编码进查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(summaryFixture()));
    vi.stubGlobal('fetch', fetcher);
    await fetchWorkbenchSummary('p-100');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/workbench/summary?projectId=p-100');
  });

  it('空字符串 projectId：视为无过滤，不带 ?projectId=', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(summaryFixture()));
    vi.stubGlobal('fetch', fetcher);
    await fetchWorkbenchSummary('');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/workbench/summary');
  });

  it('载荷字段 stats / tasks / deletionPending / currentAdvance 全量透传', async () => {
    const advance = {
      projectId: '10',
      projectCode: 'P-001',
      projectName: 'Alpha',
      currentStage: 'DEV',
      actionId: 'A-1',
      actionName: '实现阶段',
      actionStatus: 'IN_PROGRESS',
      deepLink: '/ipd/projects/10/actions/1',
    };
    const fetcher = vi.fn().mockResolvedValue(envelope({
      stats: { pending: 3, overdue: 1, unread: 4, completed: 2 },
      tasks: [
        {
          id: 't1', projectId: '10', projectName: 'Alpha', projectCode: 'P-001',
          actionCode: 'A-1', title: '需求评审', taskType: 'STAGE_ACTION',
          status: 'IN_PROGRESS', priority: 'normal', ownerRole: 'MARKET_PM',
          dueDate: 1700000000000, isBlocking: null, deepLink: '/ipd/projects/10/actions/1',
        },
      ],
      deletionPending: 5,
      currentAdvance: advance,
    }));
    vi.stubGlobal('fetch', fetcher);
    const summary = await fetchWorkbenchSummary('10');
    expect(summary.stats).toEqual({ pending: 3, overdue: 1, unread: 4, completed: 2 });
    expect(summary.tasks).toHaveLength(1);
    expect(summary.tasks[0]).toMatchObject({ id: 't1', title: '需求评审' });
    expect(summary.deletionPending).toBe(5);
    expect(summary.currentAdvance).toEqual(advance);
  });

  it('空态：stats 全 0 + tasks 为空数组 + currentAdvance 为 null', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      stats: { pending: 0, overdue: 0, unread: 0, completed: 0 },
      tasks: [],
      deletionPending: 0,
      currentAdvance: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const summary = await fetchWorkbenchSummary();
    expect(summary.stats.pending).toBe(0);
    expect(summary.tasks).toEqual([]);
    expect(summary.currentAdvance).toBeNull();
  });

  it('workbench.ts 仅导出 fetchWorkbenchSummary（动词面：GET only）', async () => {
    // 防止误加 fetchWorkbenchTasks / postWorkbenchXxx 等动词面漂移；与 http.ts 契约一致。
    const moduleExports = Object.keys(await import('./workbench')).sort();
    expect(moduleExports).toEqual(['fetchWorkbenchSummary']);
  });
});

describe('workbench API — 错误传播', () => {
  it('HTTP 500 + envelope.code != 0 抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 500, 99999));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchWorkbenchSummary()).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('HTTP 401 + code=20001 抛 IpdRequestError（会话失效）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 401, 20001));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchWorkbenchSummary('p-1')).rejects.toBeInstanceOf(IpdRequestError);
  });
});