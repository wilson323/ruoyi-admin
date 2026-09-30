/**
 * 能力选择：纯函数只提交服务端返回且可用的 ID/版本；选择器展示不可用原因。
 * 按 CLAUDE.md F8：Select 下拉在 happy-dom 打不开，直接 $emit('update:value') 驱动。
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { ProjectAgentCapabilities } from '../../../../api/ipd/project-agent';
import CapabilityPicker from './capability-picker.vue';
import {
  buildRunInput,
  emptySelection,
  isSelectionSubmittable,
  packKey,
  sanitizeSelection,
  selectPackByKey,
  type AgentCapabilitySelection,
} from './capability-selection';

/** 能力清单样例：一个可用包（含不可用 Skill/工具）、一个不可用包、一个不可用模型。 */
const CAPS: ProjectAgentCapabilities = {
  packs: [
    {
      code: 'ipd.market',
      version: '1.2.0',
      name: '市场分析',
      description: '竞品与市场规模分析',
      stages: ['CONCEPT'],
      actionCodes: ['A-01'],
      available: true,
      unavailableReason: null,
      skills: [
        { name: 'swot', version: '1', sha256: 's1', available: true, reason: null },
        { name: 'pestel', version: '2', sha256: 's2', available: false, reason: 'Skill 摘要校验失败' },
      ],
      tools: [
        { id: '0007', name: '知识库检索', readOnly: true, available: true, reason: null },
        { id: '0008', name: '写入任务', readOnly: false, available: false, reason: '写工具需审批' },
      ],
    },
    {
      code: 'ipd.finance',
      version: '0.9.0',
      name: '财务测算',
      description: '',
      stages: [],
      actionCodes: [],
      available: false,
      unavailableReason: '当前阶段未开放',
      skills: [],
      tools: [],
    },
  ],
  models: [
    { id: '0012', name: '通用模型', available: true, reason: null },
    { id: '0013', name: '推理模型', available: false, reason: '额度已用尽' },
  ],
};

const MARKET_KEY = packKey(CAPS.packs[0]!);

describe('capability selection helpers', () => {
  it('selecting a pack preselects only its available skills and tools', () => {
    const next = selectPackByKey(CAPS, emptySelection(), MARKET_KEY);
    expect(next).toMatchObject({ packCode: 'ipd.market', packVersion: '1.2.0', skillNames: ['swot'], toolIds: ['0007'] });
  });

  it('builds the run input strictly from server values (string IDs, pack version)', () => {
    const sel: AgentCapabilitySelection = { ...selectPackByKey(CAPS, emptySelection(), MARKET_KEY), modelConfigId: '0012' };
    expect(buildRunInput(CAPS, sel, '  分析竞品 ', 'k-1', 'A-01')).toEqual({
      capabilityPackCode: 'ipd.market',
      capabilityPackVersion: '1.2.0',
      modelConfigId: '0012',
      skillNames: ['swot'],
      toolIds: ['0007'],
      actionCode: 'A-01',
      message: '分析竞品',
      idempotencyKey: 'k-1',
    });
    expect(buildRunInput(CAPS, sel, 'x', 'k-1')).not.toHaveProperty('actionCode');
    const bound = buildRunInput(CAPS, sel, '分析竞品', 'k-1', 'NOT-IN-PACK', ['swot', 'pestel', 'foreign']);
    expect(bound).not.toHaveProperty('actionCode');
    expect(bound?.skillNames).toEqual(['swot']);
  });

  it('refuses unavailable or foreign selections', () => {
    const base = { ...selectPackByKey(CAPS, emptySelection(), MARKET_KEY), modelConfigId: '0012' };
    expect(isSelectionSubmittable(CAPS, base)).toBe(true);
    expect(isSelectionSubmittable(CAPS, { ...base, modelConfigId: '0013' })).toBe(false);
    expect(isSelectionSubmittable(CAPS, { ...base, skillNames: ['pestel'] })).toBe(false);
    expect(isSelectionSubmittable(CAPS, { ...base, toolIds: ['forged'] })).toBe(false);
    expect(isSelectionSubmittable(CAPS, { ...base, packVersion: '9.9.9' })).toBe(false);
    expect(isSelectionSubmittable(CAPS, { ...base, packCode: 'ipd.finance', packVersion: '0.9.0' })).toBe(false);
    expect(buildRunInput(CAPS, base, '   ', 'k')).toBeNull();
  });

  it('drops stale options when the capability list is refreshed', () => {
    const stale: AgentCapabilitySelection = {
      packCode: 'ipd.market',
      packVersion: '1.1.0',
      modelConfigId: '0099',
      skillNames: ['swot'],
      toolIds: ['0007'],
    };
    expect(sanitizeSelection(CAPS, stale)).toEqual(emptySelection());
    expect(sanitizeSelection(null, stale)).toEqual(emptySelection());
  });
});

