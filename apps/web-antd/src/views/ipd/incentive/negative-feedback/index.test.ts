/** 页36 负反馈：录入草稿走已有 POST /negative-feedbacks，缺字段时按钮不可用。 */
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NegativeFeedbackPage from './index.vue';

const { createNegativeFeedback, listNegativeFeedback } = vi.hoisted(() => ({
  createNegativeFeedback: vi.fn(),
  listNegativeFeedback: vi.fn(),
}));

vi.mock('../../../../api/ipd/negative-feedback', () => ({
  createNegativeFeedback,
  decideNegativeFeedback: vi.fn(),
  liftNegativeFeedback: vi.fn(),
  listNegativeFeedback,
  submitNegativeFeedback: vi.fn(),
}));

beforeEach(() => {
  createNegativeFeedback.mockReset();
  listNegativeFeedback.mockReset();
  listNegativeFeedback.mockResolvedValue([]);
  createNegativeFeedback.mockResolvedValue({ id: '1', status: 'DRAFT' });
});

function mountPage() {
  return mount(NegativeFeedbackPage, {
    global: {
      directives: { access: () => undefined },
    },
  });
}

describe('负反馈录入', () => {
  it('缺项目、情形或月份时不能录入', () => {
    const wrapper = mountPage();
    const button = wrapper.findAll('button').find((item) => item.text().includes('录入负反馈'));
    expect(button).toBeDefined();
    expect(button!.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('填齐后调用 createNegativeFeedback，并刷新列表', async () => {
    const wrapper = mountPage();
    const project = wrapper.find('input[placeholder="按项目过滤"]');
    await project.setValue('1001');
    const selects = wrapper.findAllComponents({ name: 'ASelect' });
    const trigger = selects.find((item) => item.attributes('data-testid') === 'nf-trigger-type') ?? selects[1];
    expect(trigger).toBeDefined();
    trigger!.vm.$emit('update:value', 'QUALITY_ACCIDENT');
    const month = wrapper.get('[data-testid="nf-trigger-month"]');
    await month.setValue('2026-08');
    await wrapper.get('button').trigger('click').catch(() => undefined);
    const submit = wrapper.findAll('button').find((item) => item.text().includes('录入负反馈'));
    expect(submit!.attributes('disabled')).toBeUndefined();
    await submit!.trigger('click');
    expect(createNegativeFeedback).toHaveBeenCalledWith({
      projectId: '1001',
      triggerMonth: '2026-08',
      triggerType: 'QUALITY_ACCIDENT',
    });
    expect(listNegativeFeedback).toHaveBeenCalled();
    expect(wrapper.text()).toContain('负反馈已录入为草稿');
    wrapper.unmount();
  });
});
