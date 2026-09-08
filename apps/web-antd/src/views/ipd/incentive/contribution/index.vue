<script setup lang="ts">
/**
 * 页35 贡献度评定（卡 P0-10.35；后端 ContributionController 已交付）。
 * 2026-09-08 契约对齐：改 GET /contributions/{projectId} 单项目视图
 * （占比 + 五维 + 系数 + 决策链），原 /versions /current /submit 为臆造路径。
 * 2026-09-08 后端补交：GET /{projectId}/versions 归档快照列表已交付，
 * 本页「版本历史」卡片已接线（每次组长 APPROVE 确认归档一份，BR-INC-09）。
 */
import { computed, ref } from 'vue';
import { Alert, Button, Card, Descriptions, DescriptionsItem, Empty, Input, Table, Tag } from 'ant-design-vue';

import {
  type ContributionVersion,
  type ContributionView,
  getContribution,
  listContributionVersions,
} from '../../../../api/ipd/contribution';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { formatDateTime } from '../../_shared/format';

defineOptions({ name: 'IpdContribution', meta: { ipdCard: 'P0-10.35' } });

const projectId = ref('');
const view = ref<null | ContributionView>(null);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

function sharePercent(value: null | number | string): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  return Number.isFinite(num) ? `${(num * 100).toFixed(1)}%` : String(value);
}

async function load(): Promise<void> {
  const pid = projectId.value.trim();
  if (!pid || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  versionsError.value = '';
  try {
    view.value = await getContribution(pid);
    loaded.value = true;
  } catch (cause) {
    view.value = null;
    errorMsg.value = ipdErrorText(cause, { fallback: '贡献度加载失败' });
  } finally {
    loading.value = false;
  }
  // 版本历史随查询同拉（独立容错：失败不影响当前视图展示）
  if (pid) {
    try {
      versions.value = await listContributionVersions(pid);
    } catch (cause) {
      versions.value = [];
      versionsError.value = ipdErrorText(cause, { fallback: '版本历史加载失败' });
    }
  }
}

const isEmpty = computed(() => loaded.value && !errorMsg.value && !view.value);

const decisionText: Record<string, string> = {
  APPROVE: '通过',
  REJECT: '驳回',
};

/* ===== 版本历史（GET /{projectId}/versions；确认时刻归档快照） ===== */
const versions = ref<ContributionVersion[]>([]);
const versionsError = ref('');

const versionColumns = [
  { title: '版次', dataIndex: 'versionNo', key: 'versionNo' },
  { title: '市场占比', dataIndex: 'marketShare', key: 'marketShare' },
  { title: '研发占比', dataIndex: 'rdShare', key: 'rdShare' },
  { title: '系数', dataIndex: 'tierCoefficient', key: 'tierCoefficient' },
  { title: '组长决策', dataIndex: 'leaderDecision', key: 'leaderDecision' },
  { title: '归档时间', dataIndex: 'archivedAt', key: 'archivedAt' },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="贡献度：市场 PM 40-65% / 研发 PM 35-60%（联动）；上市 90 天复盘三方评定；组长确认后奖金引用同一版本；退出/移交不静默重新分配。"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="按项目查询（贡献度按项目归档，无周期维度）">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号（必填）</div>
          <Input v-model:value="projectId" placeholder="请输入项目编号" style="width: 220px" />
        </div>
        <Button type="primary" :loading="loading" :disabled="!projectId.trim()" @click="load">查询贡献度</Button>
      </div>
    </Card>

    <Card class="mb-4" title="当前贡献度视图">
      <Empty v-if="errorMsg || isEmpty || !view" :description="errorMsg || (isEmpty ? '该项目暂无贡献度记录' : '请输入项目编号后查询')" />
      <Descriptions v-else :column="3" bordered size="small">
        <DescriptionsItem label="项目编号">{{ view.projectId }}</DescriptionsItem>
        <DescriptionsItem label="状态">
          <Tag :color="view.status === 'CONFIRMED' ? 'success' : 'default'">
            {{ view.status === 'CONFIRMED' ? '已确认' : (view.status ?? '—') }}
          </Tag>
        </DescriptionsItem>
        <DescriptionsItem label="权重合法性">
          <Tag :color="view.weightsValid ? 'green' : 'red'">{{ view.weightsValid ? '合法' : '非法' }}</Tag>
        </DescriptionsItem>
        <DescriptionsItem label="市场 PM 占比">{{ sharePercent(view.marketShare) }}</DescriptionsItem>
        <DescriptionsItem label="研发 PM 占比">{{ sharePercent(view.rdShare) }}</DescriptionsItem>
        <DescriptionsItem label="贡献度系数">{{ view.tierCoefficient ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="主动性">{{ view.dimInitiation ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="创新性">{{ view.dimInnovation ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="上市达成">{{ view.dimLaunch ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="市场结果">{{ view.dimMarketResult ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="领导力">{{ view.dimLeadership ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="提交时间">{{ view.submittedAt ? formatDateTime(view.submittedAt) : '—' }}</DescriptionsItem>
        <DescriptionsItem label="组长决策">
          {{ view.leaderDecision ? (decisionText[view.leaderDecision] ?? view.leaderDecision) : '待决策' }}
        </DescriptionsItem>
        <DescriptionsItem label="决策时间">{{ view.leaderDecidedAt ? formatDateTime(view.leaderDecidedAt) : '—' }}</DescriptionsItem>
        <DescriptionsItem label="组长意见">{{ view.leaderOpinion ?? '—' }}</DescriptionsItem>
      </Descriptions>
    </Card>

    <Card title="版本历史（历次确认归档快照；REJECT 退回后重新确认产生新版本）">
      <Alert v-if="versionsError" :message="versionsError" show-icon type="error" class="mb-3" />
      <Alert
        v-else-if="!loading && versions.length === 0"
        message="暂无确认归档版本（每次组长 APPROVE 确认时归档一份快照；尚未确认或被驳回未重提时为空）。"
        show-icon
        type="info"
      />
      <Table
        v-else
        :columns="versionColumns"
        :data-source="versions"
        :loading="loading"
        :pagination="false"
        :row-key="(r: ContributionVersion) => String(r.id)"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'versionNo'">
            <Tag color="green">v{{ record.versionNo ?? '—' }}</Tag>
          </template>
          <template v-else-if="column.key === 'marketShare'">{{ sharePercent(record.marketShare) }}</template>
          <template v-else-if="column.key === 'rdShare'">{{ sharePercent(record.rdShare) }}</template>
          <template v-else-if="column.key === 'leaderDecision'">
            {{ record.leaderDecision ? (decisionText[record.leaderDecision] ?? record.leaderDecision) : '—' }}
          </template>
          <template v-else-if="column.key === 'archivedAt'">
            {{ record.archivedAt ? formatDateTime(record.archivedAt) : '—' }}
          </template>
        </template>
      </Table>
    </Card>
  </div>
</template>
