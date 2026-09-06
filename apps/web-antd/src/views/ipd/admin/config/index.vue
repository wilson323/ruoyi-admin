<script setup lang="ts">
/**
 * 页45 参数配置（卡 P0-10.45；后端 P0-3.2 / P0-3.3 /api/v1/system-configs）。
 *
 * 后端真值：GET / 裸 List 约 55 条种子；GET /{key} 单点读取；PUT /{key} 更新（仅超管，写后立即失效缓存
 * PERF-02 + 同事务写版本链）；GET /{key}/versions 版本历史；GET /{key}/as-of 时点解析。
 * 规格 §4/§5 要求的 draft/publish/revert 三阶段接口、6 项涉钱参数高亮目录、数据范围仅读
 * 后端均未交付——页面按控制器能返回的真值渲染，6 项涉钱键在前端做静态高亮（P0-10.45 规格映射；G-08 红线）。
 *
 * 五态：加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { IpdSystemConfig, IpdSystemConfigVersion } from '../../../../api/ipd/system-config';

import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  message as antMessage,
} from 'ant-design-vue';

import {
  listSystemConfigVersions,
  listSystemConfigs,
  resolveSystemConfigAsOf,
  updateSystemConfig,
} from '../../../../api/ipd/system-config';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { formatDateTime, PENDING_TEXT } from '../../_shared/format';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { RULES_BY_PAGE, renderRulesDescription } from '../../_shared/zk-ipd-rules';

type Phase = 'error' | 'idle' | 'loading' | 'ready';
type TabKey = 'all' | 'money';

const auth = useIpdAuthStore();
const adminConfigRules = computed(() => renderRulesDescription(RULES_BY_PAGE.adminConfig));
const personType = computed(() => auth.identity?.person.personType ?? '');
const isAdmin = computed(() => personType.value === 'SUPER_ADMIN');

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

/** G-08 红线：6 项涉钱参数（G-08 红线字段；前端静态高亮，后端 controller 已支持更新）。 */
const MONEY_KEYS = new Set([
  'bonus.poolBase',
  'bonus.salesSource',
  'bonus.performanceScoreStrategy',
  'bonus.multiProjectSplit',
  'bonus.launchAnchor',
  'bonus.coefficientDecider',
]);
const MONEY_DESC: Record<string, string> = {
  'bonus.poolBase': '奖金池基数：目标销售额 / 实际销售额（G-08）',
  'bonus.salesSource': '奖金池销售额口径：回款 / 签单（G-08 / Q2）',
  'bonus.performanceScoreStrategy': '绩效分数策略：项目得分 / 综合得分（G-08 / Q3）',
  'bonus.multiProjectSplit': '多项目切分策略：无 / 按系数 / 按工时（G-08 / Q5）',
  'bonus.launchAnchor': '上市锚定节点：L08 动作完成 / 上市日（G-08 / Q6）',
  'bonus.coefficientDecider': '系数裁决：G1 双签 / 组长裁决 / 自动测度（G-08 / Q4）',
};

const phase = ref<Phase>('loading');
const offline = ref(false);
const errorMsg = ref('');
const rows = ref<IpdSystemConfig[]>([]);

const activeTab = ref<TabKey>('all');
const keywordInput = ref('');

const moneyRows = computed(() => rows.value.filter((row) => MONEY_KEYS.has(row.configKey)));
const otherRows = computed(() => rows.value.filter((row) => !MONEY_KEYS.has(row.configKey)));
const visibleRows = computed(() => {
  const keyword = keywordInput.value.trim().toLowerCase();
  const source = activeTab.value === 'money' ? moneyRows.value : otherRows.value;
  if (!keyword) return source;
  return source.filter((row) =>
    [row.configKey, row.description ?? '', row.remark ?? ''].join('|').toLowerCase().includes(keyword),
  );
});

/** 编辑弹窗 */
const modalOpen = ref(false);
const modalSaving = ref(false);
const editingKey = ref('');
const modalForm = reactive({
  description: '',
  rawInput: '',
  remark: '',
  value: undefined as undefined | boolean | number | string,
  valueType: 'STRING' as IpdSystemConfig['valueType'],
});
const modalFormRef = ref();

