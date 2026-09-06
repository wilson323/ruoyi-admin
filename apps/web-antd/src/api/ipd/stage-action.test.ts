/**
 * StageAction API 契约测试 + ossId 链路（A-3/A-4 修复验证）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addStageActionDeliverable } from './stage-action';

const envelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => vi.unstubAllGlobals());

describe('stage-action deliverable ossId contract', () => {
  it('POST /stage-actions/{id}/deliverables with fileName+ossId', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'd-1' }));
    vi.stubGlobal('fetch', fetcher);
    await addStageActionDeliverable('sa-1', 'doc.pdf', '9001');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/stage-actions/sa-1/deliverables');
    expect(url.searchParams.get('fileName')).toBe('doc.pdf');
    // ossId 透传 string（后端 Long 反序列化）；不再 optional
    expect(url.searchParams.get('ossId')).toBe('9001');
  });
});
