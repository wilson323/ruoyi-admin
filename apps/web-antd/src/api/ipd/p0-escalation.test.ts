/**
 * P0 升级链契约测试（R215 GAP-F4；P0EscalationController 3 端点）。
 *
 * 重点覆盖（准备包 §F4 用例清单）：
 * - listEscalationChains()：GET /p0/escalation-chain 不拼 query；(projectId) → ?projectId=<string 逐字符>；
 * - 行归一：id/projectId/p0EventId 19 位雪花无损 string；escalationCount Number()；status 原样；
 * - checkEscalation() → POST /p0/escalation-chain/check，{escalated} int 归一透传；
 * - resolveEscalationChain('2096…','已闭环') → POST …/resolve?remark=<URL 编码> 且无 body；
 * - 负例：普通成员 list 403/30001；非超管 check 403（后端 :60 requireAdmin）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { checkEscalation, listEscalationChains, resolveEscalationChain } from './p0-escalation';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/**
 * 双形态夹具：行 a 安全区间 number 形态（BigNumberSerializer 直出 number），
 * 行 b live 实测 19 位雪花 string 形态（超 2^53 恒 string 下发）。
 */
const chainFixture = [
  {
    id: 91001,
    projectId: 42,
    p0EventId: 77001,
    escalationCount: 2,
    lastEscalationAt: '2026-09-20 10:00:00',
    nextThresholdAt: '2026-09-27 10:00:00',
    status: 'ESCALATED',
    remark: '连续两次未升级，已通知双方组长',
  },
  {
    id: '2096266884247736321',
    projectId: '2096266884054798338',
    p0EventId: '2096266883998441472',
    escalationCount: '1',
    lastEscalationAt: null,
    nextThresholdAt: null,
    status: 'PENDING',
    remark: null,
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P0 升级链 API（R215 GAP-F4 · P0EscalationController）', () => {
  it('listEscalationChains() → GET /p0/escalation-chain 不拼 query', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(chainFixture));
    vi.stubGlobal('fetch', fetcher);
    const rows = await listEscalationChains();
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/p0/escalation-chain');
    expect(fetcher.mock.calls[0]![1]?.method ?? 'GET').toBe('GET');
    expect(rows).toHaveLength(2);
  });

  it('listEscalationChains(projectId) → ?projectId= 19 位雪花 string 逐字符透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listEscalationChains('2096266884054798338');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/p0/escalation-chain?projectId=2096266884054798338');
  });

  it('listEscalationChains(\'\') 空串不拼 query（与 undefined 同义）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listEscalationChains('');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/p0/escalation-chain');
  });

  it('行归一：三 ID string 透传（19 位雪花逐字符无损，防 Number() 塌缩回潮）、escalationCount Number、status 原样', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(chainFixture));
    vi.stubGlobal('fetch', fetcher);
    const [a, b] = await listEscalationChains();
    // 行 a：安全区间 number 形态 → 归一 string（展示与 key 无歧义）
    expect(a!.id).toBe('91001');
    expect(a!.projectId).toBe('42');
    expect(a!.escalationCount).toBe(2);
    expect(a!.status).toBe('ESCALATED');
    // 行 b：19 位雪花大 ID（string 下发）必须逐字符无损透传——Number() 会丢精度塌缩为 …000
    expect(b!.id).toBe('2096266884247736321');
    expect(b!.projectId).toBe('2096266884054798338');
    expect(b!.p0EventId).toBe('2096266883998441472');
    expect(b!.escalationCount).toBe(1); // string 形态 Integer → Number 归一
    expect(b!.status).toBe('PENDING');
    expect(b!.lastEscalationAt).toBeNull();
    expect(b!.remark).toBeNull();
    // 精度边界类型断言：ID 类必须 string、计数类必须 number
    expect(typeof b!.id).toBe('string');
    expect(typeof b!.escalationCount).toBe('number');
  });

  it('checkEscalation() → POST /p0/escalation-chain/check 无 body，{escalated} int 归一透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ escalated: 3 }));
    vi.stubGlobal('fetch', fetcher);
    const r = await checkEscalation();
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/p0/escalation-chain/check');
    expect(fetcher.mock.calls[0]![1]?.method).toBe('POST');
    expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined(); // 无 body 端点
    expect(r.escalated).toBe(3);
    // string 形态计数归一（BigNumberSerializer 只处理 Long，int 直出 number；双形态兜底）
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope({ escalated: '2' })));
    const r2 = await checkEscalation();
    expect(r2.escalated).toBe(2);
  });

  it('resolveEscalationChain(19 位 id, 已闭环) → POST …/resolve?remark=<URL 编码> 且无 body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: '2096266884247736321', resolved: true }));
    vi.stubGlobal('fetch', fetcher);
    const r = await resolveEscalationChain('2096266884247736321', '已闭环');
    // remark @RequestParam query（后端无 body 形参）；中文经 URLSearchParams UTF-8 百分号编码
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/p0/escalation-chain/2096266884247736321/resolve?remark=%E5%B7%B2%E9%97%AD%E7%8E%AF');
    expect(fetcher.mock.calls[0]![1]?.method).toBe('POST');
    expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined(); // remark 禁放 JSON body（会被后端静默忽略）
    expect(r.id).toBe('2096266884247736321');
    expect(r.resolved).toBe(true);
  });

  it('resolveEscalationChain 省略 remark → 不拼 query；resolved 严格 === true 归一', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 91001, resolved: true }));
    vi.stubGlobal('fetch', fetcher);
    await resolveEscalationChain('91001');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/p0/escalation-chain/91001/resolve');
    // 非 true truthy（"true" 字符串）不得判成已处置——=== true 严格归一
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope({ id: 91001, resolved: 'true' })));
    const r2 = await resolveEscalationChain('91001');
    expect(r2.resolved).toBe(false);
  });

  it('负例：普通成员 list 403/30001 → IpdRequestError 透传不吞错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 403, 30001)));
    const cause = await listEscalationChains().catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });

  it('负例：非超管 check 403（后端 :60 requireAdmin 仅超管，组长同拒）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 403, 30001)));
    const cause = await checkEscalation().catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    await expect(resolveEscalationChain('1')).rejects.toBeInstanceOf(IpdRequestError);
  });
});
