<script setup lang="ts">
/**
 * KPI 原始数据录入/展示页。接口为 GET/POST /api/v1/kpi/raw-records。
 *
 * 设计：KPI 类型枚举由权威端点 GET /api/v1/kpi/raw-records/types 下发
 * （ORPHAN-A6 #40，R212 看板卡 8338f2fa，2026-09-25 接线；此前硬编码 8 项）；
 * 拉取失败/为空回退本地清单（REVENUE/CHANNEL_COUNT/NPS/SCENE_COUNT/BUG_COUNT/
 * COMPLAINT_COUNT/CERT_COUNT/COMPLETION_RATE，与后端 listSupportedTypes 同源口径）；
 * 按 projectId + kpiType 筛选已录入记录；
 * 顶部表单新增一条（项目下拉 + KPI 类型下拉 + 期间日期 + 原始值数字 + 备注）。
 *
 * 权限：仅 GROUP_LEADER（产品组长）可见可写；超管可在审批链上看到本组数据但本页面限定组长；
 * 其他角色访问走 no-access.vue 占位（与 admin/org 同模式，五态齐全）。
 *
 * 五态：拒绝（角色）/ 加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { RuleObject } from 'ant-design-vue/es/form';

import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  KPI_RAW_TYPES,
  type KpiRawType,
  type RawKpiRecord,
  createRawKpiRecord,
  listRawKpiRecordTypes,
  listRawKpiRecords,
} from '../../../api/ipd/kpi';
import { IpdRequestError } from '../../../api/ipd/auth';
import { listProjects, type Project } from '../../../api/ipd/project';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import { PENDING_TEXT } from '../_shared/format';

type Phase = 'error' | 'loading' | 'ready';

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const isLeader = computed(() => personType.value === 'GROUP_LEADER');

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}
const isTransportError = (cause: unknown): boolean =>
  cause instanceof IpdRequestError && cause.kind === 'transport';

/** 项目下拉（拉一次，复用于筛选与录入；远期可下沉为 useProjectList composable）。 */
const projects = ref<Project[]>([]);
const projectLoading = ref(false);
async function loadProjects(): Promise<void> {
  if (projects.value.length) return;
  projectLoading.value = true;
  try {
    projects.value = await listProjects();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    projectLoading.value = false;
  }
}

const projectOptions = computed(() =>
  projects.value.map((p) => ({
    label: p.name ? `${p.name}（${p.code ?? '#' + p.id}）` : `#${p.id}`,
    value: p.id,
  })),
);
const projectNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const p of projects.value) {
    map.set(p.id, p.name ?? PENDING_TEXT);
  }
  return map;
});

/** 录入表单。 */
interface CreateFormState {
  kpiType: KpiRawType | undefined;
  period: undefined | string;
  projectId: undefined | string;
  rawValue: undefined | number;
  remark: string;
}

const createForm = reactive<CreateFormState>({
  kpiType: undefined,
  period: undefined,
  projectId: undefined,
  rawValue: undefined,
  remark: '',
});
const createFormRef = ref();
const createSaving = ref(false);
const createRules = computed<Record<string, RuleObject[]>>(() => ({
  kpiType: [{ required: true, message: '请选择 KPI 类型', trigger: 'change' }],
  period: [
    { required: true, message: '请选择期间日期', trigger: 'change' },
    {
      validator: (_rule: RuleObject, value: undefined | string) =>
        value && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? Promise.resolve()
          : Promise.reject('期间日期格式应为 YYYY-MM-DD'),
    },
  ],
  projectId: [{ required: true, message: '请选择项目', trigger: 'change' }],
  rawValue: [
    { required: true, message: '请输入原始值', trigger: 'blur' },
    {
      validator: (_rule: RuleObject, value: undefined | number) =>
        value === undefined || !Number.isFinite(value)
          ? Promise.reject('原始值必须为有效数字')
          : Promise.resolve(),
    },
  ],
}));

/** 列表 + 筛选。 */
const phase = ref<Phase>('loading');
const offline = ref(false);
const errorMsg = ref('');
const rows = ref<RawKpiRecord[]>([]);
const filterProjectId = ref<undefined | string>(undefined);
const filterKpiType = ref<undefined | string>(undefined);

const visibleRows = computed(() => {
  return rows.value.filter((row) => {
    if (filterProjectId.value && row.projectId !== filterProjectId.value) return false;
    if (filterKpiType.value && row.kpiType !== filterKpiType.value) return false;
    return true;
  });
});

