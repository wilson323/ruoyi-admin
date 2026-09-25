/**
 * 超管永久清除域契约测试（R215 GAP-F10；AdminPermanentDeleteController 2 端点全量）。
 *
 * 重点覆盖（准备包 gap-f7-f11-change-plans.md §F10 用例清单）：
 * - executePermanentDelete：POST /admin/permanent-delete/{entityType}/{id}，body 恰 {confirmCode}，
 *   19 位雪花 path 逐字符无损（hr-sync.test.ts:85-87 金标准）；
 * - entityType 白名单外（'scenario'）→ api 层运行时守卫抛错且不发请求（TS 类型层另有编译期拒，
 *   后端 @Pattern :58 兜底 400 负例透传不吞）；
 * - listPermanentDeleteAudit：缺省不拼多余 query；('kpi_record',10) → ?entityType=kpi_record&limit=10；
 * - audit 行归一：id/operatorId/entityId string（19 位雪花逐字符）、originalDataJson 非法 JSON
 *   原文 string 透传（解析容错归视图层）、deletedAt ISO 串透传；
 * - execute 结果归一：permanentlyDeleted === true 严格布尔；
 * - 负例：组长（非超管）调用 403/30001（requireAdmin :61/:79 双处）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import {
  executePermanentDelete,
  listPermanentDeleteAudit,
} from './admin-permanent-delete';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/** execute 响应夹具（controller Map.of :63-69）：ID 双形态（number 安全区 + 19 位雪花 string）。 */
const executeFixture = {
  auditId: '2096266884247736999',
  entityType: 'project',
  entityId: '2096266884247736321',
  operatorId: '2096266884054798338',
  operatorName: '超管甲',
  permanentlyDeleted: true,
};

