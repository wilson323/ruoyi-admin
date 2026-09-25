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
 *
 * ORPHAN-A4 增量（R212 桶表 #10-12，看板卡 ac46043e，2026-09-25）：
 *   列表切量 GET /bonus-pool/page（PERF-P0-2 替代 Deprecated /list）；
 *   POST /bonus-pool/auto-compute（period YYYY-MM，个人系数由 KPI 综合得分推导；仅超管，N1 口径）；
 *   POST /bonus-pool/coefficient/preview（绩效系数试算，不落库）。
 * ORPHAN-A5 增量（R212 桶表 #75-77，看板卡 ab1fb0bd）：
 *   回款面板 GET /receipt-ledgers/by-project/{id} + POST /receipt-ledgers（月度录入）
 *   + POST /{projectId}/refunds（窗口内冲减；AC-INC-16b/16c/31/31b/32，原型页34 回款面板）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
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
  Space,
  Statistic,
  Table,
  Tag,
  message,
} from 'ant-design-vue';

import {
  type BonusPool,
  type BonusStatus,
  autoComputeBonusPool,
  computeBonusPool,
  distributeBonusPool,
  freezeBonusPool,
  pageBonusPools,
  previewBonusCoefficient,
  type CoefficientStrategy,
} from '../../../../api/ipd/bonus';
import {
  type ReceiptLedger,
  createReceiptLedger,
  listReceiptLedgersByProject,
  refundReceiptLedger,
} from '../../../../api/ipd/receipt-ledger';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { listProjectItems } from '../../../../api/ipd/project';
import { formatDateTime, formatMoney, formatPercent, PENDING_TEXT } from '../../_shared/format';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
import { ZK_RULE_BONUS_POOL_FORMULA, renderRulesDescription } from '../../_shared/zk-ipd-rules';
import { bonusStateLabel, bonusStateTone, STATUS_TONE } from '../../_shared/ipd-enums';

/** 与 layouts/ipd.vue 阶段轨道全局项目下拉共用同一持久化键。 */
const CURRENT_PROJECT_KEY = 'ipd:current-project';
/** 表单内选项目后通知顶栏同步（避免用户以为顶部下拉无效）。 */
const PROJECT_SYNC_EVENT = 'ipd:current-project-changed';

defineOptions({
  name: 'IpdBonusPool',
  meta: {
    ipdBackend:
      'BonusPoolController：GET /bonus-pool/page（ORPHAN-A4 切量，PERF-P0-2）、POST /compute、POST /auto-compute、POST /coefficient/preview、POST /{id}/freeze、POST /{id}/distribute、GET /{id}；'
      + 'ReceiptLedgerController（ORPHAN-A5）：GET /receipt-ledgers/by-project/{projectId}、POST /receipt-ledgers、POST /receipt-ledgers/{projectId}/refunds。',
    ipdCard: 'P0-10.34',
  },
});

/** V8 系统漂移修复：状态机 label/tone 走 _shared/ipd-enums 集中表，本地仅留极少量重命名覆写。 */
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

const DEFAULT_POOL_RATE = 0.05; // 5% 小数语义（后端 validatePoolRate (0,1]；与裁决「实际回款×5%×S/A/B」一致；G-08 红线）

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
  actualReceipts: 0,
  /** auto-compute 考核周期 YYYY-MM（后端 AutoComputeBonusPoolReq 必填，@Pattern 校验）。 */
  period: '',
  personalCoefficient: null as null | number,
  poolRate: DEFAULT_POOL_RATE,
  projectId: '',
});

/** 与后端 @Pattern("^\\d{4}-(0[1-9]|1[0-2])$") 同款月份校验（receiptMonth/month/period 共用）。 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** InputNumber 不收 null：与 form.personalCoefficient（null|number）双向适配；留空 = 后端中性 1.0。 */
const personalCoefficientModel = computed<number | string | undefined>({
  get: () => (form.personalCoefficient == null ? undefined : form.personalCoefficient),
  set: (value) => {
    form.personalCoefficient = value == null || value === '' ? null : Number(value);
  },
});

