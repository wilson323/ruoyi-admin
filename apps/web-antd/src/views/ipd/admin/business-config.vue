<script setup lang="ts">
/**
 * 业务配置管理页（R149-A5 审批人配置管理；后端 /api/v1/business-config 端点待交付）。
 *
 * 设计：表（ipd_business_config 已存在 13 行种子）三档 scope = GLOBAL / GROUP / PROJECT：
 * - GLOBAL：全局配置（仅超管可写；组长只读）
 * - GROUP：按产品组覆盖（组长可写本组，超管可写所有）
 * - PROJECT：按项目覆盖（PM 可写本项目，组长/超管可读）
 *
 * 端点契约：
 * - GET  /api/v1/business-config?scope&scopeId → 列表（按可见范围过滤，服务端权威）
 * - POST /api/v1/business-config                → 新增/更新（白名单 DTO）
 *
 * 菜单权限：仅 super_admin 与 group_leader 可见（与 system-config 不同——后者仅超管写）；
 * UI 层做角色门禁 + 路由层 meta.access 双闸。
 *
 * 五态：拒绝（角色）/ 加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据（G-06）。
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
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  type BusinessConfig,
  type BusinessConfigScope,
  type BusinessConfigUpsertReq,
  listBusinessConfigs,
  upsertBusinessConfig,
} from '../../../api/ipd/business-config';
import { IpdRequestError } from '../../../api/ipd/auth';
import { listProductGroups, type ProductGroup } from '../../../api/ipd/product';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import { PENDING_TEXT } from '../_shared/format';

type Phase = 'error' | 'loading' | 'ready';

const SCOPE_OPTIONS: ReadonlyArray<{ label: string; value: BusinessConfigScope }> = [
  { label: 'GLOBAL · 全局', value: 'GLOBAL' },
  { label: 'GROUP · 产品组', value: 'GROUP' },
  { label: 'PROJECT · 项目', value: 'PROJECT' },
];

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const canRead = computed(
  () => personType.value === 'SUPER_ADMIN' || personType.value === 'GROUP_LEADER',
);

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

/** 产品组下拉（scope=GROUP 时选择 scopeId）。 */
const productGroups = ref<ProductGroup[]>([]);
const groupLoading = ref(false);
async function loadGroups(): Promise<void> {
  if (productGroups.value.length) return;
  groupLoading.value = true;
  try {
    productGroups.value = await listProductGroups();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    groupLoading.value = false;
  }
}

const groupOptions = computed(() =>
  productGroups.value.map((g) => ({
    label: g.groupName ? g.groupName : '#' + g.id,
    value: g.id,
  })),
);

const groupNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const g of productGroups.value) map.set(g.id, g.groupName ?? PENDING_TEXT);
  return map;
});

/** 列表 + scope 筛选。 */
const phase = ref<Phase>('loading');
const offline = ref(false);
const errorMsg = ref('');
const rows = ref<BusinessConfig[]>([]);
const filterScope = ref<undefined | BusinessConfigScope>(undefined);
const visibleRows = computed(() => {
  if (!filterScope.value) return rows.value;
  return rows.value.filter((row) => row.scope === filterScope.value);
});

const scopeLabelMap = computed(() => {
  const map = new Map<string, string>();
  for (const o of SCOPE_OPTIONS) map.set(o.value, o.label);
  return map;
});

const columns = [
  { dataIndex: 'configKey', key: 'configKey', title: 'configKey', width: 280 },
  { dataIndex: 'configValue', key: 'configValue', title: 'configValue' },
  { dataIndex: 'scope', key: 'scope', title: 'scope', width: 130 },
  { dataIndex: 'scopeId', key: 'scopeId', title: 'scopeId', width: 140 },
  { dataIndex: 'description', key: 'description', title: '描述' },
  { dataIndex: 'updatedBy', key: 'updatedBy', title: '更新人', width: 110 },
  { dataIndex: 'updatedAt', key: 'updatedAt', title: '更新时间', width: 170 },
];

function asRecord(record: Record<string, any>): BusinessConfig {
  return record as BusinessConfig;
}

