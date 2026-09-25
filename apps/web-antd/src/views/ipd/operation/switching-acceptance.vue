<script setup lang="ts">
/**
 * 月度切换验收（R215 GAP-F5，A23 预留兑现；SwitchingAcceptanceController P3-7.1；BR-INC-12/AC-INC-50/51）。
 *
 * 区块：
 * - 已 run 月份列表（GET /switching-acceptance；点击月份拉取报告详情）；
 * - 月份选择（DatePicker picker=month，value-format YYYY-MM 保证补零——2026-8 会被 api 层守卫拦）；
 * - 报告详情：checks 校验明细表（passed/expected/actual/diff/note + 四数值列）+
 *   summary 计数 + diffRate 总差异率原样展示（BigDecimal 精度串禁 parseFloat/Number，展示层不改数值）；
 * - run / lock / unlock 写按钮（v-access 分码：LOCK=run+lock、UNLOCK=unlock；
 *   ADMIN_WRITE 仅超管——控制器 2026-09-09 收紧注 :36-39；admin 别名是死码禁做门禁）；
 * - unlock Modal：reason 5~500 字前端预校验（对齐 @Size(5,500)，api 层同口径双闸）。
 *
 * ID/精度口径：ranBy/lockedBy/unlockedBy 19 位雪花 string 透传（api 层归一）；
 * isLocked/passed 布尔严格；NON_NULL 缺键展示「待补充」。五态对齐 recovery-warnings phase 范式。
 */
import { computed, onMounted, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  DescriptionsItem,
  Empty,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Textarea,
  message as antMessage,
} from 'ant-design-vue';
import dayjs, { type Dayjs } from 'dayjs';

import {
  type SwitchingAcceptanceReportView,
  getSwitchingAcceptance,
  listSwitchingAcceptance,
  lockSwitchingAcceptance,
  runSwitchingAcceptance,
  unlockSwitchingAcceptance,
} from '../../../api/ipd/switching-acceptance';
import { IpdRequestError } from '../../../api/ipd/auth';
import { IPD_PERMISSION_CODES } from '../_shared/ipd-permission-codes';
import { ipdErrorText } from '../_shared/ipd-error-text';
import { PENDING_TEXT } from '../_shared/format';
import '../_shared/ipd-theme.css';

defineOptions({ name: 'IpdOperationSwitchingAcceptance', meta: { ipdCard: 'R215-GAP-F5' } });

// ipd-error-text 的 domain 联合类型无 'switching-acceptance'（该文件本轮禁改），走通用码表 + fallback 通道
function rejectText(cause: unknown): string {
  return ipdErrorText(cause, { fallback: cause instanceof IpdRequestError ? cause.message : '操作失败，请稍后重试' });
}

type Phase = 'error' | 'loading' | 'ready';

// ---------- 已 run 月份列表（GET list，QUERY 码） ----------
const months = ref<SwitchingAcceptanceReportView[]>([]);
const phase = ref<Phase>('loading');
const errorMsg = ref('');

async function load(): Promise<void> {
  phase.value = 'loading';
  errorMsg.value = '';
  try {
    months.value = await listSwitchingAcceptance();
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    errorMsg.value = rejectText(cause);
  }
}

onMounted(load);

// ---------- 报告详情（GET {month}，QUERY 码） ----------
const report = ref<SwitchingAcceptanceReportView | null>(null);
const reportMonth = ref('');
const reportLoading = ref(false);

async function openReport(month: string): Promise<void> {
  if (reportLoading.value) return;
  reportLoading.value = true;
  try {
    report.value = await getSwitchingAcceptance(month);
    reportMonth.value = month;
  } catch (cause) {
    report.value = null;
    reportMonth.value = month;
    antMessage.error(rejectText(cause));
  } finally {
    reportLoading.value = false;
  }
}

