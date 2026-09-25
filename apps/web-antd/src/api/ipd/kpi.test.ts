/**
 * KPI 考核接口契约测试（W4-E）：含共担 KPI 归集列表 GET /kpi/shared 端点。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpdRequestError } from './auth';
import {
  confirmSharedKpi,
  deleteFunctionalMetric,
  getFunctionalKpi,
  getKpiTrend,
  getPerformanceKpi,
  getSharedDeadlineConfig,
  listFunctionalMetricCodes,
  listFunctionalMetrics,
  listRawKpiRecordTypes,
  listSharedConfirms,
  listSharedKpis,
  upsertFunctionalMetric,
} from './kpi';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  // ipdGet → useIpdAuthStore() → 必须先激活 Pinia（与 allowance.test.ts 同款）
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('kpi API contract', () => {
  it('GET /kpi/functional with period', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await getFunctionalKpi('2026-09');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/functional');
    expect(url.searchParams.get('period')).toBe('2026-09');
  });

  it('GET /kpi/performance with period', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({}));
    vi.stubGlobal('fetch', fetcher);
    await getPerformanceKpi('2026-09');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/performance');
    expect(url.searchParams.get('period')).toBe('2026-09');
  });

  it('GET /kpi/trend without periods defaults to undefined', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await getKpiTrend();
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/trend');
    expect(url.searchParams.has('periods')).toBe(false);
  });

  it('GET /kpi/trend with periods', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await getKpiTrend(6);
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.searchParams.get('periods')).toBe('6');
  });

  /* ====================== W4-E：共担 KPI 归集列表 ====================== */

  it('GET /kpi/shared with projectId + period (W4-E listShared)', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listSharedKpis('201', '2026-09');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/shared');
    expect(url.searchParams.get('projectId')).toBe('201');
    expect(url.searchParams.get('period')).toBe('2026-09');
  });

  it('GET /kpi/shared returns array (W4-E listShared payload shape)', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope([
        {
          id: '11',
          projectId: '201',
          personId: '1001',
          kpiType: 'SHARED',
          period: '2026-09',
          comprehensiveScore: '85.50',
          revision: 2,
          scoredBy: '1',
          status: 'FINALIZED',
          segment: 'FULL_SHARED',
          scoredAt: '2026-09-30T18:00:00Z',
        },
      ]),
    );
    vi.stubGlobal('fetch', fetcher);
    const rows = await listSharedKpis('201', '2026-09');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kpiType).toBe('SHARED');
    expect(rows[0]!.revision).toBe(2);
  });
});
/* =============== A2 P1：功能指标量表（R148.1 §2.2 方案②） =============== */

describe('kpi functional metrics API contract (A2 P1)', () => {
  it('GET /kpi/functional-metrics with projectId + metricCode', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listFunctionalMetrics('201', 'MKT_WINDOW_HIT_RATE');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/functional-metrics');
    expect(url.searchParams.get('projectId')).toBe('201');
    expect(url.searchParams.get('metricCode')).toBe('MKT_WINDOW_HIT_RATE');
  });

  it('GET /kpi/functional-metrics 未传 metricCode 时不下发该参数', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listFunctionalMetrics('201');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.searchParams.has('metricCode')).toBe(false);
  });

  it('GET /kpi/functional-metrics/codes 返回 8 项编码清单', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(['MKT_REQUIREMENT_ACCURACY', 'RD_FIRST_PASS_YIELD']));
    vi.stubGlobal('fetch', fetcher);
    const codes = await listFunctionalMetricCodes();
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/functional-metrics/codes');
    expect(codes).toEqual(['MKT_REQUIREMENT_ACCURACY', 'RD_FIRST_PASS_YIELD']);
  });

  it('PUT /kpi/functional-metrics：method=PUT + body 六字段白名单', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: '9001' }));
    vi.stubGlobal('fetch', fetcher);
    await upsertFunctionalMetric({
      projectId: '201',
      metricCode: 'RD_QUALITY_DEFECT_RATE',
      period: '2026-09',
      metricValue: 1200,
      targetValue: 800,
      scaleVersion: 'V1.0-2026Q3',
      remark: '首批录入',
    });
    const call = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    const url = new URL(call[0], 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/functional-metrics');
    expect(call[1].method).toBe('PUT');
    expect(JSON.parse(String(call[1].body))).toEqual({
      projectId: '201',
      metricCode: 'RD_QUALITY_DEFECT_RATE',
      period: '2026-09',
      metricValue: 1200,
      targetValue: 800,
      scaleVersion: 'V1.0-2026Q3',
      remark: '首批录入',
    });
  });

  it('PUT /kpi/functional-metrics 后端业务拒绝（50002）向上抛错，不静默吞掉', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 50002, message: '状态冲突', data: null, timestamp: '2026-09-21T00:00:00Z', traceId: 'fixture' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await expect(
      upsertFunctionalMetric({ projectId: '201', metricCode: 'MKT_WINDOW_HIT_RATE', period: '2026-09', metricValue: 88 }),
    ).rejects.toThrow();
  });
});

