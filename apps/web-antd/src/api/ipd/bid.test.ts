/**
 * 招标域 R215 GAP-F1 契约测试（BidController modify / admin-assign 两端点）。
 *
 * 重点覆盖（准备包 gap-f1-f6-change-plans.md §F1 用例清单）：
 * - modifyBidInvitation：PUT /bid-invitations/{id}/modify，query 逐值内联（@RequestParam 非 body）；
 * - 省略字段不拼 query；expireAt 空格 → %20；
 * - adminAssignBidInvitation：targetPersonId 19 位雪花逐字符无损（禁 Number）；
 * - id 路径编码防注入；
 * - 权限/包络负例 → IpdRequestError 不吞错。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { adminAssignBidInvitation, modifyBidInvitation } from './bid';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const bidFixture = {
  id: '9', projectId: null, mode: 'PUBLIC', targetPersonId: null,
  title: '新标题', content: null, expireAt: '2026-10-01 23:59:59',
  status: 'OPEN', selectedResponseId: null, createBy: '9007199254740993', createTime: '2026-09-20 10:00:00',
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('招标单修改与超管指派（R215 GAP-F1 · BidController P2-3.3）', () => {
  it('modifyBidInvitation(9,{title}) → PUT …/modify?title=…，省略字段不拼 query、无 body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(bidFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await modifyBidInvitation('9', { title: '新标题' });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/bid-invitations/9/modify?title=%E6%96%B0%E6%A0%87%E9%A2%98');
    expect(call[1]?.method).toBe('PUT');
    expect(call[1]?.body ?? undefined).toBeUndefined();
    expect(r.id).toBe('9');
  });

  it('expireAt 含空格 → %20 分隔串原样送达（后端 pattern yyyy-MM-dd HH:mm:ss，禁 T/Z）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(bidFixture));
    vi.stubGlobal('fetch', fetcher);
    await modifyBidInvitation('9', { expireAt: '2026-10-01 23:59:59', title: 't' });
    const url = String(fetcher.mock.calls[0]![0]);
    expect(url).toContain('expireAt=2026-10-01%2023%3A59%3A59');
    expect(url).toContain('title=t');
    expect(url).not.toContain('+');
  });

  it('全空 body → 端点无 query 段（三参数全 required=false）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(bidFixture));
    vi.stubGlobal('fetch', fetcher);
    await modifyBidInvitation('9', {});
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/bid-invitations/9/modify');
  });

  it('adminAssignBidInvitation → targetPersonId 19 位雪花逐字符无损（string 透传禁 Number）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ ...bidFixture, status: 'SELECTED' }));
    vi.stubGlobal('fetch', fetcher);
    await adminAssignBidInvitation('2096266884247736300', '2096266884247736321');
    expect(fetcher.mock.calls[0]![0]).toBe(
      '/api/v1/bid-invitations/2096266884247736300/admin-assign?targetPersonId=2096266884247736321',
    );
    // 精度边界哨兵：若曾走 Number() 会塌缩为 …000，逐字符断言防回潮
    expect(String(fetcher.mock.calls[0]![0]).includes('247736321')).toBe(true);
  });

  it('id 路径编码防注入（"../" → ..%2F）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(bidFixture));
    vi.stubGlobal('fetch', fetcher);
    await modifyBidInvitation('../', { title: 'x' });
    expect(String(fetcher.mock.calls[0]![0]).startsWith('/api/v1/bid-invitations/..%2F/modify?')).toBe(true);
  });

  it('权限负例：非发起人 modify 403/30001 → IpdRequestError 透传', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 403, 30001)));
    const cause = await modifyBidInvitation('9', { title: 'x' }).catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });

  it('包络负例：code=50002 状态冲突（挂起不足 30 日 / 非 EXPIRED）→ 抛 IpdRequestError 不吞错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 409, 50002)));
    await expect(adminAssignBidInvitation('9', '123')).rejects.toMatchObject({
      code: 50002,
      status: 409,
    });
  });
});
