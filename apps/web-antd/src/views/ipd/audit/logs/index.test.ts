/**
 * 页06 审计日志 · L2 每页 AI 入口（2026-09-28）：audit.anomaly-detect。
 *
 * - 三件套：按钮存在 → 素材触发 scene=audit.anomaly-detect → adopt 回传宿主；
 * - C08 零直写：AI 链路不触达验链/导出/链重建任何端点（fetch 零调用）；
 * - 手法参考 demand/index.test.ts F7（模块层 mock + testid 选择器）。
 */
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiSuggest } from '../../../../api/ipd/ai-suggest';
import {
  exportAuditByScope,
  pageAuditByScope,
  rebuildAuditChain,
  verifyAuditChain,
} from '../../../../api/ipd/audit';
import AuditLogsPage from './index.vue';

vi.mock('../../../../api/ipd/ai-suggest', () => ({ aiSuggest: vi.fn() }));

vi.mock('../../../../api/ipd/audit', () => ({
  exportAuditByScope: vi.fn(),
  pageAuditByScope: vi.fn(),
  parseAuditPayload: (raw: null | string | undefined): unknown => {
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  },
  rebuildAuditChain: vi.fn(),
  verifyAuditChain: vi.fn(),
}));

/** L2 AI 测试视图：非结构化场景（无卡）+ 非降级 → 纯文本 + 「采纳到表单」按钮。 */
const suggestView = (scene: string, markdown: string) => ({
  aiModel: 'mock-mini', card: null, completionTokens: 1, degraded: false,
  latencyMs: 5, markdown, promptTokens: 1, scene,
});

beforeEach(() => {
  vi.mocked(aiSuggest).mockReset();
  vi.mocked(pageAuditByScope).mockReset();
  vi.mocked(verifyAuditChain).mockReset();
  vi.mocked(exportAuditByScope).mockReset();
  vi.mocked(rebuildAuditChain).mockReset();
  vi.mocked(pageAuditByScope).mockResolvedValue({
    scope: 'OWN',
    operatorIds: [],
    page: { records: [], total: 0, current: 1, size: 20, pages: 0 },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('L2 AI 入口（audit.anomaly-detect）', () => {
  it('audit.anomaly-detect：按钮存在、素材触发 scene、adopt 回传宿主（C08 零直写）', async () => {
    vi.mocked(aiSuggest).mockResolvedValue(suggestView('audit.anomaly-detect', '## 异常检测\n- 凌晨批量删除'));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    // 页面按钮带 v-access:code 权限闸：测试以透传 stub 指令挂载（不移除元素）
    const wrapper = mount(AuditLogsPage, { global: { directives: { access: { mounted() {} } } } });
    await vi.waitFor(() => expect(vi.mocked(pageAuditByScope)).toHaveBeenCalled());

    // ① 按钮存在
    const runBtn = wrapper.find('[data-testid="audit-ai-anomaly"] [data-testid="ai-suggest-run"]');
    expect(runBtn.exists()).toBe(true);
    expect(runBtn.text()).toContain('AI 审计异常检测');

    // ② 触发 scene 正确（needsPrompt：先填素材再发起）
    await wrapper.get('[data-testid="audit-ai-anomaly"] [data-testid="ai-suggest-prompt"]')
      .setValue('近三天出现 12 次凌晨批量 DELETE 审计事件');
    await runBtn.trigger('click');
    await vi.waitFor(() => expect(vi.mocked(aiSuggest)).toHaveBeenCalledWith(
      'audit.anomaly-detect',
      expect.objectContaining({ userPrompt: '近三天出现 12 次凌晨批量 DELETE 审计事件' }),
    ));

    // ③ adopt 回传宿主（仅本地提示，不写库）
    await wrapper.get('[data-testid="audit-ai-anomaly"] [data-testid="ai-suggest-adopt"]').trigger('click');
    const ack = wrapper.find('[data-testid="audit-ai-adopted"]');
    expect(ack.exists()).toBe(true);
    expect(ack.text()).toContain('已回传宿主');
    expect(ack.text()).toContain('audit.anomaly-detect');
    expect(ack.text()).toContain('不写库');
    // C08 零直写：验链/导出/链重建零触达、fetch 零调用（页面读写全走模块 mock）
    expect(vi.mocked(verifyAuditChain)).not.toHaveBeenCalled();
    expect(vi.mocked(exportAuditByScope)).not.toHaveBeenCalled();
    expect(vi.mocked(rebuildAuditChain)).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
