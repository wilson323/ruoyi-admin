import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AguiInterruptForm from './agui-interrupt-form.vue';

describe('official HITL answers in the existing run', () => {
  it('accepts an explicitly open question through the existing form and original resume payload', async () => {
    const interrupt = { id: 'facts-1', reason: 'tool_call', message: '请补充事实', metadata: { toolName: 'request_clarification', toolInput: {
      kind: 'CLARIFICATION', questions: [{ id: 'facts', prompt: '其他情况请说明', options: [] }],
    } }, responseSchema: { type: 'object', properties: { facts: { type: 'string', title: '其他情况请说明', minLength: 1, maxLength: 4000 } }, required: ['facts'], additionalProperties: false } };
    const wrapper = mount(AguiInterruptForm, { props: { pause: { seq: 10, interrupts: [interrupt] } } });
    expect(wrapper.find('[data-testid="interrupt-allow"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="interrupt-unsupported"]').exists()).toBe(false);
    await wrapper.find('input[data-field="facts"]').setValue('   ');
    await wrapper.find('[data-testid="interrupt-submit"]').trigger('click');
    expect(wrapper.emitted('respond')).toBeUndefined();
    await wrapper.find('input[data-field="facts"]').setValue('本产品已在中国销售，型号待核');
    await wrapper.find('[data-testid="interrupt-submit"]').trigger('click');
    expect(wrapper.emitted('respond')).toEqual([[[{ interruptId: 'facts-1', status: 'resolved', payload: { facts: '本产品已在中国销售，型号待核' } }]]]);
    expect(wrapper.find('fieldset').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
  it('answers clarification options by stable IDs on the original resume event, never as tool permission', async () => {
    const interrupt = { id: 'clarify-1', reason: 'tool_call', message: '请确认范围', metadata: { toolName: 'request_clarification', toolInput: {
      kind: 'CLARIFICATION', questions: [{ id: 'market', prompt: '选择国家', options: [{ id: 'cn', label: '中国' }, { id: 'jp', label: '日本' }] }],
    } }, responseSchema: { type: 'object', properties: { market: { type: 'string', title: '选择国家', enum: ['cn', 'jp'] } }, required: ['market'], additionalProperties: false } };
    const wrapper = mount(AguiInterruptForm, { props: { pause: { seq: 9, interrupts: [interrupt] } } });
    expect(wrapper.find('[data-testid="interrupt-allow"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="interrupt-deny"]').exists()).toBe(false);
    await wrapper.find('[data-option-id="cn"]').trigger('click');
    expect(wrapper.text()).toContain('已选：中国。');
    await wrapper.find('[data-testid="interrupt-submit"]').trigger('click');
    await wrapper.find('[data-testid="interrupt-submit"]').trigger('click');
    expect(wrapper.emitted('respond')).toEqual([[[{ interruptId: 'clarify-1', status: 'resolved', payload: { market: 'cn' } }]]]);
    expect(wrapper.find('[data-option-id="jp"]').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ errorText: '保存失败，请重试' });
    expect(wrapper.find('[data-testid="interrupt-submit"]').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
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
