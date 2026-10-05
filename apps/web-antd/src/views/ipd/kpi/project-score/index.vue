<script setup lang="ts">
/**
 * 页31 项目绩效评定（卡 P0-10.31；后端 ProjectScoreController 已交付）。
 * 2026-09-08 契约对齐：改 GET /project-scores/{projectId}/{personId} 单视图
 * （三角色并排 + 加权 + 版本），原 /list /project-score-tasks/my 为臆造路径。
 * 2026-09-08 后端补交：GET /project-score-tasks/my 已交付，本页「我的评分任务」
 * 卡片已接线（我的自评 + 我当组长的成员评审，均限 PENDING）。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Button, Card, Descriptions, DescriptionsItem, Empty, Input, Table, Tag } from 'ant-design-vue';

import {
  type MyScoreTask,
  type ProjectScoreView,
  getProjectScore,
  listMyScoreTasks,
  settleProjectScore,
} from '../../../../api/ipd/project-score';
import { ipdErrorText } from '../../_shared/ipd-error-text';
defineOptions({ name: 'IpdKpiScore', meta: { ipdBackend: 'ProjectScoreController 已交付：GET /project-scores/{projectId}/{personId}、POST /{projectId}/{personId}/settle；TaskController GET /project-score-tasks/my 补交已接入。', ipdCard: 'P0-10.31' } });

const projectId = ref('');
const personId = ref('');
const view = ref<null | ProjectScoreView>(null);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

async function load(): Promise<void> {
  const pid = projectId.value.trim();
  const uid = personId.value.trim();
  if (!pid || !uid || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    view.value = await getProjectScore(pid, uid);
    loaded.value = true;
  } catch (cause) {
    view.value = null;
    errorMsg.value = ipdErrorText(cause, { fallback: '项目绩效加载失败' });
  } finally {
    loading.value = false;
  }
}

async function settle(): Promise<void> {
  const pid = projectId.value.trim();
  const uid = personId.value.trim();
  if (!pid || !uid || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    view.value = await settleProjectScore(pid, uid);
    loaded.value = true;
  } catch (cause) {
    errorMsg.value = ipdErrorText(cause, { fallback: '结算失败' });
  } finally {
    loading.value = false;
  }
}

const isEmpty = computed(() => loaded.value && !errorMsg.value && !view.value);

/* ===== 我的在途评分任务（GET /project-score-tasks/my；2026-09-08 后端补交后接线） ===== */
const myTasks = ref<MyScoreTask[]>([]);
const myTasksLoading = ref(false);
const myTasksError = ref('');

const myTaskColumns = [
  { title: '项目编码', dataIndex: 'projectCode', key: 'projectCode' },
  {
    title: '类型',
    dataIndex: 'targetType',
    key: 'targetType',
  },
  { title: '被评人', dataIndex: 'personName', key: 'personName' },
  { title: '项目 ID（查询用）', dataIndex: 'projectId', key: 'projectId' },
  { title: '人员 ID（查询用）', dataIndex: 'personId', key: 'personId' },
  { title: '截止时间', dataIndex: 'dueAt', key: 'dueAt' },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '操作', key: 'action' },
];

/** 2026-10-06 E2E 修复：后端只收数字 projectId/personId，页面却只展示业务编码/登录名，
 * 照页面文字手输必 400。任务行加「查询此任务」一键回填真实数字 ID；
 * 同时补两列 ID 参照 + dueAt 毫秒值格式化（原样显示 1777651200000 不可读）。 */
function formatDueAt(value: null | number | string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  }
  return String(value);
}

function applyTask(record: Record<string, any>): void {
  const task = record as MyScoreTask;
  projectId.value = String(task.projectId ?? '');
  personId.value = String(task.personId ?? '');
  void load();
}

async function loadMyTasks(): Promise<void> {
  if (myTasksLoading.value) return;
  myTasksLoading.value = true;
  myTasksError.value = '';
  try {
    myTasks.value = await listMyScoreTasks();
  } catch (cause) {
    myTasks.value = [];
    myTasksError.value = ipdErrorText(cause, { fallback: '我的评分任务加载失败' });
  } finally {
    myTasksLoading.value = false;
  }
}

