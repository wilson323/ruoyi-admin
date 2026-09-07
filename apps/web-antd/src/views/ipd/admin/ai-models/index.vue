<script setup lang="ts">
/**
 * 页48 AI 模型配置（卡 P0-10.48；后端 P4-2.1 /api/v1/ai-models）。
 *
 * 后端真值：列表/详情为脱敏视图（密钥仅 maskedKey 掩码，明文/密文均不出服务端）；
 * enabled='1' 为全局唯一生效配置；更新时 apiKey 留空表示不修改密钥；
 * 连接测试结果由后端白名单化拼入 maskedKey 字段返回；写操作仅超级管理员。
 * 五态：加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { IpdAiModelView } from '../../../../api/ipd/ai-model-config';

import { computed, onMounted, reactive, ref } from 'vue';
import type { RuleObject } from 'ant-design-vue/es/form';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  createAiModel,
  enableAiModel,
  listAiModels,
  testAiModel,
  updateAiModel,
} from '../../../../api/ipd/ai-model-config';
import { IpdRequestError } from '../../../../api/ipd/auth';

type Phase = 'error' | 'loading' | 'ready';

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

const phase = ref<Phase>('loading');
const offline = ref(false);
const errorMsg = ref('');
const rows = ref<IpdAiModelView[]>([]);

/** 新建/编辑弹窗；editingId 为空表示新建。 */
const modalOpen = ref(false);
const modalSaving = ref(false);
const editingId = ref('');

