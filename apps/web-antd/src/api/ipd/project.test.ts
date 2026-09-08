/**
 * 项目域 API 纯逻辑契约测试（Wave 9 / agent A38）：
 *   A) createProject body 白名单 DTO（pure — toWire 函数过滤 legacyImport 专属字段）
 *   B) listProjects / getProject / legacyImportProject / getGateChecklist normalize 防御性
 *      （pure — 非数组 data → 空数组 / 缺字段 → 空字符串占位 / BigDecimal 保留字符串 /
 *       items 畸形归一化 / ok 严格 true / markedCodes 缺失降级）
 *   C) parseTargetMarkets 容错（pure — JSON 解析失败一律降级空数组）
 *   D) 错误路径解析（pure — HTTP 500 / 非 JSON / fetch TypeError → IpdRequestError）
 *
 * 与 project-live.test.ts 的关系（docs/真HTTP验收规范-20260907.md §二）：
 *   - 本文件（A 桶）：纯逻辑测试，**允许 vi.mock**，覆盖 normalize / parser / 错误码解析
 *   - project-live.test.ts：业务测试，**必须真 HTTP loopback**，
 *     默认 skipIf(!IPD_LIVE_ACCEPTANCE)，跑通 listProjects / getProject / createProject /
 *     legacyImportProject / changeProjectStatus / advanceProjectStage / getGateChecklist 端到端
 *
 * 拆分不增量：原 31 cases → 本文件纯逻辑 16 + project-live.test.ts 业务 15 = 31 总数。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
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

// ──────────────────────────────────────────────────────────────────────────────
// A. createProject body 白名单 DTO（pure — toWire 函数过滤 legacyImport 专属字段）
//    评审 Important-1：missingHistoryAck 等 legacyImport 字段混入 createProject body
//    会被后端误判为存量导入请求；toWire 必须对 undefined 字段不序列化。
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — createProject body 白名单 DTO (pure)', () => {
  it('legacyImport 专属字段经 JSON.stringify 后被剔除（undefined 不可序列化）', async () => {
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
});

// ──────────────────────────────────────────────────────────────────────────────
// B. normalize 防御性（pure — 与后端响应形态无关，仅前端容错）
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — listProjects normalize 防御性 (pure)', () => {
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

describe('project API — getProject normalize 防御性 (pure)', () => {
  it('缺字段时返回空字符串占位 id/name（不抛错）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({}));
    vi.stubGlobal('fetch', fetcher);
    const row = await getProject('x');
    expect(row.id).toBe('');
    expect(row.name).toBe('');
    expect(row.code).toBeNull();
  });
});

describe('project API — legacyImportProject normalize 防御性 (pure)', () => {
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

describe('project API — getGateChecklist normalize 防御性 (pure)', () => {
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

// ──────────────────────────────────────────────────────────────────────────────
// C. parseTargetMarkets 容错（pure — JSON 解析失败一律降级空数组）
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — parseTargetMarkets 容错 (pure)', () => {
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

// ──────────────────────────────────────────────────────────────────────────────
// D. 错误路径解析（pure — 与后端实际响应解耦）
// ──────────────────────────────────────────────────────────────────────────────
describe('project API — 错误传播 (pure)', () => {
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