/** InputNumber 不收 null、Switch 只收 boolean：与 modalForm.value（宽联合）按分支双向适配。 */
const valueTextModel = computed<string | undefined>({
  get: () => (typeof modalForm.value === 'string' ? modalForm.value : undefined),
  set: (value) => {
    modalForm.value = value ?? '';
  },
});
const valueNumberModel = computed<number | string | undefined>({
  get: () => (typeof modalForm.value === 'number' ? modalForm.value : undefined),
  set: (value) => {
    modalForm.value = value == null || value === '' ? undefined : Number(value);
  },
});
const valueBoolModel = computed<boolean>({
  get: () => modalForm.value === true,
  set: (value) => {
    modalForm.value = value;
  },
});
const valueJsonModel = computed<string | undefined>({
  get: () => (typeof modalForm.value === 'string' ? modalForm.value : undefined),
  set: (value) => {
    modalForm.value = value ?? '';
  },
});

/** Table bodyCell 的 record 不做类型收窄：统一在此收敛断言。 */
function asConfig(record: Record<string, any>): IpdSystemConfig {
  return record as IpdSystemConfig;
}

const columns = [
  { dataIndex: 'configKey', key: 'configKey', title: '参数键', width: 240 },
  { dataIndex: 'valueType', key: 'valueType', title: '类型', width: 90 },
  { dataIndex: 'configValue', key: 'configValue', title: '当前值' },
  { dataIndex: 'defaultValue', key: 'defaultValue', title: '默认值', width: 120 },
  { key: 'actions', title: '操作', width: 130 },
];

/** 版本链抽屉 */
const versionsOpen = ref(false);
const versionsKey = ref('');
const versionsPhase = ref<Phase>('idle');
const versionsRows = ref<IpdSystemConfigVersion[]>([]);
const versionsError = ref('');

