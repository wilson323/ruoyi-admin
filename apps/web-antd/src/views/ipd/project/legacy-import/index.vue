<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import type { RuleObject } from 'ant-design-vue/es/form';
import type { Dayjs } from 'dayjs';

import type { ProductGroup } from '../../../../api/ipd/product';
import type {
  LegacyImportBody,
  LegacyImportResult,
  LegacyImportRowOutcome,
  ProjectLevel,
  ProjectStage,
  TemplateType,
} from '../../../../api/ipd/project';

/**
 * 页09 存量项目导入（卡 P0-10.9；后端 ProjectController#legacyImport 已交付）。
 *
 * 仅超级管理员可访问（requireAdmin）。字段对齐 LegacyImportReq 白名单：
 *   name / productId / templateType / targetMarkets / level / levelCoefficient
 *   levelCoefficientReason / targetSalesAmount / targetChannelCount / targetNps
 *   targetSceneCount / mainGroupId / legacyEffectiveAt / declaredStage
 *   missingHistoryAck=true / alternativeEvidence（可选 Map）
 *
 * 业务校验：
 * - missingHistoryAck 必须勾选，否则后端 10001 拒绝（BR-PROD-03 历史缺失声明）；
 * - declaredStage 必填且必须从概念阶段起的合法阶段（CONCEPT/PLAN/DEV/VALID/LAUNCH/LIFECYCLE）；
 * - legacyEffectiveAt 必填（存量生效日，作为补齐起算点）；
 * - S/B 级必填 levelCoefficient + levelCoefficientReason（BR-INC-05 双签定值）；
 * - targetMarkets 至少 1 项（BR-PROD-02）。
 *
 * 规格 vs 代码差异：规格写「批量导入」UI 路径——R215 WP3.1 批次3（ORPHAN-A3）补接
 * POST /projects/legacy-import/batch 后，本页以「单条 / 批量队列」双模式承载：
 * 批量模式逐行填写入队、一次提交；错误行隔离不回滚已成功行（P1-9.1 契约）。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  message,
  RadioButton,
  RadioGroup,
  Select,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { listProductGroups } from '../../../../api/ipd/product';
import {
  legacyImportProject,
  legacyImportProjectsBatch,
} from '../../../../api/ipd/project';
import { ipdErrorText, isTransportError } from '../../_shared/ipd-error-text';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
import { stageText } from '../project-display';

const router = useRouter();

interface FormState {
  declaredStage: ProjectStage;
  legacyEffectiveAt: null | number;
  level: ProjectLevel;
  levelCoefficient: null | number;
  levelCoefficientReason: string;
  mainGroupId: string;
  marketsText: string;
  missingHistoryAck: boolean;
  name: string;
  productId: string;
  targetChannelCount: number;
  targetNps: number;
  targetSalesAmount: number;
  targetSceneCount: number;
  templateType: TemplateType;
}

const formState = reactive<FormState>({
  declaredStage: 'DEV',
  legacyEffectiveAt: null,
  level: 'A',
  levelCoefficient: null,
  levelCoefficientReason: '',
  mainGroupId: '',
  marketsText: '',
  missingHistoryAck: false,
  name: '',
  productId: '',
  targetChannelCount: 20,
  targetNps: 40,
  targetSalesAmount: 5_000_000,
  targetSceneCount: 4,
  templateType: 'HARDWARE',
});

const submitting = ref(false);
const submitError = ref<unknown>(null);
const importResult = ref<LegacyImportResult | null>(null);

/** 主组下拉（存量导入必填：不再手输撞 Long；复用 create 页模式）。加载失败不降级静默——必填字段无选项时须提示。 */
const groups = ref<ProductGroup[]>([]);
const groupLoadError = ref(false);
const groupOptions = computed(() =>
  groups.value.map((group) => ({ label: group.groupName, value: group.id })),
);
onMounted(() => {
  listProductGroups()
    .then((list) => {
      groups.value = list;
      groupLoadError.value = false;
    })
    .catch(() => {
      groups.value = [];
      groupLoadError.value = true;
    });
});

