/**
 * RunTimeline 组件：未发起 / 等待 / 空 / 失败四种形态互斥清晰，条目只由事件驱动。
 * 按 CLAUDE.md F8：Alert 断言 description prop，重试按钮在 Alert 外。
 * ARTIFACT：仅持久 artifactId + runId 时展示应用按钮与内容预览；无 ID 不渲染应用 / 反馈。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { applyAgentRunArtifact, saveAiFeedback, type AgentRunEvent } from '../../../../api/ipd/project-agent';
import RunTimeline from './run-timeline.vue';

vi.mock('../../../../api/ipd/project-agent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  applyAgentRunArtifact: vi.fn(),
  saveAiFeedback: vi.fn(),
}));

/** 构造事件。 */
function ev(seq: number, type: AgentRunEvent['type'], payload: unknown = {}): AgentRunEvent {
  return { seq, type, payload, createdAt: 'x' };
}

describe('RunTimeline', () => {
  it('shows the idle hint and no items before any run', () => {
    const wrapper = mount(RunTimeline, { props: { events: [], hasRun: false } });
    expect(wrapper.find('[data-testid="timeline-idle"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(0);
  });

  it('distinguishes waiting (polling, no events) from an empty finished run', async () => {
    const wrapper = mount(RunTimeline, { props: { events: [], hasRun: true, loading: true } });
    expect(wrapper.find('[data-testid="timeline-waiting"]').attributes('role')).toBe('status');
    expect(wrapper.find('[data-testid="timeline-empty"]').exists()).toBe(false);

    await wrapper.setProps({ loading: false });
    expect(wrapper.find('[data-testid="timeline-waiting"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="timeline-empty"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(0);
  });

  it('renders the error via the Alert description prop, keeps received events, and emits retry', async () => {
    const wrapper = mount(RunTimeline, {
      props: { events: [ev(1, 'STEP', { title: '检索' })], hasRun: true, errorText: '无法连接服务，请检查网络后重试' },
    });
    const alert = wrapper.findComponent({ name: 'AAlert' });
    expect(alert.props('type')).toBe('error');
    expect(alert.props('description')).toBe('无法连接服务，请检查网络后重试');
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="timeline-waiting"]').exists()).toBe(false);

    await wrapper.find('[data-testid="timeline-retry"]').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('renders one item per folded event with its real content', () => {
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        events: [
          ev(1, 'STEP', { title: '检索资料' }),
          ev(2, 'TEXT_DELTA', { text: '第一段' }),
          ev(3, 'TEXT_DELTA', { text: '续写' }),
          ev(4, 'SOURCE', { title: '报告', url: 'https://example.com' }),
          ev(5, 'ERROR', { code: 'E1', message: '模型超时' }),
        ],
      },
    });
    const items = wrapper.findAll('[data-testid="timeline-item"]');
    expect(items.map((i) => i.attributes('data-kind'))).toEqual(['step', 'text', 'source', 'error']);
    expect(items[1]!.text()).toContain('第一段续写');
    const link = items[2]!.find('a');
    expect(link.attributes('href')).toBe('https://example.com');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(items[3]!.text()).toContain('模型超时（E1）');
  });

  it('renders think tags as a folded reasoning block and the answer as the body', () => {
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        events: [ev(1, 'TEXT_DELTA', { text: '<think>三个主题未检索到</think>无法输出项目介绍' })],
      },
    });
    const answer = wrapper.find('[data-testid="assistant-answer"]');
    expect(answer.text()).toContain('无法输出项目介绍');
    expect(answer.text()).not.toContain('<think>');
    expect(wrapper.find('[data-testid="assistant-think"]').text()).toContain('三个主题未检索到');
    expect(wrapper.find('.item-text').exists()).toBe(false);
  });

  it('renders payload text as plain text (no HTML injection)', () => {
    const wrapper = mount(RunTimeline, {
      props: { hasRun: true, events: [ev(1, 'TEXT_DELTA', { text: '<img src=x onerror=alert(1)>' })] },
    });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
  });

  it('likes an artifact with versionId and skips old artifacts that only have artifactId', async () => {
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        runId: 'run-1',
        events: [
          ev(1, 'ARTIFACT', { artifactId: 'art-9', versionId: '2096266884247736321', title: '报告' }),
          ev(2, 'ARTIFACT', { artifactId: 'art-old', title: '旧产物' }),
        ],
      },
    });
    const bars = wrapper.findAll('[data-testid="ai-feedback-bar"]');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.find('[data-testid="feedback-up"]').attributes('aria-label')).toBe('产物：报告有帮助');
    await bars[0]!.find('[data-testid="feedback-up"]').trigger('click');
    await flushPromises();
    expect(saveAiFeedback).toHaveBeenCalledWith('ARTIFACT_VERSION', '2096266884247736321', { rating: 'UP' });
  });

  it('renders an intent card with questions and steps, without the old clarification notice', () => {
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        events: [
          ev(1, 'STEP', {
            kind: 'INTENT',
            title: '意图判断',
            detail: '范围还没定，先澄清，不进入执行。',
            needsPlan: true,
            needsClarification: true,
            questions: ['范围还没定'],
            steps: ['核对功能'],
          }),
        ],
      },
    });
    const card = wrapper.find('[data-testid="agent-intent-card"]');
    expect(card.find('[data-testid="intent-questions"]').text()).toContain('范围还没定');
    expect(card.find('[data-testid="intent-steps"]').text()).toContain('核对功能');
    expect(card.find('[data-testid="intent-needs-plan"]').text()).toBe('要计划');
    expect(card.find('[data-testid="intent-needs-clarification"]').text()).toBe('要澄清');
    expect(card.find('[data-testid="intent-clarification-pending"]').exists()).toBe(false);
    expect(card.text()).not.toContain('判定为先澄清。当前版本仍会继续生成，执行前切断尚未接通。');
    expect(wrapper.find('[data-testid="timeline-item"]').attributes('data-kind')).toBe('intent');
    expect(card.find('[data-testid="intent-plan-execute"]').text()).toBe('开始执行');
    expect(card.find('[data-testid="intent-plan-revise"]').text()).toBe('先改范围');
  });

  it('renders clarification options as buttons and keeps plan steps in their own list', async () => {
    const question = '这句话里有未选定的方向：「轻量」还是「完整」。请指定其中一个后再执行。';
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        events: [
          ev(1, 'STEP', {
            kind: 'INTENT',
            title: '意图判断',
            detail: '范围还没定，先澄清，不进入执行。',
            needsPlan: true,
            needsClarification: true,
            questions: ['范围还没定', question],
            steps: ['核对功能'],
          }),
        ],
      },
    });
    const card = wrapper.find('[data-testid="agent-intent-card"]');
    const options = card.findAll('[data-testid="intent-option"]');
    expect(options.map((button) => button.text().replace(/\s+/g, ''))).toEqual(['A范围还没定', 'B轻量', 'C完整']);
    expect(card.find('[data-testid="intent-steps"]').text()).toContain('核对功能');
    expect(card.find('[data-testid="intent-questions"]').text()).not.toContain('核对功能');
    expect(card.find('[data-testid="intent-clarification-pending"]').exists()).toBe(false);
    await options[2]!.trigger('click');
    expect(wrapper.emitted('choose')?.[0]?.[0]).toEqual({ option: '完整', question });
    expect(options[2]!.classes()).toContain('is-selected');
    expect(options.every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('disables clarification options after AWAIT_USER and RUN_FINISHED', () => {
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        events: [
          ev(1, 'STEP', {
            kind: 'INTENT',
            needsClarification: true,
            questions: ['「轻量」还是「完整」'],
          }),
          ev(2, 'STEP', { kind: 'AWAIT_USER', reason: 'CLARIFICATION' }),
          ev(3, 'RUN_FINISHED', { status: 'CANCELLED' }),
        ],
      },
    });
    const options = wrapper.findAll('[data-testid="intent-option"]');
    expect(options).toHaveLength(2);
    expect(options.every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('says the kernel is still generating only when clarification did not stop the run', () => {
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        events: [
          ev(1, 'STEP', {
            kind: 'INTENT',
            needsClarification: true,
            questions: ['范围还没定'],
          }),
          ev(2, 'TEXT_DELTA', { text: '先继续写' }),
        ],
      },
    });
    expect(wrapper.find('[data-testid="intent-clarification-pending"]').text()).toBe(
      '判定为先澄清，当前仍会继续生成。',
    );
  });

  it('shows preview and apply only when artifactId is present; apply calls applyAgentRunArtifact', async () => {
    vi.mocked(applyAgentRunArtifact).mockResolvedValue({
      runId: 'run-1',
      artifactId: 'art-9',
      versionId: '2096266884247736321',
      versionNo: 1,
      documentId: '3096266884247736321',
      documentStatus: 'GENERATED',
      indexStatus: 'NOT_INDEXED',
    });
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        runId: 'run-1',
        events: [
          ev(1, 'ARTIFACT', { artifactId: 'art-9', title: '报告', content: '预览正文' }),
          ev(2, 'ARTIFACT', { title: '草稿', content: '不应出现' }),
        ],
      },
    });
    const items = wrapper.findAll('[data-testid="timeline-item"]');
    expect(items[0]!.find('[data-testid="artifact-preview"]').text()).toBe('预览正文');
    expect(items[0]!.find('[data-testid="artifact-apply-btn"]').exists()).toBe(true);
    expect(items[1]!.find('[data-testid="artifact-preview"]').exists()).toBe(false);
    expect(items[1]!.find('[data-testid="artifact-apply-btn"]').exists()).toBe(false);
    expect(items[1]!.find('[data-testid="ai-feedback-bar"]').exists()).toBe(false);

    await items[0]!.find('[data-testid="artifact-apply-btn"]').trigger('click');
    await flushPromises();
    expect(applyAgentRunArtifact).toHaveBeenCalledTimes(1);
    expect(applyAgentRunArtifact).toHaveBeenCalledWith('run-1', 'art-9');
    expect(items[0]!.find('[data-testid="artifact-apply-btn"]').text()).toContain('工作成果定档');
    expect(items[0]!.find('[data-testid="artifact-archive-note"]').text()).toContain('知识库须审核后入库');
    expect(items[0]!.find('[data-testid="artifact-apply-ok"]').text()).toContain(
      '已回填项目文档 #3096266884247736321',
    );
    expect(items[0]!.find('[data-testid="artifact-apply-ok"]').text()).toContain('状态：待审核');
    expect(items[0]!.find('[data-testid="artifact-apply-ok"]').text()).not.toContain('GENERATED');
    expect(items[0]!.find('[data-testid="artifact-apply-ok"]').text()).toContain('知识库未入库');
  });

  it('renders a paired tool call as one collapsible card', () => {
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        loading: false,
        events: [
          ev(1, 'TOOL_CALL', { toolName: 'search_web', arguments: { query: '需求' } }),
          ev(2, 'TOOL_RESULT', { toolName: 'search_web', output: '找到 2 条' }),
        ],
      },
    });
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="ai-tool-call"]').attributes('data-state')).toBe('completed');
    expect(wrapper.find('[data-testid="ai-tool-call-body"]').text()).toContain('找到 2 条');
  });

  it('hides the apply button when runId is missing even if artifactId exists', () => {
    const wrapper = mount(RunTimeline, {
      props: {
        hasRun: true,
        events: [ev(1, 'ARTIFACT', {
          artifactId: 'art-9',
          versionId: '2096266884247736321',
          title: '报告',
          content: '有正文',
        })],
      },
    });
    expect(wrapper.find('[data-testid="artifact-preview"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="artifact-apply-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ai-feedback-bar"]').exists()).toBe(true);
  });
});