/* ========== ORPHAN-A6（R212 #37/#39/#40，看板卡 8338f2fa）契约增量 ========== */

describe('kpi API contract (ORPHAN-A6: functional-metrics DELETE + codes/raw-records types)', () => {
  it('DELETE /kpi/functional-metrics/{id}：method=DELETE + 路径参数内插 + 无 body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null));
    vi.stubGlobal('fetch', fetcher);
    await deleteFunctionalMetric('9001');
    const call = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    const url = new URL(call[0], 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/functional-metrics/9001');
    expect(call[1].method).toBe('DELETE');
  });

  it('DELETE /kpi/functional-metrics/{id} 后端权限拒绝（FORBIDDEN）向上抛错，不静默吞掉', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 40300, message: '无 ipd:kpi:config 权限', data: null, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await expect(deleteFunctionalMetric('9001')).rejects.toThrow();
  });

  it('GET /kpi/raw-records/types：权威类型枚举（R212 #40）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(['REVENUE', 'NPS', 'COMPLETION_RATE']));
    vi.stubGlobal('fetch', fetcher);
    const types = await listRawKpiRecordTypes();
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/raw-records/types');
    expect(types).toEqual(['REVENUE', 'NPS', 'COMPLETION_RATE']);
  });
});

/* ========== ORPHAN-A7（R212 #79/#80/#82，看板卡 670aecdf，页30）契约增量 ========== */

describe('kpi API contract (ORPHAN-A7: shared confirms + deadline-config + confirm)', () => {
  it('GET /kpi/shared/confirms with projectId + period（不传 status 时不下发该参数）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listSharedConfirms('1001', '2026-09');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/shared/confirms');
    expect(url.searchParams.get('projectId')).toBe('1001');
    expect(url.searchParams.get('period')).toBe('2026-09');
    expect(url.searchParams.has('status')).toBe(false);
  });

  it('GET /kpi/shared/confirms with status filter（PENDING/CONFIRMED/OVERDUE 透传）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listSharedConfirms('1001', '2026-09', 'OVERDUE');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.searchParams.get('status')).toBe('OVERDUE');
  });

  it('GET /kpi/shared/confirms 返回 KpiSharedConfirmView 形态（含 confirmedByMe）', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope([
        {
          id: '9101',
          period: '2026-09',
          projectId: '1001',
          projectName: '智慧园区视频分析',
          personId: '9001',
          personName: '组长甲',
          metricCode: 'K01',
          metricName: '销量/出货量达成率',
          weight: '0.30',
          deadlineAt: '2026-10-07T18:00:00',
          status: 'PENDING',
          firstConfirmedBy: null,
          firstConfirmedAt: null,
          secondConfirmedBy: null,
          secondConfirmedAt: null,
          confirmedByMe: false,
        },
      ]),
    );
    vi.stubGlobal('fetch', fetcher);
    const rows = await listSharedConfirms('1001', '2026-09');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metricCode).toBe('K01');
    expect(rows[0]!.status).toBe('PENDING');
    expect(rows[0]!.confirmedByMe).toBe(false);
  });

  it('GET /kpi/shared/deadline-config：无查询参数 + 视图五字段', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({ dayOfMonth: 5, cutoffTime: '2026-10-07T18:00:00', version: 3, source: 'DB_ACTIVE', configuredValue: '5' }),
    );
    vi.stubGlobal('fetch', fetcher);
    const config = await getSharedDeadlineConfig();
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/shared/deadline-config');
    expect(url.search).toBe('');
    expect(config.dayOfMonth).toBe(5);
    expect(config.source).toBe('DB_ACTIVE');
  });

  it('POST /kpi/shared/{id}/confirm：method=POST + 路径内插 + 无 body', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({ confirmed: false, status: 'PENDING', firstConfirmedBy: '9001', secondConfirmedBy: null }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await confirmSharedKpi('9101');
    const call = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    const url = new URL(call[0], 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/kpi/shared/9101/confirm');
    expect(call[1].method).toBe('POST');
    expect(result.confirmed).toBe(false);
    expect(result.firstConfirmedBy).toBe('9001');
  });

  it('POST /kpi/shared/{id}/confirm 同人重签（40002 DUAL_SIGN_INCOMPLETE）向上抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 40002, message: '双组长确认需第二位不同组长签署，同一人不能重复确认', data: null, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    // message 走前端 code→文案映射（BUSINESS_CODE_MESSAGES），故按 code+envelopeMessage 断言而非 message 原文
    const cause = await confirmSharedKpi('9101').catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(40002);
    expect((cause as IpdRequestError).envelopeMessage).toContain('同一人不能重复确认');
  });
});