const templateOptions = [
  { label: '硬件', value: 'HARDWARE' as TemplateType },
  { label: '软件', value: 'SOFTWARE' as TemplateType },
  { label: '解决方案', value: 'SOLUTION' as TemplateType },
];

const levelOptions = [
  { label: 'S 级（战略）', value: 'S' as ProjectLevel },
  { label: 'A 级（标准）', value: 'A' as ProjectLevel },
  { label: 'B 级（差异化下调）', value: 'B' as ProjectLevel },
];

/** 申报阶段候选（BR-PROD-03：必须从概念阶段起的合法阶段；服务端继续校验）。 */
const stageOptions = [
  { label: '概念阶段', value: 'CONCEPT' as ProjectStage },
  { label: '计划阶段', value: 'PLAN' as ProjectStage },
  { label: '开发阶段', value: 'DEV' as ProjectStage },
  { label: '验证阶段', value: 'VALID' as ProjectStage },
  { label: '发布阶段', value: 'LAUNCH' as ProjectStage },
  { label: '生命周期', value: 'LIFECYCLE' as ProjectStage },
];

const parsedMarkets = computed<string[]>(() => {
  const text = formState.marketsText;
  if (!text) return [];
  const items = text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
});

const needCoefficient = computed(
  () => formState.level === 'S' || formState.level === 'B',
);

/** DatePicker 收 dayjs、InputNumber 不收 null：与 FormState 双向适配。 */
const legacyEffectiveAtModel = computed<Dayjs | string | undefined>({
  get: () =>
    formState.legacyEffectiveAt == null
      ? undefined
      : dayjs(formState.legacyEffectiveAt),
  set: (value) => {
    formState.legacyEffectiveAt = dayjs.isDayjs(value) ? value.valueOf() : null;
  },
});
const levelCoefficientModel = computed<number | string | undefined>({
  get: () =>
    formState.levelCoefficient == null ? undefined : formState.levelCoefficient,
  set: (value) => {
    formState.levelCoefficient =
      value == null || value === '' ? null : Number(value);
  },
});

const rules = computed<Record<string, RuleObject[]>>(() => ({
  name: [{ required: true, message: '项目名称必填', whitespace: true, min: 4 }],
  productId: [{ required: true, message: '产品 ID 必填' }],
  templateType: [{ required: true, message: '模板类型必填' }],
  level: [{ required: true, message: '立项级别必填' }],
  declaredStage: [{ required: true, message: '申报当前阶段必填' }],
  legacyEffectiveAt: [
    { required: true, type: 'number', message: '存量生效日必填' },
  ],
  mainGroupId: [{ required: true, message: '主组（市场PM 所在产品组）必填' }],
  marketsText: [
    {
      required: true,
      message: '目标市场至少 1 项；多值用换行或逗号分隔',
      validator: async () => {
        if (parsedMarkets.value.length === 0)
          throw new Error('目标市场至少 1 项；多值用换行或逗号分隔');
      },
    },
  ],
  missingHistoryAck: [
    {
      required: true,
      validator: async () => {
        if (formState.missingHistoryAck !== true)
          throw new Error('必须勾选「已确认历史缺失」才能提交（BR-PROD-03）');
      },
      message: '必须勾选「已确认历史缺失」才能提交（BR-PROD-03）',
      type: 'boolean',
    },
  ],
  targetSalesAmount: [
    {
      required: true,
      type: 'number',
      min: 1,
      message: '立项目标销售额必须大于 0',
    },
  ],
  targetChannelCount: [
    {
      required: true,
      type: 'number',
      min: 1,
      message: '立项目标渠道商数必须大于 0',
    },
  ],
  targetNps: [
    {
      required: true,
      type: 'number',
      min: 0,
      max: 100,
      message: '立项 NPS 需在 0-100 之间',
    },
  ],
  targetSceneCount: [
    {
      required: true,
      type: 'number',
      min: 1,
      message: '立项目标场景数必须大于 0',
    },
  ],
}));

