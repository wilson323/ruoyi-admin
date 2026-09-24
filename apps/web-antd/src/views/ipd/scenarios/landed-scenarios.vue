<script setup lang="ts">
/**
 * 落地场景登记/批量导入页。接口为 /api/v1/scenarios/landed 与 /api/v1/scenarios/landed/import。
 *
 * 设计：
 * - 列表 GET 的 projectId 后端必填：优先读路由 query.projectId，否则由顶部项目下拉选定；
 * - 缺 projectId 时展示空态提示，不发必 400 的无参请求（修法 A，owner 裁决）；
 * - 表格列出当前项目已登记落地场景；「新增」/「批量导入」提交后按当前项目刷新。
 *
 * 权限：MARKET_PM / RD_PM / GROUP_LEADER / SUPER_ADMIN 可写；GUEST 走 no-access。
 *
 * 五态：拒绝（角色）/ 待选项目 / 加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { RuleObject } from 'ant-design-vue/es/form';
import type { UploadProps } from 'ant-design-vue';

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
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
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Upload,
  message as antMessage,
} from 'ant-design-vue';

import {
  type LandedScenario,
  type LandedScenarioCreateReq,
  createLandedScenario,
  importLandedScenarios,
  listLandedScenarios,
} from '../../../api/ipd/scenarios';
import { IpdRequestError } from '../../../api/ipd/auth';
import { listProjects, type Project } from '../../../api/ipd/project';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import { PENDING_TEXT } from '../_shared/format';

type Phase = 'error' | 'loading' | 'ready';

const route = useRoute();
const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const GUEST_PERSON_TYPES = new Set(['GUEST']);
const canRead = computed(() => !GUEST_PERSON_TYPES.has(personType.value));

/**
 * 从路由 query 解析 projectId（与 ai-docs / kpi-shared 同模式，不硬编码）。
 *
 * @returns 非空字符串 ID，或 undefined（缺参）
 */
function projectIdFromQuery(): string | undefined {
  const raw = route.query.projectId;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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

/** 项目下拉（复用 listProjects，单次加载缓存）。 */
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
    label: p.name ? p.name + '（' + (p.code ?? '#' + p.id) + '）' : '#' + p.id,
    value: p.id,
  })),
);
const projectNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const p of projects.value) map.set(p.id, p.name ?? PENDING_TEXT);
  return map;
});

/** 列表：projectId 来自路由 query 或顶部下拉（后端必填，缺参不请求）。 */
const phase = ref<Phase>('ready');
const offline = ref(false);
const errorMsg = ref('');
const rows = ref<LandedScenario[]>([]);
const selectedProjectId = ref<undefined | string>(projectIdFromQuery());
const hasProjectId = computed(
  () => typeof selectedProjectId.value === 'string' && selectedProjectId.value.trim().length > 0,
);

const columns = [
  { dataIndex: 'landedDate', key: 'landedDate', title: '落地日期', width: 130 },
  { dataIndex: 'projectId', key: 'projectId', title: '项目', width: 180 },
  { dataIndex: 'scenarioCode', key: 'scenarioCode', title: '场景编码', width: 130 },
  { dataIndex: 'scenarioName', key: 'scenarioName', title: '场景名' },
  { dataIndex: 'amount', key: 'amount', title: '金额（万元）', width: 130 },
  { dataIndex: 'recordedBy', key: 'recordedBy', title: '录入人', width: 110 },
  { dataIndex: 'recordedAt', key: 'recordedAt', title: '录入时间', width: 170 },
];

function asRecord(record: Record<string, any>): LandedScenario {
  return record as LandedScenario;
}

