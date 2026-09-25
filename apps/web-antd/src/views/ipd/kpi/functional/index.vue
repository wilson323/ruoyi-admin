<script setup lang="ts">
/**
 * 页29 功能 KPI 指标来源与加权贡献（卡 P0-10.29；后端 GET /kpi/functional 已交付）。
 * 与原型不同构（逐条登记）：原型 12 项项目 KPI 表格 + KpiDrawer 填报/证据上传（PUT）
 * 后端未交付；本页只读展示后端汇总计算结果（来源 × 权重 × 贡献），符合 G-06 五态准则。
 *
 * A2 P1 增量（R148.1 §2.2 方案②；owner 2026-09-21 拍板）：
 * 新增「功能指标量表」区块——GET / PUT /api/v1/kpi/functional-metrics，8 项功能指标
 * （市场 4 + 研发 4，DOC-01 §4 既定口径）人工录入。读权限 ipd:kpi:config:query（四角色），
 * 写权限 ipd:kpi:config（超管 + 双 PM）。scaleVersion 为 VARCHAR(50) 自由文本，
 * 不与 kpi_rule_snapshots 建外键（R-A2 约束）。
 *
 * ORPHAN-A6 增量（R212 #37/#39，看板卡 8338f2fa，2026-09-25）：
 * - #37 DELETE /api/v1/kpi/functional-metrics/{id}（软删除）接入操作列，Popconfirm 二次确认，
 *   成功后刷新量表；权限与 upsert 同码 ipd:kpi:config（canWrite 同闸）。
 * - #39 GET /api/v1/kpi/functional-metrics/codes（权威枚举）接入下拉数据源——
 *   onMounted 拉取，成功后替换本地 8 项清单；失败/为空回退本地口径（label 映射保留本地
 *   中文文案，未知编码回显 code 本身，不造假）。
 */
import type { RuleObject } from 'ant-design-vue/es/form';

import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  KPI_FUNCTIONAL_METRIC_CODES,
  type FunctionalMetricRecord,
  type KpiSourceItem,
  deleteFunctionalMetric,
  getFunctionalKpi,
  listFunctionalMetricCodes,
  listFunctionalMetrics,
  upsertFunctionalMetric,
} from '../../../../api/ipd/kpi';
import { listProjects, type Project } from '../../../../api/ipd/project';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { ipdErrorText, isTransportError } from '../../_shared/ipd-error-text';
import { PENDING_TEXT } from '../../_shared/format';

defineOptions({ name: 'IpdKpiFunctional', meta: { ipdCard: 'P0-10.29' } });

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
/** A2 P1 写权限：超管 + 双 PM（与后端 ipd:kpi:config 角色登记一致）。 */
const canWrite = computed(() => ['SUPER_ADMIN', 'MARKET_PM', 'RD_PM'].includes(personType.value));

const period = ref(defaultPeriod());
const items = ref<KpiSourceItem[]>([]);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const sourceText: Record<KpiSourceItem['source'], string> = {
  ALLOWANCE_LEDGER: '津贴台账',
  KPI_CALCULATOR: 'KPI 计算器',
  PROJECT_SCORE: '项目评分',
};

const columns = [
  { title: '指标来源', dataIndex: 'source', key: 'source', width: 140 },
  { title: '原始值', dataIndex: 'value', key: 'value', width: 140 },
  { title: '权重', dataIndex: 'weight', key: 'weight', width: 100 },
  { title: '加权贡献', dataIndex: 'contribution', key: 'contribution', width: 140 },
];

async function load(): Promise<void> {
  if (!period.value.trim() || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    items.value = await getFunctionalKpi(period.value.trim());
    loaded.value = true;
  } catch (cause) {
    items.value = [];
    errorMsg.value = ipdErrorText(cause, { fallback: '功能 KPI 加载失败' });
  } finally {
    loading.value = false;
  }
}

const networkDown = computed(() => loaded.value && !errorMsg.value && items.value.length === 0);

