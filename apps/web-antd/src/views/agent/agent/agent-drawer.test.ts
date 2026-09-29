/**
 * Track E3：skillNames 合成回库语义契约测试。
 *
 * <p>断言锁契约：
 * - 表单隐藏占位项：drawerSchema 的 skillNames 项是隐藏值面占位（show()===false、
 *   Input 组件），仅保持 form 值树完整，不再渲染裸多选下拉；
 * - 绑定台显式合成：提交载荷 skillNames **以 SkillBindingBench 值面为准**，
 *   即便 form 值树里混入其它 skillNames 也被覆盖（值面协议）；
 * - 勾选/取消勾选实时反映到合成载荷（回库语义）。
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVbenDrawer } from '@vben/common-ui';

import { useVbenForm } from '#/adapter/form';
import {
  agentAdd,
  agentInfo,
  agentList,
  agentSkillOptions,
  agentUpdate,
} from '#/api/agent/agent';

import AgentDrawer from './agent-drawer.vue';
import { drawerSchema } from './data';

vi.mock('@vben/common-ui', () => ({
  useVbenDrawer: vi.fn(),
}));

vi.mock('@vben/locales', () => ({
  $t: (key: string) => key,
}));

vi.mock('@vben/utils', () => ({
  cloneDeep: <T,>(value: T): T => JSON.parse(JSON.stringify(value)),
}));

vi.mock('#/adapter/form', () => ({
  useVbenForm: vi.fn(),
}));

vi.mock('#/api/agent/agent', () => ({
  agentAdd: vi.fn(),
  agentInfo: vi.fn(),
  agentKnowledgeOptions: vi.fn(),
  agentList: vi.fn(),
  agentMcpToolOptions: vi.fn(),
  agentModelOptions: vi.fn(),
  agentSkillOptions: vi.fn(),
  agentUpdate: vi.fn(),
}));

vi.mock('#/utils/popup', () => ({
  defaultFormValueGetter: () => () => '{}',
  useBeforeCloseDiff: () => ({
    markInitialized: vi.fn(async () => undefined),
    onBeforeClose: async () => true,
    resetInitialized: vi.fn(),
  }),
}));

const StubForm = defineComponent({
  render: () => h('div', { 'data-testid': 'stub-form' }),
});

const StubDrawer = defineComponent({
  setup(_, { slots }) {
    return () =>
      h('div', { 'data-testid': 'stub-drawer' }, slots.default?.());
  },
});

const drawerOptions: Record<string, any> = {};
const drawerApiStub = {
  close: vi.fn(),
  drawerLoading: vi.fn(),
  getData: vi.fn(() => ({})),
  lock: vi.fn(),
};
const formApiStub: Record<string, any> = {
  form: { values: reactive({}) },
  getValues: vi.fn(async () => ({ ...formApiStub.form.values })),
  resetForm: vi.fn(async () => undefined),
  setValues: vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(formApiStub.form.values, values);
  }),
  updateSchema: vi.fn(),
  validate: vi.fn(async () => ({ valid: true })),
};

function asMock(fn: unknown) {
  return fn as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(drawerOptions)) {
    delete drawerOptions[key];
  }
  for (const key of Object.keys(formApiStub.form.values)) {
    delete (formApiStub.form.values as Record<string, unknown>)[key];
  }
  formApiStub.validate.mockResolvedValue({ valid: true });
  formApiStub.getValues.mockImplementation(async () => ({
    ...formApiStub.form.values,
  }));
  asMock(useVbenForm).mockReturnValue([StubForm, formApiStub]);
  asMock(useVbenDrawer).mockImplementation((options: Record<string, unknown>) => {
    Object.assign(drawerOptions, options);
    return [StubDrawer, drawerApiStub];
  });
  drawerApiStub.getData.mockReturnValue({});
  asMock(agentSkillOptions).mockResolvedValue([
    { description: '读 PDF', name: 'pdf:extract' },
  ]);
  asMock(agentList).mockResolvedValue({ rows: [], total: 0 });
});

async function mountDrawer() {
  // 环境对齐（非契约改动）：happy-dom 对未连接文档的节点执行点击激活（checked 翻转）
  // 但不派发 change 事件——受控 checkbox 的勾选链路必须在已连接子树上走真实事件流，
  // 故 mount 挂到 document.body；断言契约保持不变。
  const wrapper = mount(AgentDrawer, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

async function openDrawer(wrapper: VueWrapper<any>, id?: number) {
  drawerApiStub.getData.mockReturnValue(id ? { id } : {});
  await drawerOptions.onOpenChange(true);
  await flushPromises();
  return wrapper;
}

describe('skillNames 表单隐藏占位项（值树完整、不渲染裸多选）', () => {
  it('skillNames schema 项为隐藏 Input 占位（show()===false）', () => {
    const item = drawerSchema().find((schema) => schema.fieldName === 'skillNames');
    expect(item).toBeDefined();
    expect(item?.component).toBe('Input');
    // show 是 boolean | FormItemDependenciesCondition 联合类型，先断形态再调用
    const show = item?.dependencies?.show;
    expect(typeof show).toBe('function');
    expect(
      (show as (value: any, actions: any) => boolean | PromiseLike<boolean>)(
        {},
        {} as never,
      ),
    ).toBe(false);
    // 不再是带 agentSkillOptions api 的多选下拉
    expect(item?.componentProps).toBeUndefined();
  });
});

describe('skillNames 绑定台显式合成回库', () => {
  it('编辑态：载荷 skillNames 以绑定台值面为准（覆盖表单值树混入值）', async () => {
    asMock(agentInfo).mockResolvedValue({
      agentName: 'probe-agent',
      id: 1,
      modelId: 3,
      skillNames: ['pdf:extract'],
      status: '0',
    });
    const wrapper = await mountDrawer();
    await openDrawer(wrapper, 1);

    // 绑定台挂接成立：技能清单渲染
    expect(wrapper.text()).toContain('pdf:extract');
    expect(wrapper.text()).toContain('已绑定 1 个');

    // 防御场景：表单值树里混入 rogue skillNames，也不得覆盖绑定台值面
    formApiStub.getValues.mockResolvedValue({
      agentName: 'probe-agent',
      id: 1,
      skillNames: ['rogue:skill'],
      status: '0',
    });

    await drawerOptions.onConfirm();
    await flushPromises();

    expect(agentUpdate).toHaveBeenCalledTimes(1);
    const payload = asMock(agentUpdate).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.skillNames).toEqual(['pdf:extract']);
    expect(payload.skillNames).not.toContain('rogue:skill');
    expect(wrapper.emitted('reload')).toHaveLength(1);
  });

  it('新增态：绑定台勾选 → 合成载荷；取消勾选 → 载荷剔除', async () => {
    const wrapper = await mountDrawer();
    await openDrawer(wrapper); // 新增态

    // 初始未绑定
    expect(wrapper.text()).toContain('已绑定 0 个');

    const checkbox = wrapper.get('input[type="checkbox"]');
    await checkbox.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('已绑定 1 个');

    await drawerOptions.onConfirm();
    await flushPromises();
    expect(asMock(agentAdd).mock.calls[0]![0]).toMatchObject({
      skillNames: ['pdf:extract'],
    });

    // 取消勾选后再次提交：skillNames 为空数组（显式合成，非缺键）
    await checkbox.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('已绑定 0 个');

    await drawerOptions.onConfirm();
    await flushPromises();
    const payload = asMock(agentAdd).mock.calls[1]![0] as Record<
      string,
      unknown
    >;
    expect(payload.skillNames).toEqual([]);
    expect(Object.keys(payload)).toContain('skillNames');
  });

  it('编辑态打开：skillNames 值面从详情载入（表单隐藏项不再承载渲染）', async () => {
    asMock(agentInfo).mockResolvedValue({
      agentName: 'probe-agent',
      id: 2,
      modelId: 3,
      skillNames: ['pdf:extract'],
      status: '0',
    });
    const wrapper = await mountDrawer();
    await openDrawer(wrapper, 2);
    expect(wrapper.text()).toContain('已绑定 1 个');
    expect(wrapper.text()).toContain('SKILL.md 预览（front-matter）');
  });
});
