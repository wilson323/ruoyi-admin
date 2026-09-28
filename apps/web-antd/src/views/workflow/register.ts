import type { Component } from 'vue';

import { defineAsyncComponent, markRaw } from 'vue';

/**
 * 这里定义流程描述组件
 */

const LeaveDescription = defineAsyncComponent(
  () => import('#/views/workflow/leave/leave-description.vue'),
);

/**
 * key为流程的路径(task.formPath) value为要显示的组件
 */
export const flowComponentsMap = {
  /**
   * 请假申请 详情
   */
  '/workflow/leaveEdit/index': markRaw(LeaveDescription),
};

export type FlowComponentsMapMapKey = keyof typeof flowComponentsMap;

/**
 * 注册表未命中时的通用兜底描述组件（补遗 P0-2 formPath 注册表 fallback）。
 */
export const FlowDescriptionFallback: Component = markRaw(
  defineAsyncComponent(
    () => import('./components/flow-description-fallback.vue'),
  ),
);

/**
 * formPath → 流程描述组件解析（补遗 P0-2：注册表仅 1 条且无 fallback，
 * `component :is` 取 undefined 渲染空白）。
 *
 * <p>契约：命中注册表返回对应组件；formPath 空值或未注册返回通用兜底组件，
 * 永不返回 undefined/空串。
 */
export function resolveFlowDescriptionComponent(
  formPath: string | null | undefined,
): Component {
  const registered =
    formPath != null && formPath !== ''
      ? flowComponentsMap[formPath as FlowComponentsMapMapKey]
      : undefined;
  return registered ?? FlowDescriptionFallback;
}
