/**
 * 项目详情 - Gate 评审 子页签（IpdProjectGates / P0-10.23）：
 *   - 顶部 Alert 口径（项目编号 + GateReviewController 端点路径 + 项目维度 Gate 列表后端缺）
 *   - Gate 定位表单：项目编号（路由注入，禁用）+ Gate 编号（手动输入）
 *   - 真缺口登记条：项目维度 Gate 列表（/api/key-gates）后端未交付
 *   - 嵌入式 GatePanel：填入 Gate 编号后挂载
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import GatesProjectTab from './gates.vue';

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ipd/projects/:projectId/gates', name: 'IpdProjectGates', component: { template: '<div />' } },
    ],
  });
}

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('IpdProjectGates 项目 Gate 评审子页签 (P0-10.23)', () => {
  it('首屏渲染：项目编号注入 + 真缺口登记条 + Gate 编号输入框', async () => {
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/gates');
    await router.isReady();
    const wrapper = mount(GatesProjectTab, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    const text = wrapper.text();
    expect(text).toContain('项目 Gate 评审：项目 P-200');
    expect(text).toContain('项目维度 Gate 列表端点（/api/key-gates）后端未交付');
    expect(text).toContain('GateReviewController');
    expect(text).toContain('请先在上方输入 Gate 编号后加载评审面板');
    wrapper.unmount();
  });

  it('空 Gate 编号点击定位：本地校验提示 + 不挂载 GatePanel', async () => {
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/gates');
    await router.isReady();
    const wrapper = mount(GatesProjectTab, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    const queryBtn = wrapper.findAll('button').find((b) => b.text().includes('定位评审'));
    expect(queryBtn).toBeDefined();
    await queryBtn!.trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('请填写 Gate 编号');
    // 空态 Empty 仍可见，未挂载嵌入式 GatePanel
    expect(wrapper.text()).toContain('请先在上方输入 Gate 编号后加载评审面板');
    wrapper.unmount();
  });

  it('填写 Gate 编号后点击定位：嵌入式 GatePanel 渲染', async () => {
    const router = buildRouter();
    await router.push('/ipd/projects/P-200/gates');
    await router.isReady();
    const wrapper = mount(GatesProjectTab, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    const input = wrapper.find('input[placeholder*="G2026-Q4-01"]');
    expect(input.exists()).toBe(true);
    await input.setValue('G-2026-Q4-01');
    const queryBtn = wrapper.findAll('button').find((b) => b.text().includes('定位评审'));
    await queryBtn!.trigger('click');
    await wrapper.vm.$nextTick();

    // 错误条消失
    expect(wrapper.text()).not.toContain('请填写 Gate 编号');
    // 嵌入式 GatePanel 标题可见
    expect(wrapper.text()).toContain('Gate 评审面板（嵌入式 GatePanel）');
    wrapper.unmount();
  });

  it('未传 projectId：Alert 提示"尚未选择"', async () => {
    const router = buildRouter();
    await router.push('/');
    await router.isReady();
    const wrapper = mount(GatesProjectTab, { global: { plugins: [router] } });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('项目 尚未选择');
    wrapper.unmount();
  });
});
