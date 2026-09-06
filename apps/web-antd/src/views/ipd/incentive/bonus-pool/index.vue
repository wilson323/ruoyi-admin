<script setup lang="ts">
/**
 * 奖金池核算（页34 激励-奖金池核算；卡 P0-10.34；后端 BonusPoolController 已交付）。
 *
 * 业务口径（2026-09-06 owner 裁决 [CONSISTENCY-1]）：
 *   基数 = 实际回款 × 5% × S/A/B 系数
 *   UI 三段呈现：实际回款 → 5% 基数 → S/A/B 系数 → 终算奖池
 *   目标销售额不再展示（G-08 红线 + 裁决）。
 *
 * 端点：POST /bonus-pool/compute（DRAFT 入库）→ POST /{id}/freeze（DRAFT→CONFIRMED）→ POST /{id}/distribute（CONFIRMED→DISTRIBUTED）。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Select,
  SelectOption,
  Space,
  Statistic,
  Table,
  Tag,
  message,
} from 'ant-design-vue';

import {
  type BonusPool,
  type BonusStatus,
  computeBonusPool,
  distributeBonusPool,
  freezeBonusPool,
  listBonusPools,
} from '../../../../api/ipd/bonus';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { formatDateTime, formatMoney, formatPercent, PENDING_TEXT } from '../../_shared/format';
import { ZK_RULE_BONUS_POOL_FORMULA, renderRulesDescription } from '../../_shared/zk-ipd-rules';

const BONUS_STATUS_TEXT: Record<BonusStatus, string> = {
  CONFIRMED: '已确认',
  DISTRIBUTED: '已分配',
  DRAFT: '草稿',
};

const BONUS_STATUS_COLOR: Record<BonusStatus, string> = {
  CONFIRMED: 'processing',
  DISTRIBUTED: 'success',
  DRAFT: 'default',
};

const PROJECT_LEVELS: Array<{ value: 'A' | 'B' | 'S'; label: string; coefficient: number }> = [
  { value: 'S', label: 'S 级（战略级，系数 1.5）', coefficient: 1.5 },
  { value: 'A', label: 'A 级（核心级，系数 1.2）', coefficient: 1.2 },
  { value: 'B', label: 'B 级（标准级，系数 1.0）', coefficient: 1.0 },
];

const DEFAULT_POOL_RATE = 5; // 5%（与裁决「实际回款×5%×S/A/B」一致；G-08 红线）

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

const bonusFormulaRule = renderRulesDescription([ZK_RULE_BONUS_POOL_FORMULA]);

const form = reactive({
  achievementRate: 100,
  levelCoefficient: 1,
  period: defaultPeriod(),
  poolRate: DEFAULT_POOL_RATE,
  projectId: '',
  projectLevel: 'A' as 'A' | 'B' | 'S',
  receiptAmounts: 0,
  tierCoefficient: 1,
});

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const canCompute = computed(() => form.projectId.trim() !== '' && form.period.trim() !== '' && Number(form.receiptAmounts) >= 0);

/** 三段实时预览（前端不替代后端裁决，只给用户直观感受公式）。 */
const previewReceipts = computed(() => Number(form.receiptAmounts) || 0);
const previewBasePool = computed(() => previewReceipts.value * (Number(form.poolRate) || 0) / 100);
const previewCoefficient = computed(() => (Number(form.levelCoefficient) || 0) * (Number(form.tierCoefficient) || 0));
const previewFinalPool = computed(() => previewBasePool.value * previewCoefficient.value);

/** 列表数据：按 projectId 过滤；projectId 为空时展示空态（避免误跨项目）。 */
const pools = ref<BonusPool[]>([]);
const loading = ref(false);
const errorMsg = ref('');

async function loadList() {
  if (!form.projectId.trim()) {
    pools.value = [];
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    pools.value = await listBonusPools(form.projectId.trim());
  } catch (cause) {
    pools.value = [];
    errorMsg.value = rejectText(cause);
  } finally {
    loading.value = false;
  }
}

const computing = ref(false);
const currentResult = ref<BonusPool | null>(null);

async function onCompute() {
  if (!canCompute.value || computing.value) return;
  computing.value = true;
  try {
    currentResult.value = await computeBonusPool({
      achievementRate: form.achievementRate,
      levelCoefficient: form.levelCoefficient,
      period: form.period.trim(),
      poolRate: form.poolRate,
      projectId: form.projectId.trim(),
      receiptAmounts: form.receiptAmounts,
      tierCoefficient: form.tierCoefficient,
    });
    message.success(`奖金池草稿已生成（DRAFT）：${formatMoney(currentResult.value.basePool)} × ${currentResult.value.coefficient ?? '—'} = ${formatMoney(currentResult.value.finalPool)}`);
    await loadList();
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    computing.value = false;
  }
}