async function load(): Promise<void> {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    rows.value = await listBusinessConfigs();
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(() => {
  void loadGroups();
  if (canRead.value) void load();
});

/** 新增 GROUP 配置弹窗（按任务说明单一「新增 GROUP 配置」入口）。
 *  顶部按钮同时暴露 GLOBAL/GROUP/PROJECT 的通用编辑能力，但默认聚焦 GROUP 场景。 */
const upsertOpen = ref(false);
const upsertSaving = ref(false);
const upsertMode = ref<'create-group' | 'edit'>('create-group');
const editingId = ref<null | string>(null);

interface UpsertFormState {
  configKey: string;
  configValue: string;
  description: string;
  scope: BusinessConfigScope;
  scopeId: undefined | string;
}
const upsertForm = reactive<UpsertFormState>({
  configKey: '',
  configValue: '',
  description: '',
  scope: 'GROUP',
  scopeId: undefined,
});
const upsertFormRef = ref();
const upsertRules = computed<Record<string, RuleObject[]>>(() => ({
  configKey: [
    { required: true, whitespace: true, message: '请输入 configKey', trigger: 'blur' },
    { max: 128, message: 'configKey 不能超过 128 字符', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z][a-zA-Z0-9._-]*$/,
      message: 'configKey 仅允许字母数字 . _ -，且首字符为字母',
      trigger: 'blur',
    },
  ],
  configValue: [
    { required: true, whitespace: true, message: '请输入 configValue', trigger: 'blur' },
    { max: 2000, message: 'configValue 不能超过 2000 字符', trigger: 'blur' },
  ],
  scope: [{ required: true, message: '请选择 scope', trigger: 'change' }],
  scopeId: [
    {
      validator: (_rule: RuleObject, _value: unknown) =>
        upsertForm.scope === 'GLOBAL'
          ? Promise.resolve()
          : upsertForm.scopeId
            ? Promise.resolve()
            : Promise.reject('GROUP/PROJECT 必须选择 scopeId'),
      trigger: 'change',
    },
  ],
}));

function openCreateGroup(): void {
  upsertMode.value = 'create-group';
  editingId.value = null;
  upsertForm.configKey = '';
  upsertForm.configValue = '';
  upsertForm.description = '';
  upsertForm.scope = 'GROUP';
  upsertForm.scopeId = undefined;
  upsertOpen.value = true;
}


async function submitUpsert(): Promise<void> {
  if (upsertSaving.value) return;
  try {
    await upsertFormRef.value?.validate();
  } catch {
    return;
  }
  upsertSaving.value = true;
  try {
    const body: BusinessConfigUpsertReq = {
      configKey: upsertForm.configKey.trim(),
      configValue: upsertForm.configValue.trim(),
      description: upsertForm.description.trim() || null,
      scope: upsertForm.scope,
      scopeId: upsertForm.scope === 'GLOBAL' ? null : upsertForm.scopeId,
    };
    await upsertBusinessConfig(body);
    antMessage.success(editingId.value ? '业务配置已更新' : '业务配置已新增');
    upsertOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    upsertSaving.value = false;
  }
}

