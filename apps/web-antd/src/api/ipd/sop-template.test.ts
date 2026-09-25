/**
 * SOP 模板域契约测试（R215 GAP-F8；SopTemplateController 实有 9 端点，本卡接 8：
 * 版本链 7 函数前批已交付（此处冒烟锁定 URL 口径）+ 本轮新增 instances 快照读口；
 * instantiate 归 GAP-B2 等 owner 拍板，本卡不接，不写其用例防误导）。
 *
 * 重点覆盖（准备包 gap-f7-f11-change-plans.md §F8 用例清单，裁掉 instantiate 项）：
 * - listSopTemplateInstances：GET /sop-templates/instances?projectId=（query URL 内联模板拼串）；
 * - 19 位雪花 projectId 逐字符无损（hr-sync.test.ts:86-87 同款断言样板，禁 Number 化）；
 * - projectId 空串 → api 层显式拒绝、fetch 零调用（准备包「不发请求 / PARAM_INVALID」二选一，锁定前者）；
 * - 实例行归一：id/templateId/projectId/instanceVersion 四 Long 字段 string 透传、
 *   instantiatedAt（Date→ISO 串）/instantiatedBy 原样、snapshotJson 原样透传不 parse
 *   （非法 JSON 的展示兜底在视图层）、未知 status 值域外不炸；
 * - 负例：非项目成员 → 403/30001（service listInstancesByProject :422 IDOR fail-closed）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { currentSopTemplate, listSopTemplateInstances, listSopTemplates } from './sop-template';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/**
 * SopTemplateInstance 双形态夹具（BigNumberSerializer 双形态：安全区间 number / 超范围 string）：
 * 行 a 常规 number 形态（含后端下发但前端不建模的 delFlag/tenantId，锁定归一形状不含它们）；
 * 行 b 19 位雪花 string 形态 + 未知 status + 非法 JSON 快照串 + null 时间戳。
 */
const instanceFixture = [
  {
    id: 8801,
    templateId: 7712,
    instanceVersion: 3,
    projectId: 2096,
    snapshotJson: '{"actionList":["A1","A2"],"deadlineMap":{}}',
    instantiatedAt: '2026-09-20T06:30:00.000+00:00',
    instantiatedBy: '900101',
    status: 'ACTIVE',
    delFlag: '0',
    tenantId: 'T1',
  },
  {
    id: '2096266884247736321',
    templateId: '2096266884054798338',
    instanceVersion: '12',
    projectId: '2096266883900000001',
    snapshotJson: 'not-a-json{{{',
    instantiatedAt: null,
    instantiatedBy: null,
    status: 'FOO',
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

describe('SOP 模板实例快照（R215 GAP-F8 · SopTemplateController#listInstances）', () => {
  it("listSopTemplateInstances('2096266884247736321') → GET /sop-templates/instances?projectId= 19 位雪花逐字符无损", async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(instanceFixture));
    vi.stubGlobal('fetch', fetcher);
    await listSopTemplateInstances('2096266884247736321');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/sop-templates/instances?projectId=2096266884247736321');
    expect(call[1]?.method ?? 'GET').toBe('GET');
  });

  it('projectId 空串/空白 → api 层显式拒绝，fetch 零调用（@RequestParam 必填，不发必 400 的请求）', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(listSopTemplateInstances('')).rejects.toThrow(/projectId 必填/);
    await expect(listSopTemplateInstances('   ')).rejects.toThrow(/projectId 必填/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('projectId 含特殊字符 → encodeURIComponent 防注入', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listSopTemplateInstances('a/b');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/sop-templates/instances?projectId=a%2Fb');
  });

  it('行归一：四 Long 字段 string 透传（19 位雪花逐字符）、Date/Person 串原样、非法 JSON 快照不 parse 不抛、未知 status 不炸', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(instanceFixture));
    vi.stubGlobal('fetch', fetcher);
    const [a, b] = await listSopTemplateInstances('2096266883900000001');
    // 行 a：安全区间 number 形态 ID → 归一为 string（展示与 key 无歧义）
    expect(a!.id).toBe('8801');
    expect(a!.instanceVersion).toBe('3');
    expect(a!.projectId).toBe('2096');
    expect(a!.instantiatedAt).toBe('2026-09-20T06:30:00.000+00:00'); // Date→ISO 串原样透传，禁日期运算
    expect(a!.instantiatedBy).toBe('900101');
    expect(a!.status).toBe('ACTIVE');
    // snapshotJson 合法 JSON 也仅原样透传（pretty 展开归视图层）
    expect(a!.snapshotJson).toBe('{"actionList":["A1","A2"],"deadlineMap":{}}');
    // 行 b：19 位雪花 string 形态必须逐字符无损——Number() 会丢精度
    expect(b!.id).toBe('2096266884247736321');
    expect(b!.templateId).toBe('2096266884054798338');
    expect(b!.projectId).toBe('2096266883900000001');
    expect(b!.status).toBe('FOO'); // 未知枚举值原样透传不炸列表
    expect(b!.snapshotJson).toBe('not-a-json{{{'); // 非法 JSON 原样透传不抛（Drawer 兜底原文）
    expect(b!.instantiatedAt).toBeNull();
    expect(b!.instantiatedBy).toBeNull();
    // 归一形状锁定：ID 类恒 string；后端下发的 delFlag/tenantId 不进前端模型
    expect(typeof b!.id).toBe('string');
    expect(b).toStrictEqual({
      id: '2096266884247736321',
      instanceVersion: '12',
      instantiatedAt: null,
      instantiatedBy: null,
      projectId: '2096266883900000001',
      snapshotJson: 'not-a-json{{{',
      status: 'FOO',
      templateId: '2096266884054798338',
    });
  });

  it('data 非数组（null/对象）→ 守卫归空列表不抛', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(envelope(null)).mockResolvedValueOnce(envelope({ rows: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(listSopTemplateInstances('2096')).resolves.toStrictEqual([]);
    await expect(listSopTemplateInstances('2096')).resolves.toStrictEqual([]);
  });

  it('负例：非项目成员/跨租户 → 403/30001（service :422 IDOR fail-closed）抛 IpdRequestError 不吞错', async () => {
    const denied = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', denied);
    const cause = await listSopTemplateInstances('2096266883900000001').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
  });
});

describe('SOP 模板版本链冒烟（前批交付 7 函数，URL 口径回归锁定）', () => {
  it('listSopTemplates → GET /sop-templates?actionCode=；currentSopTemplate → GET /sop-templates/current?actionCode=', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(envelope([{ id: 8801, actionCode: 'M1-立项', contentLen: 120, status: 'PUBLISHED', title: '立项 SOP', version: 3 }]))
      .mockResolvedValueOnce(envelope({ id: 8801, actionCode: 'M1-立项', contentLen: 120, status: 'PUBLISHED', title: '立项 SOP', version: 3, content: '正文' }));
    vi.stubGlobal('fetch', fetcher);
    await listSopTemplates('M1-立项');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/sop-templates?actionCode=M1-%E7%AB%8B%E9%A1%B9');
    await currentSopTemplate('M1-立项');
    expect(fetcher.mock.calls[1]![0]).toBe('/api/v1/sop-templates/current?actionCode=M1-%E7%AB%8B%E9%A1%B9');
  });
});
