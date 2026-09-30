import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import AssistantTurn from './assistant-turn.vue';

describe('AssistantTurn', () => {
  it('把思考与回答拆开，结束后才给出复制和转发', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });

    const wrapper = mount(AssistantTurn, {
      props: {
        content: '<think>先核对需求。</think>\n\n结论已明确。',
        streaming: true,
      },
    });
    expect(wrapper.find('[data-testid="assistant-think"]').text()).toContain('先核对需求。');
    expect(wrapper.find('[data-testid="assistant-answer"]').text()).toContain('结论已明确。');
    expect(wrapper.find('[data-testid="message-actions"]').exists()).toBe(false);

    await wrapper.setProps({ streaming: false });
    await wrapper.find('[data-testid="message-copy"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('结论已明确。');

    await wrapper.find('[data-testid="message-forward"]').trigger('click');
    expect(wrapper.text()).toContain('已复制，可粘贴转发');
  });

  it('思考区 summary 仍是「思考」，正文留在限高的 think-body', () => {
    const host = document.createElement('div');
    host.style.whiteSpace = 'pre-wrap';
    document.body.append(host);
    const wrapper = mount(AssistantTurn, {
      attachTo: host,
      props: { content: '<think>先核对需求。</think>\n\n结论已明确。', streaming: false },
    });
    const summary = wrapper.get('[data-testid="assistant-think-summary"]');
    expect(summary.text()).toContain('思考');
    expect(summary.text()).not.toContain('先核对需求');
    const body = wrapper.get('[data-testid="assistant-think-body"]');
    expect(body.text()).toContain('先核对需求');
    const details = wrapper.get('[data-testid="assistant-think"]');
    expect(details.attributes('open')).toBeUndefined();
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'assistant-turn.vue'),
      'utf8',
    );
    const style = source.slice(source.lastIndexOf('<style'));
    expect(style).toMatch(/\.think-body\s*\{[^}]*max-height\s*:/);
    expect(style).toMatch(/\.think[^{]*\{[^}]*white-space:\s*normal/);
    expect(style).toMatch(/\.think:not\(\[open\]\)\s+\.think-body\s*\{[^}]*display:\s*none/);
  });

  it('流结束后即使思考未闭合也不强制展开，摘要只留「思考」', () => {
    const wrapper = mount(AssistantTurn, {
      props: {
        content:
          '<think>按 C02 竞品分析 skill 的执行规约，先对考勤智能体的产品定位做并行检索',
        streaming: false,
      },
    });
    const summary = wrapper.get('[data-testid="assistant-think-summary"]');
    expect(summary.text().replace(/\s+/g, '')).toBe('思考');
    expect(summary.text()).not.toContain('C02');
    expect(wrapper.get('[data-testid="assistant-think-body"]').text()).toContain('C02 竞品分析');
    expect(wrapper.get('[data-testid="assistant-think"]').attributes('open')).toBeUndefined();
    expect(wrapper.find('[data-testid="assistant-answer"]').exists()).toBe(false);
  });

  it('大块正文按已收到的字符逐步揭示，卸载后不再跳字', async () => {
    vi.useFakeTimers();
    const wrapper = mount(AssistantTurn, {
      props: { content: '', streaming: true, pace: true },
    });
    await wrapper.setProps({ content: '一二三四五六七八九十' });
    expect(wrapper.find('[data-testid="assistant-answer"]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(16);
    expect(wrapper.find('[data-testid="assistant-answer"]').text()).toContain('一二三四五六');
    expect(wrapper.find('[data-testid="assistant-answer"]').text()).not.toContain('九十');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
  });
});