const actionId = ref<string | null>(null);

async function onFreeze(pool: BonusPool | Record<string, any>) {
  const typed = pool as BonusPool;
  if (typed.status !== 'DRAFT' || actionId.value) return;
  actionId.value = typed.id;
  try {
    const updated = await freezeBonusPool(typed.id);
    message.success(`奖金池 ${updated.id} 已 DRAFT → CONFIRMED`);
    if (currentResult.value?.id === updated.id) currentResult.value = updated;
    await loadList();
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    actionId.value = null;
  }
}

async function onDistribute(pool: BonusPool | Record<string, any>) {
  const typed = pool as BonusPool;
  if (typed.status !== 'CONFIRMED' || actionId.value) return;
  actionId.value = typed.id;
  try {
    const updated = await distributeBonusPool(typed.id);
    message.success(`奖金池 ${updated.id} 已 CONFIRMED → DISTRIBUTED（生成内部台账）`);
    if (currentResult.value?.id === updated.id) currentResult.value = updated;
    await loadList();
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    actionId.value = null;
  }
}

onMounted(() => {
  // 首次进入不自动拉列表（必须先填 projectId），避免误跨项目。
});

const columns = [
  { title: '奖金池编号', dataIndex: 'id', key: 'id', width: 110 },
  { title: '项目编号', dataIndex: 'projectId', key: 'projectId', width: 110 },
  { title: '核算周期', dataIndex: 'period', key: 'period', width: 90 },
  { title: '项目等级', key: 'projectLevel', width: 90 },
  { title: '实际回款', key: 'receiptAmounts', width: 130 },
  { title: '基数（5%）', key: 'basePool', width: 130 },
  { title: '系数', key: 'coefficient', width: 90 },
  { title: '终算奖池', key: 'finalPool', width: 140 },
  { title: '达成率', key: 'achievementRate', width: 90 },
  { title: '状态', key: 'status', width: 100 },
  { title: '生成时间', key: 'createTime', width: 150 },
  { title: '操作', key: 'actions', width: 170 },
];

function levelText(level: null | string | undefined): string {
  if (level === 'S' || level === 'A' || level === 'B') return `${level} 级`;
  return PENDING_TEXT;
}

