<script setup lang="ts">
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
 * 规格 vs 代码差异：规格写「批量导入」UI 路径，但 LegacyImportController 仅暴露单条
 * 与批量端点，UI 按单条实现（单条 → 批量入口由超管另行发起，不在页09）。
 */
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import dayjs, { type Dayjs } from 'dayjs';
import type { RuleObject } from 'ant-design-vue/es/form';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  message,
} from 'ant-design-vue';

import type {
  LegacyImportBody,
  LegacyImportResult,
  ProjectLevel,
  ProjectStage,
  TemplateType,
} from '../../../../api/ipd/project';
import { legacyImportProject } from '../../../../api/ipd/project';
import { isTransportError, projectErrorText } from '../project-error';
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
  const items = text.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
});

const needCoefficient = computed(() => formState.level === 'S' || formState.level === 'B');

/** DatePicker 收 dayjs、InputNumber 不收 null：与 FormState 双向适配。 */
const legacyEffectiveAtModel = computed<Dayjs | string | undefined>({
  get: () => (formState.legacyEffectiveAt == null ? undefined : dayjs(formState.legacyEffectiveAt)),
  set: (value) => {
    formState.legacyEffectiveAt = dayjs.isDayjs(value) ? value.valueOf() : null;
  },
});
const levelCoefficientModel = computed<number | string | undefined>({
  get: () => (formState.levelCoefficient == null ? undefined : formState.levelCoefficient),
  set: (value) => {
    formState.levelCoefficient = value == null || value === '' ? null : Number(value);
  },
});

const rules = computed<Record<string, RuleObject[]>>(() => ({
  name: [{ required: true, message: '项目名称必填', whitespace: true, min: 4 }],
  productId: [{ required: true, message: '产品 ID 必填' }],
  templateType: [{ required: true, message: '模板类型必填' }],
  level: [{ required: true, message: '立项级别必填' }],
  declaredStage: [{ required: true, message: '申报当前阶段必填' }],
  legacyEffectiveAt: [{ required: true, type: 'number', message: '存量生效日必填' }],
  mainGroupId: [{ required: true, message: '主组（市场PM 所在产品组）必填' }],
  marketsText: [{
    required: true,
    message: '目标市场至少 1 项；多值用换行或逗号分隔',
    validator: async () => {
      if (parsedMarkets.value.length < 1) throw new Error('目标市场至少 1 项；多值用换行或逗号分隔');
    },
  }],
  missingHistoryAck: [{
    required: true,
    validator: async () => {
      if (formState.missingHistoryAck !== true) throw new Error('必须勾选「已确认历史缺失」才能提交（BR-PROD-03）');
    },
    message: '必须勾选「已确认历史缺失」才能提交（BR-PROD-03）',
    type: 'boolean',
  }],
  targetSalesAmount: [{ required: true, type: 'number', min: 1, message: '立项目标销售额必须大于 0' }],
  targetChannelCount: [{ required: true, type: 'number', min: 1, message: '立项目标渠道商数必须大于 0' }],
  targetNps: [{ required: true, type: 'number', min: 0, max: 100, message: '立项 NPS 需在 0-100 之间' }],
  targetSceneCount: [{ required: true, type: 'number', min: 1, message: '立项目标场景数必须大于 0' }],
}));

function toBody(): LegacyImportBody {
  return {
    name: formState.name.trim(),
    productId: formState.productId.trim(),
    templateType: formState.templateType,
    targetMarkets: parsedMarkets.value,
    level: formState.level,
    levelCoefficient: needCoefficient.value ? formState.levelCoefficient : null,
    levelCoefficientReason: needCoefficient.value ? formState.levelCoefficientReason.trim() : null,
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
  } catch (cause) {
    submitError.value = cause;
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

      <Alert
        v-if="submitError"
        class="mb-4"
        :message="submitError
          ? (isTransportError(submitError)
            ? '无法连接服务，请检查网络后重试'
            : projectErrorText(submitError, { fallback: '导入失败，请检查输入后重试' }))
          : ''"
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
            <Button size="small" type="primary" @click="gotoDetail">进入项目详情</Button>
            <Button size="small" @click="cancel">返回列表</Button>
          </Space>
        </template>
      </Alert>

      <Form
        :model="formState"
        :rules="rules"
        layout="vertical"
        class="max-w-[760px]"
        @finish="onFinish"
      >
        <Form.Item label="项目名称" name="name">
          <Input v-model:value="formState.name" placeholder="存量项目的真实名称" :maxlength="120" show-count />
        </Form.Item>

        <Form.Item label="产品 ID" name="productId" extra="1:1 项目-产品关系（BR-PROD-01）。">
          <Input v-model:value="formState.productId" placeholder="产品唯一标识" />
        </Form.Item>

        <Form.Item label="主组（市场PM 所在产品组 ID）" name="mainGroupId" extra="BR-ORG-01：项目归属于市场PM 所在产品组。">
          <Input v-model:value="formState.mainGroupId" placeholder="主组唯一标识" />
        </Form.Item>

        <Form.Item label="模板类型" name="templateType">
          <Select v-model:value="formState.templateType" :options="templateOptions" />
        </Form.Item>

        <Form.Item label="目标市场（国家代码）" name="marketsText" extra="多值以换行或逗号分隔。">
          <Input.TextArea
            v-model:value="formState.marketsText"
            placeholder="SA&#10;EU"
            :auto-size="{ minRows: 2, maxRows: 4 }"
          />
        </Form.Item>

        <Form.Item label="申报当前阶段" name="declaredStage" extra="BR-PROD-03：必须从概念阶段起的合法阶段；服务层继续校验。">
          <Select v-model:value="formState.declaredStage" :options="stageOptions" />
        </Form.Item>

        <Form.Item label="存量生效日" name="legacyEffectiveAt" extra="项目作为存量的生效起点；服务端以此写入 legacyEffectiveAt。">
          <DatePicker v-model:value="legacyEffectiveAtModel" class="!w-56" />
        </Form.Item>

        <Form.Item label="立项级别" name="level">
          <Select v-model:value="formState.level" :options="levelOptions" />
        </Form.Item>

        <Form.Item label="差异化系数" name="levelCoefficient" extra="S/B 必填（BR-INC-05 双签定值）；A 级可不填。">
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

        <Form.Item label="系数定值理由" name="levelCoefficientReason" extra="S/B 必填；A 级不填。">
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
            <InputNumber v-model:value="formState.targetSalesAmount" :min="1" :step="10000" class="!w-56" />
          </Form.Item>
          <Form.Item label="立项目标渠道商数" name="targetChannelCount">
            <InputNumber v-model:value="formState.targetChannelCount" :min="1" class="!w-40" />
          </Form.Item>
          <Form.Item label="立项 NPS（0-100）" name="targetNps">
            <InputNumber v-model:value="formState.targetNps" :min="0" :max="100" class="!w-40" />
          </Form.Item>
          <Form.Item label="立项目标场景数" name="targetSceneCount">
            <InputNumber v-model:value="formState.targetSceneCount" :min="1" class="!w-40" />
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
          <Button type="primary" html-type="submit" :loading="submitting">提交导入</Button>
          <Button @click="cancel">取消</Button>
        </Space>
      </Form>

      <div v-if="importResult" class="mt-4 text-xs text-muted-foreground">
        当前申报阶段：{{ stageText(importResult.project.declaredStage) }}；服务端补齐状态：
        {{ importResult.project.catchupStatus ?? '待补充' }}
      </div>
    </Card>
  </div>
</template>