onMounted(loadMyTasks);
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="项目绩效：自评 0.2 + 市场组长 0.4 + 研发组长 0.4，三者之和必须 = 1.0；双 PM 项目分独立；重提生成新版本，三角色齐备后可结算。"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="按项目 + 人员查询（双 PM 各自独立评分）">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号（必填，数字 ID；可从下方任务表一键回填）</div>
          <Input v-model:value="projectId" placeholder="数字项目 ID，如 9150001" style="width: 200px" />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">人员编号（必填，被评 PM 数字 ID；可从下方任务表一键回填）</div>
          <Input v-model:value="personId" placeholder="数字人员 ID，如 900103" style="width: 200px" />
        </div>
        <Button type="primary" :loading="loading" :disabled="!projectId.trim() || !personId.trim()" @click="load">
          查询评分
        </Button>
        <Button
          :disabled="!projectId.trim() || !personId.trim() || loading || !view"
          :loading="loading"
          @click="settle"
        >
          结算当前版本
        </Button>
      </div>
    </Card>

    <Card class="mb-4" title="评分视图">
      <Empty v-if="errorMsg || isEmpty || !view" :description="errorMsg || (isEmpty ? '该项目人员暂无评分记录' : '请输入项目 + 人员编号后查询')" />
      <Descriptions v-else :column="3" bordered size="small">
        <DescriptionsItem label="项目编号">{{ view.projectId }}</DescriptionsItem>
        <DescriptionsItem label="被评 PM">{{ view.personId }}</DescriptionsItem>
        <DescriptionsItem label="PM 角色">{{ view.pmRole ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="自评（权重 0.2）">{{ view.selfScore ?? '未提交' }}</DescriptionsItem>
        <DescriptionsItem label="市场组长评（权重 0.4）">{{ view.marketLeaderScore ?? '未提交' }}</DescriptionsItem>
        <DescriptionsItem label="研发组长评（权重 0.4）">{{ view.rdLeaderScore ?? '未提交' }}</DescriptionsItem>
        <DescriptionsItem label="加权得分">{{ view.weightedScore ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="评分版本">v{{ view.versionNo ?? '—' }}（规则 v{{ view.ruleVersion ?? '—' }}）</DescriptionsItem>
        <DescriptionsItem label="结算状态">
          <Tag :color="view.settled ? 'green' : 'default'">{{ view.settled ? '已结算' : '未结算' }}</Tag>
        </DescriptionsItem>
      </Descriptions>
    </Card>

    <Card title="我的评分任务（在途 PENDING；我的自评 + 我当组长的成员评审）">
      <Alert v-if="myTasksError" :message="myTasksError" show-icon type="error" class="mb-3" />
      <Alert
        v-else-if="!myTasksLoading && myTasks.length === 0"
        message="当前无在途评分待办（任务由上市 30/90 日扫描生成；全部完成或未到期限时为空）。"
        show-icon
        type="info"
      />
      <Table
        v-else
        :columns="myTaskColumns"
        :data-source="myTasks"
        :loading="myTasksLoading"
        :pagination="false"
        :row-key="(r: MyScoreTask) => `${r.projectId}-${r.targetType}-${r.personId}`"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'targetType'">
            <Tag :color="record.targetType === 'SELF_SCORING' ? 'blue' : 'purple'">
              {{ record.targetType === 'SELF_SCORING' ? '自评（上市 30 日）' : '组长评审（上市 90 日）' }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'dueAt'">
            <span :class="record.overdue ? 'text-red-500 font-medium' : ''">
              {{ formatDueAt(record.dueAt) }}{{ record.overdue ? '（已逾期）' : '' }}
            </span>
          </template>
          <template v-else-if="column.key === 'projectId'">
            <span class="tabular-nums">{{ record.projectId ?? '—' }}</span>
          </template>
          <template v-else-if="column.key === 'personId'">
            <span class="tabular-nums">{{ record.personId ?? '—' }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <Button size="small" type="link" @click="applyTask(record)">查询此任务</Button>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag color="orange">{{ record.status ?? '—' }}</Tag>
          </template>
        </template>
      </Table>
    </Card>

  </div>
</template>
