/**
 * 招标域 R215 GAP-F1/F2/F9 契约测试（F1：BidController modify / admin-assign 两端点；
 * F2：BidP231Controller 校验型创建 POST /bid-invitations/p231-create + 旧口保留哨兵；
 * F9：GET /bid-responses/by-rd-pm/{rdPmId} 我的应标分页，见文末 describe）。
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
import { adminAssignBidInvitation, createBidInvitation, createBidInvitationP231, listBidResponsesByRdPm, modifyBidInvitation } from './bid';

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

describe('招标单校验型创建（R215 GAP-F2 · BidP231Controller POST /bid-invitations/p231-create）', () => {
  const p231Fixture = {
    id: '2096266884247736399', projectId: '2096266884247736321', mode: 'ONE_TO_ONE',
    targetPersonId: '9007199254740993', title: '校验型创建', content: '客户问题与核心功能',
    expireAt: '2026-12-31 23:59:59', status: 'OPEN', selectedResponseId: null,
    createBy: '9007199254740991', createTime: '2026-09-25 10:00:00',
  };

  it('POST 打到 /bid-invitations/p231-create；body projectId/targetPersonId 19 位雪花逐字符无损 string 透传（禁 Number）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(p231Fixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await createBidInvitationP231({
      content: '客户问题与核心功能',
      expireAt: '2026-12-31 23:59:59',
      mode: 'ONE_TO_ONE',
      projectId: '2096266884247736321',
      targetPersonId: '2096266884247736322',
      title: '校验型创建',
    });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/bid-invitations/p231-create');
    expect(call[1]?.method).toBe('POST');
    const body = JSON.parse(String(call[1]?.body));
    // 精度边界哨兵（hr-sync.test.ts:86-87 同款）：若曾走 Number() 会塌缩为 …300/…320
    expect(body.projectId).toBe('2096266884247736321');
    expect(typeof body.projectId).toBe('string');
    expect(body.targetPersonId).toBe('2096266884247736322');
    expect(body.expireAt).toBe('2026-12-31 23:59:59');
    expect(r.status).toBe('OPEN');
  });

  it('PUBLIC 模式整键省略 targetPersonId（后端 BidP231Validator 对 PUBLIC 拒填，null 亦拒）；选填字段未填不塞键', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ ...p231Fixture, mode: 'PUBLIC', targetPersonId: null }));
    vi.stubGlobal('fetch', fetcher);
    await createBidInvitationP231({
      expireAt: '2026-12-31 23:59:59',
      mode: 'PUBLIC',
      projectId: '2096266884247736321',
      title: '公开征集',
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect('targetPersonId' in body).toBe(false);
    expect('requiredLevel' in body).toBe(false);
    expect('slaDays' in body).toBe(false);
  });

  it('PUBLIC 选填扩展：requiredLevel=L3 / slaDays=7 原样送达（slaDays 计数允许 number）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(p231Fixture));
    vi.stubGlobal('fetch', fetcher);
    await createBidInvitationP231({
      expireAt: '2026-12-31 23:59:59',
      mode: 'PUBLIC',
      projectId: '2096266884247736321',
      requiredLevel: 'L3',
      slaDays: 7,
      title: '公开征集',
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(body.requiredLevel).toBe('L3');
    expect(body.slaDays).toBe(7);
  });

  it('权限负例：非项目创建人 403/30001 → IpdRequestError 透传', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 403, 30001)));
    const cause = await createBidInvitationP231({
      expireAt: '2026-12-31 23:59:59', mode: 'PUBLIC', projectId: '9', title: 't',
    }).catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });

  it('包络负例：mode/expiry 参数拒 400/10001 → 抛 IpdRequestError 不吞错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 400, 10001)));
    await expect(
      createBidInvitationP231({ expireAt: '2020-01-01 00:00:00', mode: 'PUBLIC', projectId: '9', title: 't' }),
    ).rejects.toMatchObject({ code: 10001, status: 400 });
  });

  it('旧口保留哨兵：createBidInvitation 仍打 POST /bid-invitations（保留一个迭代，视图已不消费）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(p231Fixture));
    vi.stubGlobal('fetch', fetcher);
    await createBidInvitation({
      content: 'c', expireAt: '2026-12-31 23:59:59', mode: 'ONE_TO_ONE', targetPersonId: '9', title: 't',
    });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/bid-invitations');
    expect(fetcher.mock.calls[0]![1]?.method).toBe('POST');
  });
});

/**
 * R215 GAP-F9「我的应标」（BidController#listByRdPm，@GetMapping :170 + ipd:project:query :169）。
 * 用例清单来自 gap-f7-f11-change-plans.md §F9；IDOR 三分支（本人/超管/在职项目成员）服务端
 * 会话推导，前端仅锁定「不拼绕过参数、path/query 形态正确、IPage 归一」。
 */
