/**
 * 贡献度 API 契约测试（2026-09-08 契约对齐后）：
 * GET /contributions/{projectId} 单视图 + save/preview/market-share/confirm 端点组。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adjustMarketShare,
  confirmContribution,
  getContribution,
  previewContribution,
  saveContribution,
} from './contribution';

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
  it('GET /contributions/{projectId} (single view, no query)', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'cv-1' }));
    vi.stubGlobal('fetch', fetcher);
    await getContribution('p-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/contributions/p-1');
    expect(url.search).toBe('');
  });

  it('POST /contributions/{projectId}/save with five-dim body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'cv-2' }));
    vi.stubGlobal('fetch', fetcher);
    await saveContribution('p-1', {
      dimInnovation: 80, dimInitiation: 80, dimLaunch: 80, dimLeadership: 80,
      dimMarketResult: 80, role: 'MARKET_PM',
    });
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(new URL(path, 'http://ipd.local').pathname).toBe('/api/v1/contributions/p-1/save');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      dimInnovation: 80, dimInitiation: 80, dimLaunch: 80, dimLeadership: 80,
      dimMarketResult: 80, role: 'MARKET_PM',
    });
  });

  it('POST /contributions/{projectId}/preview with same body shape', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'cv-3' }));
    vi.stubGlobal('fetch', fetcher);
    await previewContribution('p-1', {
      dimInnovation: 80, dimInitiation: 80, dimLaunch: 80, dimLeadership: 80,
      dimMarketResult: 80, role: 'RD_PM',
    });
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(new URL(path, 'http://ipd.local').pathname).toBe('/api/v1/contributions/p-1/preview');
    expect(init.method).toBe('POST');
  });

  it('POST /contributions/{projectId}/market-share with marketShare query param', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'cv-4' }));
    vi.stubGlobal('fetch', fetcher);
    await adjustMarketShare('p-1', 0.55);
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const url = new URL(path, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/contributions/p-1/market-share');
    expect(url.searchParams.get('marketShare')).toBe('0.55');
    expect(init.method).toBe('POST');
  });

  it('POST /contributions/{projectId}/confirm with decision+opinion query', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'cv-5' }));
    vi.stubGlobal('fetch', fetcher);
    await confirmContribution('p-1', 'APPROVE', '同意');
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const url = new URL(path, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/contributions/p-1/confirm');
    expect(url.searchParams.get('decision')).toBe('APPROVE');
    expect(url.searchParams.get('opinion')).toBe('同意');
    expect(init.method).toBe('POST');
  });
});
