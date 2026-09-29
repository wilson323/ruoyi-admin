/**
 * Track E5：tool-drawer 提交合成契约测试（两路显式合成：formApi.getValues() + getConfigJson()）。
 *
 * 红线（断言锁契约而非现状）：
 * - 方案 a「留空提交保留原值」：edit 未替换时提交载荷**不带 configJson 键**
 *   （即便表单值里混入 configJson 也必须删键——后端 applyWriteOnlyConfigPolicy 留空保留原值）；
 * - 替换配置后提交载荷带 configJson（结构化序列化产物）；
 * - 连接配置非法：message.error 显式报错并锁提交（痛点②：不再静默 return）；
 * - 挂接成立：编辑抽屉渲染方案 a 空态卡文案（无明文）。
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVbenDrawer } from '@vben/common-ui';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { mcpToolAdd, mcpToolInfo, mcpToolUpdate } from '#/api/mcp/tool';

import ToolDrawer from './tool-drawer.vue';

vi.mock('ant-design-vue', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, message: { error: vi.fn() } };
});

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

vi.mock('#/api/mcp/tool', () => ({
  mcpToolAdd: vi.fn(),
  mcpToolInfo: vi.fn(),
  mcpToolUpdate: vi.fn(),
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
  form: { values: reactive({ name: 'probe-tool', type: 'LOCAL' }) },
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
  formApiStub.form.values.name = 'probe-tool';
  formApiStub.form.values.type = 'LOCAL';
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
  asMock(mcpToolInfo).mockResolvedValue({
    description: 'probe',
    id: 1,
    name: 'probe-tool',
    status: 'ENABLED',
    type: 'LOCAL',
    // 契约：详情响应不含 configJson（@JsonIgnore 不回显）
  });
});

async function openDrawer(wrapper: VueWrapper<any>, id?: number) {
  drawerApiStub.getData.mockReturnValue(id ? { id } : {});
  await drawerOptions.onOpenChange(true);
  await flushPromises();
  return wrapper;
}

async function mountDrawer() {
  const wrapper = mount(ToolDrawer);
  await flushPromises();
  return wrapper;
}

describe('tool-drawer 提交合成', () => {
  it('编辑留空提交：载荷不带 configJson 键（方案 a 留空保留原值红线）', async () => {
    const wrapper = await mountDrawer();
    await openDrawer(wrapper, 1);

    // 挂接成立：空态卡文案在位、无明文
    const sealed = wrapper.get('[data-testid="mcp-conn-sealed"]');
    expect(sealed.text()).toContain('连接配置已安全保存，不显示明文');
    expect(sealed.text()).toContain('留空提交将保留原配置');

    // 表单值里混入 configJson（防御场景）也不得随载荷提交
    formApiStub.getValues.mockResolvedValue({
      configJson: '{"command":"rogue"}',
      id: 1,
      name: 'probe-tool',
      status: 'ENABLED',
      type: 'LOCAL',
    });

    await drawerOptions.onConfirm();
    await flushPromises();

    expect(mcpToolUpdate).toHaveBeenCalledTimes(1);
    const payload = asMock(mcpToolUpdate).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload)).not.toContain('configJson');
    expect(payload.id).toBe(1);
    expect(wrapper.emitted('reload')).toHaveLength(1);
  });

  it('替换配置后提交：载荷带结构化 configJson（command+args）', async () => {
    const wrapper = await mountDrawer();
    await openDrawer(wrapper, 1);

    await wrapper.get('[data-testid="mcp-conn-replace"]').trigger('click');
    await wrapper.get('[data-testid="mcp-conn-command"]').setValue('npx');
    await wrapper.get('[data-testid="mcp-conn-arg-add"]').trigger('click');
    await wrapper.get('[data-testid="mcp-conn-arg-0"]').setValue('-y');

    await drawerOptions.onConfirm();
    await flushPromises();

    const payload = asMock(mcpToolUpdate).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.configJson).toBe(
      JSON.stringify({ args: ['-y'], command: 'npx' }),
    );
    expect(String(payload.configJson)).not.toMatch(/env|headers/i);
  });

  it('连接配置非法：message.error 显式报错并锁提交（痛点②：不再静默）', async () => {
    const wrapper = await mountDrawer();
    await openDrawer(wrapper); // 新增态

    await drawerOptions.onConfirm();
    await flushPromises();

    expect(asMock(message.error)).toHaveBeenCalledTimes(1);
    expect(String(asMock(message.error).mock.calls[0]![0])).toContain(
      'command 必填',
    );
    expect(mcpToolAdd).not.toHaveBeenCalled();
    expect(drawerApiStub.close).not.toHaveBeenCalled();
  });

  it('新增 LOCAL 工具：提交载荷带结构化 configJson', async () => {
    const wrapper = await mountDrawer();
    await openDrawer(wrapper);

    await wrapper.get('[data-testid="mcp-conn-command"]').setValue('npx');
    await drawerOptions.onConfirm();
    await flushPromises();

    const payload = asMock(mcpToolAdd).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.configJson).toBe(
      JSON.stringify({ args: [], command: 'npx' }),
    );
  });
});