describe('CapabilityPicker', () => {
  /** 挂载并返回最后一次 update:modelValue。 */
  function mountPicker(modelValue: AgentCapabilitySelection = emptySelection()) {
    const wrapper = mount(CapabilityPicker, { props: { capabilities: CAPS, modelValue } });
    const last = () => wrapper.emitted('update:modelValue')?.at(-1)?.[0] as AgentCapabilitySelection | undefined;
    return { last, wrapper };
  }

  it('lists backend reasons for unavailable packs and omits unavailable models', () => {
    const { wrapper } = mountPicker();
    expect(wrapper.find('[data-testid="picker-pack-reasons"]').text()).toContain('财务测算（v0.9.0）不可用：当前阶段未开放');
    expect(wrapper.find('[data-testid="picker-model-reasons"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('推理模型');
    expect(wrapper.text()).not.toContain('额度已用尽');
  });

  it('keeps unavailable packs disabled and only offers available models', () => {
    const { wrapper } = mountPicker();
    const selects = wrapper.findAllComponents({ name: 'ASelect' });
    const packOptions = selects[0]!.props('options') as Array<{ disabled: boolean; value: string }>;
    expect(packOptions.map((o) => o.disabled)).toEqual([false, true]);
    const modelOptions = selects[1]!.props('options') as Array<{ label: string; value: string }>;
    expect(modelOptions).toEqual([{ label: '通用模型', value: '0012' }]);
  });

  it('emits a selection built from server values when a pack and model are chosen', async () => {
    const { last, wrapper } = mountPicker();
    wrapper.findAllComponents({ name: 'ASelect' })[0]!.vm.$emit('update:value', MARKET_KEY);
    expect(last()).toMatchObject({ packCode: 'ipd.market', packVersion: '1.2.0', skillNames: ['swot'], toolIds: ['0007'] });

    await wrapper.setProps({ modelValue: last()! });
    wrapper.findAllComponents({ name: 'ASelect' })[1]!.vm.$emit('update:value', '0012');
    expect(last()?.modelConfigId).toBe('0012');
    wrapper.findAllComponents({ name: 'ASelect' })[1]!.vm.$emit('update:value', 'forged-id');
    expect(last()?.modelConfigId).toBeNull();
    wrapper.findAllComponents({ name: 'ASelect' })[1]!.vm.$emit('update:value', '0013');
    expect(last()?.modelConfigId).toBeNull();
  });

  it('shows skill/tool reasons, disables unavailable ones, and toggles available ones', async () => {
    const selected = selectPackByKey(CAPS, emptySelection(), MARKET_KEY);
    const { last, wrapper } = mountPicker(selected);
    const skills = wrapper.find('[data-testid="picker-skills"]');
    expect(skills.text()).toContain('不可用：Skill 摘要校验失败');
    const tools = wrapper.find('[data-testid="picker-tools"]');
    expect(tools.text()).toContain('只读');
    expect(tools.text()).toContain('不可用：写工具需审批');

    const skillInputs = skills.findAll('input[type="checkbox"]');
    expect(skillInputs[1]!.attributes('disabled')).toBeDefined();
    await skillInputs[0]!.setValue(false);
    expect(last()?.skillNames).toEqual([]);
  });

  it('shows an explicit empty state when the project has no packs', () => {
    const wrapper = mount(CapabilityPicker, {
      props: { capabilities: { packs: [], models: [] }, modelValue: emptySelection() },
    });
    expect(wrapper.find('[data-testid="picker-no-packs"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="picker-no-models"]').exists()).toBe(true);
  });
});
