/**
 * 项目评分 API 契约测试（2026-09-08 契约对齐后）：
 * GET /project-scores/{projectId}/{personId} 单视图 + settle + POST 裸路径提交。
 * 历史教训：旧断言 /list /submit /project-score-tasks/my 均为臆造路径
 * （后端无这些端点；评分任务列表端点未交付，页内登记真缺口）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProjectScore, settleProjectScore, submitProjectScore } from './project-score';

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
  it('GET /project-scores/{projectId}/{personId} (single view)', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ projectId: 'p-1' }));
    vi.stubGlobal('fetch', fetcher);
    await getProjectScore('p-1', 'pm-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/project-scores/p-1/pm-1');
    expect(url.search).toBe('');
  });

  it('GET /project-scores/{projectId}/{personId}/settle', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ projectId: 'p-1', settled: true }));
    vi.stubGlobal('fetch', fetcher);
    await settleProjectScore('p-1', 'pm-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/project-scores/p-1/pm-1/settle');
  });

  it('POST /project-scores (bare path, ProjectScoreSubmitReq body)', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ projectId: 'p-1' }));
    vi.stubGlobal('fetch', fetcher);
    await submitProjectScore({
      componentType: 'SELF',
      personId: 'pm-1',
      projectId: 'p-1',
      score: 80,
    });
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(new URL(path, 'http://ipd.local').pathname).toBe('/api/v1/project-scores');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      componentType: 'SELF',
      personId: 'pm-1',
      projectId: 'p-1',
      score: 80,
    });
  });
});
