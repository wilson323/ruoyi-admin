/**
 * 站内通知 API 契约测试：收件箱/未读数 GET + 单条/全部已读 POST 的路径与查询串。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notification';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('notification API contract', () => {
  it('GET /notifications 默认全量，unreadOnly 透传查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope([{ id: '1', kind: 'ACTION', title: 'Gate 评审待处理' }]),
    );
    vi.stubGlobal('fetch', fetcher);
    const list = await listNotifications(true);
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/notifications');
    expect(url.searchParams.get('unreadOnly')).toBe('true');
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('Gate 评审待处理');
  });

  it('GET /notifications/unread-count 解包 count（含后端字符串数字形态）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ count: '3' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchUnreadCount()).toBe(3);
    expect(new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local').pathname).toBe(
      '/api/v1/notifications/unread-count',
    );
  });

  it('POST /notifications/{id}/read 单条已读', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: '1', deliveryStatus: 'SENT' }));
    vi.stubGlobal('fetch', fetcher);
    await markNotificationRead('1');
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/notifications/1/read');
    expect(init.method).toBe('POST');
  });

  it('POST /notifications/read-all 解包 updated 计数（含后端字符串数字形态）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ updated: '5' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await markAllNotificationsRead()).toBe(5);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/notifications/read-all');
  });
});
