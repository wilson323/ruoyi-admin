/**
 * Gate 材料齐套性契约测试（[CONSISTENCY-15]）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGateMaterialStatus } from './gate-material';

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => vi.unstubAllGlobals());

describe('gate material status API contract', () => {
  it('GET /gates/{id}/materials with projectId', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ gateId: 1, projectId: 2, total: 0, uploaded: 0, missing: 0, isReady: true, items: [] }));
    vi.stubGlobal('fetch', fetcher);
    const out = await getGateMaterialStatus(1, 2);
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/gates/1/materials');
    expect(url.searchParams.get('projectId')).toBe('2');
    expect(out.isReady).toBe(true);
  });
});
