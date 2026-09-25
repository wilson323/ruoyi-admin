/**
 * 人员同步任务域契约测试（R215 GAP-F7；PersonSyncController 5 端点全量）。
 *
 * 重点覆盖（准备包 gap-f7-f11-change-plans.md §F7 用例清单）：
 * - submitSyncJob：POST /person-sync/jobs，body 恰 {employeeNo}；带 idempotencyKey → body 双键（undefined 不塞 null）；
 * - retrySyncJob：path 段逐字符无损（sync-<uuid8>-<seq> 禁 Number）；含 '/' 的 id → URL 编码；
 * - retryAllSyncJobs：无 body 无 query；四计数 Number 且 typeof number；
 * - listSyncJobs/listAbnormalSyncJobs：GET 两口径 URL 正确、数组透传；
 * - 行归一：ID/Instant 字段 string 原样（19 位雪花形态 employeeNo 逐字符无损）、枚举值域守卫未知值不炸；
 * - 负例：组长调 retry-all 403/30001；非 FAILED retry → 业务错 code≠0 抛 IpdRequestError 不吞错。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import {
  listAbnormalSyncJobs,
  listSyncJobs,
  retryAllSyncJobs,
  retrySyncJob,
  submitSyncJob,
} from './person-sync';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/** SyncJobView 双形态夹具：行 a 常规；行 b 19 位雪花形态 employeeNo + 未知枚举值（值域守卫不炸）。 */
const jobFixture = [
  {
    jobId: 'sync-ab12cd34-7', employeeNo: 'E001', status: 'FAILED',
    attempts: 2, maxAttempts: 3, failureKind: 'TRANSIENT', failureReason: 'HR 网关超时',
    nextRetryAt: '2026-09-25T02:30:00Z', createdAt: '2026-09-25T01:00:00Z', updatedAt: '2026-09-25T02:00:00Z',
  },
  {
    jobId: 'sync-ff00aa99-12', employeeNo: '2096266884247736321', status: 'FOO_UNKNOWN',
    attempts: '0', maxAttempts: '3', failureKind: null, failureReason: null,
    nextRetryAt: null, createdAt: '2026-09-25T01:00:00Z', updatedAt: null,
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

describe('人员同步任务管理（R215 GAP-F7 · PersonSyncController）', () => {
  it('submitSyncJob(E001) → POST /person-sync/jobs，body 恰 {employeeNo} 单键（idempotencyKey undefined 不塞 null）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ jobId: 'sync-ab12cd34-7', status: 'PENDING' }));
    vi.stubGlobal('fetch', fetcher);
    const r = await submitSyncJob('E001');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/person-sync/jobs');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(String(call[1]?.body))).toStrictEqual({ employeeNo: 'E001' });
    expect(r).toStrictEqual({ jobId: 'sync-ab12cd34-7', status: 'PENDING' });
  });

  it('submitSyncJob(E001, ui-1695) → body 双键 {employeeNo, idempotencyKey}', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ jobId: 'sync-x1-1', status: 'PENDING' }));
    vi.stubGlobal('fetch', fetcher);
    await submitSyncJob('E001', 'ui-1695');
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)))
      .toStrictEqual({ employeeNo: 'E001', idempotencyKey: 'ui-1695' });
  });

  it('retrySyncJob → path 逐字符无损（sync-<uuid8>-<seq> 非纯数字，Number 直接 NaN）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(jobFixture[0]));
    vi.stubGlobal('fetch', fetcher);
    const r = await retrySyncJob('sync-ab12cd34-7');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/person-sync/jobs/sync-ab12cd34-7/retry');
    expect(fetcher.mock.calls[0]![1]?.method).toBe('POST');
    expect(r.jobId).toBe('sync-ab12cd34-7');
  });

  it('retrySyncJob 含特殊字符 id → encodeURIComponent 防路径注入', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(jobFixture[0]));
    vi.stubGlobal('fetch', fetcher);
    await retrySyncJob('a/b');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/person-sync/jobs/a%2Fb/retry');
  });

  it('retryAllSyncJobs → POST /jobs/retry-all 无 body 无 query；四计数归一为 number', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ retried: 5, succeeded: 3, failed: 1, skipped: 1 }));
    vi.stubGlobal('fetch', fetcher);
    const r = await retryAllSyncJobs();
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/person-sync/jobs/retry-all');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.body ?? undefined).toBeUndefined();
    expect(r).toStrictEqual({ failed: 1, retried: 5, skipped: 1, succeeded: 3 });
    expect(typeof r.retried).toBe('number');
    expect(typeof r.skipped).toBe('number');
  });

  it('listSyncJobs / listAbnormalSyncJobs → GET 两口径 URL 正确、数组透传', async () => {
    // Response 体一次性消费：两次调用必须各发一个新 Response
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(envelope(jobFixture)));
    vi.stubGlobal('fetch', fetcher);
    const all = await listSyncJobs();
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/person-sync/jobs');
    const abnormal = await listAbnormalSyncJobs();
    expect(fetcher.mock.calls[1]![0]).toBe('/api/v1/person-sync/jobs/abnormal');
    expect(all).toHaveLength(2);
    expect(abnormal).toHaveLength(2);
  });

  it('行归一：19 位雪花形态 employeeNo 逐字符无损、Instant 字段 string 透传、计数 Number、未知枚举不炸', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(jobFixture));
    vi.stubGlobal('fetch', fetcher);
    const [a, b] = await listSyncJobs();
    // 行 a：常规形态
    expect(a!.jobId).toBe('sync-ab12cd34-7');
    expect(a!.failureReason).toBe('HR 网关超时');
    expect(a!.attempts).toBe(2);
    expect(a!.nextRetryAt).toBe('2026-09-25T02:30:00Z'); // Instant → string 原样，禁日期运算
    // 行 b：19 位雪花形态 employeeNo 超 2^53，必须逐字符无损（Number() 会碎精度）
    expect(b!.employeeNo).toBe('2096266884247736321');
    expect(typeof b!.employeeNo).toBe('string');
    expect(b!.status).toBe('FOO_UNKNOWN'); // 未知枚举值原样透传不炸
    expect(b!.failureKind).toBeNull();
    expect(b!.attempts).toBe(0); // 计数类 '0' → Number 0
    expect(typeof b!.maxAttempts).toBe('number');
    expect(b!.updatedAt).toBeNull();
  });

  it('负例：组长调 retry-all 被 403/30001 拒（requireAdmin，PersonSyncController:71）', async () => {
    const denied = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', denied);
    const cause = await retryAllSyncJobs().catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });

  it('负例：非 FAILED 任务 retry → 业务错 code≠0（STATE_CONFLICT）抛 IpdRequestError 不吞错', async () => {
    const conflict = vi.fn().mockResolvedValue(envelope(null, 409, 50002));
    vi.stubGlobal('fetch', conflict);
    const cause = await retrySyncJob('sync-ok00001-1').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).status).toBe(409);
    expect((cause as IpdRequestError).code).toBe(50002);
  });
});