// ---------- 月份选择 + run（POST {month}/run，LOCK 码） ----------
const pickedMonth = ref<{ value: Dayjs }>({ value: dayjs().subtract(1, 'month') }); // allow-clear=false 恒有值（DatePicker value 不收 null）
const running = ref(false);

function pickedMonthText(): string {
  return pickedMonth.value.value?.format('YYYY-MM') ?? '';
}

async function runReport(): Promise<void> {
  const month = pickedMonthText();
  if (!month || running.value) return;
  running.value = true;
  try {
    report.value = await runSwitchingAcceptance(month);
    reportMonth.value = month;
    antMessage.success(`${month} 对账完成：${report.value.passed ? '全部通过' : '存在差异项，见明细'}`);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    running.value = false;
  }
}

// ---------- lock（POST {month}/lock，LOCK 码） ----------
const locking = ref(false);

async function lockReport(): Promise<void> {
  const month = report.value?.month ?? reportMonth.value;
  if (!month || locking.value) return;
  locking.value = true;
  try {
    report.value = await lockSwitchingAcceptance(month);
    antMessage.success(`${month} 已锁定（locked，只读封账）`);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    locking.value = false;
  }
}

// ---------- unlock（POST {month}/unlock，UNLOCK 码；reason 5~500 前端预校验） ----------
const unlockOpen = ref(false);
const unlockReason = ref('');
const unlockSubmitting = ref(false);

function openUnlock(): void {
  unlockReason.value = '';
  unlockOpen.value = true;
}

async function submitUnlock(): Promise<void> {
  const month = report.value?.month ?? reportMonth.value;
  const reason = unlockReason.value.trim();
  if (!month || unlockSubmitting.value) return;
  // 前端预校验对齐后端 @Size(5,500)（api 层同口径双闸，此处先拦省一次注定 400 的往返）
  if (reason.length < 5 || reason.length > 500) {
    antMessage.warning('解锁理由须 5-500 字符（后端 @Size(5,500) 审计强制）');
    return;
  }
  unlockSubmitting.value = true;
  try {
    report.value = await unlockSwitchingAcceptance(month, reason);
    unlockOpen.value = false;
    antMessage.success(`${month} 已解锁（事故恢复，理由随审计留痕）`);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    unlockSubmitting.value = false;
  }
}

// ---------- 渲染辅助 ----------
const monthColumns = [
  { title: '月份', dataIndex: 'month', key: 'month', width: 110 },
  { title: '运行时间', dataIndex: 'ranAt', key: 'ranAt', width: 180 },
  { title: '结果', key: 'passed', width: 110 },
  { title: '锁定', key: 'isLocked', width: 90 },
  { title: '差异率', dataIndex: 'diffRate', key: 'diffRate', width: 120 },
  { title: '操作', key: 'action', width: 100 },
];

const checkColumns = [
  { title: '校验项', dataIndex: 'name', key: 'name', width: 180 },
  { title: '结果', key: 'passed', width: 90 },
  { title: '期望值', key: 'expected', width: 150 },
  { title: '实际值', key: 'actual', width: 150 },
  { title: '差异 diff', dataIndex: 'diff', key: 'diff', width: 120 },
  { title: '说明', key: 'note' },
];

const summaryText = computed(() => {
  const s = report.value?.summary ?? {};
  const keys = Object.keys(s);
  if (keys.length === 0) return PENDING_TEXT;
  return keys.map((k) => `${k}=${s[k]}`).join(' / ');
});

