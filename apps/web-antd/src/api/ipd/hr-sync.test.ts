/**
 * HR 同步域清单契约测试（R215 WP3.1 批次 = ORPHAN-A8；HrSyncController pending-handovers）。
 *
 * 重点覆盖：
 * - listPendingHandovers()：GET /hr-sync/pending-handovers（thresholdDays 省略不拼 query）；
 * - listPendingHandovers(30)：?thresholdDays=30 显式拼装；
 * - Long 字段 Number() 归一（BigNumberSerializer 安全范围内 number、超范围 string 两形态）；
 * - 权限负例：普通成员（GROUP_LEADER/SUPER_ADMIN 之外）403/30001 → IpdRequestError。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { listPendingHandovers } from './hr-sync';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/**
 * personId/groupId 双形态（live 证据：雪花 ID 超安全范围以 string 下发，如
 * "2096266884247736321"；契约归一为 string 透传防精度丢失）＋计数字段 number/string 双形态。
 */
const pendingFixture = [
  {
    personId: 900101,
    name: '张三',
    employeeNo: 'E001',
    groupId: 12,
    frozenSince: '2026-09-10T08:00:00Z',
    activeProjects: 2,
    ageDays: 18,
    escalate: true,
  },
  {
    personId: '2096266884247736321',
    name: '李四',
    employeeNo: null,
    groupId: '2096266884054798338',
    frozenSince: null,
    activeProjects: '0',
    ageDays: '3',
    escalate: false,
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('离职待移交清单（R215 A8 · HrSyncController）', () => {
  it('listPendingHandovers() → GET /hr-sync/pending-handovers，thresholdDays 省略不拼 query', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(pendingFixture));
    vi.stubGlobal('fetch', fetcher);
    const rows = await listPendingHandovers();
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/hr-sync/pending-handovers');
    expect(call[1]?.method ?? 'GET').toBe('GET');
    expect(rows).toHaveLength(2);
  });

  it('listPendingHandovers(30) → ?thresholdDays=30 显式拼装', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listPendingHandovers(30);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/hr-sync/pending-handovers?thresholdDays=30');
  });

  it('字段归一：ID 类 string 透传（超 2^53 雪花 ID 无损）、计数类 Number()、escalate 严格 === true', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(pendingFixture));
    vi.stubGlobal('fetch', fetcher);
    const [a, b] = await listPendingHandovers();
    // 行 a：安全范围内的 number 形态 ID → 归一为 string（展示与 key 无歧义）
    expect(a!.personId).toBe('900101');
    expect(a!.groupId).toBe('12');
    expect(a!.activeProjects).toBe(2);
    expect(a!.escalate).toBe(true);
    // 行 b：live 实测的雪花大 ID（string 下发）必须逐字符无损透传——Number() 会丢精度
    expect(b!.personId).toBe('2096266884247736321');
    expect(b!.groupId).toBe('2096266884054798338');
    expect(b!.activeProjects).toBe(0);
    expect(b!.ageDays).toBe(3);
    expect(b!.frozenSince).toBeNull();
    expect(b!.employeeNo).toBeNull();
    // 计数类归一后必须是 number；ID 类必须是 string（精度边界）
    expect(typeof b!.personId).toBe('string');
    expect(typeof b!.ageDays).toBe('number');
  });

  it('权限负例：普通成员调用被 403/30001 拒（端点限 GROUP_LEADER + SUPER_ADMIN）', async () => {
    const denied = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', denied);
    const cause = await listPendingHandovers().catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });
});
