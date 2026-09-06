<script setup lang="ts">
/**
 * 页35 贡献度评定（卡 P0-10.35；后端 ContributionController 已交付）。
 * 规则：市场 PM 40-65% / 研发 PM 35-60%；上市 90 天复盘三方评定；归档版本可追溯。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Button, Card, Empty, Input, Table, Tag } from 'ant-design-vue';

import {
  type ContributionVersion,
  getCurrentContribution,
  listContributionVersions,
} from '../../../../api/ipd/contribution';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { formatPercent, formatDateTime } from '../../_shared/format';

defineOptions({ name: 'IpdContribution', meta: { ipdCard: 'P0-10.35' } });

const projectId = ref('');
const period = ref(defaultPeriod());
const versions = ref<ContributionVersion[]>([]);
const current = ref<null | ContributionVersion>(null);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const statusText: Record<ContributionVersion['status'], string> = {
  CONFIRMED: '已确认',
  DRAFT: '草稿',
};

const statusColor: Record<ContributionVersion['status'], string> = {
  CONFIRMED: 'success',
  DRAFT: 'default',
};

const columns = [
  { title: '版本号', dataIndex: 'version', key: 'version', width: 80 },
  { title: '状态', key: 'status', width: 100 },
  { title: '市场 PM 占比', key: 'market', width: 130 },
  { title: '研发 PM 占比', key: 'rd', width: 130 },
  { title: '市场 PM 占比下限', dataIndex: 'contributionMarketMin', key: 'marketMin', width: 150 },
  { title: '研发 PM 占比上限', dataIndex: 'contributionRdMax', key: 'rdMax', width: 150 },
  { title: '归档时间', key: 'archivedAt', width: 160 },
];

async function load(): Promise<void> {
  if (!projectId.value.trim() || !period.value.trim() || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    versions.value = await listContributionVersions(projectId.value.trim(), period.value.trim());
    try {
      current.value = await getCurrentContribution(projectId.value.trim(), period.value.trim());
    } catch {
      current.value = null;
    }
    loaded.value = true;
  } catch (cause) {
    versions.value = [];
    current.value = null;
    errorMsg.value = ipdErrorText(cause, { fallback: '贡献度版本加载失败' });
  } finally {
    loading.value = false;
  }
}

const isEmpty = computed(() => loaded.value && !errorMsg.value && versions.value.length === 0);

onMounted(() => {
  // 首次进入不自动拉（必须先填 projectId），避免误跨项目。
});
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="贡献度：市场 PM 40-65% / 研发 PM 35-60%；归档版本可追溯，奖金引用同一版本。"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="按项目+周期查询">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号</div>
          <Input v-model:value="projectId" placeholder="请输入项目编号" style="width: 200px" />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">核算周期（YYYY-MM）</div>
          <Input v-model:value="period" placeholder="2026-09" style="width: 140px" />
        </div>
        <Button type="primary" :loading="loading" :disabled="!projectId.trim() || !period.trim()" @click="load">查询版本</Button>
      </div>
    </Card>

    <Card v-if="current" class="mb-4" :title="`当前生效版本 v${current.version}`">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div><span class="text-xs text-gray-500">市场 PM 占比：</span><strong>{{ formatPercent(current.marketPmShare) }}</strong></div>
        <div><span class="text-xs text-gray-500">研发 PM 占比：</span><strong>{{ formatPercent(current.rdPmShare) }}</strong></div>
        <div><span class="text-xs text-gray-500">状态：</span><Tag :color="statusColor[current.status]">{{ statusText[current.status] }}</Tag></div>
      </div>
    </Card>

    <Card title="贡献度版本列表（含历史归档）">
      <Table
        :columns="columns"
        :data-source="versions"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <Tag :color="statusColor[record.status as ContributionVersion['status']]">{{ statusText[record.status as ContributionVersion['status']] ?? record.status }}</Tag>
          </template>
          <template v-else-if="column.key === 'market'">{{ formatPercent(record.marketPmShare) }}</template>
          <template v-else-if="column.key === 'rd'">{{ formatPercent(record.rdPmShare) }}</template>
          <template v-else-if="column.key === 'archivedAt'">{{ formatDateTime(record.archivedAt) }}</template>
        </template>
        <template #emptyText>
          <Empty :description="errorMsg || (isEmpty ? '该项目当前周期无版本记录' : (loaded ? '请输入项目编号+周期后查询' : '请先查询'))" />
        </template>
      </Table>
    </Card>
  </div>
</template>
