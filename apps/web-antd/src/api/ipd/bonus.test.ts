/**
 * 奖金池 API 契约测试：compute/freeze/distribute/get/list 端点 + 路径与方法。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeBonusPool,
  distributeBonusPool,
  freezeBonusPool,
  getBonusPool,
  listBonusPools,
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
