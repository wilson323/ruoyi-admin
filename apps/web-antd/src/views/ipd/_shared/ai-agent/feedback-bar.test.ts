/**
 * FeedbackBar：仅持久 targetId 可用；评级即 PUT、原因补充再 PUT；错误走 ipdErrorText 可见。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import { saveAiFeedback } from '../../../../api/ipd/project-agent';
import FeedbackBar from './feedback-bar.vue';

vi.mock('../../../../api/ipd/project-agent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveAiFeedback: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(saveAiFeedback).mockReset();
  vi.mocked(saveAiFeedback).mockImplementation(async (targetType, targetId, input) => ({
    targetType,
    targetId,
    rating: input.rating,
    reason: input.reason ?? null,
    updatedAt: 'x',
  }));
});

describe('FeedbackBar', () => {
  it.each([null, undefined, '', '   '])('renders nothing without a persistent targetId (%j)', (targetId) => {
    const wrapper = mount(FeedbackBar, { props: { targetType: 'RUN_MESSAGE', targetId } });
    expect(wrapper.find('[data-testid="ai-feedback-bar"]').exists()).toBe(false);
  });

  it('PUTs the rating immediately and reflects it with aria-pressed', async () => {
    const wrapper = mount(FeedbackBar, {
      props: { targetType: 'RUN_MESSAGE', targetId: 'run-1', label: '本次运行' },
    });
    const up = wrapper.find('[data-testid="feedback-up"]');
    expect(up.attributes('aria-label')).toBe('本次运行有帮助');
    await up.trigger('click');
    await flushPromises();
    expect(saveAiFeedback).toHaveBeenCalledWith('RUN_MESSAGE', 'run-1', { rating: 'UP' });
    expect(wrapper.find('[data-testid="feedback-up"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('[role="status"]').text()).toBe('已记录反馈');
  });

  it('submits a trimmed reason with the current rating as a second idempotent PUT', async () => {
    const wrapper = mount(FeedbackBar, { props: { targetType: 'ARTIFACT_VERSION', targetId: 'art-1' } });
    await wrapper.find('[data-testid="feedback-down"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="feedback-reason"]').setValue('  引用了过期数据 ');
    await wrapper.find('[data-testid="feedback-reason-submit"]').trigger('click');
    await flushPromises();
    expect(saveAiFeedback).toHaveBeenLastCalledWith('ARTIFACT_VERSION', 'art-1', {
      rating: 'DOWN',
      reason: '引用了过期数据',
    });
  });

  it('shows the backend error message and does not pretend success', async () => {
    vi.mocked(saveAiFeedback).mockRejectedValueOnce(new IpdRequestError('x', 404, 50001, 'http', '该运行不存在'));
    const wrapper = mount(FeedbackBar, { props: { targetType: 'RUN_MESSAGE', targetId: 'run-x' } });
    await wrapper.find('[data-testid="feedback-up"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe('该运行不存在');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="feedback-up"]').attributes('aria-pressed')).toBe('false');
  });

  it('resets its state when the target changes', async () => {
    const wrapper = mount(FeedbackBar, { props: { targetType: 'RUN_MESSAGE', targetId: 'run-1' } });
    await wrapper.find('[data-testid="feedback-up"]').trigger('click');
    await flushPromises();
    await wrapper.setProps({ targetId: 'run-2' });
    expect(wrapper.find('[data-testid="feedback-up"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.find('[data-testid="feedback-reason"]').exists()).toBe(false);
  });
});
