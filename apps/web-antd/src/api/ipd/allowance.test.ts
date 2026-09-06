/**
 * 月度津贴 API 契约测试：ledger/pending-stop 端点 + period 必填 + personId 可选。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllowancePendingStop, listAllowances } from './allowance';

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

describe('allowance API contract', () => {
  it('GET /allowance/ledger with period', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listAllowances('2026-01');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/allowance/ledger');
    expect(url.searchParams.get('period')).toBe('2026-01');
  });

  it('omits personId when not provided', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listAllowances('2026-01', 'pm-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.searchParams.get('personId')).toBe('pm-1');
  });

  it('GET /allowance/pending-stop with period', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await getAllowancePendingStop('2026-01');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/allowance/pending-stop');
    expect(url.searchParams.get('period')).toBe('2026-01');
  });
});
