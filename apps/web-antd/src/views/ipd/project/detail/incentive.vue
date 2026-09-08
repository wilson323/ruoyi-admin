<script setup lang="ts">
/**
 * 项目详情 - 激励台账 子页签（卡 P0-10.37；后端 BonusPoolController 已交付）。
 *
 * 端点真值（HTTP 401 已验证端点存在 + 需 token）：
 *   GET /api/v1/bonus-pool/list?projectId=&status=
 *   GET /api/v1/bonus-pool/{id}
 *
 * 本页是项目维度的奖金池列表 + 摘要展示；算/冻/分的完整操作请到
 * 「奖金池核算」页（/ipd/incentive/bonus-pool，P0-10.34），按 G-08 红线
 * 不在多个入口重复写操作按钮（防止口径分歧）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Empty,
  Table,
  Tag,
  message,
} from 'ant-design-vue';

import {
  type BonusPool,
  type BonusStatus,
  listBonusPools,
} from '../../../../api/ipd/bonus';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import {
  formatDateTime,
  formatMoney,
  formatPercent,
  PENDING_TEXT,
} from '../../_shared/format';
import {
  bonusStateLabel,
  bonusStateTone,
  STATUS_TONE,
} from '../../_shared/ipd-enums';

defineOptions({
  name: 'IpdProjectIncentive',
  meta: {
    ipdBackend: 'BonusPoolController 已交付：GET /bonus-pool/list?projectId&status、GET /{id}。算/冻/分操作在 /ipd/incentive/bonus-pool 页。',
    ipdCard: 'P0-10.37',
  },
});

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));

/** 状态机 label/tone 走 _shared/ipd-enums 集中表，本地仅留状态名映射别名。 */
const BONUS_STATUS_TEXT: Record<BonusStatus, string> = {
  CONFIRMED: bonusStateLabel('CONFIRMED'),
  DISTRIBUTED: bonusStateLabel('DISTRIBUTED'),
  DRAFT: bonusStateLabel('DRAFT'),
};

const BONUS_STATUS_COLOR: Record<BonusStatus, string> = {
  CONFIRMED: STATUS_TONE.CONFIRMED ?? bonusStateTone('CONFIRMED'),
  DISTRIBUTED: STATUS_TONE.DISTRIBUTED ?? bonusStateTone('DISTRIBUTED'),
  DRAFT: STATUS_TONE.DRAFT ?? bonusStateTone('DRAFT'),
};

const pools = ref<BonusPool[]>([]);
const loading = ref(false);
const errorMsg = ref('');

async function loadList() {
  const id = projectId.value.trim();
  if (!id) {
    pools.value = [];
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    pools.value = await listBonusPools(id);
  } catch (cause) {
    pools.value = [];
    errorMsg.value = ipdErrorText(cause);
    message.error(errorMsg.value);
  } finally {
    loading.value = false;
  }
}

onMounted(loadList);

function levelText(level: null | string | undefined): string {
  if (level === 'S' || level === 'A' || level === 'B') return `${level} 级`;
  return PENDING_TEXT;
}

const columns = [
  { title: '奖金池编号', dataIndex: 'id', key: 'id', width: 110 },
  { title: '核算周期', dataIndex: 'period', key: 'period', width: 100 },
  { title: '项目等级', key: 'projectLevel', width: 90 },
  { title: '实际回款', key: 'receiptAmounts', width: 130 },
  { title: '基数（5%）', key: 'basePool', width: 130 },
  { title: '系数', key: 'coefficient', width: 90 },
  { title: '终算奖池', key: 'finalPool', width: 140 },
  { title: '达成率', key: 'achievementRate', width: 90 },
  { title: '状态', key: 'status', width: 110 },
  { title: '生成时间', key: 'createTime', width: 150 },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`项目激励台账：${projectId || '尚未选择项目'} · 算/冻/分完整操作请到「奖金池核算」页。`"
      show-icon
      type="info"
    />

    <Card title="本项目奖金池记录">
      <template #extra>
        <Button :loading="loading" size="small" @click="loadList">刷新</Button>
      </template>
      <Table
        :columns="columns"
        :data-source="pools"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'projectLevel'">{{ levelText(record.projectLevel) }}</template>
          <template v-else-if="column.key === 'receiptAmounts'">¥ {{ formatMoney(record.receiptAmounts ?? null) }}</template>
          <template v-else-if="column.key === 'basePool'">¥ {{ formatMoney(record.basePool) }}</template>
          <template v-else-if="column.key === 'coefficient'">{{ formatPercent(record.coefficient, '') }}</template>
          <template v-else-if="column.key === 'finalPool'">
            <strong class="text-primary">¥ {{ formatMoney(record.finalPool) }}</strong>
          </template>
          <template v-else-if="column.key === 'achievementRate'">{{ formatPercent(record.achievementRate) }}</template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="BONUS_STATUS_COLOR[record.status as BonusStatus] ?? 'default'">
              {{ BONUS_STATUS_TEXT[record.status as BonusStatus] ?? record.status }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
        </template>
        <template #emptyText>
          <Empty
            :description="
              projectId
                ? errorMsg || '该项目暂无奖金池记录，请到「奖金池核算」页触发核算'
                : '请先选择项目'
            "
          />
        </template>
      </Table>
    </Card>
  </div>
</template>