<script setup lang="ts">
/**
 * 页08 新建项目（卡 P0-10.8；后端 ProjectController#create 已交付）。
 *
 * 表单字段对齐 ProjectCreateReq 白名单：
 *   name / productId / templateType / targetMarkets / level / levelCoefficient
 *   levelCoefficientReason / targetSalesAmount / targetChannelCount / targetNps
 *   targetSceneCount / mainGroupId / launchDate
 *
 * code/currentStage/status/source/lifecycleStatus 由服务端权威生成，
 * 前端不展示、不发送（CODE-01 安全约束）。
 *
 * 业务校验（前端提前拦截，后端仍是权威）：
 * - targetMarkets 至少 1 项（BR-PROD-02）；
 * - level=S 或 B 时 levelCoefficient + levelCoefficientReason 必填（BR-INC-05 双签定值）；
 * - 四立项基准值均 >0；NPS 0-100；
 * - mainGroupId 必填（BR-ORG-01）。
 */
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import dayjs, { type Dayjs } from 'dayjs';
import type { RuleObject } from 'ant-design-vue/es/form';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  message,
} from 'ant-design-vue';

import type { Project, ProjectCreateBody, ProjectLevel, TemplateType } from '../../../../api/ipd/project';
import { createProject } from '../../../../api/ipd/project';
import { isTransportError, projectErrorText } from '../project-error';
import { RULES_BY_PAGE, renderRulesDescription, type ZkIpdRule } from '../_shared/zk-ipd-rules';
import '../_shared/ipd-theme.css';

const router = useRouter();
const projectCreateRules = computed(() => renderRulesDescription(RULES_BY_PAGE.projectCreate));

interface FormState {
  launchDate: null | number;
  level: ProjectLevel;
  levelCoefficient: null | number;
  levelCoefficientReason: string;
  mainGroupId: string;
  marketsText: string;
  name: string;
  productId: string;
  targetChannelCount: number;
  targetNps: number;
  targetSalesAmount: number;
  targetSceneCount: number;
  templateType: TemplateType;
}

