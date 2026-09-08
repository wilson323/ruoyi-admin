/**
 * 负反馈 API 契约测试（2026-09-08 契约对齐后）：
 * GET /negative-feedbacks?projectId=&status= 与 POST /negative-feedbacks。
 * 历史教训：旧断言 /list /create 锁死了臆造路径——GET /list 会被后端
 * GET /{id} 路由捕获，"list" 转 Long 失败 → 500/90001。
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
  it('GET /negative-feedbacks with required projectId only', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listNegativeFeedback('p-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/negative-feedbacks');
    expect(url.searchParams.get('projectId')).toBe('p-1');
    expect(url.searchParams.has('status')).toBe(false);
  });

  it('GET /negative-feedbacks with optional status filter', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listNegativeFeedback('p-1', 'EXECUTED');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/negative-feedbacks');
    expect(url.searchParams.get('projectId')).toBe('p-1');
    expect(url.searchParams.get('status')).toBe('EXECUTED');
  });

  it('POST /negative-feedbacks (bare path, NegativeFeedbackCreateReq body)', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'nf-1' }));
    vi.stubGlobal('fetch', fetcher);
    await createNegativeFeedback({
      projectId: 'p-1',
      triggerEvidence: '证据材料',
      triggerMonth: '2026-01',
      triggerType: 'REWORK_EXCEEDED',
    });
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(new URL(path, 'http://ipd.local').pathname).toBe('/api/v1/negative-feedbacks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      projectId: 'p-1',
      triggerEvidence: '证据材料',
      triggerMonth: '2026-01',
      triggerType: 'REWORK_EXCEEDED',
    });
  });
});
