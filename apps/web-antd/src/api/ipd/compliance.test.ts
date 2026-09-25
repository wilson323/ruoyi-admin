/**
 * 合规中心契约测试（R215 GAP-F6；ComplianceController P2-5.1 四端点）。
 *
 * 重点覆盖（准备包 §F6 用例清单）：
 * - fetchRetentionRules → GET /compliance/data-retention-rules 数组透传 + retentionDays Number 归一；
 * - createDataDeletionRequest：body 恰三键（无 requesterId/operatorId，SEC-API-01）+ 19 位雪花 string 无损；
 * - fetchAuditTrail：路径两段 + 分页 query；records.seq/actorId/entityId 归一 string；
 * - checkPermissionSeparation：conflict 布尔严格断言；
 * - 权限负例 403/30001。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import {
  checkPermissionSeparation,
  createDataDeletionRequest,
  fetchAuditTrail,
  fetchRetentionRules,
} from './compliance';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('合规中心 API（R215 GAP-F6 · ComplianceController）', () => {
  it('fetchRetentionRules → GET /compliance/data-retention-rules，数组透传 + int 计数归一', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([
      { resourceType: 'projects', retentionDays: 3650, deletionPolicy: 'SOFT_DELETE', legalBasis: '内部留存' },
      { resourceType: 'audit_logs', retentionDays: '2555', deletionPolicy: null, legalBasis: null },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const rows = await fetchRetentionRules();
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/compliance/data-retention-rules');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.retentionDays).toBe(3650);
    expect(rows[1]!.retentionDays).toBe(2555); // string 形态 int → Number 归一
    expect(rows[1]!.legalBasis).toBeNull();
  });

  it('createDataDeletionRequest → body 恰三键（SEC-API-01 禁 requesterId）；resourceId 19 位雪花逐字符无损', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      id: 1001, resourceType: 'projects', resourceId: 20_962_668_842_477_360_000, requesterId: '900101',
      reason: '用户撤回授权', status: 'PENDING', deadlineAt: '2026-10-25 00:00:00', createdAt: '2026-09-25 00:00:00',
    }));
    vi.stubGlobal('fetch', fetcher);
    const r = await createDataDeletionRequest({ reason: '用户撤回授权', resourceId: '2096266884247736321', resourceType: 'projects' });
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(Object.keys(body).sort()).toEqual(['reason', 'resourceId', 'resourceType']);
    expect(body.resourceId).toBe('2096266884247736321'); // string 透传，非 Number 塌缩形态
    // 出参归一：后端 Long 双形态（示例安全区间 number）→ 前端 string
    expect(typeof r.resourceId).toBe('string');
    expect(r.id).toBe('1001');
    expect(r.status).toBe('PENDING');
    expect(r.deadlineAt).toBe('2026-10-25 00:00:00');
  });

  it('fetchAuditTrail(type,id,2,50) → GET 路径两段 + ?pageNo=2&pageSize=50；records ID 归一 string', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      current: 2, pages: 3, size: 50, total: 120,
      records: [{ seq: 9001, actorId: '2096266884247736321', actorName: '张三', action: 'RESIGN', before: null, after: '{}', createTime: '2026-09-25 10:00:00', entityType: 'persons', entityId: '2096266884247736321' }], // 超 2^53 雪花：BigNumberSerializer 恒 string 下发
    }));
    vi.stubGlobal('fetch', fetcher);
    const page = await fetchAuditTrail('project', '2096266884247736321', 2, 50);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/compliance/audit-trail/project/2096266884247736321?pageNo=2&pageSize=50');
    expect(page.total).toBe(120);
    const row = page.records[0]!;
    expect(row.seq).toBe('9001');
    expect(row.actorId).toBe('2096266884247736321');
    expect(row.entityId).toBe('2096266884247736321'); // 19 位雪花逐字符无损（若前端曾 Number() 归一会塌缩为 …0000，此处防回潮）
    expect(row.before).toBeNull();
  });

  it('fetchAuditTrail 缺省分页 → 不拼 query（后端 defaultValue 1/20 兜底）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ records: [] }));
    vi.stubGlobal('fetch', fetcher);
    const page = await fetchAuditTrail('persons', '900101');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/compliance/audit-trail/persons/900101');
    expect(page.records).toEqual([]);
  });

  it('checkPermissionSeparation → GET …/permission-separation/<id>；conflict 布尔严格判定', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ userId: '2096266884247736321', hasReadRole: true, hasWriteRole: true, conflict: true, roleList: ['compliance-reader', 'compliance-writer'] }));
    vi.stubGlobal('fetch', fetcher);
    const r = await checkPermissionSeparation('2096266884247736321');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/compliance/permission-separation/2096266884247736321');
    expect(r.conflict).toBe(true);
    expect(r.userId).toBe('2096266884247736321');
    expect(r.roleList).toEqual(['compliance-reader', 'compliance-writer']);
    // 非布尔 truthy（字符串 "true"）不得判成冲突——=== true 严格归一
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope({ conflict: 'true', roleList: null })));
    const r2 = await checkPermissionSeparation('9');
    expect(r2.conflict).toBe(false);
    expect(r2.roleList).toEqual([]);
  });

  it('权限负例：无 compliance:write 创建删除请求 403/30001；read 越权同通道', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 403, 30001)));
    const cause = await createDataDeletionRequest({ reason: 'x', resourceId: '1', resourceType: 'projects' }).catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).status).toBe(403);
    await expect(fetchRetentionRules()).rejects.toBeInstanceOf(IpdRequestError);
  });
});
