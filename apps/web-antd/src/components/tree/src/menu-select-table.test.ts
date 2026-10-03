import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MenuSelectTable from './menu-select-table.vue';

const { openGuide, grid } = vi.hoisted(() => ({
  openGuide: vi.fn(),
  grid: {
    getData: vi.fn(() => []),
    getCheckboxRecords: vi.fn(() => []),
    loadData: vi.fn(),
    setCheckboxRow: vi.fn(),
    setAllTreeExpand: vi.fn(),
  },
}));
vi.mock('@vben/utils', () => ({
  cloneDeep: (value: unknown) => value,
  findGroupParentIds: () => [],
}));
vi.mock('ant-design-vue', () => ({
  Alert: 'div',
  Checkbox: 'div',
  RadioGroup: 'div',
  Space: 'div',
}));
vi.mock('#/adapter/vxe-table', () => ({
  useVbenVxeGrid: () => [
    { template: '<div />' },
    { grid, setGridOptions: vi.fn() },
  ],
}));
vi.mock('./data', () => ({ columns: [], nodeOptions: [] }));
vi.mock('./helper', () => ({
  menusWithPermissions: vi.fn(),
  rowAndChildrenChecked: vi.fn(),
  setPermissionsChecked: vi.fn(),
  setTableChecked: vi.fn(),
}));
vi.mock('./hook', () => ({
  useFullScreenGuide: () => ({
    FullScreenGuide: { template: '<div />' },
    openGuide,
  }),
}));

describe('菜单树表引导生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    openGuide.mockClear();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('选中变化取消旧引导，仅最新一次在一秒后打开', async () => {
    const wrapper = mount(MenuSelectTable, {
      props: { checkedKeys: [], menus: [] },
      global: { stubs: { 'a-button': true } },
    });
    await wrapper.setProps({ checkedKeys: [1] });
    await nextTick();
    vi.advanceTimersByTime(500);
    await wrapper.setProps({ checkedKeys: [2] });
    await nextTick();
    vi.advanceTimersByTime(500);
    expect(openGuide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(openGuide).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('组件卸载停止watch并清理待执行的引导', async () => {
    const wrapper = mount(MenuSelectTable, {
      props: { checkedKeys: [], menus: [] },
      global: { stubs: { 'a-button': true } },
    });
    await wrapper.setProps({ checkedKeys: [1] });
    await nextTick();
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(openGuide).not.toHaveBeenCalled();
  });
});