onMounted(() => {
  void load();
  void loadMetricProjects();
  // ORPHAN-A6 #39：codes 权威枚举先行拉取（失败回退本地 8 项，不阻塞页面）
  void loadMetricCodes();
});

// ===== A2 P1：功能指标量表（8 项人工录入） =====
const metricProjects = ref<Project[]>([]);
const metricProjectLoading = ref(false);
const metricProjectId = ref<undefined | string>(undefined);
const metricRows = ref<FunctionalMetricRecord[]>([]);
const metricLoading = ref(false);
const metricError = ref('');
const metricLoaded = ref(false);

const metricProjectOptions = computed(() =>
  metricProjects.value.map((p) => ({
    label: p.name ? `${p.name}（${p.code ?? '#' + p.id}）` : `#${p.id}`,
    value: p.id,
  })),
);

/** ORPHAN-A6 #39：本地 8 项清单降级为回退口径 + label 字典（权威编码来自 /codes 端点）。 */
const LOCAL_METRIC_LABELS = new Map<string, string>(KPI_FUNCTIONAL_METRIC_CODES.map((item) => [item.value, item.label]));
const metricCodes = ref<string[]>(KPI_FUNCTIONAL_METRIC_CODES.map((item) => item.value));

async function loadMetricCodes(): Promise<void> {
  try {
    const codes = await listFunctionalMetricCodes();
    // 防御：仅接受非空字符串数组（异常包络/空清单一律回退本地口径）
    const sanitized = Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string' && c.length > 0) : [];
    if (sanitized.length) metricCodes.value = sanitized;
  } catch {
    // 权威枚举不可达 → 回退本地 8 项（与后端 DOC-01 §4 口径同源，G-06 不造假）
  }
}

const metricOptions = computed(() =>
  metricCodes.value.map((code) => ({ label: LOCAL_METRIC_LABELS.get(code) ?? code, value: code })),
);
const metricLabelMap = computed(() => new Map<string, string>(metricOptions.value.map((item) => [item.value, item.label])));

const metricColumns = [
  { dataIndex: 'metricCode', key: 'metricCode', title: '功能指标（8 项）', width: 220 },
  { dataIndex: 'period', key: 'period', title: '期间', width: 150 },
  { dataIndex: 'metricValue', key: 'metricValue', title: '指标值', width: 110 },
  { dataIndex: 'targetValue', key: 'targetValue', title: '目标值', width: 110 },
  { dataIndex: 'scaleVersion', key: 'scaleVersion', title: '量表版本', width: 140 },
  { dataIndex: 'remark', key: 'remark', title: '备注' },
  { dataIndex: 'action', key: 'action', title: '操作', width: 150 },
];

interface MetricFormState {
  metricCode: undefined | string;
  period: string;
  metricValue: undefined | number;
  targetValue: undefined | number;
  scaleVersion: string;
  remark: string;
}

const metricForm = reactive<MetricFormState>({
  metricCode: undefined,
  period: defaultPeriod(),
  metricValue: undefined,
  targetValue: undefined,
  scaleVersion: '',
  remark: '',
});
const metricFormRef = ref();
const metricSaving = ref(false);
const metricFormVisible = ref(false);
const editingId = ref<null | string>(null);

