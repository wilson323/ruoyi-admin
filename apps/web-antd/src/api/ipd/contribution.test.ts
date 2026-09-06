/**
 * 贡献度 API 契约测试：versions/current/submit 三端点。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentContribution, listContributionVersions, submitContribution } from './contribution';

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

describe('contribution API contract', () => {
  it('GET /contribution/versions with projectId+period', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listContributionVersions('p-1', '2026-01');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/contribution/versions');
    expect(url.searchParams.get('projectId')).toBe('p-1');
    expect(url.searchParams.get('period')).toBe('2026-01');
  });

  it('GET /contribution/current with same filters', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'cv-1' }));
    vi.stubGlobal('fetch', fetcher);
    await getCurrentContribution('p-1', '2026-01');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/contribution/current');
  });

  it('POST /contribution/submit', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'cv-2' }));
    vi.stubGlobal('fetch', fetcher);
    await submitContribution({
      contributionMarketMin: 0.4, contributionRdMax: 0.6,
      marketPmShare: 0.4, period: '2026-01', projectId: 'p-1',
      rdPmShare: 0.6,
    });
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });
});