function valueText(v: unknown): string {
  if (v === null || v === undefined) return PENDING_TEXT;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

const activeMonth = computed(() => report.value?.month ?? reportMonth.value);
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="月度账务切换验收（BR-INC-12 / AC-INC-50/51：切换前后账务一致才算验收通过）"
      description="run 对指定月份执行五类校验（KPI 得分合计 / 奖金发放合计 / 重复发放 / 汇总一致性 / 差异率）；lock 锁定后该月只读封账，unlock 仅事故恢复用（理由 5-500 字随审计留痕）。diffRate 与各项 diff 均为后端 BigDecimal 精度串，页面原样展示不做数值换算。"
      show-icon
      type="info"
    />

    <Card>
      <template #title>
        <Space wrap>
          <span>运行 / 处置</span>
          <Tag v-if="activeMonth" color="blue">当前月份 {{ activeMonth }}</Tag>
        </Space>
      </template>
      <Space wrap>
        <DatePicker
          v-model:value="pickedMonth.value"
          :allow-clear="false"
          format="YYYY-MM"
          picker="month"
          placeholder="选择对账月份"
          value-format="YYYY-MM"
        />
        <!-- run：LOCK 码（ADMIN_WRITE 仅超管，控制器 :40） -->
        <Button v-access:code="IPD_PERMISSION_CODES.SWITCHING_ACCEPTANCE_LOCK" :loading="running" type="primary" @click="runReport">
          运行对账（run）
        </Button>
        <Button v-access:code="IPD_PERMISSION_CODES.SWITCHING_ACCEPTANCE_LOCK" :disabled="!activeMonth" :loading="locking" @click="lockReport">
          锁定该月（lock）
        </Button>
        <Button
          v-access:code="IPD_PERMISSION_CODES.SWITCHING_ACCEPTANCE_UNLOCK"
          danger
          :disabled="!activeMonth"
          @click="openUnlock"
        >
          解锁该月（unlock）
        </Button>
        <Button :loading="reportLoading" @click="load">刷新月份列表</Button>
      </Space>
    </Card>

    <Card>
      <template #title>已 run 月份（GET /switching-acceptance）</template>
      <div v-if="phase === 'loading'" class="flex justify-center py-6" role="status">
        <Spin tip="正在加载已 run 月份" />
      </div>
      <Alert v-else-if="phase === 'error'" :message="errorMsg" show-icon type="error" role="alert">
        <template #action>
          <Button danger size="small" @click="load">重新加载</Button>
        </template>
      </Alert>
      <Empty v-else-if="months.length === 0" description="尚无已 run 月份——选择月份后点击「运行对账」生成首份报告" />
      <Table
        v-else
        :columns="monthColumns"
        :data-source="months"
        :pagination="false"
        row-key="month"
        size="small"
        bordered
      >
        <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
          <template v-if="column.key === 'month'">
            <span class="font-mono tabular-nums">{{ record.month ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'ranAt'">
            <span class="tabular-nums">{{ record.ranAt ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'passed'">
            <Tag :color="record.passed === true ? 'green' : 'red'">{{ record.passed === true ? '通过' : '未通过' }}</Tag>
          </template>
          <template v-else-if="column.key === 'isLocked'">
            <Tag :color="record.isLocked === true ? 'orange' : 'default'">{{ record.isLocked === true ? '已锁定' : '未锁' }}</Tag>
          </template>
          <template v-else-if="column.key === 'diffRate'">
            <!-- BigDecimal 精度串原样展示（禁 parseFloat/Number） -->
            <span class="font-mono tabular-nums">{{ record.diffRate ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <Button size="small" type="link" @click="openReport(String(record.month))">查看报告</Button>
          </template>
        </template>
      </Table>
    </Card>

    <Card v-if="reportLoading" class="text-center">
      <Spin tip="正在加载报告" />
    </Card>
    <Card v-else-if="report" :title="`验收报告：${reportMonth}`">
      <Descriptions :column="3" bordered size="small" class="mb-4">
        <DescriptionsItem label="运行人（ranBy）"><span class="font-mono">{{ report.ranBy ?? PENDING_TEXT }}</span></DescriptionsItem>
        <DescriptionsItem label="运行时间（ranAt）"><span class="tabular-nums">{{ report.ranAt ?? PENDING_TEXT }}</span></DescriptionsItem>
        <DescriptionsItem label="总体结果">
          <Tag :color="report.passed ? 'green' : 'red'">{{ report.passed ? '通过（passed）' : '未通过' }}</Tag>
        </DescriptionsItem>
        <DescriptionsItem label="锁定状态">
          <Tag :color="report.isLocked ? 'orange' : 'default'">{{ report.isLocked ? `已锁定（${report.lockedAt ?? PENDING_TEXT}）` : '未锁定' }}</Tag>
        </DescriptionsItem>
        <DescriptionsItem label="锁定人（lockedBy）"><span class="font-mono">{{ report.lockedBy ?? PENDING_TEXT }}</span></DescriptionsItem>
        <DescriptionsItem label="总差异率（diffRate 原样）"><span class="font-mono tabular-nums">{{ report.diffRate ?? PENDING_TEXT }}</span></DescriptionsItem>
        <DescriptionsItem label="汇总计数（summary）" :span="2">{{ summaryText }}</DescriptionsItem>
        <DescriptionsItem label="解锁信息">
          <template v-if="report.unlockReason">
            {{ report.unlockedAt ?? PENDING_TEXT }} / <span class="font-mono">{{ report.unlockedBy ?? PENDING_TEXT }}</span>
          </template>
          <template v-else>—</template>
        </DescriptionsItem>
      </Descriptions>

      <Alert
        v-if="report.unlockReason"
        class="mb-4"
        type="warning"
        show-icon
        :message="`该月曾被解锁：${report.unlockReason}`"
      />

      <div class="mb-2 font-medium">校验明细（checks）</div>
      <Table :columns="checkColumns" :data-source="report.checks" :pagination="false" row-key="name" size="small" bordered>
        <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
          <template v-if="column.key === 'name'">
            <span class="font-mono">{{ record.name ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'passed'">
            <Tag :color="record.passed === true ? 'green' : 'red'">{{ record.passed === true ? '✓' : '✗' }}</Tag>
          </template>
          <template v-else-if="column.key === 'expected' || column.key === 'actual'">
            <span class="font-mono tabular-nums">{{ valueText(record[column.key === 'expected' ? 'expected' : 'actual']) }}</span>
          </template>
          <template v-else-if="column.key === 'diff'">
            <span class="font-mono tabular-nums">{{ record.diff ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'note'">
            {{ record.note ?? PENDING_TEXT }}
            <Tag v-if="record.duplicateCount != null" class="ml-1" color="purple">重复 {{ record.duplicateCount }}</Tag>
            <span v-if="record.kpiScoreSum != null" class="ml-1 font-mono text-xs">KPI合计 {{ record.kpiScoreSum }}</span>
            <span v-if="record.bonusDistributionSum != null" class="ml-1 font-mono text-xs">发放合计 {{ record.bonusDistributionSum }}</span>
          </template>
        </template>
      </Table>
    </Card>

    <Modal
      v-model:open="unlockOpen"
      :confirm-loading="unlockSubmitting"
      :mask-closable="false"
      cancel-text="取消"
      ok-text="确认解锁"
      title="月度解锁（事故恢复，仅超管）"
      width="560px"
      @ok="submitUnlock"
    >
      <div class="py-2">
        <p class="text-muted-foreground mb-3 text-sm">
          解锁 <span class="font-mono">{{ activeMonth || '（未选择月份）' }}</span>
          将重新开放该月写口；理由 5-500 字随审计留痕（后端 @NotBlank @Size(5,500)，IpdAudit 记录 month+reason）。
        </p>
        <div class="mb-1 text-xs text-gray-500">解锁理由（必填，5-500 字）</div>
        <Textarea
          v-model:value="unlockReason"
          :maxlength="500"
          :rows="3"
          placeholder="如：重复发放已冲正，需重跑该月对账后重新锁定"
          show-count
        />
      </div>
    </Modal>
  </div>
</template>