/** ORPHAN-A6 #40：本地 8 项清单降级为回退口径 + label 字典（权威编码来自 /types 端点）。 */
const LOCAL_TYPE_LABELS = new Map<string, string>(KPI_RAW_TYPES.map((t) => [t.value, t.label]));
const rawTypeOptions = ref<{ label: string; value: string }[]>(
  KPI_RAW_TYPES.map((t) => ({ label: t.label, value: t.value })),
);

async function loadRawTypes(): Promise<void> {
  try {
    const types = await listRawKpiRecordTypes();
    // 防御：仅接受非空字符串数组（异常包络/空清单一律回退本地口径）
    const sanitized = Array.isArray(types) ? types.filter((t): t is string => typeof t === 'string' && t.length > 0) : [];
    if (sanitized.length) {
      rawTypeOptions.value = sanitized.map((t) => ({ label: LOCAL_TYPE_LABELS.get(t) ?? t, value: t }));
    }
  } catch {
    // 权威枚举不可达 → 回退本地 8 项（与后端 listSupportedTypes 同源，G-06 不造假）
  }
}

const typeLabelMap = computed(() => new Map<string, string>(rawTypeOptions.value.map((o) => [o.value, o.label])));

const columns = [
  { dataIndex: 'period', key: 'period', title: '期间', width: 120 },
  { dataIndex: 'projectId', key: 'projectId', title: '项目', width: 200 },
  { dataIndex: 'kpiType', key: 'kpiType', title: 'KPI 类型', width: 200 },
  { dataIndex: 'rawValue', key: 'rawValue', title: '原始值', width: 140 },
  { dataIndex: 'remark', key: 'remark', title: '备注' },
  { dataIndex: 'recordedBy', key: 'recordedBy', title: '录入人', width: 110 },
  { dataIndex: 'recordedAt', key: 'recordedAt', title: '录入时间', width: 170 },
];

function asRecord(record: Record<string, any>): RawKpiRecord {
  return record as RawKpiRecord;
}

