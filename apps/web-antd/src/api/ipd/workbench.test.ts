/**
 * 工作台聚合 API 契约测试（页03；后端 WorkbenchController /api/v1/workbench）。
 *
 * 重点覆盖：
 * - fetchWorkbenchSummary：projectId 可选；不带时不发查询串，带时编码；
 * - 载荷透传 stats / tasks / deletionPending / currentAdvance；
 * - 错误传播。
 * - R215 A10：fetchMyInitiated / fetchMyPendingApprovals（personId 可选 + 载荷透传）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { fetchMyInitiated, fetchMyPendingApprovals, fetchWorkbenchSummary } from './workbench';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-07T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const summaryFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  // P1-4: summaryFixture 默认 stats 含 myInitiated（默认 0；按需 overrides）
  stats: { pending: 5, overdue: 2, unread: 3, completed: 7, myInitiated: 0 },
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
      // P1-4: 载荷透传验证追加 myInitiated 字段
      stats: { pending: 3, overdue: 1, unread: 4, completed: 2, myInitiated: 6 },
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
    // P1-4: myInitiated 字段在 stats 中透传（不漂移）
    expect(summary.stats).toMatchObject({ pending: 3, overdue: 1, unread: 4, completed: 2, myInitiated: 6 });
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

  it('workbench.ts 导出面锁定（动词面：GET only；R215 A10 后含 my-initiated/my-pending-approvals）', async () => {
    // 防止误加 fetchWorkbenchTasks / postWorkbenchXxx 等动词面漂移；与 http.ts 契约一致。
    const moduleExports = Object.keys(await import('./workbench')).sort();
    expect(moduleExports).toEqual([
      'fetchMyInitiated',
      'fetchMyPendingApprovals',
      'fetchWorkbenchSummary',
    ]);
  });
});

describe('workbench API — P1-4 「我发起的」字段契约', () => {
  it('stats 含 myInitiated 数字字段（默认 0，可选键）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      stats: { pending: 1, overdue: 0, unread: 0, completed: 0, myInitiated: 9 },
      tasks: [],
      deletionPending: 0,
      currentAdvance: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const summary = await fetchWorkbenchSummary();
    expect(summary.stats.myInitiated).toBe(9);
  });

  it('旧后端不返 myInitiated 键 → 字段为 undefined（前端 ?? 0 兜底）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      stats: { pending: 1, overdue: 0, unread: 0, completed: 0 },
      tasks: [],
      deletionPending: 0,
      currentAdvance: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const summary = await fetchWorkbenchSummary();
    expect(summary.stats.myInitiated).toBeUndefined();
  });

  it('零值边界：myInitiated=0 透传（非 null、非负数）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      stats: { pending: 0, overdue: 0, unread: 0, completed: 0, myInitiated: 0 },
      tasks: [],
      deletionPending: 0,
      currentAdvance: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const summary = await fetchWorkbenchSummary();
    expect(summary.stats.myInitiated).toBe(0);
    expect(summary.stats.myInitiated).not.toBeNull();
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

// ---------- R215 A10：我发起 / 待我审批聚合卡（MyInitiatedTask 投影）契约测试 ----------

const initiatedFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '7001',
  // 实测 16039：taskType 为短形式（后端常量名长形式但值为短）
  taskType: 'DELETION',
  sourceId: '6001',
  sourceTable: 'deletion_requests',
  title: '删除项目 P-100',
  status: 'PENDING_REVIEW',
  initiatorId: '9007199254740993',
  approverId: null,
  createdAt: 1789992000000,
  ...overrides,
});

describe('workbench API — fetchMyInitiated / fetchMyPendingApprovals（R215 A10）', () => {
  it('无 personId：GET /workbench/my-initiated 不带查询串（后端会话推导当前人）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([initiatedFixture()]));
    vi.stubGlobal('fetch', fetcher);
    const rows = await fetchMyInitiated();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/workbench/my-initiated');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('7001');
    expect(rows[0]!.taskType).toBe('DELETION');
    expect(rows[0]!.sourceTable).toBe('deletion_requests');
    expect(rows[0]!.createdAt).toBe(1789992000000);
  });

  it('传 personId：编码进查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await fetchMyInitiated('9007199254740993');
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/v1/workbench/my-initiated?personId=9007199254740993',
    );
  });

  it('fetchMyPendingApprovals：GET /workbench/my-pending-approvals，空数组正常返回', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    const rows = await fetchMyPendingApprovals('9007199254740993');
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/v1/workbench/my-pending-approvals?personId=9007199254740993',
    );
    expect(rows).toEqual([]);
  });

  it('HTTP 500 抛 IpdRequestError（治理卡静默降级依赖此行为）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 500, 99999));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchMyInitiated()).rejects.toBeInstanceOf(IpdRequestError);
  });
});