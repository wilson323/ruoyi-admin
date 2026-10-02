import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AguiInterruptForm from './agui-interrupt-form.vue';

describe('official HITL answers in the existing run', () => {
  it('requires all questions, preserves enum values and sends denial as resolved', async () => {
    const pause = { seq: 7, interrupts: [{ id: 'tool', reason: 'tool_call', message: '是否执行？' }, { id: 'input', reason: 'input_required', responseSchema: { type: 'object', properties: { country: { type: 'string', enum: ['中国', '日本'] } }, required: ['country'] } }] };
    const wrapper = mount(AguiInterruptForm, { props: { pause } });
    await wrapper.find('[data-testid="interrupt-submit"]').trigger('click');
    expect(wrapper.emitted('respond')).toBeUndefined();
    await wrapper.find('[data-testid="interrupt-deny"]').setValue();
    await wrapper.find('select[data-field="country"]').setValue('0');
    await wrapper.find('[data-testid="interrupt-submit"]').trigger('click');
    expect(wrapper.emitted('respond')?.[0]?.[0]).toEqual([{ interruptId: 'tool', status: 'resolved', payload: { approved: false } }, { interruptId: 'input', status: 'resolved', payload: { country: '中国' } }]);
  });
  it('shows an unsupported schema instead of guessing an answer', async () => {
    const wrapper = mount(AguiInterruptForm, { props: { pause: { seq: 1, interrupts: [{ id: 'input', reason: 'input_required', responseSchema: { type: 'array' } }] } } });
    expect(wrapper.find('[data-testid="interrupt-unsupported"]').text()).toContain('暂不支持');
    await wrapper.find('[data-testid="interrupt-submit"]').trigger('click');
    expect(wrapper.emitted('respond')).toBeUndefined();
  });
});


describe('official no-answer and recovery controls', () => {
  it('covers every pending item, omits skipped input payload and keeps tool denial resolved', async () => {
    const wrapper = mount(AguiInterruptForm, { props: { pause: { seq: 7, interrupts: [{ id: 'tool', reason: 'tool_call' }, { id: 'input', reason: 'input_required', responseSchema: { type: 'object', properties: { scope: { type: 'string' } }, required: ['scope'] } }] } } });
    await wrapper.find('[data-testid="interrupt-deny"]').setValue();
    await wrapper.find('[data-testid="interrupt-skip"]').setValue(true);
    await wrapper.find('[data-testid="interrupt-submit"]').trigger('click');
    expect(wrapper.emitted('respond')?.[0]?.[0]).toEqual([{ interruptId: 'tool', status: 'resolved', payload: { approved: false } }, { interruptId: 'input', status: 'cancelled' }]);
  });
  it('offers a read-only recovery action beside a rejected answer', async () => {
    const wrapper = mount(AguiInterruptForm, { props: { pause: { seq: 7, interrupts: [{ id: 'tool', reason: 'tool_call' }] }, errorText: '数据状态已变更，请刷新后重试' } });
    await wrapper.find('[data-testid="interrupt-refresh"]').trigger('click');
    expect(wrapper.emitted('refresh')).toEqual([[]]);
    expect(wrapper.emitted('respond')).toBeUndefined();
  });
});
