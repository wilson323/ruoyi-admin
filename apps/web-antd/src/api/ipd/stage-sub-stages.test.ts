import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceSubStage, fetchSubStages } from './stage-sub-stages';

const envelope = (data: unknown) => new Response(JSON.stringify({
  code: 0, data, message: 'success', timestamp: '2026-09-29T00:00:00Z', traceId: 'fixture',
}), { headers: { 'Content-Type': 'application/json' }, status: 200 });

const stage = (id: unknown) => ({
  actions: [{ actionCode: 'C01', actionName: '收集需求', skillNames: ['research'], sortOrder: 1, subStageCode: 'CONCEPT-S1' }],
  code: 'CONCEPT-S1', gateCode: null, id, isGate: 'N', name: '客户问题',
  ownerRole: 'MARKET_PM', skillHint: null, sortOrder: 1, stageCode: 'CONCEPT',
});

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('小阶段 API 契约', () => {
  it('目录保留字符串雪花 ID，并按后端实际路径读取动作技能', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([stage('9007199254740993')]));
    vi.stubGlobal('fetch', fetcher);

    const result = await fetchSubStages();

    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/ipd/stage/sub-stages');
    expect(result[0]?.id).toBe('9007199254740993');
    expect(result[0]?.actions[0]?.skillNames).toEqual(['research']);
  });

  it('拒绝数字化的雪花 ID，避免精度丢失后静默进入工作区', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope([stage(9007199254740993)])));
    await expect(fetchSubStages()).rejects.toThrow('小阶段目录响应格式错误');
  });

  it('推进参数放在 query，与后端 @RequestParam 合同一致', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ projectId: '1001', currentStage: 'CONCEPT',
      currentSubStageCode: 'CONCEPT-S2', version: 2, gateResult: null, replayed: false, advanced: true }));
    vi.stubGlobal('fetch', fetcher);

    await advanceSubStage('1001', 'CONCEPT-S2', 1);

    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/ipd/stage/sub-stages/advance');
    expect(url.searchParams.get('projectId')).toBe('1001');
    expect(url.searchParams.get('targetSubStageCode')).toBe('CONCEPT-S2');
    expect(url.searchParams.get('expectedVersion')).toBe('1');
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });
});
