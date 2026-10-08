/**
 * 域内 AI 建议 API 契约测试（R227-C1 AI-FUSION L2；AiSuggestionController）。
 *
 * 重点覆盖：
 * - POST /ai/suggest 路径与 body 四字段（undefined 键透传给 http 层，包络 code=0 解包）；
 * - 视图字段原样透传（markdown/degraded/aiModel 等不做数值转换）；
 * - 非 0 包络错误经 IpdRequestError 通道抛出（复用 authenticatedRequest 链路，此处不重复测包络层）；
 * - L2 场景镜像：AiSuggestScene 20 项 ↔ 后端 AiSuggestionService.SCENES 防漂移
 *   （bonus.fairness-analyze 已于 2026-10-03 随「奖金池」退役移除，21 → 20）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_SUGGEST_TIMEOUT_LONG_FORM_MS, AI_SUGGEST_TIMEOUT_MS, type AiSuggestScene, aiSuggest, aiSuggestTimeoutMs } from './ai-suggest';

const envelope = (data: unknown): Response =>
  new Response(
    JSON.stringify({ code: 0, message: 'ok', data, timestamp: '2026-09-26T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('aiSuggest（R227-C1 AI-FUSION L2）', () => {
  it('全参数：POST /api/v1/ai/suggest，body 含 scene/projectId/entityId/userPrompt', async () => {
    const view = {
      aiModel: 'mock-mini',
      completionTokens: 45,
      degraded: false,
      latencyMs: 800,
      markdown: '## 检查清单\n- 材料齐',
      promptTokens: 120,
      scene: 'gate.precheck-checklist',
    };
    const fetcher = vi.fn().mockResolvedValue(envelope(view));
    vi.stubGlobal('fetch', fetcher);

    const r = await aiSuggest('gate.precheck-checklist', {
      entityId: '30001',
      projectId: '9140001',
      userPrompt: '可选补充',
    });

    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/ai/suggest');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1]!.body!)).toEqual({
      entityId: '30001',
      projectId: '9140001',
      scene: 'gate.precheck-checklist',
      userPrompt: '可选补充',
    });
    // 视图透传：markdown 原样、ID/数字不做转换
    expect(r.markdown).toBe('## 检查清单\n- 材料齐');
    expect(r.degraded).toBe(false);
    expect(r.latencyMs).toBe(800);
  });

  it('缺省参数：body 仅 scene 有值，其余键为 undefined（JSON 序列化自动丢弃）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ scene: 'workbench.next-step', markdown: '建议' }));
    vi.stubGlobal('fetch', fetcher);

    await aiSuggest('workbench.next-step');

    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body!);
    expect(body).toEqual({ entityId: undefined, projectId: undefined, scene: 'workbench.next-step', userPrompt: undefined });
    expect('projectId' in body ? body.projectId : undefined).toBeUndefined();
  });

  it('degraded=true 降级视图透传（模型未启用引导文案）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      aiModel: 'intent_match',
      completionTokens: 0,
      degraded: true,
      latencyMs: 1,
      markdown: 'AI 建议暂未启用',
      promptTokens: 0,
      scene: 'project.summary.refresh',
    }));
    vi.stubGlobal('fetch', fetcher);

    const r = await aiSuggest('project.summary.refresh', { projectId: '7' });
    expect(r.degraded).toBe(true);
    expect(r.aiModel).toBe('intent_match');
  });

  it('立项建议等模型 60 秒，15 秒时请求仍未中止', async () => {
    expect(AI_SUGGEST_TIMEOUT_MS).toBe(60_000);
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      });
    })));
    try {
      const settled = aiSuggest('project.create.suggest', { userPrompt: '做一款门禁' }).then(
        () => { throw new Error('should have rejected'); },
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(15_000);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(aborted).toBe(true);
      await expect(settled).resolves.toMatchObject({ kind: 'timeout', message: '请求超时，请稍后重试' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('长文场景超时放宽到 180 秒，镜像后端 timeoutMsFor（2026-10-08 TIMEOUT 修复）', () => {
    expect(AI_SUGGEST_TIMEOUT_LONG_FORM_MS).toBe(180_000);
    expect(aiSuggestTimeoutMs('timeline.storyline')).toBe(180_000);
    expect(aiSuggestTimeoutMs('kpi.contributor-summary')).toBe(180_000);
    expect(aiSuggestTimeoutMs('project.create.suggest')).toBe(60_000);
    expect(aiSuggestTimeoutMs('gate.precheck-checklist')).toBe(AI_SUGGEST_TIMEOUT_MS);
  });

  it('叙事场景等模型 180 秒：60 秒不中止，180 秒才中止（timeline.storyline）', async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      });
    })));
    try {
      const settled = aiSuggest('timeline.storyline', { projectId: '9140001' }).then(
        () => { throw new Error('should have rejected'); },
        (error: unknown) => error,
      );
      // 60 秒（旧上限）不得中止：否则长叙事仍被腰斩成 TIMEOUT
      await vi.advanceTimersByTimeAsync(60_000);
      expect(aborted).toBe(false);
      // 再推进 120 秒到 180 秒上限才中止
      await vi.advanceTimersByTimeAsync(120_000);
      expect(aborted).toBe(true);
      await expect(settled).resolves.toMatchObject({ kind: 'timeout', message: '请求超时，请稍后重试' });
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * L2 场景镜像（防漂移）：前端 AiSuggestScene 联合类型 ↔ 后端 SCENES 清单。
 *
 * 后端真值源：ruoyi-ai/ruoyi-modules/ruoyi-ipd/.../ipd/service/AiSuggestionService.java
 * 的 SCENES（POST /ai/suggest 单入口多场景分发）。跨仓不可 import，此处清单写死；
 * 与后端对账日期 2026-10-03（2026-09-28 L2 补全落地 21 项后，bonus.fairness-analyze
 * 随「奖金池」退役移除，现存 20 项）。后端增删场景时，
 * `satisfies Record<AiSuggestScene, true>` 会因键缺失/多余在 check:type 报错，双向防漂移。
 */
