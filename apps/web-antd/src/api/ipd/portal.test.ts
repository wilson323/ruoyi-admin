import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchPortalDemandByCode,
  fetchPortalProducts,
  submitPortalDemand,
  supplementDemand,
  withdrawDemand,
} from './portal';

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

  it('超时中止（AbortError）判为「请求超时」，不误报断网（2026-09-08 与 requestIpd 同步）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    ));
    await expect(fetchPortalProducts()).rejects.toThrow('请求超时，请稍后重试');
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

describe('portal api（双兼容字段命名 queryCode/initialStatus vs code/status）', () => {
  it('提交：响应使用新契约字段 queryCode/initialStatus 解析成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ queryCode: 'ABC12345', initialStatus: 'SUBMITTED' }),
    ));
    const result = await submitPortalDemand({
      customerName: '某某公司', feedbackPerson: '张三', functionalRequirement: '希望支持批量导出报表功能',
      productId: null, rawModel: null,
    });
    expect(result).toEqual({ code: 'ABC12345', status: 'SUBMITTED' });
  });

  it('提交：响应使用旧契约字段 code/status 解析成功（fallback 兼容未升级后端）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ code: 'ABC12345', status: 'SUBMITTED' }),
    ));
    const result = await submitPortalDemand({
      customerName: '某某公司', feedbackPerson: '张三', functionalRequirement: '希望支持批量导出报表功能',
      productId: null, rawModel: null,
    });
    expect(result).toEqual({ code: 'ABC12345', status: 'SUBMITTED' });
  });

  it('提交：新旧字段同时存在时优先采用新契约 queryCode/initialStatus', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({
        queryCode: 'NEW12345', initialStatus: 'NEW_STATU',
        code: 'OLD12345', status: 'OLD_STATU',
      }),
    ));
    const result = await submitPortalDemand({
      customerName: '某某公司', feedbackPerson: '张三', functionalRequirement: '希望支持批量导出报表功能',
      productId: null, rawModel: null,
    });
    expect(result).toEqual({ code: 'NEW12345', status: 'NEW_STATU' });
  });

  it('提交：新旧字段都缺失时判为响应异常（不误报成功）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ something: 'else' })));
    await expect(submitPortalDemand({
      customerName: '某某公司', feedbackPerson: '张三', functionalRequirement: '希望支持批量导出报表功能',
      productId: null, rawModel: null,
    })).rejects.toThrow('服务响应格式异常');
  });
});

describe('portal api（R3 补登契约 GuestDemandUpdateReq/SUPPLEMENT）', () => {
  it('补登：POST /api/v1/public/demands/:code/supplement，body 逐字段 = action=SUPPLEMENT/functionalRequirement/contact', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      code: 'AB12CD34',
      status: 'SUBMITTED',
      customerName: '某某**公司',
      timeline: [{ stage: 'SUBMITTED', occurredAt: '2026-09-05T02:00:00Z' }],
      attachments: [],
      canSupplement: true,
      canWithdraw: true,
      withdrawDeadlineAt: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const trace = await supplementDemand('AB12CD34', {
      contact: '13800000000',
      functionalRequirement: '希望增加批量导出报表功能',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/public/demands/AB12CD34/supplement');
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.action).toBe('SUPPLEMENT');
    expect(body.functionalRequirement).toBe('希望增加批量导出报表功能');
    expect(body.contact).toBe('13800000000');
    // 字段名白名单：仅 action/functionalRequirement/contact，禁自造字段
    expect(Object.keys(body).sort()).toEqual(['action', 'contact', 'functionalRequirement']);
    // 返回包络 {code:0,message,data:GuestDemandView} 解析为脱敏进度视图
    expect(trace).toEqual({
      attachments: [],
      canSupplement: true,
      canWithdraw: true,
      code: 'AB12CD34',
      customerName: '某某**公司',
      status: 'SUBMITTED',
      timeline: [{ memo: undefined, occurredAt: '2026-09-05T02:00:00Z', stage: 'SUBMITTED' }],
      withdrawDeadlineAt: null,
    });
  });

  it('补登失败：50002 受理后锁定（HTTP 409）→ portal 域中文文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, 409, 50002)));
    await expect(supplementDemand('AB12CD34', {
      contact: '13800000000',
      functionalRequirement: '希望增加批量导出报表功能',
    })).rejects.toThrow('当前状态不支持该操作，请稍后重试');
  });
});

describe('portal api（R3 撤回契约 GuestDemandUpdateReq/WITHDRAW）', () => {
  it('撤回：POST /api/v1/public/demands/:code/withdraw，body 必带 action=WITHDRAW（非空对象、无多余字段）', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      code: 'AB12CD34',
      status: 'WITHDRAWN',
      customerName: '某某**公司',
      timeline: [{ stage: 'WITHDRAWN', occurredAt: '2026-09-05T04:00:00Z' }],
      attachments: [],
      canSupplement: false,
      canWithdraw: false,
      withdrawDeadlineAt: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const trace = await withdrawDemand('AB12CD34');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/public/demands/AB12CD34/withdraw');
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    // 后端 GuestDemandUpdateReq 校验：缺 body/空对象/错配 action 统一 10001，body 必须带 action=WITHDRAW
    expect(typeof init.body).toBe('string');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ action: 'WITHDRAW' });
    expect(Object.keys(body)).toEqual(['action']);
    // 返回包络 data=GuestDemandView 解析为脱敏进度视图（撤回后入口锁定）
    expect(trace).toEqual({
      attachments: [],
      canSupplement: false,
      canWithdraw: false,
      code: 'AB12CD34',
      customerName: '某某**公司',
      status: 'WITHDRAWN',
      timeline: [{ memo: undefined, occurredAt: '2026-09-05T04:00:00Z', stage: 'WITHDRAWN' }],
      withdrawDeadlineAt: null,
    });
  });

  it('撤回失败：50001 查询码不存在（HTTP 404）→ portal 域中文文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, 404, 50001)));
    await expect(withdrawDemand('ZZZZZZZZ')).rejects.toThrow('未查询到对应的需求，请核对查询码');
  });

  it('补登/撤回同源业务码：10001 参数非法 → 通用文案；40011 限流 → 限流文案', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse(null, 400, 10001))
      .mockResolvedValueOnce(jsonResponse(null, 429, 40011)));
    await expect(supplementDemand('AB12CD34', {
      contact: '13800000000',
      functionalRequirement: 'x'.repeat(4001),
    })).rejects.toThrow('输入信息不符合要求，请检查后重试');
    await expect(withdrawDemand('AB12CD34')).rejects.toThrow('请求过于频繁，请稍后再试');
  });
});
