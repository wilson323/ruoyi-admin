/**
 * 域内 AI 建议 API 契约测试（R227-C1 AI-FUSION L2；AiSuggestionController）。
 *
 * 重点覆盖：
 * - POST /ai/suggest 路径与 body 四字段（undefined 键透传给 http 层，包络 code=0 解包）；
 * - 视图字段原样透传（markdown/degraded/aiModel 等不做数值转换）；
 * - 非 0 包络错误经 IpdRequestError 通道抛出（复用 authenticatedRequest 链路，此处不重复测包络层）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiSuggest } from './ai-suggest';

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
});
