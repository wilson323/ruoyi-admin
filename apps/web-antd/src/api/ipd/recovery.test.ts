/**
 * 90 日回款预警 API 契约：路径不得重复拼接 /api/v1，扫描日期走查询参数。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIpdAuthStore } from '../../store/ipd-auth';
import { checkRecovery90d, listRecoveryWarnings } from './recovery';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-21T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  const auth = useIpdAuthStore();
  auth.token = 'test-session';
});
afterEach(() => vi.unstubAllGlobals());

describe('recovery warning API contract', () => {
  it('posts check-90d with scanDate as a query parameter and no body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(2));
    vi.stubGlobal('fetch', fetcher);
    const saved = await checkRecovery90d('2026-09-21');
    expect(saved).toBe(2);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/v1/recovery/check-90d?scanDate=2026-09-21');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('omits the query when scanDate is absent', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(0));
    vi.stubGlobal('fetch', fetcher);
    await checkRecovery90d();
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/recovery/check-90d');
  });

  it('gets warnings without a doubled /api/v1 prefix', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    const rows = await listRecoveryWarnings();
    expect(rows).toEqual([]);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/recovery/warnings');
    expect(fetcher.mock.calls[0]![1].method).toBe('GET');
  });
});
