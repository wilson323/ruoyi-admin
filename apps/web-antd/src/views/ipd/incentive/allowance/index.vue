<script setup lang="ts">
/**
 * 页33 津贴台账（卡 P0-10.33；后端 AllowanceLedgerController /allowance/ledger 已交付）。
 * 规则：L1~L5 基数 × 绑定项目数（封顶 2 倍）；综合分 < 60 停发。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Button, Card, Empty, Input, Table, Tag, message } from 'ant-design-vue';

import {
  type AllowanceLedger,
  type AllowanceStatus,
  listAllowances,
} from '../../../../api/ipd/allowance';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { formatMoney, formatDateTime } from '../../_shared/format';

defineOptions({ name: 'IpdAllowance', meta: { ipdCard: 'P0-10.33' } });

const period = ref(defaultPeriod());
const personId = ref('');
const items = ref<AllowanceLedger[]>([]);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const statusText: Record<AllowanceStatus, string> = {
  ACTIVE: '正常',
  FROZEN: '已冻结',
  PENDING_CONFIRM: '待确认',
};

const statusColor: Record<AllowanceStatus, string> = {
  ACTIVE: 'success',
  FROZEN: 'default',
  PENDING_CONFIRM: 'warning',
};

const columns = [
  { title: '津贴编号', dataIndex: 'id', key: 'id', width: 110 },
  { title: '人员', dataIndex: 'personId', key: 'personId', width: 110 },
  { title: '周期', dataIndex: 'period', key: 'period', width: 100 },
  { title: '等级', dataIndex: 'level', key: 'level', width: 70 },
  { title: '绑定项目数', dataIndex: 'projectCount', key: 'projectCount', width: 110 },
  { title: '金额（元）', key: 'amount', width: 130 },
  { title: '封顶', dataIndex: 'capReached', key: 'capReached', width: 80 },
  { title: '状态', key: 'status', width: 110 },
  { title: '生成时间', key: 'createTime', width: 150 },
];

async function load(): Promise<void> {
  if (!period.value.trim() || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    items.value = await listAllowances(period.value.trim(), personId.value.trim() || undefined);
    loaded.value = true;
  } catch (cause) {
    items.value = [];
    errorMsg.value = ipdErrorText(cause, { fallback: '津贴台账加载失败' });
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
      message="津贴台账：L1~L5 基数 × 绑定项目数（封顶 2 倍）；综合分 < 60 当月停发。"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="查询条件">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">核算周期（YYYY-MM）</div>
          <Input v-model:value="period" placeholder="2026-09" style="width: 160px" />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">人员编号（可选）</div>
          <Input v-model:value="personId" placeholder="按权限范围过滤" style="width: 200px" />
        </div>
        <Button type="primary" :loading="loading" @click="load">查询津贴</Button>
      </div>
    </Card>

    <Card title="津贴台账列表">
      <Table
        :columns="columns"
        :data-source="items"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'amount'">¥ {{ formatMoney(record.amount) }}</template>
          <template v-else-if="column.key === 'capReached'">{{ record.capReached ? '是' : '否' }}</template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="statusColor[record.status as AllowanceStatus]">{{ statusText[record.status as AllowanceStatus] ?? record.status }}</Tag>
          </template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
        </template>
        <template #emptyText>
          <Empty :description="errorMsg || (isEmpty ? '当前周期暂无津贴记录' : (loaded ? '请输入周期后查询' : '加载中…'))" />
        </template>
      </Table>
    </Card>
  </div>
</template>