const canCompute = computed(() => form.projectId.trim() !== '' && Number(form.actualReceipts) >= 0);

/** 项目下拉数据源（R31 P0-2 值域修复：后端 projectId 要数字 ID，不再让用户手填编码）。 */
const projectOptions = ref<{ label: string; value: string }[]>([]);

/** 两段实时预览：实际回款 → 预计基数；S/A/B 系数与达成率阶梯由后端裁决（前端不替代）。 */
const previewReceipts = computed(() => Number(form.actualReceipts) || 0);
const previewBasePool = computed(() => previewReceipts.value * (Number(form.poolRate) || 0));

/** 列表数据：按 projectId 过滤；projectId 为空时展示空态（避免误跨项目）。 */
const pools = ref<BonusPool[]>([]);
const loading = ref(false);
const errorMsg = ref('');
/** 是否已对当前 projectId 发起过列表请求（区分「未选项目」与「已选但无数据」空态文案）。 */
const listAttempted = ref(false);

/**
 * 空态文案：未选项目 / 请求失败 / 已选项目但无记录，三者不得共用「请先填写项目编号」。
 */
const emptyDescription = computed(() => {
  if (errorMsg.value) return errorMsg.value;
  if (!form.projectId.trim()) return '请先在上方选择项目，或使用顶栏全局项目切换后再点「刷新列表」';
  if (listAttempted.value) return '该项目暂无奖金池记录，可填写回款后触发核算生成草稿';
  return '请选择项目后点击「刷新列表」';
});

/**
 * 将表单项目与顶栏全局选择器对齐：写 localStorage 并派发同步事件（不整页 reload）。
 */
function syncGlobalProject(projectId: string) {
  const id = projectId.trim();
  if (!id || typeof window === 'undefined') return;
  window.localStorage.setItem(CURRENT_PROJECT_KEY, id);
  window.dispatchEvent(new CustomEvent(PROJECT_SYNC_EVENT, { detail: { projectId: id } }));
}

/** 分页状态（ORPHAN-A4：数据源切量 GET /bonus-pool/page，PERF-P0-2 替代 Deprecated /list）。 */
const pageState = reactive({ current: 1, pageSize: 20, total: 0 });
/** 后端 PAGE_SIZE_MAX=200，前端选择器同口径封顶。 */
const PAGE_SIZE_MAX = 200;

/**
 * 分页加载奖金池列表。pageNo 缺省沿用当前页（template @click 直调会注入 MouseEvent，需防御）。
 */
async function loadList(pageNo?: number) {
  const target = typeof pageNo === 'number' && Number.isFinite(pageNo) ? Math.max(1, Math.trunc(pageNo)) : pageState.current;
  if (!form.projectId.trim()) {
    pools.value = [];
    pageState.total = 0;
    listAttempted.value = false;
    errorMsg.value = '';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    const page = await pageBonusPools(form.projectId.trim(), target, pageState.pageSize);
    pools.value = page.records;
    pageState.current = page.current || target;
    pageState.total = page.total;
    listAttempted.value = true;
  } catch (cause) {
    pools.value = [];
    pageState.total = 0;
    listAttempted.value = true;
    errorMsg.value = rejectText(cause);
  } finally {
    loading.value = false;
  }
}

/** Table 分页/换页回调（pageSize 变更回到第 1 页）。 */
function onTableChange(pag: { current?: number; pageSize?: number }) {
  if (pag.pageSize && pag.pageSize !== pageState.pageSize) {
    pageState.pageSize = Math.min(pag.pageSize, PAGE_SIZE_MAX);
    void loadList(1);
  } else if (pag.current && pag.current !== pageState.current) {
    void loadList(pag.current);
  }
}

/** 分页 total 文案（template 内联函数带类型标注会编译失败，收敛到 script）。 */
function paginationTotalText(total: number): string {
  return `共 ${total} 条`;
}

watch(
  () => form.projectId,
  (next, prev) => {
    if (next === prev) return;
    syncGlobalProject(next);
    pageState.current = 1;
    void loadList(1);
    void loadLedgers();
  },
);

