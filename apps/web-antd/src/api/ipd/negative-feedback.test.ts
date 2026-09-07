/**
 * 负反馈 API 契约测试：list 端点过滤 + create 端点 POST。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNegativeFeedback, listNegativeFeedback } from './negative-feedback';

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

describe('negative-feedback API contract', () => {
  it('GET /negative-feedbacks/list with optional projectId/personId', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listNegativeFeedback({ projectId: 'p-1' });
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/negative-feedbacks/list');
    expect(url.searchParams.get('projectId')).toBe('p-1');
    expect(url.searchParams.has('personId')).toBe(false);
  });

  it('POST /negative-feedbacks/create', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'nf-1' }));
    vi.stubGlobal('fetch', fetcher);
    await createNegativeFeedback({
      effectiveMonth: '2026-01', operatorId: 'op-1', personId: 'pm-1',
      projectId: 'p-1', role: 'PRIMARY', trigger: 'QUALITY_INCIDENT',
    });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/negative-feedbacks/create');
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });
});
