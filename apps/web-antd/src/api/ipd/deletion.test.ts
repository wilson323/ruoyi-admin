/**
 * 删除审核域 API 契约测试：端点路径、决策查询参数、请求体白名单、24h 撤回窗口。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIpdAuthStore } from '../../store/ipd-auth';
import {
  adminDecideDeletion,
  escalateOverdueLeaderReview,
  leaderDecideDeletion,
  listDeletionArchive,
  submitDeletionRequest,
  withinWithdrawWindow,
  withdrawDeletionRequest,
} from './deletion';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  const auth = useIpdAuthStore();
  auth.token = 'test-session';
});
afterEach(() => vi.unstubAllGlobals());

describe('deletion request API contract', () => {
  it('submits the whitelisted body to /deletion-requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: '9001', status: 'LEADER_REVIEW' }));
    vi.stubGlobal('fetch', fetcher);
    const created = await submitDeletionRequest({ entityType: 'products', entityId: '42', reason: '重复建档需要删除' });
    expect(created.status).toBe('LEADER_REVIEW');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/v1/deletion-requests');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ entityType: 'products', entityId: '42', reason: '重复建档需要删除' });
  });

  it('sends leader and admin decisions as query parameters without a body', async () => {
    // mockImplementation 每次返回新 Response：同一 Response 的 body 只能读一次。
    const fetcher = vi.fn().mockImplementation(async () => envelope({ id: '7', status: 'ADMIN_REVIEW' }));
    vi.stubGlobal('fetch', fetcher);
    await leaderDecideDeletion('7', true, '同意删除');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const leader = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(leader.pathname).toBe('/api/v1/deletion-requests/7/leader-decision');
    expect(leader.searchParams.get('approve')).toBe('true');
    expect(leader.searchParams.get('opinion')).toBe('同意删除');
    expect((fetcher.mock.calls[0]![1] as RequestInit).body).toBeUndefined();

    await adminDecideDeletion('7', false);
    const admin = new URL(fetcher.mock.calls[1]![0] as string, 'http://ipd.local');
    expect(admin.pathname).toBe('/api/v1/deletion-requests/7/admin-decision');
    expect(admin.searchParams.get('approve')).toBe('false');
    expect(admin.searchParams.has('opinion')).toBe(false);
  });

  it('keeps withdraw / archive / overdue / purge / escalate endpoints on the api/v1 prefix', async () => {
    const fetcher = vi.fn().mockImplementation(async () => envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await withdrawDeletionRequest('9001');
    await listDeletionArchive();
    await escalateOverdueLeaderReview();
    const urls = fetcher.mock.calls.map((call) => call[0] as string);
    expect(urls).toEqual([
      '/api/v1/deletion-requests/9001/withdraw',
      '/api/v1/deletion-requests/archive',
      '/api/v1/deletion-requests/escalate-overdue',
    ]);
  });
});

describe('24h withdraw window (BR-DEL-04)', () => {
  it('accepts "yyyy-MM-dd HH:mm:ss", ISO strings and epoch millis', () => {
    const now = Date.parse('2026-09-05T12:00:00');
    expect(withinWithdrawWindow('2026-09-05 08:00:00', now)).toBe(true);
    expect(withinWithdrawWindow('2026-09-04 08:00:00', now)).toBe(false);
    expect(withinWithdrawWindow('2026-09-05T04:00:00Z', now)).toBe(true);
    expect(withinWithdrawWindow(Date.parse('2026-09-05T04:00:00Z'), now)).toBe(true);
    expect(withinWithdrawWindow(undefined, now)).toBe(false);
    expect(withinWithdrawWindow('', now)).toBe(false);
    expect(withinWithdrawWindow('not-a-date', now)).toBe(false);
  });
});