function onProjectLevelChange(value: 'A' | 'B' | 'S') {
  const target = PROJECT_LEVELS.find((item) => item.value === value);
  if (target) form.levelCoefficient = target.coefficient;
}
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`奖金池口径：实际回款 × 5% × S/A/B 系数（G-08 红线 · 2026-09-06 owner 裁决）。${bonusFormulaRule}`"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="三段核算预览（前端实时演算）">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Statistic
          title="① 实际回款"
          :value="previewReceipts"
          :precision="2"
          prefix="¥"
          :value-style="{ fontVariantNumeric: 'tabular-nums' }"
        />
        <Statistic
          title="② 5% 基数"
          :value="previewBasePool"
          :precision="2"
          prefix="¥"
          :value-style="{ fontVariantNumeric: 'tabular-nums' }"
        />
        <Statistic
          title="③ 系数（级别 × 等级）"
          :value="previewCoefficient"
          :precision="2"
          suffix="×"
          :value-style="{ fontVariantNumeric: 'tabular-nums' }"
        />
        <Statistic
          title="④ 终算奖池"
          :value="previewFinalPool"
          :precision="2"
          prefix="¥"
          :value-style="{ color: '#1677ff', fontVariantNumeric: 'tabular-nums' }"
        />
      </div>
    </Card>

    <Card class="mb-4" title="触发奖金池核算（POST /bonus-pool/compute）">
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 14 }">
        <FormItem label="项目编号" required>
          <Input v-model:value="form.projectId" placeholder="请输入项目编号" />
        </FormItem>
        <FormItem label="核算周期" required>
          <Input v-model:value="form.period" placeholder="YYYY-MM（例：2026-09）" />
        </FormItem>
        <FormItem label="项目等级">
          <Select v-model:value="form.projectLevel" @change="(value: unknown) => onProjectLevelChange(value as 'A' | 'B' | 'S')">
            <SelectOption v-for="item in PROJECT_LEVELS" :key="item.value" :value="item.value">
              {{ item.label }}
            </SelectOption>
          </Select>
        </FormItem>
        <FormItem label="实际回款金额" required>
          <InputNumber
            v-model:value="form.receiptAmounts"
            :min="0"
            :precision="2"
            :step="1000"
            class="w-full"
            placeholder="上市后连续 6 个月实际回款金额"
          />
        </FormItem>
        <FormItem label="基数比例（%）">
          <InputNumber v-model:value="form.poolRate" :min="0" :max="100" :precision="2" :step="0.5" class="w-full" />
          <div class="text-muted-foreground mt-1 text-xs">默认 5%（与裁决「实际回款×5%×S/A/B」一致）</div>
        </FormItem>
        <FormItem label="级别系数">
          <InputNumber v-model:value="form.levelCoefficient" :min="0" :precision="2" :step="0.1" class="w-full" />
        </FormItem>
        <FormItem label="层级系数">
          <InputNumber v-model:value="form.tierCoefficient" :min="0" :precision="2" :step="0.1" class="w-full" />
        </FormItem>
        <FormItem label="达成率（%）">
          <InputNumber v-model:value="form.achievementRate" :min="0" :max="999" :precision="2" class="w-full" />
        </FormItem>
        <FormItem :wrapper-col="{ offset: 6, span: 14 }">
          <Space>
            <Button type="primary" :disabled="!canCompute" :loading="computing" @click="onCompute">
              触发核算（落库 DRAFT）
            </Button>
            <Button :disabled="!form.projectId.trim()" :loading="loading" @click="loadList">
              刷新列表
            </Button>
          </Space>
        </FormItem>
      </Form>
    </Card>

    <Card v-if="currentResult" class="mb-4" :title="`当前核算结果 #${currentResult.id}`">
      <Descriptions bordered :column="2" size="small">
        <DescriptionsItem label="奖金池编号">{{ currentResult.id }}</DescriptionsItem>
        <DescriptionsItem label="项目编号">{{ currentResult.projectId }}</DescriptionsItem>
        <DescriptionsItem label="核算周期">{{ currentResult.period ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="项目等级">{{ levelText(currentResult.projectLevel) }}</DescriptionsItem>
        <DescriptionsItem label="实际回款">¥ {{ formatMoney(currentResult.receiptAmounts ?? null) }}</DescriptionsItem>
        <DescriptionsItem label="基数比例">{{ formatPercent(currentResult.poolRate ?? null) }}</DescriptionsItem>
        <DescriptionsItem label="基数">¥ {{ formatMoney(currentResult.basePool ?? null) }}</DescriptionsItem>
        <DescriptionsItem label="系数">{{ currentResult.coefficient ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="终算奖池">
          <strong class="text-primary">¥ {{ formatMoney(currentResult.finalPool ?? null) }}</strong>
        </DescriptionsItem>
        <DescriptionsItem label="状态">
          <Tag :color="BONUS_STATUS_COLOR[currentResult.status]">{{ BONUS_STATUS_TEXT[currentResult.status] ?? currentResult.status }}</Tag>
        </DescriptionsItem>
        <DescriptionsItem label="生成时间">{{ formatDateTime(currentResult.createTime) }}</DescriptionsItem>
        <DescriptionsItem label="达成率">{{ formatPercent(currentResult.achievementRate ?? null) }}</DescriptionsItem>
      </Descriptions>
      <Space class="mt-3">
        <Button
          v-if="currentResult.status === 'DRAFT'"
          :loading="actionId === currentResult.id"
          type="primary"
          @click="onFreeze(currentResult)"
        >
          冻结（DRAFT → CONFIRMED）
        </Button>
        <Button
          v-if="currentResult.status === 'CONFIRMED'"
          :loading="actionId === currentResult.id"
          type="primary"
          @click="onDistribute(currentResult)"
        >
          分配（CONFIRMED → DISTRIBUTED）
        </Button>
        <Tag v-if="currentResult.status === 'DISTRIBUTED'" color="success">已分配（生成内部台账）</Tag>
      </Space>
    </Card>

    <Card title="奖金池列表（按项目过滤）">
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
          <template v-else-if="column.key === 'actions'">
            <Button
              v-if="record.status === 'DRAFT'"
              size="small"
              type="link"
              :loading="actionId === record.id"
              @click="onFreeze(record)"
            >
              冻结
            </Button>
            <Button
              v-if="record.status === 'CONFIRMED'"
              size="small"
              type="link"
              :loading="actionId === record.id"
              @click="onDistribute(record)"
            >
              分配
            </Button>
            <span v-if="record.status === 'DISTRIBUTED'" class="text-muted-foreground text-xs">已分配</span>
          </template>
        </template>
        <template #emptyText>
          <Empty :description="errorMsg || '请先填写项目编号后点击「刷新列表」'" />
        </template>
      </Table>
    </Card>
  </div>
</template>