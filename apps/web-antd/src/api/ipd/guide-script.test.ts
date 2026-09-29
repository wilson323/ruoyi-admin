/**
 * 引导帧序列 API 契约测试（C4a）：GET /api/v1/ipd/stage/sub-stages/guide-events 的
 * 路径/查询串/方法与非数组防御归一。后端 C2 并行开发中（value 增 guideSteps/advanceGate），
 * 此处 mock 包络先行钉死前端侧 URL 契约（Track A A4.2 @RequestMapping 全等）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuideEvent } from './guide-script';
import { fetchGuideEvents } from './guide-script';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({
      code: 0,
      data,
      message: 'success',
      timestamp: '2026-09-28T00:00:00Z',
      traceId: 'fixture',
    }),
    { headers: { 'Content-Type': 'application/json' }, status: 200 },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('guide-script API contract', () => {
  it('GET /ipd/stage/sub-stages/guide-events：查询串携带 subStageCode/projectId，返回事件数组', async () => {
    const events: GuideEvent[] = [{ type: 'RUN_STARTED' }, { type: 'RUN_FINISHED' }];
    const fetcher = vi.fn().mockResolvedValue(envelope(events));
    vi.stubGlobal('fetch', fetcher);

    const list = await fetchGuideEvents('CONCEPT-S1', '1001');

    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/ipd/stage/sub-stages/guide-events');
    expect(url.searchParams.get('subStageCode')).toBe('CONCEPT-S1');
    expect(url.searchParams.get('projectId')).toBe('1001');
    expect((fetcher.mock.calls[0]![1] as RequestInit | undefined)?.method ?? 'GET').toBe('GET');
    expect(list).toEqual(events);
  });

  it('projectId 缺省：查询串不含 projectId 键（buildQuery 跳过 undefined）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);

    expect(await fetchGuideEvents('CONCEPT-S1')).toEqual([]);

    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.searchParams.has('projectId')).toBe(false);
    expect(url.searchParams.get('subStageCode')).toBe('CONCEPT-S1');
  });

  it('非数组响应防御性归一为 []（不崩）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ unexpected: true }));
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchGuideEvents('CONCEPT-S1')).toEqual([]);
  });
});
