<script setup lang="ts">
/**
 * 页35 贡献度评定（卡 P0-10.35；后端 ContributionController 已交付）。
 * 2026-09-08 契约对齐：改 GET /contributions/{projectId} 单项目视图
 * （占比 + 五维 + 系数 + 决策链），原 /versions /current /submit 为臆造路径。
 * 「版本历史列表」端点后端未交付（仅当前视图），页内登记真缺口。
 */
import { computed, ref } from 'vue';
import { Alert, Button, Card, Descriptions, DescriptionsItem, Empty, Input, Tag } from 'ant-design-vue';

import {
  type ContributionView,
  getContribution,
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
  try {
    view.value = await getContribution(pid);
    loaded.value = true;
  } catch (cause) {
    view.value = null;
    errorMsg.value = ipdErrorText(cause, { fallback: '贡献度加载失败' });
  } finally {
    loading.value = false;
  }
}

const isEmpty = computed(() => loaded.value && !errorMsg.value && !view.value);

const decisionText: Record<string, string> = {
  APPROVE: '通过',
  REJECT: '驳回',
};
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

    <Card title="版本历史">
      <Alert
        message="真缺口登记：「归档版本历史列表」端点后端未交付（GET /api/v1/contributions/{projectId} 仅返回当前视图，无版本列表端点），待后端补版本追溯端点后接线。保存/预览/调整/确认等写操作入口在项目详情激励流程中，本页当前为只读查询。"
        show-icon
        type="warning"
      />
    </Card>
  </div>
</template>
