<script setup lang="ts">
import { Descriptions, DescriptionsItem } from 'ant-design-vue';

/**
 * 流程表单描述通用兜底组件（补遗 P0-2：formPath 注册表无 fallback，
 * `component :is` 取 undefined 渲染空白——未注册 formPath 回退本组件）。
 *
 * <p>与注册组件同 prop 契约（businessId 必传），保证 `:is` 动态渲染接口一致。
 */
defineOptions({
  name: 'FlowDescriptionFallback',
  inheritAttrs: false,
});

defineProps<{ businessId: number | string }>();
</script>

<template>
  <div class="rounded-[6px] border p-2">
    <Descriptions :column="1" size="middle">
      <DescriptionsItem label="业务ID">{{ businessId }}</DescriptionsItem>
      <DescriptionsItem label="表单详情">
        该流程表单描述组件未注册（formPath 未登记于 workflow/register.ts），已回退通用描述
      </DescriptionsItem>
    </Descriptions>
  </div>
</template>
