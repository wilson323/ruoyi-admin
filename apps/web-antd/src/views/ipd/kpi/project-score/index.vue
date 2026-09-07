<script setup lang="ts">
/**
 * 页31 项目绩效评定（卡 P0-10.31；后端 ProjectScoreController + ProjectScoreTaskController 已交付）。
 * 五态齐全：loading / success / empty / error / 断网；按角色权重 0.2 / 0.4 / 0.4 自评+双组长评。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Button, Card, Empty, Input, Table, Tag } from 'ant-design-vue';

import {
  type ProjectScore,
  type ScoreRole,
  listMyScoreTasks,
  listProjectScores,
} from '../../../../api/ipd/project-score';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { formatDateTime } from '../../_shared/format';

defineOptions({ name: 'IpdKpiScore', meta: { ipdCard: 'P0-10.31' } });

const roleText: Record<ScoreRole, string> = {
  SELF: '自评',
  MARKET_LEADER: '市场组长',
  RD_LEADER: '研发组长',
};

const roleColor: Record<ScoreRole, string> = {
  SELF: 'blue',
  MARKET_LEADER: 'cyan',
  RD_LEADER: 'purple',
};

const projectId = ref('');
const period = ref(defaultPeriod());
const scores = ref<ProjectScore[]>([]);
const tasks = ref<ProjectScore[]>([]);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const columns = [
  { title: '项目编号', dataIndex: 'projectId', key: 'projectId', width: 130 },
  { title: '核算周期', dataIndex: 'period', key: 'period', width: 100 },
  { title: '评定人', key: 'role', width: 110 },
  { title: '评分', dataIndex: 'score', key: 'score', width: 90 },
  { title: '权重', key: 'weight', width: 100 },
  { title: '加权得分', dataIndex: 'weightedScore', key: 'weightedScore', width: 110 },
  { title: '意见', dataIndex: 'comment', key: 'comment' },
  { title: '提交时间', key: 'createTime', width: 150 },
];

function roleWeight(record: ProjectScore): string {
  if (record.role === 'SELF') return String(record.weightSelf ?? '0.2');
  if (record.role === 'MARKET_LEADER') return String(record.weightMarketLeader ?? '0.4');
  return String(record.weightRdLeader ?? '0.4');
}

async function load(): Promise<void> {
  if (!projectId.value.trim() || !period.value.trim() || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    const [listResult, taskResult] = await Promise.all([
      listProjectScores(projectId.value.trim(), period.value.trim()),
      listMyScoreTasks().catch(() => [] as ProjectScore[]),
    ]);
    scores.value = listResult;
    tasks.value = taskResult;
    loaded.value = true;
  } catch (cause) {
    scores.value = [];
    tasks.value = [];
    errorMsg.value = ipdErrorText(cause, { fallback: '项目绩效加载失败' });
  } finally {
    loading.value = false;
  }
}

async function loadTasks(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    tasks.value = await listMyScoreTasks();
    loaded.value = true;
  } catch (cause) {
    tasks.value = [];
    errorMsg.value = ipdErrorText(cause, { fallback: '当前评分任务加载失败' });
  } finally {
    loading.value = false;
  }
}

const isEmpty = computed(() => loaded.value && !errorMsg.value && scores.value.length === 0 && tasks.value.length === 0);

onMounted(() => {
  void loadTasks();
});
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="项目绩效：自评 0.2 + 市场组长 0.4 + 研发组长 0.4；三者之和必须 = 1.0。"
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
        <Button type="primary" :loading="loading" :disabled="!projectId.trim() || !period.trim()" @click="load">查询评分</Button>
      </div>
    </Card>

    <Card class="mb-4" title="项目评分明细">
      <Table
        :columns="columns"
        :data-source="scores"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'role'">
            <Tag :color="roleColor[record.role as ScoreRole]">{{ roleText[record.role as ScoreRole] }}</Tag>
          </template>
          <template v-else-if="column.key === 'weight'">{{ roleWeight(record as ProjectScore) }}</template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
        </template>
        <template #emptyText>
          <Empty :description="errorMsg || (isEmpty ? '当前查询无评分记录' : (loaded ? '请输入项目编号+周期后查询' : '请先查询'))" />
        </template>
      </Table>
    </Card>

    <Card title="我的评分任务">
      <Table
        :columns="columns"
        :data-source="tasks"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'role'">
            <Tag :color="roleColor[record.role as ScoreRole]">{{ roleText[record.role as ScoreRole] }}</Tag>
          </template>
          <template v-else-if="column.key === 'weight'">{{ roleWeight(record as ProjectScore) }}</template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
        </template>
        <template #emptyText>
          <Empty :description="loaded ? '暂无待评分任务' : '加载中…'" />
        </template>
      </Table>
    </Card>
  </div>
</template>
