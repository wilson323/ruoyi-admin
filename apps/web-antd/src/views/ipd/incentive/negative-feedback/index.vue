<script setup lang="ts">
/**
 * 页36 负反馈执行（卡 P0-10.36；后端 NegativeFeedbackController 已交付）。
 * 规则：主责停发 / 连带减半；触发表含需求返工/质量事故/错过市场窗口。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Card, Empty, Input, Table, Tag } from 'ant-design-vue';

import {
  type NegativeFeedback,
  type NegativeRole,
  type NegativeTrigger,
  listNegativeFeedback,
} from '../../../../api/ipd/negative-feedback';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { formatDateTime } from '../../_shared/format';

defineOptions({ name: 'IpdNegativeFeedback', meta: { ipdCard: 'P0-10.36' } });

const projectId = ref('');
const personId = ref('');
const items = ref<NegativeFeedback[]>([]);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

const triggerText: Record<NegativeTrigger, string> = {
  DEFECT_REWORK: '需求返工率超标',
  MISSED_MARKET_WINDOW: '错过市场窗口',
  QUALITY_INCIDENT: '质量事故',
};

const triggerColor: Record<NegativeTrigger, string> = {
  DEFECT_REWORK: 'orange',
  MISSED_MARKET_WINDOW: 'red',
  QUALITY_INCIDENT: 'volcano',
};

const roleText: Record<NegativeRole, string> = {
  PRIMARY: '主责（停发）',
  SECONDARY: '次责（减半）',
  CO_RESPONSIBLE: '共同担责',
};

const roleColor: Record<NegativeRole, string> = {
  PRIMARY: 'red',
  SECONDARY: 'orange',
  CO_RESPONSIBLE: 'gold',
};

const columns = [
  { title: '编号', dataIndex: 'id', key: 'id', width: 110 },
  { title: '项目', dataIndex: 'projectId', key: 'projectId', width: 110 },
  { title: '人员', dataIndex: 'personId', key: 'personId', width: 110 },
  { title: '触发原因', key: 'trigger', width: 150 },
  { title: '责任', key: 'role', width: 130 },
  { title: '生效月', dataIndex: 'effectiveMonth', key: 'effectiveMonth', width: 110 },
  { title: '执行月', dataIndex: 'executeMonth', key: 'executeMonth', width: 130 },
  { title: '恢复月', dataIndex: 'recoveryMonth', key: 'recoveryMonth', width: 130 },
  { title: '登记时间', key: 'createTime', width: 150 },
];

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    items.value = await listNegativeFeedback({
      projectId: projectId.value.trim() || undefined,
      personId: personId.value.trim() || undefined,
    });
    loaded.value = true;
  } catch (cause) {
    items.value = [];
    errorMsg.value = ipdErrorText(cause, { fallback: '负反馈列表加载失败' });
  } finally {
    loading.value = false;
  }
}

const isEmpty = computed(() => loaded.value && !errorMsg.value && items.value.length === 0);

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="负反馈：主责停发 / 连带减半 / 共同担责（双 PM 共同担责无主次区分）；重复事件不重复扣减。"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="过滤条件">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号（可选）</div>
          <Input v-model:value="projectId" placeholder="按项目过滤" style="width: 200px" />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">人员编号（可选）</div>
          <Input v-model:value="personId" placeholder="按 PM 范围过滤" style="width: 200px" />
        </div>
        <button class="primary-button" type="button" @click="load">查询负反馈</button>
      </div>
    </Card>

    <Card title="负反馈列表">
      <Table
        :columns="columns"
        :data-source="items"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'trigger'">
            <Tag :color="triggerColor[record.trigger as NegativeTrigger]">{{ triggerText[record.trigger as NegativeTrigger] ?? record.trigger }}</Tag>
          </template>
          <template v-else-if="column.key === 'role'">
            <Tag :color="roleColor[record.role as NegativeRole]">{{ roleText[record.role as NegativeRole] ?? record.role }}</Tag>
          </template>
          <template v-else-if="column.key === 'executeMonth'">{{ record.executeMonth ?? '—' }}</template>
          <template v-else-if="column.key === 'recoveryMonth'">{{ record.recoveryMonth ?? '—' }}</template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
        </template>
        <template #emptyText>
          <Empty :description="errorMsg || (isEmpty ? '当前过滤条件下无负反馈记录' : (loaded ? '请调整过滤条件后查询' : '加载中…'))" />
        </template>
      </Table>
    </Card>
  </div>
</template>

<style scoped>
.primary-button {
  min-height: 38px;
  padding: 0 16px;
  font-weight: 700;
  color: white;
  cursor: pointer;
  background: var(--ipd-blue);
  border: 0;
  border-radius: 6px;
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