/** Table bodyCell 的 record 不做类型收窄：统一在此收敛断言。 */
function asAiModel(record: Record<string, any>): IpdAiModelView {
  return record as IpdAiModelView;
}
const modalForm = reactive({
  apiKey: '',
  endpoint: '',
  maxTokens: undefined as undefined | number,
  model: '',
  provider: '',
  temperature: undefined as undefined | number,
});
const modalRules = computed<Record<string, RuleObject[]>>(() => ({
  // 新建必填；编辑留空表示不修改密钥，但一旦填写仍须满足长度要求。
  apiKey: editingId.value
    ? [{
        trigger: 'blur',
        validator: (_rule: RuleObject, value: string) =>
          !value || value.length >= 8 ? Promise.resolve() : Promise.reject('API 密钥至少8个字符'),
      }]
    : [{ message: 'API 密钥至少8个字符', min: 8, required: true, trigger: 'blur', whitespace: true }],
  endpoint: [
    { required: true, whitespace: true, message: '请输入接口地址' },
    { pattern: /^https?:\/\//, message: '接口地址必须以 http:// 或 https:// 开头' },
  ],
  model: [{ required: true, whitespace: true, message: '请输入模型名称' }],
  provider: [
    { required: true, whitespace: true, message: '请输入提供商' },
    { max: 32, message: '提供商不能超过32个字符' },
  ],
}));
const modalFormRef = ref();

/** 连接测试结果弹窗 */
const testOpen = ref(false);
const testResult = ref('');
const testTarget = ref('');
const testingId = ref('');

const columns = [
  { dataIndex: 'model', key: 'model', title: '模型名称' },
  { dataIndex: 'provider', key: 'provider', title: '提供商', width: 120 },
  { dataIndex: 'endpoint', key: 'endpoint', title: '接口地址' },
  { dataIndex: 'temperature', key: 'temperature', title: '温度', width: 80 },
  { dataIndex: 'maxTokens', key: 'maxTokens', title: '最大 Token', width: 110 },
  { dataIndex: 'maskedKey', key: 'maskedKey', title: '密钥（脱敏）', width: 160 },
  { dataIndex: 'enabled', key: 'enabled', title: '状态', width: 90 },
  { key: 'actions', title: '操作', width: 230 },
];

async function load() {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    rows.value = await listAiModels();
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(load);

function openCreate() {
  editingId.value = '';
  modalForm.provider = '';
  modalForm.endpoint = '';
  modalForm.model = '';
  modalForm.apiKey = '';
  modalForm.temperature = undefined;
  modalForm.maxTokens = undefined;
  modalOpen.value = true;
}

function openEdit(record: IpdAiModelView) {
  editingId.value = record.id;
  modalForm.provider = record.provider;
  modalForm.endpoint = record.endpoint;
  modalForm.model = record.model;
  modalForm.apiKey = '';
  modalForm.temperature = record.temperature === null ? undefined : Number(record.temperature);
  modalForm.maxTokens = record.maxTokens ?? undefined;
  modalOpen.value = true;
}

async function saveModal() {
  if (modalSaving.value) return;
  try {
    await modalFormRef.value?.validate();
  } catch {
    return;
  }
  modalSaving.value = true;
  const isEdit = !!editingId.value;
  const body = {
    endpoint: modalForm.endpoint.trim(),
    maxTokens: modalForm.maxTokens ?? null,
    model: modalForm.model.trim(),
    provider: modalForm.provider.trim(),
    temperature: modalForm.temperature ?? null,
    // 新建必填；编辑留空表示不修改密钥（后端约定）。
    apiKey: isEdit && !modalForm.apiKey ? undefined : modalForm.apiKey,
  };
  try {
    if (isEdit) {
      await updateAiModel(editingId.value, body);
      antMessage.success('配置已更新');
    } else {
      await createAiModel(body);
      antMessage.success('配置已创建，启用后才会成为全局生效配置');
    }
    modalOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    modalSaving.value = false;
  }
}

async function enable(record: IpdAiModelView) {
  try {
    await enableAiModel(record.id);
    antMessage.success(`配置 ${record.model} 已启用，原生效配置已自动停用`);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  }
}

async function runTest(record: IpdAiModelView) {
  if (testingId.value) return;
  testingId.value = record.id;
  try {
    const result = await testAiModel(record.id);
    testTarget.value = record.model;
    // 后端把白名单化测试消息拼接在 maskedKey 字段返回（形如 abcd****wxyz | connect: ok(200)）。
    testResult.value = result.maskedKey || '未返回测试结果';
    testOpen.value = true;
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    testingId.value = '';
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="AI 模型配置的密钥加密存储、永不回显（仅显示脱敏掩码）；全局至多一条配置生效，启用新配置时原生效配置自动停用。连接测试失败时不泄露任何凭证信息。"
      show-icon
      type="info"
    />

    <Card v-if="phase === 'loading'" class="text-center">
      <Spin tip="正在加载模型配置" />
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
          <Button danger size="small" @click="load">重新加载</Button>
        </template>
      </Alert>

      <Card v-else>
        <template #title>
          <div class="flex items-center justify-between">
            <span>AI 模型配置</span>
            <Button type="primary" @click="openCreate">新增配置</Button>
          </div>
        </template>
        <Empty
          v-if="rows.length === 0"
          description="暂无 AI 模型配置。点击「新增配置」录入提供商、接口地址与模型名称后启用。"
        />
        <Table
          v-else
          :columns="columns"
          :data-source="rows"
          :pagination="false"
          row-key="id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'endpoint'">
              <span class="break-all">{{ record.endpoint || '待补充' }}</span>
            </template>
            <template v-else-if="column.key === 'temperature'">
              <span class="tabular-nums">{{ record.temperature ?? '待补充' }}</span>
            </template>
            <template v-else-if="column.key === 'maxTokens'">
              <span class="tabular-nums">{{ record.maxTokens ?? '待补充' }}</span>
            </template>
            <template v-else-if="column.key === 'maskedKey'">
              <code v-if="record.maskedKey" class="text-xs">{{ record.maskedKey }}</code>
              <span v-else class="text-muted-foreground">待补充</span>
            </template>
            <template v-else-if="column.key === 'enabled'">
              <Tag v-if="record.enabled === '1'" color="success">生效中</Tag>
              <Tag v-else color="default">未生效</Tag>
            </template>
            <template v-else-if="column.key === 'actions'">
              <Space :size="4" wrap>
                <Button size="small" @click="openEdit(asAiModel(record))">编辑</Button>
                <Popconfirm
                  v-if="record.enabled !== '1'"
                  title="启用后该配置成为全局唯一生效的 AI 模型配置，原生效配置自动停用。确认启用？"
                  @confirm="enable(asAiModel(record))"
                >
                  <Button size="small" type="primary">启用</Button>
                </Popconfirm>
                <Button
                  :loading="testingId === record.id"
                  size="small"
                  @click="runTest(asAiModel(record))"
                >
                  测试连接
                </Button>
              </Space>
            </template>
          </template>
        </Table>
      </Card>
    </template>

    <Modal
      v-model:open="modalOpen"
      :confirm-loading="modalSaving"
      :mask-closable="false"
      :title="editingId ? '编辑 AI 模型配置' : '新增 AI 模型配置'"
      cancel-text="取消"
      ok-text="保存"
      @ok="saveModal"
    >
      <Alert
        class="mb-3"
        :message="editingId
          ? 'API 密钥留空表示不修改；密钥保存后加密存储，任何页面都不会回显明文。'
          : 'API 密钥保存后加密存储，任何页面都不会回显明文；新建的配置需点击「启用」才会成为全局生效配置。'"
        show-icon
        type="warning"
      />
      <Form ref="modalFormRef" :label-col="{ span: 6 }" :model="modalForm" :rules="modalRules" :wrapper-col="{ span: 16 }">
        <FormItem label="提供商" name="provider">
          <Input v-model:value="modalForm.provider" :maxlength="32" placeholder="如 DeepSeek / Zhipu / OpenAI" />
        </FormItem>
        <FormItem label="接口地址" name="endpoint">
          <Input v-model:value="modalForm.endpoint" :maxlength="255" placeholder="https:// 开头的完整接口地址" />
        </FormItem>
        <FormItem label="模型名称" name="model">
          <Input v-model:value="modalForm.model" :maxlength="64" placeholder="如 deepseek-chat（保存后不可重名）" />
        </FormItem>
        <FormItem label="API 密钥" name="apiKey">
          <Input.Password
            v-model:value="modalForm.apiKey"
            :autocomplete="editingId ? 'new-password' : 'off'"
            :maxlength="256"
            :placeholder="editingId ? '留空表示不修改密钥' : '至少8个字符，保存后不可查看'"
          />
        </FormItem>
        <FormItem label="温度" name="temperature">
          <InputNumber v-model:value="modalForm.temperature" :max="2" :min="0" :step="0.1" class="w-full" placeholder="0-2，选填" />
        </FormItem>
        <FormItem label="最大 Token" name="maxTokens">
          <InputNumber v-model:value="modalForm.maxTokens" :max="200000" :min="1" :precision="0" class="w-full" placeholder="1-200000，选填" />
        </FormItem>
      </Form>
    </Modal>

    <Modal
      v-model:open="testOpen"
      :footer="null"
      :title="`连接测试结果：${testTarget}`"
      width="560px"
    >
      <Alert
        :message="testResult"
        show-icon
        :type="testResult.includes('ok') ? 'success' : 'warning'"
      />
      <p class="text-muted-foreground mt-3 text-xs">
        结果由服务端白名单化返回，仅包含主机与失败类别，不包含任何凭证信息。
      </p>
    </Modal>
  </div>
</template>
