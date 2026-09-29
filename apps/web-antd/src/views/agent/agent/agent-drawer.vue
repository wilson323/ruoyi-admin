<script setup lang="ts">
import { computed, ref } from 'vue';

import { useVbenDrawer } from '@vben/common-ui';
import { $t } from '@vben/locales';
import { cloneDeep } from '@vben/utils';

import { useVbenForm } from '#/adapter/form';
import { agentAdd, agentInfo, agentUpdate } from '#/api/agent/agent';
import { defaultFormValueGetter, useBeforeCloseDiff } from '#/utils/popup';

import SkillBindingBench from './_shared/skill-binding-bench.vue';
import { drawerSchema } from './data';

const emit = defineEmits<{ reload: [] }>();

const isUpdate = ref(false);
const title = computed(() => {
  return isUpdate.value ? $t('pages.common.edit') : $t('pages.common.add');
});

/** E3：技能绑定台值面（= AgentVO.skillNames），提交前与 form 值显式合成。 */
const skillNames = ref<string[]>([]);

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

const { onBeforeClose, markInitialized, resetInitialized } = useBeforeCloseDiff(
  {
    initializedGetter: defaultFormValueGetter(formApi),
    currentGetter: defaultFormValueGetter(formApi),
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
    if (isUpdate.value && id) {
      const record = await agentInfo(id);
      await formApi.setValues(record);
      skillNames.value = Array.isArray(record.skillNames)
        ? [...record.skillNames]
        : [];
    } else {
      skillNames.value = [];
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
    const data = cloneDeep(await formApi.getValues());
    // E3 合成：技能值面以绑定台为准（表单 skillNames 项为隐藏占位）
    data.skillNames = [...skillNames.value];
    await (isUpdate.value ? agentUpdate(data) : agentAdd(data));
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
  skillNames.value = [];
  resetInitialized();
}
</script>

<template>
  <BasicDrawer :title="title" class="w-[720px]">
    <BasicForm />
    <SkillBindingBench v-model="skillNames" class="ipd-agent-bench" />
  </BasicDrawer>
</template>

<style scoped>
.ipd-agent-bench {
  margin-top: 12px;
}
</style>