const responseRow = (over: Record<string, unknown> = {}) => ({
  id: '9001', invitationId: '11', rdPmId: '900101', status: 'PENDING',
  responseNote: '方案A：40-500字应标说明', respondedAt: '2026-09-20 10:00:00',
  createBy: '900101', createTime: '2026-09-20 10:00:00', ...over,
});

describe('研发PM 我的应标分页（R215 GAP-F9 · BidController#listByRdPm）', () => {
  it('listBidResponsesByRdPm(19位雪花) → GET path 逐字符无损（string 透传禁 Number）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ records: [], total: 0, size: 20, current: 1, pages: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await listBidResponsesByRdPm('2096266884247736321');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/bid-responses/by-rd-pm/2096266884247736321');
    // 精度边界哨兵：若曾走 Number() 会塌缩为 …000
    expect(String(fetcher.mock.calls[0]![0]).includes('247736321')).toBe(true);
  });

  it('params {pageNo:2,pageSize:50} → ?pageNo=2&pageSize=50；缺省不拼空 query', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ records: [], total: 0, size: 50, current: 2, pages: 1 }));
    vi.stubGlobal('fetch', fetcher);
    await listBidResponsesByRdPm('7', { pageNo: 2, pageSize: 50 });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/bid-responses/by-rd-pm/7?pageNo=2&pageSize=50');
    const plain = vi.fn().mockResolvedValue(envelope({ records: [], total: 0, size: 20, current: 1, pages: 0 }));
    vi.stubGlobal('fetch', plain);
    await listBidResponsesByRdPm('7');
    expect(plain.mock.calls[0]![0]).toBe('/api/v1/bid-responses/by-rd-pm/7');
  });

  it('IPage 包络归一：records[].id/invitationId/rdPmId string（number 下发形态也 String() 归一）、total/pages/size/current Number', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      records: [responseRow(), responseRow({ id: '2096266884247736321', invitationId: '2096266884247736322', rdPmId: '2096266884247736323', status: 'ACCEPTED' })],
      total: '2', size: '20', current: '1', pages: '1',
    }));
    vi.stubGlobal('fetch', fetcher);
    const page = await listBidResponsesByRdPm('900101');
    expect(page.total).toBe(2);
    expect(typeof page.total).toBe('number');
    expect(typeof page.size).toBe('number');
    expect(typeof page.current).toBe('number');
    expect(typeof page.pages).toBe('number');
    // 19 位雪花三 ID 逐字符无损（BigNumberSerializer string 下发形态）
    expect(page.records[1]!.id).toBe('2096266884247736321');
    expect(page.records[1]!.invitationId).toBe('2096266884247736322');
    expect(page.records[1]!.rdPmId).toBe('2096266884247736323');
    expect(typeof page.records[1]!.id).toBe('string');
    wrapperNumberGuard(page.records[1]!.id);
  });

  it('rdPmId 含特殊字符 → encodeURIComponent 防路径注入', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ records: [], total: 0, size: 20, current: 1, pages: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await listBidResponsesByRdPm('a/b');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/bid-responses/by-rd-pm/a%2Fb');
  });

  it('负例：非本人且非超管非成员 → 403/30001（IDOR 三分支拒）抛 IpdRequestError 不吞错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 403, 30001)));
    const cause = await listBidResponsesByRdPm('900101').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });
});

/** 精度哨兵：19 位雪花 ID 若被数值化必丢末位精度（Number.MAX_SAFE_INTEGER 边界）。 */
function wrapperNumberGuard(id: string): void {
  expect(Number.isSafeInteger(Number(id))).toBe(false);
  expect(String(Number(id))).not.toBe(id); // 证明该值绝不能走 Number 路径
}
