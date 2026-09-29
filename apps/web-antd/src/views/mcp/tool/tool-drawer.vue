<script setup lang="ts">
import { computed, ref } from 'vue';

import { useVbenDrawer } from '@vben/common-ui';
import { $t } from '@vben/locales';
import { cloneDeep } from '@vben/utils';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { mcpToolAdd, mcpToolInfo, mcpToolUpdate } from '#/api/mcp/tool';
import { defaultFormValueGetter, useBeforeCloseDiff } from '#/utils/popup';

import McpConnectionForm from '../_shared/mcp-connection-form.vue';
import {
  emptyConnectionDraft,
  type ConnectionDraft,
  type McpToolType,
} from '../_shared/connection-config';

import { drawerSchema } from './data';

const emit = defineEmits<{ reload: [] }>();

const isUpdate = ref(false);
const title = computed(() => {
  return isUpdate.value ? $t('pages.common.edit') : $t('pages.common.add');
});

const [BasicForm, formApi] = useVbenForm({
  commonConfig: {
    formItemClass: 'col-span-2',
    componentProps: {
      class: 'w-full',
    },
  },
  layout: 'vertical',
  schema: drawerSchema(),
  showDefaultActions: false,
  wrapperClass: 'grid-cols-2 gap-x-4',
});

// Track E5：连接配置与表单域解耦（#19 write-only 红线）——结构化表单独立于 schema，
// 提交时走 formApi.getValues() + getConfigJson() 两路显式合成。
const connFormRef = ref<InstanceType<typeof McpConnectionForm>>();
const connDraft = ref<ConnectionDraft>(emptyConnectionDraft());
const connReplaced = ref(false);
const toolType = computed<McpToolType>(() => {
  const values = (formApi.form?.values ?? {}) as { type?: string };
  return (values.type ?? 'LOCAL') as McpToolType;
});

function setupForm(update: boolean) {
  formApi.updateSchema([
    {
      componentProps: {
        disabled: update,
      },
      fieldName: 'type',
    },
  ]);
}

async function toolDraftSnapshot() {
  const form = await defaultFormValueGetter(formApi)();
  return JSON.stringify([form, connDraft.value, connReplaced.value]);
}

const { onBeforeClose, markInitialized, resetInitialized } = useBeforeCloseDiff(
  {
    initializedGetter: toolDraftSnapshot,
    currentGetter: toolDraftSnapshot,
  },
);

const [BasicDrawer, drawerApi] = useVbenDrawer({
  onBeforeClose,
  onClosed: handleClosed,
  onConfirm: handleConfirm,
  async onOpenChange(isOpen) {
    if (!isOpen) {
      return null;
    }
    drawerApi.drawerLoading(true);

    const { id } = drawerApi.getData() as { id?: number | string };
    isUpdate.value = !!id;
    setupForm(isUpdate.value);
    if (isUpdate.value && id) {
      const record = await mcpToolInfo(id);
      await formApi.setValues(record);
    }
    await markInitialized();

    drawerApi.drawerLoading(false);
  },
});

async function handleConfirm() {
  try {
    drawerApi.lock(true);
    const { valid } = await formApi.validate();
    if (!valid) {
      return;
    }
    // 痛点②修复：连接配置非法显式报错并锁提交（不再静默 return）
    const errors = connFormRef.value?.validate() ?? [];
    if (errors.length > 0) {
      message.error(errors.join('；'));
      return;
    }
    const data = cloneDeep(await formApi.getValues()) as Record<string, any>;
    const configJson = connFormRef.value?.getConfigJson() ?? null;
    if (configJson === null) {
      // 方案 a：不带 configJson 键 = 后端 applyWriteOnlyConfigPolicy 留空保留原值（红线）
      delete data.configJson;
    } else {
      data.configJson = configJson;
    }
    await (isUpdate.value ? mcpToolUpdate(data) : mcpToolAdd(data));
    resetInitialized();
    emit('reload');
    drawerApi.close();
  } catch (error) {
    console.error(error);
  } finally {
    drawerApi.lock(false);
  }
}

async function handleClosed() {
  await formApi.resetForm();
  connDraft.value = emptyConnectionDraft();
  connReplaced.value = false;
  resetInitialized();
}
</script>

<template>
  <BasicDrawer :title="title" class="w-[600px]">
    <BasicForm />
    <McpConnectionForm
      ref="connFormRef"
      v-model:draft="connDraft"
      v-model:replaced="connReplaced"
      :mode="isUpdate ? 'edit' : 'create'"
      :type="toolType"
    />
  </BasicDrawer>
</template>
