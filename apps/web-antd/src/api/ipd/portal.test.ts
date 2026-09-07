import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPortalDemandByCode, fetchPortalProducts, submitPortalDemand } from './portal';

const jsonResponse = (data: unknown, status = 200, code = 0) =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'ok' : '请求不合法', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('portal api（游客免登录封装）', () => {
  it('提交：POST /api/v1/public/demands，不携带 Authorization，返回 8 位查询码', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ code: 'AB12CD34', status: 'SUBMITTED' }));
    vi.stubGlobal('fetch', fetcher);
    const result = await submitPortalDemand({
      contact: '13800000000',
      customerName: '某某公司',
      feedbackPerson: '张三',
      functionalRequirement: '希望支持批量导出报表功能',
      productId: null,
      rawModel: 'ZZZ-999',
      website: '',
    });
    expect(result).toEqual({ code: 'AB12CD34', status: 'SUBMITTED' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/public/demands');
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toMatchObject({ customerName: '某某公司', website: '' });
  });

  it('提交：响应查询码不满足 ^[A-Z0-9]{8}$ 时判为响应异常，不误报成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'short', status: 'SUBMITTED' })));
    await expect(submitPortalDemand({
      customerName: '某某公司', feedbackPerson: '张三', functionalRequirement: '希望支持批量导出报表功能',
      productId: null, rawModel: null,
    })).rejects.toThrow('服务响应格式异常');
  });

  it('已登记业务码映射为固定中文文案：40011 限流', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, 429, 40011)));
    await expect(submitPortalDemand({
      customerName: '某某公司', feedbackPerson: '张三', functionalRequirement: '希望支持批量导出报表功能',
      productId: null, rawModel: null,
    })).rejects.toThrow('请求过于频繁，请稍后再试');
  });

  it('未登记业务码不透传服务端任意字符串，回落通用文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 99999, message: 'SQL debug details', data: null }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
    ));
    await expect(fetchPortalProducts()).rejects.toThrow('服务暂时不可用，请稍后重试');
  });

  it('非 JSON 响应判为服务不可用；传输失败判为断网文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('<html>gateway</html>'))
      .mockRejectedValueOnce(new TypeError('network unavailable')));
    await expect(fetchPortalProducts()).rejects.toThrow('服务暂时不可用，请稍后重试');
    await expect(fetchPortalProducts()).rejects.toThrow('无法连接服务，请检查网络后重试');
  });

  it('产品列表：GET /api/v1/public/products，过滤畸形条目并派生 listingStatus 兜底', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse([
      { id: '101', productName: 'ZK-X100', modelCode: 'ZK-X100', status: 'ACTIVE', listingStatus: 'ON_SALE' },
      { id: 102, productName: '在研产品A', modelCode: null, status: 'ACTIVE', listingStatus: 'IN_DEV' },
      { id: '103' },
      'junk',
    ]));
    vi.stubGlobal('fetch', fetcher);
    const products = await fetchPortalProducts();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/public/products');
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ id: '101', listingStatus: 'ON_SALE' });
    expect(products[1]).toMatchObject({ id: '102', listingStatus: 'IN_DEV' });
  });

  it('进度查询：GET /api/v1/public/demands/:code，宽松解析脱敏视图', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      code: 'AB12CD34',
      status: 'ACCEPTED',
      customerName: '某某**公司',
      timeline: [
        { stage: 'SUBMITTED', occurredAt: '2026-09-05T02:00:00Z' },
        { stage: 'ACCEPTED', occurredAt: '2026-09-05T03:00:00Z', memo: '已进入受理队列' },
        { stage: '' },
        'junk',
      ],
      attachments: [{ fileName: 'specs.pdf', fileSize: '1.2MB' }, { fileName: '' }],
      canSupplement: false,
      canWithdraw: false,
      withdrawDeadlineAt: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const trace = await fetchPortalDemandByCode('AB12CD34');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/public/demands/AB12CD34');
    expect(trace.status).toBe('ACCEPTED');
    expect(trace.timeline).toHaveLength(2);
    expect(trace.attachments).toEqual([{ fileName: 'specs.pdf', fileSize: '1.2MB' }]);
  });

  it('进度查询：缺 code/status 的畸形响应判为响应异常', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ timeline: [] })));
    await expect(fetchPortalDemandByCode('AB12CD34')).rejects.toThrow('服务响应格式异常');
  });
});

describe('portal api（探针真值兼容）', () => {
  it('产品列表裸数组响应：直接按数组解析，不要求包络', async () => {
    const raw = [
      { id: '1', productName: 'A', modelCode: 'A-1', status: 'ACTIVE', listingStatus: 'ON_SALE' },
      { id: '2', productName: 'B', modelCode: null, status: 'ACTIVE', listingStatus: 'IN_DEV' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(raw), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    const products = await fetchPortalProducts();
    expect(products).toHaveLength(2);
    expect(products[0]!.id).toBe('1');
  });

  it('未匹配路由：HTTP200 + envelope.code=404 + message=null → 友好文案而非格式异常', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 404, message: null, data: null, timestamp: '2026-09-05T00:00:00Z', traceId: 'fix' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    await expect(fetchPortalDemandByCode('AB12CD34')).rejects.toThrow('未查询到对应的资源，请稍后再试');
  });

  it('合法响应允许 message=null：仅校验 code=0 与 data 存在', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: null, data: { code: 'AB12CD34', status: 'SUBMITTED' }, timestamp: '2026-09-05T00:00:00Z', traceId: 'ok' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    const result = await submitPortalDemand({
      customerName: '某某公司', feedbackPerson: '张三', functionalRequirement: '希望支持批量导出报表功能',
      productId: null, rawModel: null,
    });
    expect(result.code).toBe('AB12CD34');
  });
});