const SCENE_MIRROR = {
  // AI-P3 及之前的 11 个老场景
  'change.impact-analyze': true,
  'demand.create.from-requirement': true,
  'demand.dedupe': true,
  'gate.conclusion-draft': true,
  'gate.precheck-checklist': true,
  'handover.checklist-generate': true,
  'project.create.suggest': true,
  'project.summary.refresh': true,
  'report.nl-query': true,
  'workbench.next-step': true,
  'workbench.risk-warning': true,
  // L2 每页 AI 入口补全（2026-09-28）新增 10 场景，其中 bonus.fairness-analyze
  // 已于 2026-10-03 随「奖金池」退役移除，现存 9 项
  'audit.anomaly-detect': true,
  'bid.evaluate-proposal': true,
  'demand.classify': true,
  'demand.priority': true,
  'kpi.contributor-summary': true,
  'kpi.monthly-summary': true,
  'product.name-classify': true,
  'report.trend-analyze': true,
  'timeline.storyline': true,
} satisfies Record<AiSuggestScene, true>;

describe('L2 场景镜像（AiSuggestScene ↔ 后端 SCENES 防漂移，对账 2026-10-03）', () => {
  it('场景清单 20 项全对齐：11 老场景 + 9 个 L2 新场景逐项存在', () => {
    expect(Object.keys(SCENE_MIRROR)).toHaveLength(20);
  });

  it.each([
    'demand.classify',
    'demand.priority',
    'bid.evaluate-proposal',
    'kpi.monthly-summary',
    'kpi.contributor-summary',
    'timeline.storyline',
    'report.trend-analyze',
    'audit.anomaly-detect',
    'product.name-classify',
  ] as const)('L2 新场景 %s 在前端联合类型中逐项存在', (scene) => {
    expect(SCENE_MIRROR[scene]).toBe(true);
  });
});