/** audit 行夹具（PermanentDeleteAudit；行 b 非法 JSON 快照 + 部分缺键形态）。 */
const auditFixture = [
  {
    id: '2096266884247737001', operatorId: '2096266884054798338', operatorName: '超管甲',
    entityType: 'person', entityId: '2096266884247736321',
    originalDataJson: '{"id":"2096266884247736321","name":"李四"}',
    deletedAt: '2026-09-24T10:15:30.000+00:00', ipAddress: '10.0.0.8', tenantId: '000000', delFlag: '0',
  },
  {
    id: 900102, operatorId: 900101, operatorName: '超管乙',
    entityType: 'kpi_record', entityId: '2096266884247736455',
    originalDataJson: '{broken json 原文',
    deletedAt: null, ipAddress: 'unknown', tenantId: '000000', delFlag: '0',
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

describe('超管永久清除（R215 GAP-F10 · AdminPermanentDeleteController）', () => {
  it("executePermanentDelete('project','2096266884247736321','PERMANENT_DELETE_CONFIRMED') → POST path 19 位雪花逐字符无损、body 恰 {confirmCode} 单键", async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(executeFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await executePermanentDelete('project', '2096266884247736321', 'PERMANENT_DELETE_CONFIRMED');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/admin/permanent-delete/project/2096266884247736321');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(String(call[1]?.body))).toStrictEqual({ confirmCode: 'PERMANENT_DELETE_CONFIRMED' });
    expect(r.entityId).toBe('2096266884247736321');
  });

  it('execute 结果归一：auditId/operatorId 19 位雪花 string 逐字符无损、permanentlyDeleted 严格 === true', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(executeFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await executePermanentDelete('project', '2096266884247736321', 'PERMANENT_DELETE_CONFIRMED');
    expect(r.auditId).toBe('2096266884247736999');
    expect(r.operatorId).toBe('2096266884054798338');
    expect(r.operatorName).toBe('超管甲');
    expect(r.permanentlyDeleted).toBe(true);
    expect(typeof r.permanentlyDeleted).toBe('boolean');
    expect(typeof r.auditId).toBe('string'); // Number() 会碎精度，锁定 string
  });

  it("execute 结果脏形态守卫：permanentlyDeleted 非 true（如 'yes'）归一为 false 不放行", async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ ...executeFixture, permanentlyDeleted: 'yes' }));
    vi.stubGlobal('fetch', fetcher);
    const r = await executePermanentDelete('person', '900101', 'PERMANENT_DELETE_CONFIRMED');
    expect(r.permanentlyDeleted).toBe(false);
  });

  it("entityType 白名单外（'scenario'）→ api 层运行时守卫抛错且不发请求（scenario 暂未建模必 400；TS 联合类型另有编译期拒）", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const cause = await executePermanentDelete(
      'scenario' as unknown as 'person',
      '2096266884247736321',
      'PERMANENT_DELETE_CONFIRMED',
    ).catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('person|project|kpi_record');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('后端 @Pattern 兜底负例：白名单外强行透传 400/PARAM_INVALID → IpdRequestError 透传不吞', async () => {
    const denied = vi.fn().mockResolvedValue(envelope(null, 400, 30000));
    vi.stubGlobal('fetch', denied);
    const cause = await executePermanentDelete('kpi_record', '1', 'WRONG_CODE').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).status).toBe(400);
  });

  it('confirmCode 错码负例：后端 REQUIRED_CONFIRM_CODE 严格相等校验 → PARAM_INVALID code≠0 抛 IpdRequestError（视图层另有空串拦截）', async () => {
    const rejected = vi.fn().mockResolvedValue(envelope(null, 200, 30000));
    vi.stubGlobal('fetch', rejected);
    const cause = await executePermanentDelete('project', '2096266884247736321', 'CONFIRMED').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30000);
    expect((cause as IpdRequestError).status).toBe(200);
  });

  it('listPermanentDeleteAudit() → GET /audit 不拼多余 query（后端默认 limit=50，confirmCode 严禁携带）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(auditFixture));
    vi.stubGlobal('fetch', fetcher);
    await listPermanentDeleteAudit();
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/admin/permanent-delete/audit');
    expect(fetcher.mock.calls[0]![0]).not.toContain('?');
  });

  it("listPermanentDeleteAudit('kpi_record', 10) → ?entityType=kpi_record&limit=10 显式拼装", async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listPermanentDeleteAudit('kpi_record', 10);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/admin/permanent-delete/audit?entityType=kpi_record&limit=10');
  });

  it('audit 行归一：ID 类 string（19 位雪花逐字符 + 安全区 number 双形态）、非法 JSON 快照原文透传、deletedAt ISO 串不运算', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(auditFixture));
    vi.stubGlobal('fetch', fetcher);
    const [a, b] = await listPermanentDeleteAudit();
    // 行 a：19 位雪花 ID 逐字符无损（Number() 即碎精度）
    expect(a!.id).toBe('2096266884247737001');
    expect(a!.entityId).toBe('2096266884247736321');
    expect(a!.operatorId).toBe('2096266884054798338');
    expect(typeof a!.id).toBe('string');
    expect(a!.deletedAt).toBe('2026-09-24T10:15:30.000+00:00'); // Date→ISO 串原样，禁日期运算
    // 行 b：安全区 number 形态 ID → 归一 string；非法 JSON 快照原文 string 透传（解析容错在视图层）
    expect(b!.id).toBe('900102');
    expect(b!.operatorId).toBe('900101');
    expect(b!.originalDataJson).toBe('{broken json 原文');
    expect(b!.deletedAt).toBeNull();
    expect(b!.ipAddress).toBe('unknown');
  });

  it('audit 非数组脏形态守卫 → 归 [] 不抛（null/undefined data 兜底）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null));
    vi.stubGlobal('fetch', fetcher);
    const rows = await listPermanentDeleteAudit();
    expect(rows).toStrictEqual([]);
  });

  it('负例：组长（非超管）调用 execute 被 403/30001 拒（requireAdmin :61 + service :95 双兜底）', async () => {
    const denied = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', denied);
    const cause = await executePermanentDelete('person', '900101', 'PERMANENT_DELETE_CONFIRMED').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });

  it('负例：组长（非超管）拉取 audit 被 403/30001 拒（requireAdmin :79）', async () => {
    const denied = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', denied);
    const cause = await listPermanentDeleteAudit('person').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });
});