function toBody(): LegacyImportBody {
  return {
    name: formState.name.trim(),
    productId: formState.productId.trim(),
    templateType: formState.templateType,
    targetMarkets: parsedMarkets.value,
    level: formState.level,
    levelCoefficient: needCoefficient.value ? formState.levelCoefficient : null,
    levelCoefficientReason: needCoefficient.value
      ? formState.levelCoefficientReason.trim()
      : null,
    targetSalesAmount: formState.targetSalesAmount,
    targetChannelCount: formState.targetChannelCount,
    targetNps: formState.targetNps,
    targetSceneCount: formState.targetSceneCount,
    mainGroupId: formState.mainGroupId.trim(),
    legacyEffectiveAt: formState.legacyEffectiveAt as number,
    declaredStage: formState.declaredStage,
    missingHistoryAck: true,
  };
}

async function onFinish(): Promise<void> {
  submitError.value = null;
  importResult.value = null;
  submitting.value = true;
  try {
    const result = await legacyImportProject(toBody());
    importResult.value = result;
    message.success('存量项目已导入；请从概念阶段开始补齐缺失节点');
  } catch (error) {
    submitError.value = error;
  } finally {
    submitting.value = false;
  }
}

function cancel(): void {
  router.replace('/ipd/projects');
}

function gotoDetail(): void {
  const id = importResult.value?.project.id;
  if (id) router.replace(`/ipd/projects/${id}/overview`);
}

// ---------- R215 WP3.1 批次3（ORPHAN-A3）：批量导入（POST /projects/legacy-import/batch） ----------

type ImportMode = 'batch' | 'single';
const mode = ref<ImportMode>('single');

/** 队列行：body 为 LegacyImportBody 白名单；key 仅为渲染 row-key（不参与请求）。 */
interface BatchQueueRow {
  body: LegacyImportBody;
  key: number;
}

const formRef = ref<FormInstance>();
let batchSeq = 0;
const batchRows = ref<BatchQueueRow[]>([]);
const batchSubmitting = ref(false);
const batchError = ref<unknown>(null);
/** 逐行结果（index 对应提交顺序；ok=false 行 error 携带后端拒绝原因）。 */
const batchResults = ref<LegacyImportRowOutcome[] | null>(null);

/** 队列主组列展示组名而非裸 ID（组列表已在本页加载）。 */
function groupNameById(id: string): string {
  return groups.value.find((group) => group.id === id)?.groupName ?? id;
}

/** 表单校验通过后入队（字段级错误信息由 Form 内联展示，此处静默返回）。 */
async function addToBatch(): Promise<void> {
  try {
    await formRef.value?.validateFields();
  } catch {
    return;
  }
  batchRows.value = [...batchRows.value, { body: toBody(), key: ++batchSeq }];
  message.success(`已加入批量队列（当前 ${batchRows.value.length} 行）`);
}

function removeBatchRow(key: number): void {
  batchRows.value = batchRows.value.filter((row) => row.key !== key);
}

async function submitBatch(): Promise<void> {
  if (batchRows.value.length === 0 || batchSubmitting.value) return;
  batchSubmitting.value = true;
  batchError.value = null;
  batchResults.value = null;
  try {
    const results = await legacyImportProjectsBatch(
      batchRows.value.map((row) => row.body),
    );
    batchResults.value = results;
    const okCount = results.filter((row) => row.ok).length;
    message.success(
      `批量导入完成：成功 ${okCount} 行 / 失败 ${results.length - okCount} 行（错误行隔离，不回滚已成功行）`,
    );
    // 全部成功才清空队列；存在失败行时保留队列便于修正后重提。
    if (okCount === results.length) batchRows.value = [];
  } catch (error) {
    batchError.value = error;
  } finally {
    batchSubmitting.value = false;
  }
}