const formState = reactive<FormState>({
  launchDate: null,
  level: 'A',
  levelCoefficient: null,
  levelCoefficientReason: '',
  mainGroupId: '',
  marketsText: '',
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

/** 解析 targetMarkets：换行/逗号分隔 → 数组；空段忽略；去重保序。 */
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

/** S/B 必填 levelCoefficient + levelCoefficientReason（BR-INC-05 双签定值）。 */
const needCoefficient = computed(() => formState.level === 'S' || formState.level === 'B');

/** DatePicker 收 dayjs、InputNumber 不收 null：与 FormState 双向适配。 */
const launchDateModel = computed<Dayjs | string | undefined>({
  get: () => (formState.launchDate == null ? undefined : dayjs(formState.launchDate)),
  set: (value) => {
    formState.launchDate = dayjs.isDayjs(value) ? value.valueOf() : null;
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
  mainGroupId: [{ required: true, message: '主组（市场PM 所在产品组）必填' }],
  marketsText: [{
    required: true,
    message: '目标市场至少 1 项；多值用换行或逗号分隔',
    validator: async () => {
      if (parsedMarkets.value.length < 1) throw new Error('目标市场至少 1 项；多值用换行或逗号分隔');
    },
  }],
  targetSalesAmount: [{ required: true, type: 'number', min: 1, message: '立项目标销售额必须大于 0' }],
  targetChannelCount: [{ required: true, type: 'number', min: 1, message: '立项目标渠道商数必须大于 0' }],
  targetNps: [{ required: true, type: 'number', min: 0, max: 100, message: '立项 NPS 需在 0-100 之间' }],
  targetSceneCount: [{ required: true, type: 'number', min: 1, message: '立项目标场景数必须大于 0' }],
}));

function toBody(): ProjectCreateBody {
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
    launchDate: formState.launchDate ?? null,
  };
}

async function onFinish(): Promise<void> {
  submitError.value = null;
  submitting.value = true;
  try {
    const created: Project = await createProject(toBody());
    message.success(`项目已创建，编码 ${created.code ?? '待补充'}`);
    router.replace(`/ipd/projects/${created.id}/overview`);
  } catch (cause) {
    submitError.value = cause;
  } finally {
    submitting.value = false;
  }
}

function cancel(): void {
  router.replace('/ipd/projects');
}
</script>

<template>
  <div class="p-4">
    <Card>
      <template #title>新建项目</template>
      <template #extra>
        <Space>
          <Button @click="cancel">取消</Button>
        </Space>
      </template>

      <Alert
        class="mb-4"
        message="新建项目需满足 BR-PROD-02 三模板分支 + BR-INC-05 系数定值双签；项目编码 / 立项阶段 / 状态 / 来源由服务端权威生成。"
        show-icon
        type="info"
      />

      <!-- ZK-IPD 业务规则提示：与 Prompt §二.10/§三.2/§三.1 强一致 -->
      <Alert
        class="mb-4"
        type="warning"
        show-icon
        message="ZK-IPD 业务规则提示"
        :description="projectCreateRules"
      />

      <Alert
        v-if="submitError"
        class="mb-4"
        :message="submitError
          ? (isTransportError(submitError)
            ? '无法连接服务，请检查网络后重试'
            : projectErrorText(submitError, {
                fallback: '创建项目失败，请稍后重试',
                codeTexts: {
                  40001: '阶段门禁未通过，请联系管理员',
                  40004: '市场PM 与研发PM 不能由同一人担任，请确认后重试',
                },
              }))
          : ''"
        type="error"
        show-icon
      />

      <Form
        :model="formState"
        :rules="rules"
        layout="vertical"
        class="max-w-[760px]"
        @finish="onFinish"
      >
        <Form.Item label="项目名称" name="name">
          <Input v-model:value="formState.name" placeholder="例如：智慧园区视频分析算法研发" :maxlength="120" show-count />
        </Form.Item>

        <Form.Item label="产品 ID" name="productId" extra="1:1 项目-产品关系（BR-PROD-01）；具体产品通过产品管理维护。">
          <Input v-model:value="formState.productId" placeholder="产品唯一标识" />
        </Form.Item>

        <Form.Item label="主组（市场PM 所在产品组 ID）" name="mainGroupId" extra="BR-ORG-01：项目归属于市场PM 所在产品组。">
          <Input v-model:value="formState.mainGroupId" placeholder="主组唯一标识" />
        </Form.Item>

        <Form.Item label="模板类型" name="templateType">
          <Select v-model:value="formState.templateType" :options="templateOptions" />
        </Form.Item>

        <Form.Item label="目标市场（国家代码）" name="marketsText" extra="多值以换行或逗号分隔，例如 SA / EU。BR-IPD-05b：保存后自动带出国别认证清单。">
          <Input.TextArea
            v-model:value="formState.marketsText"
            placeholder="SA&#10;EU"
            :auto-size="{ minRows: 2, maxRows: 4 }"
          />
        </Form.Item>

        <Form.Item label="立项级别" name="level">
          <Select v-model:value="formState.level" :options="levelOptions" />
        </Form.Item>

        <Form.Item label="差异化系数" name="levelCoefficient" extra="S/A/B 映射见系统参数 bonus.coefficient；A 级可不填。S/B 级必填。">
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

        <Form.Item label="系数定值理由" name="levelCoefficientReason" extra="S/B 必填（BR-INC-05 双签定值），A 级不填。">
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

        <Form.Item label="上市日期" name="launchDate" extra="后置指标起算原点（BR-IPD-08）；立项后修改需要双签。">
          <DatePicker v-model:value="launchDateModel" class="!w-56" />
        </Form.Item>

        <Space>
          <Button type="primary" html-type="submit" :loading="submitting">创建项目</Button>
          <Button @click="cancel">取消</Button>
        </Space>
      </Form>
    </Card>
  </div>
</template>