function toNumber(value: null | number | string): null | number {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatRawValue(record: RawKpiRecord): string {
  const num = toNumber(record.rawValue);
  if (num === null) return PENDING_TEXT;
  if (record.kpiType === 'COMPLETION_RATE') return num.toFixed(4);
  return num.toString();
}

function dateInputToIso(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value ? new Date(value as string) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function load(): Promise<void> {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    rows.value = await listRawKpiRecords();
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(() => {
  void loadProjects();
  // ORPHAN-A6 #40：types 权威枚举（组长可见下拉/表格消费；失败回退本地 8 项）
  if (isLeader.value) void loadRawTypes();
  if (isLeader.value) void load();
});

async function submitCreate(): Promise<void> {
  if (createSaving.value) return;
  try {
    await createFormRef.value?.validate();
  } catch {
    return;
  }
  createSaving.value = true;
  try {
    await createRawKpiRecord({
      kpiType: createForm.kpiType as KpiRawType,
      period: dateInputToIso(createForm.period),
      projectId: createForm.projectId as string,
      rawValue: Number(createForm.rawValue),
      remark: createForm.remark.trim() || null,
    });
    antMessage.success('KPI 原始记录已录入');
    createForm.kpiType = undefined;
    createForm.period = undefined;
    createForm.projectId = undefined;
    createForm.rawValue = undefined;
    createForm.remark = '';
    createFormRef.value?.resetFields();
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    createSaving.value = false;
  }
}

function resetFilters(): void {
  filterProjectId.value = undefined;
  filterKpiType.value = undefined;
}

function reload(): void {
  void load();
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="KPI 原始数据录入：8 项固定类型枚举（销售/渠道/NPS/场景/缺陷/投诉/认证/完成率），按项目+期间登记"
      description="仅产品组长（GROUP_LEADER）可写；记录只可调取不可改写（与既有 KpiRecord 不可变语义一致）。接口为 GET/POST /api/v1/kpi/raw-records，拒绝与断网按真实结果展示。"
      show-icon
      type="info"
    />

    <Card v-if="!isLeader">
      <Alert
        message="KPI 原始数据录入为产品组长专属页面"
        description="该入口仅 GROUP_LEADER 可访问；其他角色走工作台「协同绩效」读端点，不开放录入。"
        show-icon
        type="info"
        role="alert"
      />
    </Card>

    <template v-else>
      <Card title="新增原始记录">
        <Form
          ref="createFormRef"
          :label-col="{ span: 5 }"
          :model="createForm"
          :rules="createRules"
          :wrapper-col="{ span: 19 }"
          layout="horizontal"
        >
          <div class="grid grid-cols-1 gap-x-6 md:grid-cols-2 lg:grid-cols-3">
            <FormItem label="项目" name="projectId">
              <Select
                v-model:value="createForm.projectId"
                :loading="projectLoading"
                :options="projectOptions"
                allow-clear
                placeholder="选择项目（按已加载下拉）"
                show-search
              />
            </FormItem>
            <FormItem label="KPI 类型" name="kpiType">
              <Select
                v-model:value="createForm.kpiType"
                :options="rawTypeOptions"
                allow-clear
                placeholder="选择 KPI 类型（权威枚举）"
              />
            </FormItem>
            <FormItem label="期间日期" name="period">
              <DatePicker
                v-model:value="createForm.period"
                format="YYYY-MM-DD"
                placeholder="选择期间（YYYY-MM-DD）"
                value-format="YYYY-MM-DD"
                class="w-full"
              />
            </FormItem>
            <FormItem label="原始值" name="rawValue">
              <InputNumber
                v-model:value="createForm.rawValue"
                :max="1e9"
                :min="-1e9"
                :precision="4"
                :step="1"
                class="w-full"
                placeholder="数字；完成率 0-1"
              />
            </FormItem>
            <FormItem label="备注" name="remark">
              <Input
                v-model:value="createForm.remark"
                :maxlength="200"
                allow-clear
                placeholder="选填，≤200 字"
              />
            </FormItem>
            <FormItem label=" " :wrapper-col="{ span: 24 }">
              <Space>
                <Button :loading="createSaving" type="primary" @click="submitCreate">
                  提交录入
                </Button>
                <Button @click="createFormRef?.resetFields()">重置</Button>
              </Space>
            </FormItem>
          </div>
        </Form>
      </Card>

      <Card>
        <template #title>
          <Space>
            <span>已录入原始记录</span>
            <Tag color="default">当前可见 {{ visibleRows.length }} 条 / 全量 {{ rows.length }} 条</Tag>
          </Space>
        </template>
        <Space wrap>
          <Select
            v-model:value="filterProjectId"
            :options="projectOptions"
            allow-clear
            class="min-w-[240px]"
            placeholder="按项目筛选"
            show-search
          />
          <Select
            v-model:value="filterKpiType"
            :options="rawTypeOptions"
            allow-clear
            class="min-w-[220px]"
            placeholder="按 KPI 类型筛选"
          />
          <Button @click="resetFilters">清空筛选</Button>
          <Button @click="reload">刷新</Button>
        </Space>
      </Card>

      <Card v-if="phase === 'loading'" class="text-center">
        <Spin tip="正在加载原始记录" />
      </Card>

      <template v-else>
        <Alert
          v-if="phase === 'error'"
          :message="errorMsg"
          show-icon
          type="error"
          role="alert"
        >
          <template v-if="offline" #action>
            <Button danger size="small" @click="reload">重新加载</Button>
          </template>
        </Alert>

        <Card v-else-if="rows.length === 0" class="text-center">
          <Empty description="尚无 KPI 原始记录。点击上方「提交录入」创建第一条；接口已对接，按真实拒绝/断网状态展示。" />
        </Card>

        <Card v-else-if="visibleRows.length === 0" class="text-center">
          <Empty description="当前过滤条件下无匹配记录。" />
        </Card>

        <Card v-else>
          <Table
            :columns="columns"
            :data-source="visibleRows"
            :pagination="{ pageSize: 20, showSizeChanger: false }"
            row-key="id"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'projectId'">
                <span>{{ projectNameMap.get(asRecord(record).projectId ?? '') ?? '#' + (asRecord(record).projectId ?? '?') }}</span>
              </template>
              <template v-else-if="column.key === 'kpiType'">
                <Tag color="blue">{{ typeLabelMap.get(asRecord(record).kpiType ?? '') ?? asRecord(record).kpiType ?? PENDING_TEXT }}</Tag>
              </template>
              <template v-else-if="column.key === 'rawValue'">
                <span class="tabular-nums">{{ formatRawValue(asRecord(record)) }}</span>
              </template>
              <template v-else-if="column.key === 'remark'">
                <span class="text-muted-foreground text-sm">{{ asRecord(record).remark || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'recordedBy'">
                <span class="text-muted-foreground text-sm">
                  {{ asRecord(record).recordedBy ? '#' + asRecord(record).recordedBy : PENDING_TEXT }}
                </span>
              </template>
              <template v-else-if="column.key === 'recordedAt'">
                <span class="text-muted-foreground tabular-nums text-xs">{{ asRecord(record).recordedAt || PENDING_TEXT }}</span>
              </template>
            </template>
          </Table>
        </Card>
      </template>
    </template>
  </div>
</template>
