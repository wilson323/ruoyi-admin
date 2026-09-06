/**
 * 项目评分 API 契约测试：list/submit/listMyScoreTasks 三端点。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listMyScoreTasks, listProjectScores, submitProjectScore } from './project-score';

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

describe('project score API contract', () => {
  it('GET /project-score/list with projectId+period', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listProjectScores('p-1', '2026-01');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/project-score/list');
    expect(url.searchParams.get('projectId')).toBe('p-1');
    expect(url.searchParams.get('period')).toBe('2026-01');
  });

  it('POST /project-score/submit', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'ps-1' }));
    vi.stubGlobal('fetch', fetcher);
    await submitProjectScore({
      period: '2026-01', personId: 'pm-1', projectId: 'p-1',
      role: 'SELF', score: 80,
    });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/project-score/submit');
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  it('GET /project-score-tasks/my (no params)', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listMyScoreTasks();
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/project-score-tasks/my');
  });
});
