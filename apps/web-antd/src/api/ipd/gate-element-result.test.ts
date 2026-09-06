/**
 * Gate 要素判定 API 契约测试 + countVetoFailures 硬阻断纯函数。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeGateElementResult, countVetoFailures, listGateElements, submitGateElementResult } from './gate-element-result';

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

describe('gate element result API contract', () => {
  it('GET /gates/{id}/elements returns seeded 33-element list', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([
      { id: 'e-1', code: 'G1-01', gateCode: 'G1', title: 't1', isVeto: true, status: 'PUBLISHED', sortOrder: 1 },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const list = await listGateElements('gate-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/gates/gate-1/elements');
    expect(list[0]!.isVeto).toBe(true);
  });

  it('POST /gates/{id}/element-results', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'er-1' }));
    vi.stubGlobal('fetch', fetcher);
    await submitGateElementResult('gate-1', { elementId: 'e-1', result: 'PASS' });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/gates/gate-1/element-results');
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  it('POST /gates/{id}/element-results/{resultId}/close for condition items', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'er-1' }));
    vi.stubGlobal('fetch', fetcher);
    await closeGateElementResult('gate-1', 'er-1', { evidenceRef: 'att-1', note: '已补材料' });
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/gates/gate-1/element-results/er-1/close');
  });
});

describe('countVetoFailures hardblock', () => {
  it('counts only veto items with FAIL result', () => {
    const els = [
      { id: '1', isVeto: true } as any,
      { id: '2', isVeto: false } as any,
      { id: '3', isVeto: true } as any,
    ];
    const results = new Map([
      ['1', 'FAIL' as const],
      ['2', 'FAIL' as const],
      ['3', 'PASS' as const],
    ]);
    expect(countVetoFailures(els, results)).toBe(1);
  });

  it('returns 0 when no veto failures', () => {
    expect(countVetoFailures([{ id: '1', isVeto: true } as any], new Map())).toBe(0);
  });
});