const computing = ref(false);
const currentResult = ref<BonusPool | null>(null);

async function onCompute() {
  if (!canCompute.value || computing.value) return;
  computing.value = true;
  try {
    currentResult.value = await computeBonusPool({
      achievementRate: form.achievementRate,
      actualReceipts: form.actualReceipts,
      ...(form.personalCoefficient != null ? { personalCoefficient: form.personalCoefficient } : {}),
      poolRate: form.poolRate,
      projectId: form.projectId.trim(),
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

/* ==================== ORPHAN-A4：auto-compute + coefficient/preview ==================== */

/** 自动核算可用：项目/回款已填 + period 通过 YYYY-MM 校验（个人系数不收，后端按 KPI 推导）。 */
const canAutoCompute = computed(
  () => canCompute.value && MONTH_PATTERN.test(form.period.trim()),
);
const autoComputing = ref(false);

async function onAutoCompute() {
  if (!canAutoCompute.value || autoComputing.value) return;
  autoComputing.value = true;
  try {
    currentResult.value = await autoComputeBonusPool({
      achievementRate: form.achievementRate,
      actualReceipts: form.actualReceipts,
      period: form.period.trim(),
      poolRate: form.poolRate,
      projectId: form.projectId.trim(),
    });
    message.success(
      `自动核算完成（个人绩效系数由 ${form.period.trim()} KPI 综合得分推导）：¥ ${formatMoney(currentResult.value.finalPool)}`,
    );
    await loadList(1);
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    autoComputing.value = false;
  }
}

/** 取数策略：空串 = 不传，走 system_configs(bonus.performance.strategy) 默认。 */
const STRATEGY_OPTIONS = [
  { label: '默认（system_configs）', value: '' },
  { label: 'PROJECT_SCORE（项目分）', value: 'PROJECT_SCORE' },
  { label: 'WEIGHTED_AVG（加权平均）', value: 'WEIGHTED_AVG' },
  { label: 'LAST_QUARTER（最近季度）', value: 'LAST_QUARTER' },
] as const;

const previewForm = reactive({
  /** undefined 适配 antd InputNumber ValueType（不收 null）；canPreview 以 != null 判空。 */
  score: undefined as number | undefined,
  strategy: '' as '' | CoefficientStrategy,
});
const previewing = ref(false);
/** 试算结果（BonusPoolVO 投影；仅 coefficient/strategy 相关字段有意义，不入列表）。 */
const previewResult = ref<BonusPool | null>(null);

const canPreview = computed(
  () =>
    form.projectId.trim() !== '' &&
    previewForm.score != null &&
    Number(previewForm.score) >= 0 &&
    Number(previewForm.score) <= 100,
);

async function onPreviewCoefficient() {
  if (!canPreview.value || previewing.value) return;
  previewing.value = true;
  try {
    previewResult.value = await previewBonusCoefficient({
      projectId: form.projectId.trim(),
      score: Number(previewForm.score),
      ...(previewForm.strategy ? { strategy: previewForm.strategy } : {}),
    });
  } catch (cause) {
    previewResult.value = null;
    message.error(rejectText(cause));
  } finally {
    previewing.value = false;
  }
}

/* ==================== ORPHAN-A5：回款台账（AC-INC-16b/16c/31/31b/32） ==================== */

const ledgerForm = reactive({
  receiptMonth: '',
  receiptAmount: undefined as number | undefined,
  refundAmount: undefined as number | undefined,
  voucherUrl: '',
});
const canRecordReceipt = computed(
  () =>
    form.projectId.trim() !== '' &&
    MONTH_PATTERN.test(ledgerForm.receiptMonth.trim()) &&
    ledgerForm.receiptAmount != null &&
    Number(ledgerForm.receiptAmount) > 0,
);
const recording = ref(false);

const refundForm = reactive({
  month: '',
  refundAmount: undefined as number | undefined,
});
const canRefund = computed(
  () =>
    form.projectId.trim() !== '' &&
    MONTH_PATTERN.test(refundForm.month.trim()) &&
    refundForm.refundAmount != null &&
    Number(refundForm.refundAmount) > 0,
);
const refunding = ref(false);

const ledgers = ref<ReceiptLedger[]>([]);
const ledgerLoading = ref(false);

/** 按项目加载回款台账（未选项目清空，不发请求）。 */
async function loadLedgers() {
  if (!form.projectId.trim()) {
    ledgers.value = [];
    return;
  }
  ledgerLoading.value = true;
  try {
    ledgers.value = await listReceiptLedgersByProject(form.projectId.trim());
  } catch {
    ledgers.value = []; // G-06：加载失败降级空列表，不阻断核算主流程
  } finally {
    ledgerLoading.value = false;
  }
}

/** 月度回款录入（POST /receipt-ledgers；仅超管，adminOnly 审计 RECEIPT_CREATE）。 */
async function onRecordReceipt() {
  if (!canRecordReceipt.value || recording.value) return;
  recording.value = true;
  try {
    const created = await createReceiptLedger({
      projectId: form.projectId.trim(),
      receiptMonth: ledgerForm.receiptMonth.trim(),
      receiptAmount: Number(ledgerForm.receiptAmount),
      ...(ledgerForm.refundAmount != null && ledgerForm.refundAmount !== 0
        ? { refundAmount: Number(ledgerForm.refundAmount) }
        : {}),
      ...(ledgerForm.voucherUrl.trim() ? { voucherUrl: ledgerForm.voucherUrl.trim() } : {}),
    });
    message.success(`回款已录入：${created.receiptMonth ?? ledgerForm.receiptMonth.trim()} ¥ ${formatMoney(created.receiptAmount ?? null)}`);
    await loadLedgers();
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    recording.value = false;
  }
}

/** 退款冲减（POST /receipt-ledgers/{projectId}/refunds；窗口内当期冲减，窗外后端拒绝回溯）。 */
async function onRefundReceipt() {
  if (!canRefund.value || refunding.value) return;
  refunding.value = true;
  try {
    const updated = await refundReceiptLedger(form.projectId.trim(), {
      month: refundForm.month.trim(),
      refundAmount: Number(refundForm.refundAmount),
    });
    message.success(`退款已冲减 ${updated.receiptMonth ?? refundForm.month.trim()}：¥ ${formatMoney(updated.refundAmount ?? null)}`);
    await loadLedgers();
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    refunding.value = false;
  }
}

onMounted(async () => {
  // 拉项目下拉；若顶栏已选全局项目则回填表单并自动刷列表（R211c：避免同一项目选两次）。
  try {
    const items = await listProjectItems();
    projectOptions.value = items.map((p) => ({ label: `${p.name} · ${p.code}`, value: String(p.id) }));
  } catch {
    projectOptions.value = []; // G-06：加载失败降级空列表，不阻断页面
  }
  const saved =
    typeof window !== 'undefined' ? window.localStorage.getItem(CURRENT_PROJECT_KEY) : null;
  if (saved && projectOptions.value.some((o) => o.value === saved)) {
    // R215-E2E-D：列表/台账只由上方 form.projectId watch（唯一触发点）各拉一次。
    // 原此处显式 loadList+loadLedgers 与 watch('')→saved 的触发叠加，单实例挂载
    // 即把 /bonus-pool/page 与 /receipt-ledgers/by-project 各打两次（探针“双发”真因，
    // 非布局双实例；计数回归见 index.test.ts）。
    form.projectId = saved;
  }
});

/** 回款台账列（ORPHAN-A5；金额/时间列在 bodyCell 模板格式化）。 */
const ledgerColumns = [
  { title: '回款月份', dataIndex: 'receiptMonth', key: 'receiptMonth', width: 90 },
  { title: '回款金额', key: 'receiptAmount', width: 130 },
  { title: '冲减金额', key: 'refundAmount', width: 110 },
  { title: '净回款', key: 'netAmount', width: 130 },
  { title: '窗口判定', key: 'inWindow', width: 90 },
  { title: '凭证', key: 'voucherUrl', width: 110 },
  { title: '来源', dataIndex: 'source', key: 'source', width: 90 },
  { title: '录入时间', key: 'createTime', width: 150 },
];

const columns = [
  { title: '奖金池编号', dataIndex: 'id', key: 'id', width: 110 },
  { title: '项目编号', dataIndex: 'projectId', key: 'projectId', width: 110 },
  { title: '实际回款', key: 'targetSales', width: 130 },
  { title: '基数（5%）', key: 'basePool', width: 130 },
  { title: 'S/A/B 系数', key: 'coefficient', width: 100 },
  { title: '阶梯系数', key: 'tierCoefficient', width: 90 },
  { title: '终算奖池', key: 'finalPool', width: 140 },
  { title: '达成率', key: 'achievementRate', width: 90 },
  { title: '状态', key: 'status', width: 100 },
  { title: '生成时间', key: 'createTime', width: 150 },
  { title: '操作', key: 'actions', width: 170 },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`奖金池口径：实际回款 × 5% × S/A/B 系数（G-08 红线 · 2026-09-06 owner 裁决）。${bonusFormulaRule}`"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="两段核算预览（前端实时演算）">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Statistic
          title="① 实际回款"
          :value="previewReceipts"
          :precision="2"
          prefix="¥"
          :value-style="{ fontVariantNumeric: 'tabular-nums' }"
        />
        <Statistic
          title="② 预计基数（回款 × 奖金池比例）"
          :value="previewBasePool"
          :precision="2"
          prefix="¥"
          :value-style="{ fontVariantNumeric: 'tabular-nums' }"
        />
      </div>
      <div class="text-muted-foreground mt-2 text-xs">
        S/A/B 差异化系数由后端从项目配置带出，达成率阶梯系数与个人绩效系数由后端裁决；终算奖池以核算结果为准。
      </div>
    </Card>

    <Card class="mb-4" title="触发奖金池核算（POST /bonus-pool/compute）">
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 14 }">
        <FormItem label="项目" required>
          <Select
            v-model:value="form.projectId"
            :options="projectOptions"
            show-search
            option-filter-prop="label"
            placeholder="请选择项目（列表来自项目空间；后端要求项目数字 ID）"
          />
        </FormItem>
        <FormItem label="实际回款金额" required>
          <InputNumber
            v-model:value="form.actualReceipts"
            :min="0"
            :precision="2"
            :step="1000"
            class="w-full"
            placeholder="上市后连续 6 个月实际回款金额"
          />
        </FormItem>
        <FormItem label="奖金池比例（小数）">
          <InputNumber v-model:value="form.poolRate" :min="0" :max="1" :precision="4" :step="0.01" class="w-full" />
          <div class="text-muted-foreground mt-1 text-xs">后端要求 (0,1] 小数，默认 0.05 即 5%（与裁决「实际回款×5%×S/A/B」一致）</div>
        </FormItem>
        <FormItem label="达成率（%）">
          <InputNumber v-model:value="form.achievementRate" :min="0" :max="999" :precision="2" class="w-full" />
          <div class="text-muted-foreground mt-1 text-xs">回款达成率百分数；后端按 6 档阶梯表自动折算阶梯系数</div>
        </FormItem>
        <FormItem label="个人绩效系数">
          <InputNumber v-model:value="personalCoefficientModel" :min="0" :precision="2" :step="0.1" class="w-full" placeholder="留空默认 1.0" />
          <div class="text-muted-foreground mt-1 text-xs">手动核算入参；改用「自动核算」时由后端按 KPI 综合得分推导，本输入不参与</div>
        </FormItem>
        <FormItem label="考核周期（自动核算）">
          <Input
            v-model:value="form.period"
            class="w-full"
            placeholder="YYYY-MM（auto-compute 必填；据 kpi_records 当月综合得分推导个人系数）"
          />
        </FormItem>
        <FormItem :wrapper-col="{ offset: 6, span: 14 }">
          <Space>
            <Button v-access:code="IPD_PERMISSION_CODES.BONUS_POOL_COMPUTE" type="primary" :disabled="!canCompute" :loading="computing" @click="onCompute">
              触发核算（落库 DRAFT）
            </Button>
            <Button
              v-access:code="IPD_PERMISSION_CODES.BONUS_POOL_COMPUTE"
              :disabled="!canAutoCompute"
              :loading="autoComputing"
              @click="onAutoCompute"
            >
              自动核算（KPI 系数推导）
            </Button>
            <Button :disabled="!form.projectId.trim()" :loading="loading" @click="loadList(1)">
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
        <DescriptionsItem label="实际回款">¥ {{ formatMoney(currentResult.targetSales ?? null) }}</DescriptionsItem>
        <DescriptionsItem label="基数比例">{{ formatPercent(currentResult.poolRate ?? null) }}</DescriptionsItem>
        <DescriptionsItem label="基数">¥ {{ formatMoney(currentResult.basePool ?? null) }}</DescriptionsItem>
        <DescriptionsItem label="S/A/B 系数">{{ currentResult.coefficient ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="阶梯系数">{{ currentResult.tierCoefficient ?? PENDING_TEXT }}</DescriptionsItem>
        <DescriptionsItem label="个人绩效系数">{{ form.personalCoefficient ?? '1.0（后端默认）' }}</DescriptionsItem>
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
          v-access:code="IPD_PERMISSION_CODES.BONUS_POOL_FREEZE"
          :loading="actionId === currentResult.id"
          type="primary"
          @click="onFreeze(currentResult)"
        >
          冻结（DRAFT → CONFIRMED）
        </Button>
        <Button
          v-if="currentResult.status === 'CONFIRMED'"
          v-access:code="IPD_PERMISSION_CODES.BONUS_POOL_DISTRIBUTE"
          :loading="actionId === currentResult.id"
          type="primary"
          @click="onDistribute(currentResult)"
        >
          分配（CONFIRMED → DISTRIBUTED）
        </Button>
        <Tag v-if="currentResult.status === 'DISTRIBUTED'" color="success">已分配（生成内部台账）</Tag>
      </Space>
    </Card>

    <Card class="mb-4" title="绩效系数试算（POST /bonus-pool/coefficient/preview · 不落库）">
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 14 }">
        <FormItem label="综合得分（0-100）" required>
          <InputNumber v-model:value="previewForm.score" :min="0" :max="100" :precision="1" class="w-full" placeholder="锁定项目分或预估得分" />
        </FormItem>
        <FormItem label="取数策略">
          <Select v-model:value="previewForm.strategy" :options="[...STRATEGY_OPTIONS]" placeholder="默认走 system_configs(bonus.performance.strategy)" />
        </FormItem>
        <FormItem :wrapper-col="{ offset: 6, span: 14 }">
          <Space>
            <Button
              v-access:code="IPD_PERMISSION_CODES.BONUS_POOL_COMPUTE"
              type="primary"
              :disabled="!canPreview"
              :loading="previewing"
              @click="onPreviewCoefficient"
            >
              试算绩效系数
            </Button>
            <span v-if="previewResult" class="text-muted-foreground text-xs">
              S/A/B 系数 {{ previewResult.coefficient ?? PENDING_TEXT }} · 终算奖池参考 ¥ {{ formatMoney(previewResult.finalPool ?? null) }}（试算不写库、不产生审计）
            </span>
          </Space>
        </FormItem>
      </Form>
    </Card>

    <Card class="mb-4" title="回款台账（GET /receipt-ledgers/by-project · 月度录入与退款冲减）">
      <template #extra>
        <Button :disabled="!form.projectId.trim()" :loading="ledgerLoading" size="small" @click="loadLedgers">
          刷新台账
        </Button>
      </template>
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 14 }">
        <FormItem label="回款月份" required>
          <Input v-model:value="ledgerForm.receiptMonth" class="w-full" placeholder="YYYY-MM" />
        </FormItem>
        <FormItem label="回款金额（元）" required>
          <InputNumber v-model:value="ledgerForm.receiptAmount" :min="0.01" :precision="2" :step="10000" class="w-full" placeholder="当月实际回款（口径 RECEIPT，非出库/开票）" />
        </FormItem>
        <FormItem label="同步冲减（元）">
          <InputNumber v-model:value="ledgerForm.refundAmount" :min="0" :precision="2" class="w-full" placeholder="可空；退款也可在录入后单独冲减" />
        </FormItem>
        <FormItem label="凭证地址">
          <Input v-model:value="ledgerForm.voucherUrl" class="w-full" placeholder="银行回单/对账单 URL（可空，≤500 字符）" />
        </FormItem>
        <FormItem label="退款冲减（事后）">
          <Input v-model:value="refundForm.month" class="w-full" placeholder="冲减月份 YYYY-MM（仅 6 自然月窗口内当期冲减，窗外拒绝回溯）" />
          <InputNumber
            v-model:value="refundForm.refundAmount"
            :min="0.01"
            :precision="2"
            :step="1000"
            class="mt-1 w-full"
            placeholder="冲减金额（元）"
          />
        </FormItem>
        <FormItem :wrapper-col="{ offset: 6, span: 14 }">
          <Space>
            <Button
              v-access:code="IPD_PERMISSION_CODES.BONUS_POOL_COMPUTE"
              type="primary"
              :disabled="!canRecordReceipt"
              :loading="recording"
              @click="onRecordReceipt"
            >
              录入回款
            </Button>
            <Button
              v-access:code="IPD_PERMISSION_CODES.BONUS_POOL_COMPUTE"
              :disabled="!canRefund"
              :loading="refunding"
              @click="onRefundReceipt"
            >
              退款冲减
            </Button>
          </Space>
        </FormItem>
      </Form>
      <Table
        class="mt-2"
        :columns="ledgerColumns"
        :data-source="ledgers"
        :loading="ledgerLoading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'receiptAmount'">¥ {{ formatMoney(record.receiptAmount ?? null) }}</template>
          <template v-else-if="column.key === 'refundAmount'">¥ {{ formatMoney(record.refundAmount ?? null) }}</template>
          <template v-else-if="column.key === 'netAmount'">
            <strong class="text-primary">¥ {{ formatMoney(record.netAmount ?? null) }}</strong>
          </template>
          <template v-else-if="column.key === 'inWindow'">
            <Tag v-if="record.inWindow === true" color="success">窗口内</Tag>
            <Tag v-else-if="record.inWindow === false" color="default">窗口外</Tag>
            <span v-else class="text-muted-foreground text-xs">—</span>
          </template>
          <template v-else-if="column.key === 'voucherUrl'">
            <a v-if="record.voucherUrl" :href="record.voucherUrl" target="_blank" rel="noopener noreferrer">查看凭证</a>
            <span v-else class="text-muted-foreground text-xs">—</span>
          </template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
        </template>
        <template #emptyText>
          <Empty :description="form.projectId.trim() ? '该项目暂无回款台账记录' : '请先在上方选择项目'" />
        </template>
      </Table>
    </Card>

    <Card title="奖金池列表（按项目分页 · GET /bonus-pool/page）">
      <Table
        :columns="columns"
        :data-source="pools"
        :loading="loading"
        :pagination="{
          current: pageState.current,
          pageSize: pageState.pageSize,
          total: pageState.total,
          pageSizeOptions: ['10', '20', '50', '100'],
          showSizeChanger: true,
          showTotal: paginationTotalText,
        }"
        row-key="id"
        size="small"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'targetSales'">¥ {{ formatMoney(record.targetSales ?? null) }}</template>
          <template v-else-if="column.key === 'basePool'">¥ {{ formatMoney(record.basePool) }}</template>
          <template v-else-if="column.key === 'coefficient'">{{ record.coefficient ?? '—' }}</template>
          <template v-else-if="column.key === 'tierCoefficient'">{{ record.tierCoefficient ?? '—' }}</template>
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
          <Empty :description="emptyDescription" />
        </template>
      </Table>
    </Card>
  </div>
</template>