function reload(): void {
  void load();
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="审批人配置管理：覆盖 ipd_business_config 三档 scope（GLOBAL/GROUP/PROJECT）"
      description="仅 super_admin / group_leader 可见；超管可写所有 scope，组长可写本组 scope。配置变更落 ipd_business_config_versions 版本链（与 system-config 同构）。后端 /api/v1/business-config 端点待交付，按真实拒绝/断网状态如实展示。"
      show-icon
      type="info"
    />

    <Card v-if="!canRead">
      <Alert
        message="审批人配置为组长/超管专属页面"
        description="该入口仅 GROUP_LEADER / SUPER_ADMIN 可访问；其他角色读取走工作台或单点接口。"
        show-icon
        type="info"
        role="alert"
      />
    </Card>

    <template v-else>
      <Card>
        <template #title>
          <Space>
            <span>业务配置列表</span>
            <Tag color="default">当前可见 {{ visibleRows.length }} 条 / 全量 {{ rows.length }} 条</Tag>
          </Space>
        </template>
        <Space wrap>
          <Select
            v-model:value="filterScope"
            :options="[...SCOPE_OPTIONS]"
            allow-clear
            class="min-w-[200px]"
            placeholder="按 scope 筛选"
          />
          <Button @click="reload">刷新</Button>
          <Button type="primary" @click="openCreateGroup">新增 GROUP 配置</Button>
        </Space>
      </Card>

      <Card v-if="phase === 'loading'" class="text-center">
        <Spin tip="正在加载业务配置" />
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
          <Empty description="尚无业务配置记录。请确认 P0-7 种子已初始化（13 行种子），或点击「新增 GROUP 配置」录入。" />
        </Card>

        <Card v-else-if="visibleRows.length === 0" class="text-center">
          <Empty description="当前 scope 过滤条件下无匹配配置。" />
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
              <template v-if="column.key === 'configKey'">
                <code class="font-mono text-sm">{{ asRecord(record).configKey }}</code>
              </template>
              <template v-else-if="column.key === 'configValue'">
                <span class="break-all">{{ asRecord(record).configValue || PENDING_TEXT }}</span>
                <div v-if="asRecord(record).description" class="text-muted-foreground mt-1 text-xs">
                  {{ asRecord(record).description }}
                </div>
              </template>
              <template v-else-if="column.key === 'scope'">
                <Tag
                  :color="
                    asRecord(record).scope === 'GLOBAL'
                      ? 'blue'
                      : asRecord(record).scope === 'GROUP'
                        ? 'purple'
                        : 'green'
                  "
                >
                  {{ scopeLabelMap.get(asRecord(record).scope ?? '') ?? asRecord(record).scope }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'scopeId'">
                <span v-if="!asRecord(record).scopeId" class="text-muted-foreground">—</span>
                <span v-else-if="asRecord(record).scope === 'GROUP'" class="tabular-nums">
                  {{ groupNameMap.get(asRecord(record).scopeId ?? '') ?? '#' + (asRecord(record).scopeId ?? '?') }}
                </span>
                <span v-else class="tabular-nums">#{{ asRecord(record).scopeId }}</span>
              </template>
              <template v-else-if="column.key === 'updatedBy'">
                <span class="text-muted-foreground text-sm">
                  {{ asRecord(record).updatedBy ? '#' + asRecord(record).updatedBy : PENDING_TEXT }}
                </span>
              </template>
              <template v-else-if="column.key === 'updatedAt'">
                <span class="text-muted-foreground tabular-nums text-xs">{{ asRecord(record).updatedAt || PENDING_TEXT }}</span>
              </template>
            </template>
          </Table>
        </Card>
      </template>
    </template>

    <Modal
      v-model:open="upsertOpen"
      :confirm-loading="upsertSaving"
      :mask-closable="false"
      cancel-text="取消"
      ok-text="保存"
      :title="upsertMode === 'create-group' ? '新增 GROUP 业务配置' : '编辑业务配置'"
      width="560px"
      @ok="submitUpsert"
    >
      <Form
        ref="upsertFormRef"
        :label-col="{ span: 5 }"
        :model="upsertForm"
        :rules="upsertRules"
        :wrapper-col="{ span: 19 }"
      >
        <FormItem label="configKey" name="configKey">
          <Input
            v-model:value="upsertForm.configKey"
            :disabled="upsertMode === 'edit'"
            :maxlength="128"
            placeholder="如 approver.flow.default / kpi.weight.market"
          />
        </FormItem>
        <FormItem label="scope" name="scope">
          <Select
            v-model:value="upsertForm.scope"
            :options="[...SCOPE_OPTIONS]"
            :disabled="upsertMode === 'edit'"
          />
        </FormItem>
        <FormItem label="scopeId" name="scopeId">
          <Select
            v-if="upsertForm.scope === 'GROUP'"
            v-model:value="upsertForm.scopeId"
            :loading="groupLoading"
            :options="groupOptions"
            allow-clear
            placeholder="选择产品组"
            show-search
          />
          <Input
            v-else-if="upsertForm.scope === 'PROJECT'"
            v-model:value="upsertForm.scopeId"
            :maxlength="64"
            placeholder="项目 ID（前端全局捕获项目选择器值）"
          />
          <Input
            v-else
            :value="'—'"
            disabled
            placeholder="GLOBAL 无 scopeId"
          />
        </FormItem>
        <FormItem label="configValue" name="configValue">
          <Input.TextArea
            v-model:value="upsertForm.configValue"
            :auto-size="{ minRows: 3, maxRows: 8 }"
            :maxlength="2000"
            placeholder="字符串承载（数字/布尔/JSON 均走字符串）"
            show-count
          />
        </FormItem>
        <FormItem label="描述" name="description">
          <Input
            v-model:value="upsertForm.description"
            :maxlength="200"
            allow-clear
            placeholder="选填，≤200 字"
          />
        </FormItem>
      </Form>
    </Modal>
  </div>
</template>