function toNumber(value: null | number | string): null | number {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatAmount(record: LandedScenario): string {
  const num = toNumber(record.amount);
  return num === null ? PENDING_TEXT : num.toFixed(2);
}

function dateInputToIso(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value ? new Date(value as string) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

/**
 * 加载当前项目的落地场景列表；无 projectId 时清空并保持 ready（不发 GET）。
 */
async function load(): Promise<void> {
  offline.value = false;
  errorMsg.value = '';
  if (!hasProjectId.value) {
    rows.value = [];
    phase.value = 'ready';
    return;
  }
  phase.value = 'loading';
  try {
    rows.value = await listLandedScenarios({ projectId: selectedProjectId.value as string });
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(() => {
  void loadProjects();
  if (canRead.value) void load();
});

watch(selectedProjectId, () => {
  if (canRead.value) void load();
});

/** 单条新增弹窗。 */
interface CreateFormState {
  landedDate: undefined | string;
  landingAmount: undefined | number;
  projectId: undefined | string;
  scenarioCode: string;
  scenarioName: string;
}
const createOpen = ref(false);
const createSaving = ref(false);
const createForm = reactive<CreateFormState>({
  landedDate: undefined,
  landingAmount: undefined,
  projectId: undefined,
  scenarioCode: '',
  scenarioName: '',
});
const createFormRef = ref();
const createRules = computed<Record<string, RuleObject[]>>(() => ({
  landedDate: [
    { required: true, message: '请选择落地日期', trigger: 'change' },
    {
      validator: (_rule: RuleObject, value: undefined | string) =>
        value && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? Promise.resolve()
          : Promise.reject('落地日期格式应为 YYYY-MM-DD'),
    },
  ],
  landingAmount: [
    { required: true, message: '请输入金额', trigger: 'blur' },
    {
      validator: (_rule: RuleObject, value: undefined | number) =>
        value !== undefined && Number.isFinite(value)
          ? Promise.resolve()
          : Promise.reject('金额必须为有效数字'),
    },
  ],
  projectId: [{ required: true, message: '请选择项目', trigger: 'change' }],
  scenarioCode: [
    { required: true, whitespace: true, message: '请输入场景编码', trigger: 'blur' },
    { max: 64, message: '场景编码不能超过 64 字符', trigger: 'blur' },
  ],
  scenarioName: [
    { required: true, whitespace: true, message: '请输入场景名', trigger: 'blur' },
    { max: 128, message: '场景名不能超过 128 字符', trigger: 'blur' },
  ],
}));

function openCreate(): void {
  createForm.landedDate = undefined;
  createForm.landingAmount = undefined;
  createForm.projectId = selectedProjectId.value;
  createForm.scenarioCode = '';
  createForm.scenarioName = '';
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  if (createSaving.value) return;
  try {
    await createFormRef.value?.validate();
  } catch {
    return;
  }
  createSaving.value = true;
  try {
    const body: LandedScenarioCreateReq = {
      landedDate: dateInputToIso(createForm.landedDate),
      landingAmount: Number(createForm.landingAmount),
      projectId: createForm.projectId as string,
      scenarioCode: createForm.scenarioCode.trim(),
      scenarioName: createForm.scenarioName.trim(),
    };
    await createLandedScenario(body);
    antMessage.success('落地场景已登记');
    createOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    createSaving.value = false;
  }
}

/** 批量导入（Upload beforeUpload 拦截，解析 JSON 后走 POST）。 */
const importBusy = ref(false);
const importOpen = ref(false);
const importFileName = ref('');
const importSummary = ref('');
const importError = ref('');
const importIssueList = ref<{ index: number; reason: string }[]>([]);

function parseImportRow(row: unknown, index: number): null | LandedScenarioCreateReq {
  if (typeof row !== 'object' || row === null) {
    importIssueList.value.push({ index, reason: '非对象' });
    return null;
  }
  const r = row as Record<string, unknown>;
  const projectId = typeof r.projectId === 'string' ? r.projectId : String(r.projectId ?? '');
  const scenarioCode = typeof r.scenarioCode === 'string' ? r.scenarioCode : '';
  const scenarioName = typeof r.scenarioName === 'string' ? r.scenarioName : '';
  const landedDateRaw =
    typeof r.landedDate === 'string'
      ? r.landedDate
      : typeof r.landed_date === 'string'
        ? r.landed_date
        : '';
  const amountRaw = r.landingAmount ?? r.amount;
  const landingAmount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
  if (!projectId) importIssueList.value.push({ index, reason: 'projectId 缺失' });
  if (!scenarioCode) importIssueList.value.push({ index, reason: 'scenarioCode 缺失' });
  if (!scenarioName) importIssueList.value.push({ index, reason: 'scenarioName 缺失' });
  if (!landedDateRaw) importIssueList.value.push({ index, reason: 'landedDate 缺失' });
  if (!Number.isFinite(landingAmount)) importIssueList.value.push({ index, reason: 'landingAmount 非数字' });
  if (!projectId || !scenarioCode || !scenarioName || !landedDateRaw || !Number.isFinite(landingAmount)) {
    return null;
  }
  return {
    landedDate: dateInputToIso(landedDateRaw) || landedDateRaw,
    landingAmount,
    projectId,
    scenarioCode: scenarioCode.trim(),
    scenarioName: scenarioName.trim(),
  };
}

const uploadProps = computed<UploadProps>(() => ({
  accept: '.json,application/json',
  beforeUpload: async (file) => {
    importFileName.value = file.name;
    importSummary.value = '';
    importError.value = '';
    importIssueList.value = [];
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('JSON 必须为对象数组');
      }
      const rowsParsed = parsed.map((row, index) => parseImportRow(row, index));
      const valid = rowsParsed.filter((row): row is LandedScenarioCreateReq => row !== null);
      if (valid.length === 0) {
        throw new Error('无可用记录（请检查 JSON 字段）');
      }
      importBusy.value = true;
      try {
        const result = await importLandedScenarios(valid);
        const errorCount = result.errors?.length ?? 0;
        importSummary.value =
          '成功导入 ' + result.imported + ' 条，跳过 ' + result.skipped + ' 条' +
          (errorCount ? '；' + errorCount + ' 条后端错误' : '');
        antMessage.success(importSummary.value);
        importOpen.value = true;
        await load();
      } catch (cause) {
        importError.value = rejectText(cause);
        antMessage.error(importError.value);
        importOpen.value = true;
      } finally {
        importBusy.value = false;
      }
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : rejectText(cause);
      antMessage.error('JSON 解析失败：' + msg);
    }
    return false;
  },
  showUploadList: false,
}));

function reload(): void {
  void load();
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="落地场景登记：项目级已落地销售/部署的场景"
      description="与产品空间阶段的「立项场景清单」区分；批量导入走 JSON 上传（每行 {projectId, scenarioCode, scenarioName, landedDate, landingAmount}）。接口为 /api/v1/scenarios/landed 与 /import，拒绝与断网按真实结果展示。"
      show-icon
      type="info"
    />

    <Card v-if="!canRead">
      <Alert
        message="落地场景登记仅内部角色可见"
        description="游客（GUEST）请走游客门户提交；PM / 组长 / 超管可登记与导入。"
        show-icon
        type="info"
        role="alert"
      />
    </Card>

    <template v-else>
      <Card>
        <template #title>
          <Space>
            <span>已登记落地场景</span>
            <Tag color="default">当前项目 {{ rows.length }} 条</Tag>
          </Space>
        </template>
        <Space wrap>
          <Select
            v-model:value="selectedProjectId"
            :loading="projectLoading"
            :options="projectOptions"
            allow-clear
            class="min-w-[240px]"
            placeholder="选择项目（必选）"
            show-search
          />
          <Button :disabled="!hasProjectId" @click="reload">刷新</Button>
          <Button type="primary" @click="openCreate">新增</Button>
          <Upload v-bind="uploadProps">
            <Button :loading="importBusy">批量导入（JSON）</Button>
          </Upload>
          <span v-if="importFileName" class="text-muted-foreground text-xs">已选：{{ importFileName }}</span>
        </Space>
      </Card>

      <Card v-if="!hasProjectId" class="text-center">
        <Empty description="请先选择项目（或从带 ?projectId= 的链接进入），再查看该项目的落地场景。缺项目编号时不会请求列表接口。" />
      </Card>

      <Card v-else-if="phase === 'loading'" class="text-center">
        <Spin tip="正在加载落地场景" />
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
          <Empty description="该项目尚无落地场景记录。点击「新增」或「批量导入」录入第一批；接口已对接，按真实拒绝/断网状态展示。" />
        </Card>

        <Card v-else>
          <Table
            :columns="columns"
            :data-source="rows"
            :pagination="{ pageSize: 20, showSizeChanger: false }"
            row-key="id"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'projectId'">
                <span>{{ projectNameMap.get(asRecord(record).projectId ?? '') ?? '#' + (asRecord(record).projectId ?? '?') }}</span>
              </template>
              <template v-else-if="column.key === 'scenarioCode'">
                <code class="font-mono text-xs">{{ asRecord(record).scenarioCode || PENDING_TEXT }}</code>
              </template>
              <template v-else-if="column.key === 'amount'">
                <span class="tabular-nums">{{ formatAmount(asRecord(record)) }}</span>
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

    <Modal
      v-model:open="createOpen"
      :confirm-loading="createSaving"
      :mask-closable="false"
      cancel-text="取消"
      ok-text="保存"
      title="新增落地场景"
      @ok="submitCreate"
    >
      <Form
        ref="createFormRef"
        :label-col="{ span: 5 }"
        :model="createForm"
        :rules="createRules"
        :wrapper-col="{ span: 19 }"
      >
        <FormItem label="项目" name="projectId">
          <Select
            v-model:value="createForm.projectId"
            :loading="projectLoading"
            :options="projectOptions"
            allow-clear
            placeholder="选择项目"
            show-search
          />
        </FormItem>
        <FormItem label="场景编码" name="scenarioCode">
          <Input v-model:value="createForm.scenarioCode" :maxlength="64" placeholder="如 SCN-CN-001" />
        </FormItem>
        <FormItem label="场景名" name="scenarioName">
          <Input v-model:value="createForm.scenarioName" :maxlength="128" placeholder="如 杭州智慧园区项目交付" />
        </FormItem>
        <FormItem label="落地日期" name="landedDate">
          <DatePicker
            v-model:value="createForm.landedDate"
            format="YYYY-MM-DD"
            placeholder="选择落地日期"
            value-format="YYYY-MM-DD"
            class="w-full"
          />
        </FormItem>
        <FormItem label="金额（万元）" name="landingAmount">
          <InputNumber
            v-model:value="createForm.landingAmount"
            :max="1e9"
            :min="0"
            :precision="2"
            :step="1"
            class="w-full"
            placeholder="0.00"
          />
        </FormItem>
      </Form>
    </Modal>

    <Modal
      v-model:open="importOpen"
      :footer="null"
      title="批量导入结果"
      width="520px"
    >
      <Alert v-if="importSummary" :message="importSummary" show-icon type="success" />
      <Alert v-else-if="importError" :message="importError" show-icon type="error" />
      <p v-if="importIssueList.length" class="text-muted-foreground mt-3 text-xs">
        本次共跳过 {{ importIssueList.length }} 条（解析失败）：
      </p>
      <ul v-if="importIssueList.length" class="mt-2 max-h-48 overflow-auto text-xs">
        <li v-for="item in importIssueList" :key="item.index">
          第 {{ item.index + 1 }} 条：{{ item.reason }}
        </li>
      </ul>
    </Modal>
  </div>
</template>
