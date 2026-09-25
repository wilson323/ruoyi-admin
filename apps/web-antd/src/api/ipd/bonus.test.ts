/**
 * 奖金池 API 契约测试：compute/freeze/distribute/get/list 端点 + 路径与方法。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoComputeBonusPool,
  computeBonusPool,
  distributeBonusPool,
  freezeBonusPool,
  getBonusPool,
  listBonusPools,
  pageBonusPools,
  previewBonusCoefficient,
} from './bonus';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('bonus pool API contract', () => {
  it('POST /bonus-pool/compute with body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'bp-1', status: 'DRAFT' }));
    vi.stubGlobal('fetch', fetcher);
    await computeBonusPool({
      achievementRate: 80, actualReceipts: 1_000_000,
      personalCoefficient: 1.1, poolRate: 0.05, projectId: 'p-1',
    });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/bonus-pool/compute');
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    const body = JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.actualReceipts).toBe(1_000_000);
    expect(body).not.toHaveProperty('receiptAmounts');
    expect(body).not.toHaveProperty('period');
    expect(body).not.toHaveProperty('levelCoefficient');
    expect(body).not.toHaveProperty('tierCoefficient');
  });

  it('POST /{id}/freeze and /{id}/distribute on the bonus pool', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(envelope({ id: 'bp-1', status: 'CONFIRMED' }))
      .mockResolvedValueOnce(envelope({ id: 'bp-1', status: 'DISTRIBUTED' }));
    vi.stubGlobal('fetch', fetcher);
    await freezeBonusPool('bp-1');
    await distributeBonusPool('bp-1');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/bonus-pool/bp-1/freeze');
    expect(fetcher.mock.calls[1]![0]).toBe('/api/v1/bonus-pool/bp-1/distribute');
  });

  it('GET /{id} and GET /list with optional status', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(envelope({ id: 'bp-1' }))
      .mockResolvedValueOnce(envelope([{ id: 'bp-2' }]));
    vi.stubGlobal('fetch', fetcher);
    await getBonusPool('bp-1');
    await listBonusPools('p-1', 'DRAFT');
    const url1 = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    const url2 = new URL(fetcher.mock.calls[1]![0] as string, 'http://ipd.local');
    expect(url1.pathname).toBe('/api/v1/bonus-pool/bp-1');
    expect(url2.pathname).toBe('/api/v1/bonus-pool/list');
    expect(url2.searchParams.get('status')).toBe('DRAFT');
  });
});

/* ========== ORPHAN-A4 增量契约（R212 桶表 #10-12；page/auto-compute/coefficient-preview） ========== */

describe('bonus pool API contract — ORPHAN-A4 (page / auto-compute / coefficient preview)', () => {
  it('GET /bonus-pool/page?projectId=&pageNo=&pageSize= → IPage 包络（records/total）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      records: [{ id: 'bp-9', status: 'DRAFT' }],
      total: 1, size: 20, current: 1, pages: 1,
    }));
    vi.stubGlobal('fetch', fetcher);
    const page = await pageBonusPools('p-1', 2, 50);
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/bonus-pool/page');
    expect(url.searchParams.get('projectId')).toBe('p-1');
    expect(url.searchParams.get('pageNo')).toBe('2');
    expect(url.searchParams.get('pageSize')).toBe('50');
    expect(page.records[0]!.id).toBe('bp-9');
    expect(page.total).toBe(1);
  });

  it('pageBonusPools 默认分页参数 pageNo=1 & pageSize=20（与后端默认一致）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ records: [], total: 0, size: 20, current: 1, pages: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await pageBonusPools('p-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.searchParams.get('pageNo')).toBe('1');
    expect(url.searchParams.get('pageSize')).toBe('20');
  });

  it('POST /bonus-pool/auto-compute：body 必含 period（YYYY-MM），不传 personalCoefficient（后端 KPI 推导）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'bp-2', status: 'DRAFT' }));
    vi.stubGlobal('fetch', fetcher);
    await autoComputeBonusPool({
      achievementRate: 100, actualReceipts: 2_000_000, period: '2026-08', projectId: 'p-1',
    });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/bonus-pool/auto-compute');
    expect((call[1] as RequestInit).method).toBe('POST');
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.period).toBe('2026-08');
    expect(body.actualReceipts).toBe(2_000_000);
    expect(body).not.toHaveProperty('personalCoefficient');
  });

  it('POST /bonus-pool/coefficient/preview：strategy 缺省时 body 不带 strategy 字段（走 system_configs）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'preview-1', coefficient: 1.0 }));
    vi.stubGlobal('fetch', fetcher);
    await previewBonusCoefficient({ projectId: 'p-1', score: 85 });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/bonus-pool/coefficient/preview');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ projectId: 'p-1', score: 85 });
  });

  it('POST /bonus-pool/coefficient/preview：strategy 透传（PROJECT_SCORE/WEIGHTED_AVG/LAST_QUARTER）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'preview-2', coefficient: 0.8 }));
    vi.stubGlobal('fetch', fetcher);
    await previewBonusCoefficient({ projectId: 'p-1', score: 60, strategy: 'WEIGHTED_AVG' });
    const body = JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.strategy).toBe('WEIGHTED_AVG');
  });
});
