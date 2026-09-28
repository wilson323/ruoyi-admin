<!--
审批详情
动态渲染要显示的内容 需要再flowDescripionsMap先定义好组件
-->
<script setup lang="ts">
import type { FlowInfoResponse } from '#/api/workflow/instance/model';
import type { TaskInfo } from '#/api/workflow/task/model';

import { Divider } from 'ant-design-vue';

import { ApprovalTimeline } from '.';
import { resolveFlowDescriptionComponent } from '../register';

defineOptions({
  name: 'ApprovalDetails',
  inheritAttrs: false,
});

defineProps<{
  currentFlowInfo: FlowInfoResponse;
  task: TaskInfo;
}>();
</script>

<template>
  <div>
    <!--
     动态渲染要显示的内容 需要再flowDescripionsMap先定义好组件
     business-id为业务ID 必传
     formPath 未注册时由 resolveFlowDescriptionComponent 回退通用描述（P0-2 fallback）
    -->
    <component
      :is="resolveFlowDescriptionComponent(task.formPath)"
      :business-id="task.businessId"
    />
    <Divider />
    <ApprovalTimeline :list="currentFlowInfo.list" />
  </div>
</template>
