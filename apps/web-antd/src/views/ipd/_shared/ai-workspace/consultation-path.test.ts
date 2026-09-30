import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ConsultationPath from './consultation-path.vue';

const baseProps = {
  hasDelta: false,
  question: '',
  sources: [] as string[],
  status: 'idle' as const,
};

describe('ConsultationPath', () => {
  it('空态明确研究步骤未接入，不制造研究进度', () => {
    const wrapper = mount(ConsultationPath, { props: baseProps });
    expect(wrapper.get('[data-testid="ipd-ai-consultation-idle"]').text()).toContain('输入问题');
    expect(wrapper.text()).toContain('深度研究步骤事件尚未接入');
    expect(wrapper.find('[data-testid="ipd-ai-consultation-response"]').exists()).toBe(false);
  });

  it('按真实 SSE 状态更新响应和上下文来源，来源不伪装为引用链接', async () => {
    const wrapper = mount(ConsultationPath, { props: {
      ...baseProps,
      question: '项目风险是什么？',
      status: 'running' as const,
    } });
    expect(wrapper.get('[data-testid="ipd-ai-consultation-response"]').text()).toContain('等待首段回答');
    await wrapper.setProps({
      hasDelta: true,
      intent: 'CHITCHAT',
      sources: ['project.advance', 'project.advance', 'project.history_docs'],
    });
    expect(wrapper.get('[data-testid="ipd-ai-consultation-response"]').text()).toContain('正在接收回答内容');
    expect(wrapper.text()).toContain('返回意图 · CHITCHAT');
    expect(wrapper.get('[data-testid="ipd-ai-consultation-sources"]').text()).toContain('上下文来源');
    expect(wrapper.findAll('.source-list li').map((item) => item.text())).toEqual([
      'project.advance', 'project.history_docs',
    ]);
    expect(wrapper.find('.source-list a').exists()).toBe(false);
    await wrapper.setProps({ status: 'complete', tokenCompletion: 189 });
    expect(wrapper.get('[data-testid="ipd-ai-consultation-status"]').text()).toBe('已结束');
    expect(wrapper.get('[data-testid="ipd-ai-consultation-response"]').text()).toContain('本轮回答已结束');
    expect(wrapper.get('[data-testid="ipd-ai-execution-kind"]').text()).toContain('189 生成 token');
  });

  it('规则答复明确没有调用模型', () => {
    const wrapper = mount(ConsultationPath, { props: {
      ...baseProps,
      intent: 'TASKS',
      question: '我的待办',
      status: 'complete' as const,
      tokenCompletion: 0,
    } });
    expect(wrapper.get('[data-testid="ipd-ai-execution-kind"]').text()).toContain('未调用模型');
  });

  it('错误原文作为文本显示，不插入 HTML，也不显示无来源占位', () => {
    const wrapper = mount(ConsultationPath, { props: {
      ...baseProps,
      error: '<script>failed()</script>',
      question: '测试',
      status: 'error' as const,
    } });
    expect(wrapper.get('[role="alert"]').text()).toBe('<script>failed()</script>');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ipd-ai-consultation-sources"]').exists()).toBe(false);
  });
});