const queueColumns = [
  { title: '#', key: 'seq', width: 48 },
  { title: '项目名称', dataIndex: 'name', key: 'name', width: 200 },
  { title: '主组', key: 'mainGroupId', width: 140 },
  { title: '级别', dataIndex: 'level', key: 'level', width: 70 },
  { title: '申报阶段', key: 'declaredStage', width: 100 },
  { title: '目标市场', key: 'targetMarkets', width: 120 },
  { title: '操作', key: 'rowAction', width: 80 },
];

const resultColumns = [
  { title: '行号', dataIndex: 'index', key: 'index', width: 60 },
  { title: '结果', key: 'ok', width: 80 },
  { title: '项目 ID', key: 'projectId', width: 190 },
  { title: '错误原因', key: 'error', width: 260 },
  { title: '历史缺失标记', key: 'markedCodes', width: 200 },
];
</script>

<template>
  <div class="p-4">
    <Card>
      <template #title>存量项目导入</template>
      <template #extra>
        <Space>
          <Button @click="cancel">返回列表</Button>
        </Space>
      </template>

      <Alert
        class="mb-4"
        message="仅超级管理员可操作。导入后项目从概念阶段起的缺失节点需逐一补齐，确认历史缺失的节点自动豁免门禁（BR-PROD-03）。"
        show-icon
        type="warning"
      />

      <!-- R215 WP3.1 批次3（ORPHAN-A3）：单条 / 批量双模式（批量走 POST /legacy-import/batch）。 -->
      <div class="mb-4">
        <RadioGroup v-model:value="mode">
          <RadioButton value="single">单条导入</RadioButton>
          <RadioButton value="batch">批量导入（队列）</RadioButton>
        </RadioGroup>
        <span class="text-muted-foreground ml-3 text-xs">
          {{
            mode === 'single'
              ? '单条提交（POST /projects/legacy-import）'
              : '逐行填写入队后一次提交（POST /projects/legacy-import/batch，错误行隔离不回滚成功行）'
          }}
        </span>
      </div>

      <Alert
        v-if="mode === 'batch'"
        class="mb-4"
        message="批量模式：填写一行 → 「加入批量队列」→ 清空名称继续填下一行；队列一次提交，失败行会保留队列供修正重提。"
        show-icon
        type="info"
      />

      <Alert
        v-if="submitError"
        class="mb-4"
        :message="
          submitError
            ? isTransportError(submitError)
              ? '无法连接服务，请检查网络后重试'
              : ipdErrorText(submitError, {
                  domain: 'project',
                  fallback: '导入失败，请检查输入后重试',
                })
            : ''
        "
        type="error"
        show-icon
      />

      <Alert
        v-if="importResult"
        class="mb-4"
        type="success"
        show-icon
        :message="`导入成功：编码 ${importResult.project.code ?? '待补充'}；服务端自动标「历史缺失」${importResult.markedCodes.length} 项`"
      >
        <template #description>
          <Space>
            <Button size="small" type="primary" @click="gotoDetail">
              进入项目详情
            </Button>
            <Button size="small" @click="cancel">返回列表</Button>
          </Space>
        </template>
      </Alert>

      <Form
        ref="formRef"
        :model="formState"
        :rules="rules"
        layout="vertical"
        class="max-w-[760px]"
        @finish="onFinish"
      >
        <Form.Item label="项目名称" name="name">
          <Input
            v-model:value="formState.name"
            placeholder="存量项目的真实名称"
            :maxlength="120"
            show-count
          />
        </Form.Item>

        <Form.Item
          label="产品 ID"
          name="productId"
          extra="1:1 项目-产品关系（BR-PROD-01）。"
        >
          <Input
            v-model:value="formState.productId"
            placeholder="产品唯一标识"
          />
        </Form.Item>

        <Form.Item
          label="主组（市场PM 所在产品组）"
          name="mainGroupId"
          extra="BR-ORG-01：项目归属于市场PM 所在产品组；存量导入必选。"
        >
          <Select
            v-model:value="formState.mainGroupId"
            :options="groupOptions"
            placeholder="选择产品组"
            :disabled="groupLoadError"
            show-search
            option-filter-prop="label"
          />
        </Form.Item>

        <Alert
          v-if="groupLoadError"
          class="mb-4"
          message="产品组列表加载失败，无法选择主组；请刷新页面重试后再提交导入。"
          show-icon
          type="error"
        />

        <Form.Item label="模板类型" name="templateType">
          <Select
            v-model:value="formState.templateType"
            :options="templateOptions"
          />
        </Form.Item>

        <Form.Item
          label="目标市场（国家代码）"
          name="marketsText"
          extra="多值以换行或逗号分隔。"
        >
          <Input.TextArea
            v-model:value="formState.marketsText"
            placeholder="SA&#10;EU"
            :auto-size="{ minRows: 2, maxRows: 4 }"
          />
        </Form.Item>

        <Form.Item
          label="申报当前阶段"
          name="declaredStage"
          extra="BR-PROD-03：必须从概念阶段起的合法阶段；服务层继续校验。"
        >
          <Select
            v-model:value="formState.declaredStage"
            :options="stageOptions"
          />
        </Form.Item>

        <Form.Item
          label="存量生效日"
          name="legacyEffectiveAt"
          extra="项目作为存量的生效起点；服务端以此写入 legacyEffectiveAt。"
        >
          <DatePicker v-model:value="legacyEffectiveAtModel" class="!w-56" />
        </Form.Item>

        <Form.Item label="立项级别" name="level">
          <Select v-model:value="formState.level" :options="levelOptions" />
        </Form.Item>

        <Form.Item
          label="差异化系数"
          name="levelCoefficient"
          extra="S/B 必填（BR-INC-05 双签定值）；A 级可不填。"
        >
          <InputNumber
            v-model:value="levelCoefficientModel"
            :min="0"
            :max="2"
            :step="0.01"
            :precision="4"
            class="!w-full"
            :disabled="!needCoefficient"
          />
        </Form.Item>

        <Form.Item
          label="系数定值理由"
          name="levelCoefficientReason"
          extra="S/B 必填；A 级不填。"
        >
          <Input.TextArea
            v-model:value="formState.levelCoefficientReason"
            :auto-size="{ minRows: 2, maxRows: 4 }"
            :disabled="!needCoefficient"
            :maxlength="500"
            show-count
          />
        </Form.Item>

        <Space size="large" wrap>
          <Form.Item label="立项目标销售额（元）" name="targetSalesAmount">
            <InputNumber
              v-model:value="formState.targetSalesAmount"
              :min="1"
              :step="10000"
              class="!w-56"
            />
          </Form.Item>
          <Form.Item label="立项目标渠道商数" name="targetChannelCount">
            <InputNumber
              v-model:value="formState.targetChannelCount"
              :min="1"
              class="!w-40"
            />
          </Form.Item>
          <Form.Item label="立项 NPS（0-100）" name="targetNps">
            <InputNumber
              v-model:value="formState.targetNps"
              :min="0"
              :max="100"
              class="!w-40"
            />
          </Form.Item>
          <Form.Item label="立项目标场景数" name="targetSceneCount">
            <InputNumber
              v-model:value="formState.targetSceneCount"
              :min="1"
              class="!w-40"
            />
          </Form.Item>
        </Space>

        <Form.Item
          label="已确认历史缺失"
          name="missingHistoryAck"
          extra="BR-PROD-03：勾选表示已确认已过节点历史缺失；服务端会把缺失动作标 HISTORICAL_MISSING（不伪造 DONE，门禁视为已满足）。"
        >
          <Checkbox v-model:checked="formState.missingHistoryAck">
            我已确认：当前申报阶段之前的所有节点均为历史缺失，由服务端标记并豁免门禁
          </Checkbox>
        </Form.Item>

        <Space>
          <Button
            v-if="mode === 'single'"
            type="primary"
            html-type="submit"
            :loading="submitting"
          >
            提交导入
          </Button>
          <Button v-else type="primary" @click="addToBatch">
            加入批量队列
          </Button>
          <Button @click="cancel">取消</Button>
        </Space>
      </Form>

      <div v-if="importResult" class="text-muted-foreground mt-4 text-xs">
        当前申报阶段：{{
          stageText(importResult.project.declaredStage)
        }}；服务端补齐状态：
        {{ importResult.project.catchupStatus ?? '待补充' }}
      </div>

      <!-- 批量队列 + 逐行结果（仅批量模式显示）。 -->
      <template v-if="mode === 'batch'">
        <div class="mt-6">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium">批量队列（{{ batchRows.length }} 行）</span>
            <Space>
              <Button
                size="small"
                :disabled="batchRows.length === 0"
                @click="batchRows = []"
              >
                清空队列
              </Button>
              <Button
                v-access:code="IPD_PERMISSION_CODES.PROJECT_CREATE"
                size="small"
                type="primary"
                :loading="batchSubmitting"
                :disabled="batchRows.length === 0"
                @click="submitBatch"
              >
                提交批量导入
              </Button>
            </Space>
          </div>

          <Alert
            v-if="batchError"
            class="mb-3"
            :message="
              isTransportError(batchError)
                ? '无法连接服务，请检查网络后重试'
                : ipdErrorText(batchError, {
                    domain: 'project',
                    fallback: '批量导入失败，请稍后重试',
                  })
            "
            show-icon
            type="error"
          />

          <Table
            :columns="queueColumns"
            :data-source="batchRows"
            :row-key="(record: Record<string, any>) => String(record.key)"
            :pagination="false"
            size="small"
            bordered
          >
            <template
              #bodyCell="{
                column,
                record,
              }: {
                column: Record<string, any>;
                record: Record<string, any>;
              }"
            >
              <template v-if="column.key === 'seq'">
                <span>{{
                  batchRows.indexOf(record as BatchQueueRow) + 1
                }}</span>
              </template>
              <template v-else-if="column.key === 'mainGroupId'">
                <span>{{
                  groupNameById(
                    String((record as BatchQueueRow).body.mainGroupId),
                  )
                }}</span>
              </template>
              <template v-else-if="column.key === 'declaredStage'">
                <span>{{
                  stageText((record as BatchQueueRow).body.declaredStage)
                }}</span>
              </template>
              <template v-else-if="column.key === 'targetMarkets'">
                <span>{{
                  (record as BatchQueueRow).body.targetMarkets.join('、')
                }}</span>
              </template>
              <template v-else-if="column.key === 'rowAction'">
                <Button
                  danger
                  size="small"
                  @click="removeBatchRow(Number(record.key))"
                >
                  移除
                </Button>
              </template>
            </template>
            <template #emptyText>
              <span>队列为空；在上方表单填写一行后点击「加入批量队列」</span>
            </template>
          </Table>
        </div>

        <div v-if="batchResults" class="mt-6">
          <div class="mb-2 font-medium">
            逐行结果（成功 {{ batchResults.filter((row) => row.ok).length }} /
            失败 {{ batchResults.filter((row) => !row.ok).length }}）
          </div>
          <Table
            :columns="resultColumns"
            :data-source="batchResults"
            :row-key="(record: Record<string, any>) => String(record.index)"
            :pagination="false"
            size="small"
            bordered
          >
            <template
              #bodyCell="{
                column,
                record,
              }: {
                column: Record<string, any>;
                record: Record<string, any>;
              }"
            >
              <template v-if="column.key === 'ok'">
                <Tag :color="record.ok ? 'success' : 'error'">
                  {{ record.ok ? '成功' : '失败' }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'projectId'">
                <span>{{ record.projectId || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'error'">
                <span>{{ record.error || '—' }}</span>
              </template>
              <template v-else-if="column.key === 'markedCodes'">
                <span>{{
                  record.markedCodes?.length
                    ? record.markedCodes.join('、')
                    : '—'
                }}</span>
              </template>
            </template>
          </Table>
        </div>
      </template>
    </Card>
  </div>
</template>
