/**
 * E1-② formPath 注册表 fallback 契约（补遗 P0-2 / 《E1权限码方案对比》残余留账 §5）。
 *
 * <p>契约源：补遗 P0-2「formPath 注册表仅 1 条且无 fallback：`component :is` 取 undefined
 * 渲染空白」——断言锁定「未注册/空值 formPath 必回退通用描述组件，永不渲染空白」，
 * 篡改 resolve 兜底语义或 fallback 渲染面即红（不是实现现状）。
 *
 * <p>形态说明：formPath 为后端 FlowTaskVo.formPath（String 可空，流程定义表单路径），
 * 前端 register.ts flowComponentsMap 为「对应后端 formPath 的注册表」。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

// components/index 依赖链（apply-modal 等 12 组件）均含 '#/' 别名 import，
// vitest.ipd 配置无 resolve.alias；mock 掉时间线子树，隔离测 :is 动态渲染消费点契约。
vi.mock('./components/index', () => ({
  ApprovalTimeline: { template: '<div data-testid="timeline-stub" />' },
}));

import ApprovalDetails from './components/approval-details.vue';
import FlowDescriptionFallbackStatic from './components/flow-description-fallback.vue';
import {
  flowComponentsMap,
  FlowDescriptionFallback,
  resolveFlowDescriptionComponent,
} from './register';

describe('formPath 注册表 fallback 契约（E1-② / P0-2）', () => {
  it('命中注册表：返回注册组件本体（行为等价，存量流程零迁移）', () => {
    const registeredKey = '/workflow/leaveEdit/index';
    expect(resolveFlowDescriptionComponent(registeredKey)).toBe(
      flowComponentsMap[registeredKey],
    );
  });

  it('未命中注册表：返回兜底组件，不是 undefined（P0-2 断裂点：:is 取 undefined 渲染空白）', () => {
    const resolved = resolveFlowDescriptionComponent(
      '/workflow/unknownForm/index',
    );
    expect(resolved).toBe(FlowDescriptionFallback);
    expect(resolved).toBeDefined();
  });

  it('空值形态（undefined/null/空串，后端 formPath 可空）：一律兜底，不得渲染空白', () => {
    for (const emptyPath of [undefined, null, '']) {
      expect(resolveFlowDescriptionComponent(emptyPath)).toBe(
        FlowDescriptionFallback,
      );
    }
  });

  it('兜底组件渲染面：展示业务 ID 与未注册提示（不空白），prop 契约 businessId 与注册组件一致', () => {
    const wrapper = mount(FlowDescriptionFallbackStatic, {
      props: { businessId: 9527 },
    });
    const text = wrapper.text();
    expect(text).toContain('9527');
    expect(text).toContain('未注册');
  });

  it('消费点端到端：approval-details 对未注册 formPath 渲染兜底描述而非空白', async () => {
    const wrapper = mount(ApprovalDetails, {
      props: {
        currentFlowInfo: { list: [] },
        task: {
          formPath: '/workflow/neverRegistered/index',
          businessId: 'biz-001',
        },
      } as never,
      global: { stubs: { ApprovalTimeline: true } },
    });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain('biz-001');
    expect(text).toContain('未注册');
  });
});
