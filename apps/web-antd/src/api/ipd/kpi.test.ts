/**
 * KPI 考核接口契约测试（W4-E）：含共担 KPI 归集列表 GET /kpi/shared 端点。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionalKpi, getKpiTrend, getPerformanceKpi, listSharedKpis } from './kpi';

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
    await listSharedKpis(201, '2026-09');
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
    const rows = await listSharedKpis(201, '2026-09');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kpiType).toBe('SHARED');
    expect(rows[0]!.revision).toBe(2);
  });
});