async function load() {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    rows.value = await listSystemConfigs();
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(() => {
  if (isAdmin.value) void load();
});

function openEdit(record: IpdSystemConfig) {
  editingKey.value = record.configKey;
  modalForm.valueType = record.valueType;
  modalForm.description = record.description ?? '';
  modalForm.remark = record.remark ?? '';
  modalForm.rawInput = '';
  modalForm.value = parseForEdit(record.valueType, record.configValue);
  modalOpen.value = true;
}

function parseForEdit(type: IpdSystemConfig['valueType'], raw: string): undefined | boolean | number | string {
  if (type === 'BOOL') return raw === 'true' || raw === '1';
  if (type === 'NUMBER') {
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }
  return raw;
}

const valueTypeRules = computed(() => ({
  value: [
    {
      validator: (_rule: unknown, value: unknown) => {
        if (modalForm.valueType === 'JSON' && typeof value === 'string') {
          try {
            JSON.parse(value);
          } catch {
            return Promise.reject('JSON 格式不正确，请检查语法');
          }
        }
        if (modalForm.valueType === 'NUMBER' && typeof value !== 'number') {
          return Promise.reject('数字类型参数必须为数值');
        }
        return Promise.resolve();
      },
    },
  ],
}));

async function saveModal() {
  if (modalSaving.value || !editingKey.value) return;
  try {
    await modalFormRef.value?.validate();
  } catch {
    return;
  }
  modalSaving.value = true;
  try {
    let body: string;
    if (modalForm.valueType === 'BOOL') {
      body = modalForm.value ? 'true' : 'false';
    } else if (modalForm.valueType === 'NUMBER') {
      body = String(modalForm.value);
    } else {
      body = String(modalForm.value ?? '');
    }
    if (body.length > 2000) {
      antMessage.error('参数值超过 2000 字符上限');
      return;
    }
    await updateSystemConfig(editingKey.value, { value: body });
    antMessage.success(`参数 ${editingKey.value} 已更新（写后立即失效缓存，PERF-02）`);
    modalOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    modalSaving.value = false;
  }
}

async function openVersions(record: IpdSystemConfig) {
  versionsKey.value = record.configKey;
  versionsOpen.value = true;
  versionsPhase.value = 'loading';
  versionsError.value = '';
  versionsRows.value = [];
  try {
    versionsRows.value = await listSystemConfigVersions(record.configKey, 50);
    versionsPhase.value = 'ready';
  } catch (cause) {
    versionsPhase.value = 'error';
    versionsError.value = rejectText(cause);
  }
}

async function runAsOf(record: IpdSystemConfig) {
  try {
    const asOf = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await resolveSystemConfigAsOf(record.configKey, asOf);
    antMessage.info(
      `时点解析（${asOf}）：来源 ${result.source}${result.version !== null ? ` v${result.version}` : ''}，值 ${result.value ?? '待补充'}`,
    );
  } catch (cause) {
    antMessage.error(rejectText(cause));
  }
}

function reload() {
  void load();
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="参数配置：G-05 零硬编码的承载点"
      description="所有系数、阈值、期限、额度均在此维护；写后立即失效缓存（PERF-02）确保业务热路径同步生效。任何内部角色可读（热路径 /{key:.+}），写仅 super_admin。"
      show-icon
      type="info"
    />

    <Card v-if="!isAdmin">
      <Alert
        message="参数配置为超级管理员专属页面"
        description="该入口仅 super_admin 可访问；其他角色读取走单点接口 /api/v1/system-configs/{key}，不开放列表与写操作。"
        show-icon
        type="info"
        role="alert"
      />
    </Card>

    <template v-else>
      <!-- ZK-IPD §九 超管权限移交专属路径业务规则提示 -->
      <Alert
        class="mb-2"
        type="warning"
        show-icon
        message="ZK-IPD 超管权限移交规则"
        :description="adminConfigRules"
      />

      <Card>
        <Tabs
          v-model:active-key="activeTab"
          :items="[
            { key: 'all', tab: `全部参数 (${otherRows.length})` },
            { key: 'money', tab: `6 项涉钱参数高亮 (${moneyRows.length})` },
          ]"
        />
        <Space wrap>
          <Input
            v-model:value="keywordInput"
            :maxlength="64"
            allow-clear
            class="min-w-[240px]"
            placeholder="本地搜索：参数键 / 描述 / 备注"
          />
          <Button @click="reload">刷新</Button>
          <Tooltip title="规格 §4/§5 要求的 draft / publish / revert 紧急回滚接口后端暂未交付，当前仅支持单点 PUT（PERF-02 写后立即失效缓存）。">
            <Tag color="warning">draft / publish 暂未交付</Tag>
          </Tooltip>
        </Space>
      </Card>

      <Card v-if="phase === 'loading'" class="text-center">
        <Spin tip="正在加载参数列表" />
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
          <Empty description="系统中暂无系统参数。请确认 P0-3.2 种子数据已初始化。" />
        </Card>

        <Card v-else-if="activeTab === 'money' && moneyRows.length === 0" class="text-center">
          <Empty description="未匹配到 6 项涉钱参数。请确认 system_configs 表中存在对应键值（spec §3）。" />
        </Card>

        <Card v-else-if="visibleRows.length === 0" class="text-center">
          <Empty description="当前过滤条件下无匹配参数。" />
        </Card>

        <Card v-else>
          <template #title>
            <Space>
              <span>{{ activeTab === 'money' ? '6 项涉钱参数（G-08 红线）' : '系统参数总览' }}</span>
              <Tag color="default">当前可见 {{ visibleRows.length }} 项</Tag>
            </Space>
          </template>
          <Alert
            v-if="activeTab === 'money'"
            class="mb-3"
            :message="'G-08 红线：以下 6 项涉钱参数变更需写入专用审计 action=money_param_switched（后端审计约定；前端高亮定位）。'"
            show-icon
            type="warning"
          />
          <Table
            :columns="columns"
            :data-source="visibleRows"
            :pagination="{ pageSize: 20, showSizeChanger: false }"
            row-key="id"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'configKey'">
                <code class="font-mono text-sm">{{ record.configKey }}</code>
                <Tag
                  v-if="MONEY_KEYS.has(record.configKey)"
                  class="ml-2"
                  color="error"
                >
                  涉钱
                </Tag>
                <Tooltip v-if="MONEY_DESC[record.configKey]" :title="MONEY_DESC[record.configKey]">
                  <span class="text-muted-foreground ml-1 cursor-help text-xs">说明</span>
                </Tooltip>
              </template>
              <template v-else-if="column.key === 'valueType'">
                <Tag color="default">{{ record.valueType }}</Tag>
              </template>
              <template v-else-if="column.key === 'configValue'">
                <span class="tabular-nums">{{ record.configValue || PENDING_TEXT }}</span>
                <div v-if="record.description" class="text-muted-foreground mt-1 text-xs">
                  {{ record.description }}
                </div>
              </template>
              <template v-else-if="column.key === 'defaultValue'">
                <span class="text-muted-foreground tabular-nums text-xs">
                  {{ record.defaultValue || PENDING_TEXT }}
                </span>
              </template>
              <template v-else-if="column.key === 'actions'">
                <Space :size="4" wrap>
                  <Button size="small" type="primary" @click="openEdit(asConfig(record))">编辑</Button>
                  <Button size="small" @click="openVersions(asConfig(record))">版本链</Button>
                  <Button size="small" @click="runAsOf(asConfig(record))">时点解析</Button>
                </Space>
              </template>
            </template>
          </Table>
        </Card>
      </template>
    </template>

    <Modal
      v-model:open="modalOpen"
      :confirm-loading="modalSaving"
      :mask-closable="false"
      :title="`编辑参数 ${editingKey}`"
      cancel-text="取消"
      ok-text="保存"
      @ok="saveModal"
    >
      <Alert
        class="mb-3"
        :message="MONEY_KEYS.has(editingKey)
          ? '涉钱参数（G-08 红线）：变更会被审计为 money_param_switched，请确认影响面。'
          : '更新后立即失效缓存（PERF-02），同一事务写版本链；前端仅展示，不展示明文密文。'"
        show-icon
        :type="MONEY_KEYS.has(editingKey) ? 'error' : 'info'"
      />
      <Form ref="modalFormRef" :model="modalForm" :rules="valueTypeRules" layout="vertical">
        <FormItem label="参数键">
          <Input :value="editingKey" disabled />
        </FormItem>
        <FormItem label="类型">
          <Tag color="default">{{ modalForm.valueType }}</Tag>
        </FormItem>
        <FormItem v-if="modalForm.description" label="描述">
          <span class="text-muted-foreground text-sm">{{ modalForm.description }}</span>
        </FormItem>
        <FormItem label="新值" name="value">
          <Input
            v-if="modalForm.valueType === 'STRING'"
            v-model:value="valueTextModel"
            :maxlength="2000"
            placeholder="字符串参数值"
            show-count
          />
          <InputNumber
            v-else-if="modalForm.valueType === 'NUMBER'"
            v-model:value="valueNumberModel"
            class="w-full"
            placeholder="数值参数值"
          />
          <Switch
            v-else-if="modalForm.valueType === 'BOOL'"
            v-model:checked="valueBoolModel"
          />
          <Input.TextArea
            v-else-if="modalForm.valueType === 'JSON'"
            v-model:value="valueJsonModel"
            :auto-size="{ minRows: 4, maxRows: 12 }"
            placeholder='合法 JSON，如 {"key":"value"}'
          />
        </FormItem>
        <FormItem v-if="modalForm.remark" label="备注">
          <span class="text-muted-foreground text-sm">{{ modalForm.remark }}</span>
        </FormItem>
      </Form>
    </Modal>

    <Drawer
      v-model:open="versionsOpen"
      :footer="null"
      :title="`参数 ${versionsKey} 的版本链`"
      width="640px"
    >
      <Spin v-if="versionsPhase === 'loading'" tip="正在加载版本链" />
      <Alert
        v-else-if="versionsPhase === 'error'"
        :message="versionsError"
        show-icon
        type="error"
        role="alert"
      />
      <Empty
        v-else-if="versionsRows.length === 0"
        :description="`参数 ${versionsKey} 暂无版本历史（首次初始化或未发生变更）。`"
      />
      <Table
        v-else
        :columns="[
          { dataIndex: 'version', key: 'version', title: '版本', width: 80 },
          { dataIndex: 'configValue', key: 'configValue', title: '值' },
          { dataIndex: 'effectiveFrom', key: 'effectiveFrom', title: '生效起始', width: 160 },
          { dataIndex: 'effectiveTo', key: 'effectiveTo', title: '生效截止', width: 160 },
          { dataIndex: 'changedBy', key: 'changedBy', title: '变更人', width: 100 },
        ]"
        :data-source="versionsRows"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'version'">
            <Tag color="blue">v{{ record.version }}</Tag>
          </template>
          <template v-else-if="column.key === 'effectiveFrom'">
            <span class="tabular-nums text-xs">{{ formatDateTime(record.effectiveFrom) }}</span>
          </template>
          <template v-else-if="column.key === 'effectiveTo'">
            <span v-if="record.effectiveTo" class="tabular-nums text-xs">
              {{ formatDateTime(record.effectiveTo) }}
            </span>
            <Tag v-else color="success">生效中</Tag>
          </template>
          <template v-else-if="column.key === 'changedBy'">
            <span>#{{ record.changedBy ?? PENDING_TEXT }}</span>
          </template>
        </template>
      </Table>
      <Alert
        class="mt-3"
        :message="'P0-3.3：版本行不可变（append-only），只能通过追加新版本 + 闭合 effective_to 实现变更；前端展示仅展示，页面不提供 delete 接口。'"
        show-icon
        type="info"
      />
    </Drawer>
  </div>
</template>