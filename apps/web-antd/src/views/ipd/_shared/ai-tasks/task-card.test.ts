/**
 * R221 任务卡组件测试（R232 P2-04）：
 * - BR-AI-04：头部常驻风险 Alert（与 ai-cards 同一渲染纪律，无一豁免）；
 * - 状态呈现到 result_summary 粒度：五态标签 + resultSummary/errorMsg 插值；
 * - prompt 防泄漏哨兵：数据面混入 fillPayload/prompt 原文也**不得**出现在 HTML（禁 v-html）；
 * - C08 零直写：「直达审批卡」只 emit 给宿主，组件内 fetch 零调用。
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { AiAgentTaskView } from '../../../../api/ipd/stage-action';
import TaskCard from './task-card.vue';

const baseTask: AiAgentTaskView = {
  actionCode: 'C11',
  aiDocId: '9001',
  attempt: 1,
  createTime: 1_758_000_000_000,
  errorMsg: null,
  execMode: 'HUMAN_GATE',
  id: '2104',
  projectId: '200',
  resultSummary: 'G1 备料完成：要素判定草稿 7/7 已生成',
  stageActionId: '300',
  status: 'SUCCEEDED',
  triggeredBy: '9001',
  triggerType: 'PASSIVE',
  updateTime: null,
};

describe('R232 P2-04 任务卡渲染（状态到 result_summary 粒度）', () => {
  it('BR-AI-04 头部 Alert 常驻 + 五态标签 + resultSummary 插值', () => {
    const wrapper = mount(TaskCard, { props: { task: baseTask } });
    expect(wrapper.find('[data-testid="ai-card-alert"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="ai-task-status"]').text()).toContain('已完成');
    expect(wrapper.find('[data-testid="ai-task-result"]').text()).toContain('G1 备料完成');
  });

  it.each([
    ['PENDING', '排队中'],
    ['RUNNING', '执行中'],
    ['SUCCEEDED', '已完成'],
    ['FAILED', '执行失败'],
    ['DEAD', '死信·需人工处理'],
  ])('status=%s 呈现 %s', (status, label) => {
    const wrapper = mount(TaskCard, {
      props: { task: { ...baseTask, status } },
    });
    expect(wrapper.find('[data-testid="ai-task-status"]').text()).toContain(label);
  });

  it('FAILED 态渲染 errorMsg；无 aiDocId 时不渲染直达按钮（无需人审）', () => {
    const wrapper = mount(TaskCard, {
      props: {
        task: {
          ...baseTask,
          aiDocId: null,
          errorMsg: '模型超时，已重试 2 次',
          resultSummary: null,
          status: 'FAILED',
        },
      },
    });
    expect(wrapper.find('[data-testid="ai-task-error"]').text()).toContain('模型超时');
    expect(wrapper.find('[data-testid="ai-task-result"]').text()).toBe('—');
    expect(wrapper.find('[data-testid="ai-task-open-review"]').exists()).toBe(false);
  });

  it('防注入哨兵：数据面混入 prompt/fillPayload 原文不出 HTML（仅插值，禁 v-html）', () => {
    const poisoned = {
      ...baseTask,
      fillPayload: 'SECRET_FILL_PAYLOAD_XYZ',
      prompt: 'SECRET_PROMPT_ORIGINAL_XYZ',
    } as unknown as AiAgentTaskView;
    const wrapper = mount(TaskCard, { props: { task: poisoned } });
    expect(wrapper.html()).not.toContain('SECRET_FILL_PAYLOAD_XYZ');
    expect(wrapper.html()).not.toContain('SECRET_PROMPT_ORIGINAL_XYZ');
  });

  it('C08 零直写：直达按钮只 emit openReview，组件内 fetch 零调用', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(TaskCard, { props: { task: baseTask } });
    await wrapper.find('[data-testid="ai-task-open-review"]').trigger('click');
    const emitted = wrapper.emitted('openReview');
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]?.[0]).toMatchObject({ id: '2104', aiDocId: '9001' });
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