function toNumber(value: null | number | string | undefined): null | number {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function displayMetricValue(value: null | number | string | undefined): string {
  const num = toNumber(value);
  return num === null ? PENDING_TEXT : String(num);
}

function asMetric(record: Record<string, any>): FunctionalMetricRecord {
  return record as FunctionalMetricRecord;
}

const metricRules = computed<Record<string, RuleObject[]>>(() => ({
  metricCode: [{ required: true, message: '请选择功能指标（8 项之一）', trigger: 'change' }],
  period: [
    { required: true, message: '请输入期间', trigger: 'blur' },
    {
      validator: (_rule: RuleObject, value: undefined | string) => {
        const text = String(value ?? '').trim();
        if (!text) return Promise.resolve();
        return /^\d{4}-\d{2}$/.test(text) || /^上市后\s?\d+\s?个月$/.test(text)
          ? Promise.resolve()
          : Promise.reject('期间格式应为 YYYY-MM 或「上市后 N 个月」');
      },
    },
  ],
  metricValue: [
    {
      validator: () =>
        (toNumber(metricForm.metricValue) === null && toNumber(metricForm.targetValue) === null
          ? Promise.reject('指标值与目标值至少填写一项（留空表示待补充，不等同 0）')
          : Promise.resolve()),
    },
  ],
}));

async function loadMetricProjects(): Promise<void> {
  if (metricProjects.value.length) return;
  metricProjectLoading.value = true;
  try {
    metricProjects.value = await listProjects();
  } catch (cause) {
    antMessage.error(ipdErrorText(cause, { fallback: '项目列表加载失败' }));
  } finally {
    metricProjectLoading.value = false;
  }
}

async function loadMetrics(): Promise<void> {
  if (!metricProjectId.value) {
    metricRows.value = [];
    metricLoaded.value = false;
    metricError.value = '';
    return;
  }
  metricLoading.value = true;
  metricError.value = '';
  try {
    metricRows.value = await listFunctionalMetrics(metricProjectId.value);
    metricLoaded.value = true;
  } catch (cause) {
    metricRows.value = [];
    metricLoaded.value = true;
    metricError.value = ipdErrorText(cause, { fallback: '功能指标量表加载失败' });
  } finally {
    metricLoading.value = false;
  }
}

function resetMetricForm(): void {
  metricForm.metricCode = undefined;
  metricForm.period = defaultPeriod();
  metricForm.metricValue = undefined;
  metricForm.targetValue = undefined;
  metricForm.scaleVersion = '';
  metricForm.remark = '';
  metricFormRef.value?.clearValidate?.();
}

function openCreate(): void {
  editingId.value = null;
  resetMetricForm();
  metricFormVisible.value = true;
}

function openEdit(record: FunctionalMetricRecord): void {
  editingId.value = record.id ?? null;
  metricForm.metricCode = record.metricCode;
  metricForm.period = record.period ?? '';
  metricForm.metricValue = toNumber(record.metricValue) ?? undefined;
  metricForm.targetValue = toNumber(record.targetValue) ?? undefined;
  metricForm.scaleVersion = record.scaleVersion ?? '';
  metricForm.remark = record.remark ?? '';
  metricFormVisible.value = true;
}

/** ORPHAN-A6 #37：软删除（Popconfirm 确认后执行；权限与 upsert 同闸 canWrite）。 */
const metricDeletingId = ref<null | string>(null);

async function removeMetric(record: FunctionalMetricRecord): Promise<void> {
  if (!record.id || metricDeletingId.value) return;
  metricDeletingId.value = record.id;
  try {
    await deleteFunctionalMetric(record.id);
    antMessage.success('功能指标已删除');
    await loadMetrics();
  } catch (cause) {
    antMessage.error(ipdErrorText(cause, { fallback: '功能指标删除失败' }));
  } finally {
    metricDeletingId.value = null;
  }
}

function cancelMetricForm(): void {
  metricFormVisible.value = false;
  editingId.value = null;
  resetMetricForm();
}

async function submitMetric(): Promise<void> {
  if (metricSaving.value) return;
  if (!metricProjectId.value) {
    antMessage.warning('请先选择项目');
    return;
  }
  try {
    await metricFormRef.value?.validate();
  } catch {
    return;
  }
  metricSaving.value = true;
  try {
    await upsertFunctionalMetric({
      projectId: metricProjectId.value,
      metricCode: metricForm.metricCode as string,
      period: String(metricForm.period ?? '').trim(),
      metricValue: toNumber(metricForm.metricValue),
      targetValue: toNumber(metricForm.targetValue),
      scaleVersion: metricForm.scaleVersion.trim() || null,
      remark: metricForm.remark.trim() || null,
    });
    antMessage.success(editingId.value ? '功能指标已更新' : '功能指标已录入');
    cancelMetricForm();
    await loadMetrics();
  } catch (cause) {
    antMessage.error(ipdErrorText(cause, { fallback: '功能指标保存失败' }));
  } finally {
    metricSaving.value = false;
  }
}

const metricEmptyText = computed(() => {
  if (metricError.value) return metricError.value;
  if (!metricProjectId.value) return '请先在上方选择项目，再加载功能指标量表';
  if (!metricLoaded.value) return '点击「加载量表」读取该项目已录入的功能指标';
  return '该项目暂无功能指标量表记录';
});
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="功能 KPI：来自津贴台账 / KPI 计算器 / 项目评分三类来源，按权重汇总加权贡献。"
      show-icon
      type="info"
    />
    <Card class="mb-4" title="查询条件">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">核算周期（YYYY-MM）</div>
          <Input v-model:value="period" placeholder="2026-09" style="width: 160px" @keyup.enter="load" />
        </div>
        <Button type="primary" :loading="loading" @click="load">加载功能 KPI</Button>
        <Button v-if="errorMsg && isTransportError({ message: errorMsg })" :loading="loading" @click="load">重试</Button>
      </div>
    </Card>

    <Card title="功能 KPI 明细">
      <Table
        :columns="columns"
        :data-source="items"
        :loading="loading"
        :pagination="false"
        row-key="source"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'source'">
            <Tag>{{ sourceText[record.source as KpiSourceItem['source']] ?? record.source }}</Tag>
          </template>
          <template v-else-if="column.key === 'value'">{{ record.value ?? '—' }}</template>
          <template v-else-if="column.key === 'weight'">{{ record.weight ?? '—' }}</template>
          <template v-else-if="column.key === 'contribution'">
            <strong>{{ record.contribution ?? '—' }}</strong>
          </template>
        </template>
        <template #emptyText>
          <Empty :description="errorMsg || (networkDown ? '服务暂不可达，请稍后重试' : (loaded ? '当前周期暂无功能 KPI 数据' : '请输入核算周期后加载'))" />
        </template>
      </Table>
    </Card>

    <Card class="mt-4">
      <template #title>
        <Space>
          <span>功能指标量表（8 项人工录入）</span>
          <Tag color="blue">ipd:kpi:config</Tag>
          <Tag :color="canWrite ? 'green' : 'default'">{{ canWrite ? '可录入' : '只读' }}</Tag>
        </Space>
      </template>
      <Alert
        class="mb-3"
        message="A2 P1 功能指标量表：市场 4 项 + 研发 4 项（DOC-01 §4 既定口径），按项目 + 期间人工录入。"
        description="读权限 ipd:kpi:config:query（组长 / 双 PM / 超管）；写权限 ipd:kpi:config（超管 + 双 PM）。留空表示「待补充」（不等同 0），指标值与目标值至少填一项；量表版本为 ≤50 字自由文本，不与快照表建外键。"
        show-icon
        type="info"
      />
      <Space class="mb-3" wrap>
        <Select
          v-model:value="metricProjectId"
          :loading="metricProjectLoading"
          :options="metricProjectOptions"
          allow-clear
          class="min-w-[260px]"
          placeholder="选择项目"
          show-search
          @change="loadMetrics"
        />
        <Button :disabled="!metricProjectId" :loading="metricLoading" @click="loadMetrics">加载量表</Button>
        <Button v-if="canWrite" :disabled="!metricProjectId" type="primary" @click="openCreate">录入 / 编辑</Button>
        <span v-else class="text-xs text-gray-500">当前角色只读（录入开放给超管与双 PM）</span>
      </Space>

      <Form
        v-if="canWrite && metricFormVisible"
        ref="metricFormRef"
        :label-col="{ span: 6 }"
        :model="metricForm"
        :rules="metricRules"
        :wrapper-col="{ span: 18 }"
        class="mb-4"
        layout="horizontal"
      >
        <div class="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          <FormItem label="功能指标" name="metricCode">
            <Select
              v-model:value="metricForm.metricCode"
              :disabled="editingId !== null"
              :options="metricOptions"
              allow-clear
              placeholder="8 项之一"
            />
          </FormItem>
          <FormItem label="期间" name="period">
            <Input
              v-model:value="metricForm.period"
              :disabled="editingId !== null"
              :maxlength="20"
              placeholder="2026-09 或 上市后 6 个月"
            />
          </FormItem>
          <FormItem label="指标值" name="metricValue">
            <InputNumber v-model:value="metricForm.metricValue" :min="0" :precision="4" class="w-full" placeholder="人工录入值（可留空）" />
          </FormItem>
          <FormItem label="目标值" name="targetValue">
            <InputNumber v-model:value="metricForm.targetValue" :min="0" :precision="4" class="w-full" placeholder="PPM 目标等（可留空）" />
          </FormItem>
          <FormItem label="量表版本" name="scaleVersion">
            <Input v-model:value="metricForm.scaleVersion" :maxlength="50" allow-clear placeholder="如 V1.0-2026Q3（≤50 字）" />
          </FormItem>
          <FormItem label="备注" name="remark">
            <Input v-model:value="metricForm.remark" :maxlength="500" allow-clear placeholder="选填，≤500 字" />
          </FormItem>
        </div>
        <FormItem :wrapper-col="{ span: 24 }">
          <Space>
            <Button :loading="metricSaving" type="primary" @click="submitMetric">保存</Button>
            <Button @click="cancelMetricForm">取消</Button>
          </Space>
        </FormItem>
      </Form>

      <Alert v-if="metricError" :message="metricError" class="mb-2" show-icon type="error" role="alert">
        <template v-if="isTransportError({ message: metricError })" #action>
          <Button danger size="small" @click="loadMetrics">重新加载</Button>
        </template>
      </Alert>

      <Table
        :columns="metricColumns"
        :data-source="metricRows"
        :loading="metricLoading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'metricCode'">
            <Tag color="blue">{{ metricLabelMap.get(asMetric(record).metricCode) ?? asMetric(record).metricCode }}</Tag>
          </template>
          <template v-else-if="column.key === 'metricValue'">
            <span class="tabular-nums">{{ displayMetricValue(asMetric(record).metricValue) }}</span>
          </template>
          <template v-else-if="column.key === 'targetValue'">
            <span class="tabular-nums">{{ displayMetricValue(asMetric(record).targetValue) }}</span>
          </template>
          <template v-else-if="column.key === 'scaleVersion'">
            {{ asMetric(record).scaleVersion || PENDING_TEXT }}
          </template>
          <template v-else-if="column.key === 'remark'">
            {{ asMetric(record).remark || '—' }}
          </template>
          <template v-else-if="column.key === 'action'">
            <Space v-if="canWrite">
              <Button size="small" type="link" @click="openEdit(asMetric(record))">编辑</Button>
              <Popconfirm
                :disabled="!asMetric(record).id"
                title="确认删除该条量表记录？（软删除，权限 ipd:kpi:config）"
                ok-text="删除"
                ok-type="danger"
                cancel-text="取消"
                @confirm="removeMetric(asMetric(record))"
              >
                <Button
                  danger
                  size="small"
                  type="link"
                  :loading="metricDeletingId === asMetric(record).id"
                >删除</Button>
              </Popconfirm>
            </Space>
            <span v-else class="text-xs text-gray-400">—</span>
          </template>
        </template>
        <template #emptyText>
          <Empty :description="metricEmptyText" />
        </template>
      </Table>
    </Card>

    <div v-if="errorMsg && !isTransportError({ message: errorMsg })" class="mt-2 text-xs text-red-600">{{ errorMsg }}</div>
  </div>
</template>
