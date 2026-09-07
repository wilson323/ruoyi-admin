/**
 * 项目域 API 契约测试（页07/08/09/11/12；后端 ProjectController）。
 *
 * 重点覆盖：
 * - GET /projects 的 { project: { ... } } 嵌套包络兼容（真机 2026-09-07 实证）；
 * - createProject 的白名单 DTO（targetMarkets → JSON、日期透传毫秒、不外漏字段）；
 * - legacyImportProject 的 missingHistoryAck 强制 true 与 markedCodes 解析；
 * - getGateChecklist 的 items 数组过滤与 ok=true 严格判定；
 * - parseTargetMarkets 的容错（无效 JSON → 空数组）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  advanceProjectStage,
  changeProjectStatus,
  createProject,
  getGateChecklist,
  getProject,
  legacyImportProject,
  listProjects,
  parseTargetMarkets,
} from './project';
import { IpdRequestError } from './auth';

const envelope = (data: unknown, status = 200, code = 0) =>
  new Response(
    JSON.stringify({ code, message: code ? '请求不合法' : 'success', data, timestamp: '2026-09-07T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const projectFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '100',
  code: 'P-100',
  name: '智慧园区一体机',
  productId: 'p-001',
  templateType: 'HARDWARE',
  targetMarkets: '["SA","AE"]',
  level: 'S',
  levelCoefficient: '1.20',
  levelCoefficientReason: 'S 级',
  targetSalesAmount: '5000000.00',
  targetChannelCount: 30,
  targetNps: 60,
  targetSceneCount: 5,
  launchDate: 1735660800000,
  currentStage: 'CONCEPT',
  declaredStage: null,
  lifecycleStatus: 'TEAMING',
  source: 'NEW',
  missingHistoryAck: null,
  catchupStatus: null,
  legacyEffectiveAt: null,
  status: 'DRAFT',
  mainGroupId: 'g-1',
  createBy: '9001',
  createTime: '2026-09-01 10:00:00',
  ...overrides,
});

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project API — listProjects 列表', () => {
  it('无 keyword：GET /projects 不带查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([projectFixture()]));
    vi.stubGlobal('fetch', fetcher);
    const list = await listProjects();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: '100', code: 'P-100', name: '智慧园区一体机' });
  });

  it('带 keyword：编码进查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listProjects('智慧');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects?keyword=%E6%99%BA%E6%85%A7');
  });

  it('空 keyword 视为无参数：不带 ?keyword=', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listProjects('');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects');
  });

  it('列表行用 {project:{...}} 嵌套包裹时仍能正确归一化（2026-09-07 真机形态）', async () => {
    const wrapped = { project: projectFixture({ id: '200', code: 'P-200' }) };
    const fetcher = vi.fn().mockResolvedValue(envelope([wrapped, { project: projectFixture({ id: '201' }) }]));
    vi.stubGlobal('fetch', fetcher);
    const list = await listProjects();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: '200', code: 'P-200' });
    expect(list[1]).toMatchObject({ id: '201' });
  });

  it('非数组 data 直接返回空数组，不抛错', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ junk: true }));
    vi.stubGlobal('fetch', fetcher);
    const list = await listProjects();
    expect(list).toEqual([]);
  });

  it('BigDecimal 字段保持字符串（不被强转 number 丢失精度）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([
      projectFixture({ targetSalesAmount: '9999999999999.99', levelCoefficient: '2.40' }),
    ]));
    vi.stubGlobal('fetch', fetcher);
    const [row] = await listProjects();
    expect(row?.targetSalesAmount).toBe('9999999999999.99');
    expect(row?.levelCoefficient).toBe('2.40');
    expect(typeof row?.targetSalesAmount).toBe('string');
  });
});

describe('project API — getProject 单查', () => {
  it('GET /projects/{id}，对 id 做 URL 编码', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(projectFixture({ id: 'a b/c' })));
    vi.stubGlobal('fetch', fetcher);
    const row = await getProject('a b/c');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects/a%20b%2Fc');
    expect(row.id).toBe('a b/c');
  });

  it('单查响应平铺形态（非嵌套）直通归一化', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(projectFixture({ code: 'P-300' })));
    vi.stubGlobal('fetch', fetcher);
    const row = await getProject('300');
    expect(row.code).toBe('P-300');
  });

  it('缺字段时返回空字符串占位 id/name（不抛错）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({}));
    vi.stubGlobal('fetch', fetcher);
    const row = await getProject('x');
    expect(row.id).toBe('');
    expect(row.name).toBe('');
    expect(row.code).toBeNull();
  });
});

describe('project API — createProject 新建', () => {
  it('POST /projects，targetMarkets 数组转 JSON 字符串；日期透传毫秒', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(projectFixture()));
    vi.stubGlobal('fetch', fetcher);
    const created = await createProject({
      launchDate: 1735660800000,
      level: 'S',
      levelCoefficient: 1.2,
      levelCoefficientReason: 'S 级',
      mainGroupId: 'g-1',
      name: '智慧园区一体机',
      productId: 'p-001',
      targetChannelCount: 30,
      targetMarkets: ['SA', 'AE'],
      targetNps: 60,
      targetSalesAmount: 5000000,
      targetSceneCount: 5,
      templateType: 'HARDWARE',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects');
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toEqual({
      name: '智慧园区一体机',
      productId: 'p-001',
      templateType: 'HARDWARE',
      targetMarkets: '["SA","AE"]',
      level: 'S',
      levelCoefficient: 1.2,
      levelCoefficientReason: 'S 级',
      targetSalesAmount: 5000000,
      targetChannelCount: 30,
      targetNps: 60,
      targetSceneCount: 5,
      mainGroupId: 'g-1',
      launchDate: 1735660800000,
      legacyEffectiveAt: undefined,
      declaredStage: undefined,
      missingHistoryAck: undefined,
    });
    expect(created.id).toBe('100');
  });

  it('白名单 DTO：legacyImport 专属字段经 JSON.stringify 后被剔除（undefined 不可序列化）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(projectFixture()));
    vi.stubGlobal('fetch', fetcher);
    await createProject({
      launchDate: null,
      level: 'A',
      levelCoefficient: null,
      levelCoefficientReason: null,
      mainGroupId: 'g-1',
      name: 'A 级探索',
      productId: 'p-002',
      targetChannelCount: 10,
      targetMarkets: [],
      targetNps: 30,
      targetSalesAmount: 100000,
      targetSceneCount: 1,
      templateType: 'SOFTWARE',
    });
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    // missingHistoryAck / declaredStage / legacyEffectiveAt 由 JSON.stringify 丢弃（undefined 不可序列化），
    // 等价于「未发 legacyImport 专属字段 → 不可能被误解析为存量导入请求」。
    expect(Object.keys(body).sort()).toEqual([
      'launchDate', 'level', 'levelCoefficient', 'levelCoefficientReason',
      'mainGroupId', 'name', 'productId', 'targetChannelCount', 'targetMarkets',
      'targetNps', 'targetSalesAmount', 'targetSceneCount', 'templateType',
    ]);
    expect('missingHistoryAck' in body).toBe(false);
    expect('declaredStage' in body).toBe(false);
    expect('legacyEffectiveAt' in body).toBe(false);
  });

  it('创建响应被 {project:{...}} 包裹时仍能解析（与列表一致）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ project: projectFixture({ id: '999' }) }));
    vi.stubGlobal('fetch', fetcher);
    const row = await createProject({
      launchDate: null, level: 'B', levelCoefficient: 1.1, levelCoefficientReason: null,
      mainGroupId: 'g-1', name: 'B', productId: 'p', targetChannelCount: 1,
      targetMarkets: [], targetNps: 1, targetSalesAmount: 1, targetSceneCount: 1,
      templateType: 'SOLUTION',
    });
    expect(row.id).toBe('999');
  });
});

describe('project API — legacyImportProject 存量导入', () => {
  it('强制 missingHistoryAck=true；POST /projects/legacy-import', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      markedCodes: ['OLD-1', 'OLD-2'],
      project: projectFixture({ id: '500', code: 'P-500' }),
    }));
    vi.stubGlobal('fetch', fetcher);
    const result = await legacyImportProject({
      declaredStage: 'VALID',
      legacyEffectiveAt: 1700000000000,
      level: 'S',
      levelCoefficient: 1.2,
      levelCoefficientReason: '历史 S 级',
      mainGroupId: 'g-1',
      missingHistoryAck: true,
      name: '历史存量 A',
      productId: 'p-001',
      targetChannelCount: 20,
      targetMarkets: ['CN'],
      targetNps: 50,
      targetSalesAmount: 3000000,
      targetSceneCount: 4,
      templateType: 'HARDWARE',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects/legacy-import');
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.missingHistoryAck).toBe(true);
    expect(body.declaredStage).toBe('VALID');
    expect(body.legacyEffectiveAt).toBe(1700000000000);
    expect(body.targetMarkets).toBe('["CN"]');
    expect(result.project.id).toBe('500');
    expect(result.markedCodes).toEqual(['OLD-1', 'OLD-2']);
  });

  it('markedCodes 缺失/非数组时降级为空数组，不抛错', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ project: projectFixture() }));
    vi.stubGlobal('fetch', fetcher);
    const result = await legacyImportProject({
      declaredStage: 'PLAN', legacyEffectiveAt: 1700000000000, level: 'A',
      levelCoefficient: null, levelCoefficientReason: null, mainGroupId: 'g-1',
      missingHistoryAck: true, name: 'n', productId: 'p', targetChannelCount: 1,
      targetMarkets: [], targetNps: 1, targetSalesAmount: 1, targetSceneCount: 1,
      templateType: 'SOFTWARE',
    });
    expect(result.markedCodes).toEqual([]);
  });
});

describe('project API — changeProjectStatus 状态流转', () => {
  it('POST /projects/{id}/status，target 走查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(projectFixture({ status: 'TEAMING' })));
    vi.stubGlobal('fetch', fetcher);
    const row = await changeProjectStatus('100', 'TEAMING');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects/100/status?target=TEAMING');
    expect(row.status).toBe('TEAMING');
  });

  it('可传入任意字符串 target（非法迁移由后端拒绝）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(
      projectFixture({ status: 'TEAMING' }),
      400, 10001,
    ));
    vi.stubGlobal('fetch', fetcher);
    await expect(changeProjectStatus('100', 'INVALID_JUMP')).rejects.toBeInstanceOf(IpdRequestError);
  });
});

describe('project API — advanceProjectStage 进入下一阶段', () => {
  it('POST /projects/{id}/advance-stage，无 body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(projectFixture({ currentStage: 'DEV' })));
    vi.stubGlobal('fetch', fetcher);
    const row = await advanceProjectStage('100');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects/100/advance-stage');
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    expect(row.currentStage).toBe('DEV');
  });

  it('门禁失败 400/10001 抛出 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 400, 10001));
    vi.stubGlobal('fetch', fetcher);
    await expect(advanceProjectStage('100')).rejects.toBeInstanceOf(IpdRequestError);
  });
});

describe('project API — getGateChecklist 门禁清单', () => {
  it('不带 stage：GET /projects/{id}/gate-checklist', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      configVersion: 'v3', items: [
        { code: 'TEAM_OK', name: '团队齐备', ok: true, reason: '', stage: 'CONCEPT', status: 'OK' },
        { code: 'BUDGET', name: '预算已审', ok: false, reason: '待补', stage: 'CONCEPT', status: 'PENDING' },
      ], level: 'S', projectId: '100', stage: 'CONCEPT',
    }));
    vi.stubGlobal('fetch', fetcher);
    const view = await getGateChecklist('100');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects/100/gate-checklist');
    expect(view.items).toHaveLength(2);
    expect(view.items[0]).toMatchObject({ code: 'TEAM_OK', ok: true, status: 'OK' });
    expect(view.items[1]).toMatchObject({ code: 'BUDGET', ok: false, reason: '待补' });
  });

  it('带 stage：编码进查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      configVersion: null, items: [], level: null, projectId: '100', stage: 'DEV',
    }));
    vi.stubGlobal('fetch', fetcher);
    await getGateChecklist('100', 'DEV');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/projects/100/gate-checklist?stage=DEV');
  });

  it('items 缺省/非数组时降级为空数组', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      configVersion: null, level: null, projectId: '100', stage: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const view = await getGateChecklist('100');
    expect(view.items).toEqual([]);
  });

  it('items 行畸形（仅部分字段）仍能归一化，缺失字段用空串/null/ok=false 占位', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      configVersion: null, items: [{ code: 'A' }, { code: 'B', ok: true }], level: null, projectId: '100', stage: null,
    }));
    vi.stubGlobal('fetch', fetcher);
    const view = await getGateChecklist('100');
    expect(view.items[0]).toEqual({ code: 'A', name: '', stage: '', status: null, ok: false, reason: '' });
    expect(view.items[1]?.ok).toBe(true);
  });

  it('ok 严格判定：仅 true 才为 true（不为 truthy 字符串）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      configVersion: null, items: [{ code: 'A', ok: 'true', name: 'n', reason: 'r', stage: 'CONCEPT', status: 'OK' }],
      level: null, projectId: '100', stage: 'CONCEPT',
    }));
    vi.stubGlobal('fetch', fetcher);
    const view = await getGateChecklist('100');
    expect(view.items[0]?.ok).toBe(false);
  });
});

describe('project API — parseTargetMarkets 容错', () => {
  it('解析合法 JSON 数组字符串', () => {
    expect(parseTargetMarkets('["SA","AE"]')).toEqual(['SA', 'AE']);
  });

  it('解析对象/null/数字统一降级为空数组', () => {
    expect(parseTargetMarkets('{"a":1}')).toEqual([]);
    expect(parseTargetMarkets('123')).toEqual([]);
  });

  it('空 / null / undefined 视为无市场配置', () => {
    expect(parseTargetMarkets(null)).toEqual([]);
    expect(parseTargetMarkets(undefined)).toEqual([]);
    expect(parseTargetMarkets('')).toEqual([]);
  });

  it('非字符串 JSON（例如对象）也走 JSON.parse 路径', () => {
    // 真实场景下后端可能直接传对象，但 toRecord 之后 raw 仍可能是 string;
    // 直接传对象会被 JSON.parse 接受并降级（Array.isArray=false）。
    expect(parseTargetMarkets('"SA"')).toEqual([]);
  });

  it('非法 JSON 不抛错，返回空数组', () => {
    expect(parseTargetMarkets('[SA,AE')).toEqual([]);
    expect(parseTargetMarkets('not-json{')).toEqual([]);
  });
});

describe('project API — 错误传播', () => {
  it('HTTP 500 + envelope.code != 0 抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 500, 99999));
    vi.stubGlobal('fetch', fetcher);
    await expect(listProjects()).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('非 JSON 响应（HTML 网关）抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(listProjects()).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('fetch 抛 TypeError（断网）抛 IpdRequestError 传输类', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('network unavailable'));
    vi.stubGlobal('fetch', fetcher);
    await expect(listProjects()).rejects.toBeInstanceOf(IpdRequestError);
  });
});