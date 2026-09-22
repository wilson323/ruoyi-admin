<script setup lang="ts">
/**
 * 页47 Gate 评审要素（卡 P0-10.47；后端 P1-6 /api/v1/gate-elements；R175-A 全生命周期 9 按钮接入）。
 *
 * 后端真值：
 * - 列表（GET /gate-elements）仅返回 enabled='1' 的启用要素（sortOrder 升序）；
 * - 管理视图（GET /gate-elements/manage）返回全部生命周期（draft/published/archived + 停用），仅超管；
 * - 编码即身份不可改；无删除接口——仅停用（G-02 证据链禁删）；写操作仅超级管理员；
 * - 33 项要素 / 14 否决位为种子目标值，页面按真实接口数据统计展示（G-06 不造数）；
 * - 五态：加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据；
 *
 * 9 按钮决策：与 button-policy.ts 状态机一一对应（draft / published+enabled / published-disabled / archived）。
 */
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
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  message as antMessage,
} from 'ant-design-vue';
import type { RuleObject } from 'ant-design-vue/es/form';

import {
  IPD_GATE_CODES,
  archiveGateElement,
  copyGateElement,
  createGateElement,
  disableGateElement,
  duplicateGateElement,
  enableGateElement,
  listGateElements,
  listGateElementsForManage,
  publishGateElement,
  restoreGateElement,
  revertGateElement,
  updateGateElement,
  type IpdGateElement,
  type IpdGateElementCreateReq,
  type IpdGateElementStatus as Lifecycle,
} from '../../../../api/ipd/gate-element';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
import {
  ROW_BUTTON_LABEL,
  ROW_BUTTON_ORDER,
  decideRowButton,
  type GateElementButtonState,
  type GateElementRowButton,
} from './button-policy';

type Phase = 'error' | 'loading' | 'ready';

/** 业务列表（listGateElements）无 status 字段 — fallback 为 'published' 视作已发布。 */
function lifecycleOf(record: IpdGateElement): Lifecycle {
  return record.status ?? 'published';
}

function buttonState(record: IpdGateElement): GateElementButtonState {
  return { enabled: record.enabled, lifecycle: lifecycleOf(record) };
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

const phase = ref<Phase>('loading');
const offline = ref(false);
const errorMsg = ref('');

/** 全生命周期视图开关：默认 false（业务视图）；true → manage 视图（仅超管）。 */
const fullLifecycle = ref(false);
const gateFilter = ref<string>('');
const rows = ref<IpdGateElement[]>([]);

const vetoCount = computed(() => rows.value.filter((row) => row.isVeto === '1').length);
const statusCounts = computed(() => {
  let draft = 0;
  let published = 0;
  let archived = 0;
  let disabled = 0;
  for (const row of rows.value) {
    if (lifecycleOf(row) === 'draft') draft += 1;
    else if (lifecycleOf(row) === 'archived') archived += 1;
    else if (row.enabled === '0') disabled += 1;
    else published += 1;
  }
  return { archived, disabled, draft, published };
});

/** 新建/编辑弹窗共用状态；editingId 为空表示新建。 */
const modalOpen = ref(false);
const modalSaving = ref(false);
const editingId = ref('');
const modalForm = reactive({
  elementCode: '',
  elementName: '',
  enabled: true as boolean,
  gateCode: 'G1' as string,
  isVeto: false as boolean,
  passStandard: '',
  sortOrder: 0 as number,
  /** 阈值 JSON 文本（键非空、值均为整数）；空串视为不提交。 */
  thresholdJson: '',
  /** 双否决位（仅 isVeto=true 时生效，保存时若 isVeto=false 强制写 '0'）。 */
  vetoDualRequired: false as boolean,
});
const modalRules: Record<string, RuleObject[]> = {
  elementCode: [{ required: true, whitespace: true, message: '请输入要素编码' }],
  elementName: [{ required: true, whitespace: true, message: '请输入要素名称' }],
  gateCode: [{ required: true, message: '请选择适用 Gate' }],
  thresholdJson: [
    {
      validator: (_rule: RuleObject, value: undefined | string) => {
        const text = (value ?? '').trim();
        if (!text) return Promise.resolve();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return Promise.reject('阈值 JSON 格式不正确，请检查语法');
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return Promise.reject('阈值 JSON 必须为对象（键值对），不能为数组或基础值');
        }
        for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
          if (!key) return Promise.reject('阈值 JSON 的键不能为空');
          if (typeof val !== 'number' || !Number.isInteger(val)) {
            return Promise.reject(`阈值 JSON 的 "${key}" 必须为整数`);
          }
        }
        return Promise.resolve();
      },
      trigger: 'blur',
    },
  ],
};
const modalFormRef = ref();

/** copy 操作弹窗共用状态。 */
const copyOpen = ref(false);
const copySaving = ref(false);
const copySource = ref<IpdGateElement | null>(null);
const copyNewCode = ref('');

/** revert 操作弹窗共用状态。 */
const revertOpen = ref(false);
const revertSaving = ref(false);
const revertSource = ref<IpdGateElement | null>(null);
const revertAuditLogId = ref('');

const columns = [
  { dataIndex: 'sortOrder', key: 'sortOrder', title: '排序', width: 80 },
  { dataIndex: 'gateCode', key: 'gateCode', title: 'Gate', width: 70 },
  { dataIndex: 'elementCode', key: 'elementCode', title: '要素编码', width: 140 },
  { dataIndex: 'elementName', key: 'elementName', title: '要素名称' },
  { dataIndex: 'passStandard', key: 'passStandard', title: '通过标准' },
  { dataIndex: 'isVeto', key: 'isVeto', title: '否决项', width: 90 },
  { dataIndex: 'status', key: 'status', title: '状态', width: 100 },
  { key: 'actions', title: '操作', width: 360, fixed: 'right' as const },
];

async function load() {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    rows.value = fullLifecycle.value
      ? await listGateElementsForManage(gateFilter.value || undefined)
      : await listGateElements(gateFilter.value || undefined);
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(load);

/** 全生命周期开关切换：ant-design-vue Switch @change 回调签名是 (checked, event)。 */
function onFullLifecycleChange(next: boolean | string | number): void {
  fullLifecycle.value = Boolean(next);
  void load();
}

function openCreate() {
  editingId.value = '';
  modalForm.gateCode = gateFilter.value || 'G1';
  modalForm.elementCode = '';
  modalForm.elementName = '';
  modalForm.passStandard = '';
  modalForm.isVeto = false;
  modalForm.sortOrder = 0;
  modalForm.enabled = true;
  modalForm.thresholdJson = '';
  modalForm.vetoDualRequired = false;
  modalOpen.value = true;
}

function openEdit(record: IpdGateElement) {
  editingId.value = record.id;
  modalForm.gateCode = record.gateCode;
  modalForm.elementCode = record.elementCode;
  modalForm.elementName = record.elementName;
  modalForm.passStandard = record.passStandard ?? '';
  modalForm.isVeto = record.isVeto === '1';
  modalForm.sortOrder = record.sortOrder ?? 0;
  modalForm.enabled = record.enabled === '1';
  modalForm.thresholdJson = record.thresholdJson ?? '';
  modalForm.vetoDualRequired = record.vetoDualRequired === '1';
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
  const thresholdText = modalForm.thresholdJson.trim();
  const payload = {
    elementName: modalForm.elementName.trim(),
    enabled: (modalForm.enabled ? '1' : '0') as '0' | '1',
    isVeto: (modalForm.isVeto ? '1' : '0') as '0' | '1',
    passStandard: modalForm.passStandard.trim() ? modalForm.passStandard.trim() : null,
    sortOrder: modalForm.sortOrder ?? 0,
    /** 双否决位仅在否决项上有意义；非否决项强制 '0'（与后端语义一致）。 */
    vetoDualRequired: (modalForm.isVeto && modalForm.vetoDualRequired ? '1' : '0') as '0' | '1',
    thresholdJson: thresholdText ? thresholdText : undefined,
  };
  try {
    if (editingId.value) {
      await updateGateElement(editingId.value, payload);
      antMessage.success('评审要素已更新');
    } else {
      const createPayload: IpdGateElementCreateReq = {
        ...payload,
        elementCode: modalForm.elementCode.trim(),
        gateCode: modalForm.gateCode,
      };
      await createGateElement(createPayload);
      antMessage.success('评审要素已创建（草稿，需发布后启用）');
    }
    modalOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    modalSaving.value = false;
  }
}

/** 通用生命周期操作：run 回调返回 Promise<unknown>；失败抛错由 antMessage 兜底。 */
async function runLifecycleAction(
  action: () => Promise<unknown>,
  successMessage: string,
): Promise<void> {
  try {
    await action();
    antMessage.success(successMessage);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  }
}

/** 仅简单操作的轻量包装（disable / archive / publish / enable / restore / duplicate）。 */
async function runSimpleAction(
  record: IpdGateElement,
  apiCall: (id: string) => Promise<unknown>,
  successMessage: string,
): Promise<void> {
  await runLifecycleAction(() => apiCall(record.id), successMessage);
}

/** 高危操作（archive / restore / disable / publish / duplicate）弹窗二次确认文案。 */
function confirmText(button: GateElementRowButton, record: IpdGateElement): string {
  switch (button) {
    case 'archive':
      return `归档后该要素不可再编辑或发布（须先恢复为草稿）。确认归档 ${record.elementCode}？`;
    case 'restore':
      return `恢复后该要素变为草稿（不可见），需手动发布。确认恢复 ${record.elementCode}？`;
    case 'disable':
      return `停用后该要素不再出现在评审要素列表，历史判定记录不受影响。确认停用 ${record.elementCode}？`;
    case 'publish':
      return `发布后该要素在业务列表可见（启用），编码不可再改。确认发布 ${record.elementCode}？`;
    case 'duplicate':
      return `将为 ${record.elementCode} 创建草稿「副本」，源要素零改动。确认复制？`;
    case 'copy':
      return `将复制 ${record.elementCode} 为新编码草稿。确认复制？`;
    case 'revert':
      return `将回滚 ${record.elementCode} 到指定审计快照（高危）。确认回滚？`;
    case 'enable':
      return `将启用 ${record.elementCode}（需先确保定义完整）。确认启用？`;
    default:
      return `确认 ${ROW_BUTTON_LABEL[button]} ${record.elementCode}？`;
  }
}

/** 触发按钮 → 对应 API 调用。 */
async function invokeButton(button: GateElementRowButton, record: IpdGateElement): Promise<void> {
  switch (button) {
    case 'edit':
      openEdit(record);
      return;
    case 'disable':
      await runSimpleAction(record, disableGateElement, `要素 ${record.elementCode} 已停用`);
      return;
    case 'enable':
      await runSimpleAction(record, enableGateElement, `要素 ${record.elementCode} 已启用`);
      return;
    case 'publish':
      await runSimpleAction(record, publishGateElement, `要素 ${record.elementCode} 已发布`);
      return;
    case 'archive':
      await runSimpleAction(record, archiveGateElement, `要素 ${record.elementCode} 已归档`);
      return;
    case 'restore':
      await runSimpleAction(record, restoreGateElement, `要素 ${record.elementCode} 已恢复为草稿`);
      return;
    case 'duplicate':
      await runSimpleAction(record, duplicateGateElement, `要素 ${record.elementCode} 已复制为副本`);
      return;
    case 'copy':
      copySource.value = record;
      copyNewCode.value = '';
      copyOpen.value = true;
      return;
    case 'revert':
      revertSource.value = record;
      revertAuditLogId.value = '';
      revertOpen.value = true;
      return;
  }
}

async function submitCopy() {
  if (copySaving.value) return;
  const source = copySource.value;
  if (!source) return;
  const code = copyNewCode.value.trim();
  if (!code) {
    antMessage.error('请输入新编码');
    return;
  }
  copySaving.value = true;
  try {
    await copyGateElement(source.id, code);
    antMessage.success(`已复制 ${source.elementCode} 为 ${code}（草稿）`);
    copyOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    copySaving.value = false;
  }
}

async function submitRevert() {
  if (revertSaving.value) return;
  const source = revertSource.value;
  if (!source) return;
  const idText = revertAuditLogId.value.trim();
  if (!/^\d+$/.test(idText)) {
    antMessage.error('请输入有效的审计日志 ID（整数）');
    return;
  }
  revertSaving.value = true;
  try {
    await revertGateElement(source.id, Number(idText));
    antMessage.success(`要素 ${source.elementCode} 已回滚到审计快照 #${idText}`);
    revertOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    revertSaving.value = false;
  }
}

function statusLabel(record: IpdGateElement): { color: string; text: string } {
  const lifecycle = lifecycleOf(record);
  if (lifecycle === 'draft') return { color: 'default', text: '草稿' };
  if (lifecycle === 'archived') return { color: 'default', text: '已归档' };
  if (record.enabled === '0') return { color: 'warning', text: '已停用' };
  return { color: 'success', text: '已发布' };
}

/** ant-design-vue Table bodyCell record 推断为 Record<string, any>，统一转为 IpdGateElement。 */
function toElement(record: Record<string, unknown>): IpdGateElement {
  return record as unknown as IpdGateElement;
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="Gate 评审要素定义五大 Gate 的判定标准；否决项判定不通过时无法提交通过（硬阻断）。要素只可停用不可删除，历史判定记录不受停用影响。开启「全生命周期视图」可查看草稿/归档/停用要素及其生命周期按钮。"
      show-icon
      type="info"
    />

    <Card>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Space :size="12">
          <span class="text-muted-foreground text-sm">按 Gate 筛选</span>
          <Select
            v-model:value="gateFilter"
            :options="[{ label: '全部 Gate', value: '' }, ...IPD_GATE_CODES.map((code) => ({ label: code, value: code }))]"
            class="min-w-[140px]"
            @change="load"
          />
          <span class="text-muted-foreground text-sm">全生命周期视图</span>
          <Switch v-model:checked="fullLifecycle" @change="onFullLifecycleChange" />
          <span class="text-muted-foreground text-xs">
            当前视图：草稿 {{ statusCounts.draft }} · 已发布 {{ statusCounts.published }} · 已停用 {{ statusCounts.disabled }} · 已归档 {{ statusCounts.archived }}
          </span>
        </Space>
        <Button type="primary" v-access:code="IPD_PERMISSION_CODES.GATE_ELEMENT_CREATE" @click="openCreate">新增要素</Button>
      </div>
    </Card>

    <Card v-if="phase === 'loading'" class="text-center">
      <Spin tip="正在加载评审要素" />
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
          评审要素清单
          <span class="text-muted-foreground ml-2 text-sm">
            当前筛选下共 {{ rows.length }} 项，其中否决项 {{ vetoCount }} 项（仅显示启用要素，数据来自系统时）
          </span>
        </template>
        <Empty
          v-if="rows.length === 0"
          :description="fullLifecycle
            ? (gateFilter ? `${gateFilter} 暂无评审要素（含草稿/归档/停用）。` : '暂无评审要素（含草稿/归档/停用）。点击「新增要素」创建第一条判定标准。')
            : (gateFilter ? `${gateFilter} 暂无启用的评审要素。可切换到全部 Gate 或新增要素。` : '暂无启用的评审要素。点击「新增要素」创建第一条判定标准。')"
        />
        <Table
          v-else
          :columns="columns"
          :data-source="rows"
          :pagination="false"
          row-key="id"
          size="middle"
          :scroll="{ x: 900 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'sortOrder'">
              <span class="tabular-nums">{{ record.sortOrder ?? 0 }}</span>
            </template>
            <template v-else-if="column.key === 'passStandard'">
              {{ record.passStandard || '待补充' }}
            </template>
            <template v-else-if="column.key === 'isVeto'">
              <Tag v-if="record.isVeto === '1'" color="error">否决项</Tag>
              <span v-else class="text-muted-foreground">普通项</span>
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="statusLabel(toElement(record)).color">{{ statusLabel(toElement(record)).text }}</Tag>
            </template>
            <template v-else-if="column.key === 'actions'">
              <Space :size="4" wrap>
                <template v-for="button in ROW_BUTTON_ORDER" :key="button">
                  <template v-if="decideRowButton(button, buttonState(toElement(record))).visible">
                    <template v-if="button === 'edit'">
                      <Button
                        size="small"
                        v-access:code="IPD_PERMISSION_CODES.GATE_ELEMENT_UPDATE"
                        @click="invokeButton(button, toElement(record))"
                      >
                        {{ ROW_BUTTON_LABEL[button] }}
                      </Button>
                    </template>
                    <Popconfirm
                      v-else
                      :title="confirmText(button, toElement(record))"
                      @confirm="invokeButton(button, toElement(record))"
                    >
                      <Button
                        size="small"
                        :danger="button === 'disable' || button === 'archive'"
                        v-access:code="button === 'disable' ? IPD_PERMISSION_CODES.GATE_ELEMENT_DISABLE : button === 'enable' ? IPD_PERMISSION_CODES.GATE_ELEMENT_UPDATE : button === 'publish' ? IPD_PERMISSION_CODES.GATE_ELEMENT_PUBLISH : button === 'archive' ? IPD_PERMISSION_CODES.GATE_ELEMENT_ARCHIVE : button === 'copy' ? IPD_PERMISSION_CODES.GATE_ELEMENT_COPY : button === 'duplicate' ? IPD_PERMISSION_CODES.GATE_ELEMENT_COPY : button === 'revert' ? IPD_PERMISSION_CODES.GATE_ELEMENT_REVERT : IPD_PERMISSION_CODES.GATE_ELEMENT_RESTORE"
                      >
                        {{ ROW_BUTTON_LABEL[button] }}
                      </Button>
                    </Popconfirm>
                  </template>
                  <Tooltip
                    v-else
                    :title="decideRowButton(button, buttonState(toElement(record))).reason"
                  >
                    <Button
                      size="small"
                      disabled
                      style="opacity: 0.5; cursor: not-allowed;"
                    >
                      {{ ROW_BUTTON_LABEL[button] }}
                    </Button>
                  </Tooltip>
                </template>
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
      :title="editingId ? '编辑评审要素' : '新增评审要素'"
      cancel-text="取消"
      ok-text="保存"
      @ok="saveModal"
    >
      <Alert
        v-if="editingId"
        class="mb-3"
        message="要素编码与适用 Gate 是要素身份，创建后不可修改。"
        show-icon
        type="warning"
      />
      <Form ref="modalFormRef" :label-col="{ span: 6 }" :model="modalForm" :rules="modalRules" :wrapper-col="{ span: 16 }">
        <FormItem label="适用 Gate" name="gateCode">
          <Select
            v-model:value="modalForm.gateCode"
            :disabled="!!editingId"
            :options="IPD_GATE_CODES.map((code) => ({ label: code, value: code }))"
          />
        </FormItem>
        <FormItem label="要素编码" name="elementCode">
          <Input v-model:value="modalForm.elementCode" :disabled="!!editingId" :maxlength="64" placeholder="如 G1-E01" />
        </FormItem>
        <FormItem label="要素名称" name="elementName">
          <Input v-model:value="modalForm.elementName" :maxlength="128" placeholder="如 客户验证完成" />
        </FormItem>
        <FormItem label="通过标准" name="passStandard">
          <Input.TextArea
            v-model:value="modalForm.passStandard"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            placeholder="判定通过的客观标准（选填）"
          />
        </FormItem>
        <FormItem :value-prop-name="'checked'" label="否决项" name="isVeto">
          <Space>
            <Switch v-model:checked="modalForm.isVeto" />
            <span class="text-muted-foreground text-xs">开启后判定不通过将阻断 Gate 提交通过</span>
          </Space>
        </FormItem>
        <FormItem :value-prop-name="'checked'" label="双签否决" name="vetoDualRequired">
          <Space>
            <Switch
              v-model:checked="modalForm.vetoDualRequired"
              :disabled="!modalForm.isVeto"
            />
            <span class="text-muted-foreground text-xs">
              {{ modalForm.isVeto ? '开启后该否决项需双 PM 双签才能否决（评审侧 P2-5.2 消费）' : '仅否决项可启用双签' }}
            </span>
          </Space>
        </FormItem>
        <FormItem label="阈值 JSON" name="thresholdJson">
          <Input.TextArea
            v-model:value="modalForm.thresholdJson"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            placeholder='选填；键非空、值均为整数，如 {"minCustomerVerifications":3}'
          />
        </FormItem>
        <FormItem label="排序号" name="sortOrder">
          <InputNumber v-model:value="modalForm.sortOrder" :precision="0" class="w-full" />
        </FormItem>
        <FormItem v-if="!editingId" :value-prop-name="'checked'" label="启用" name="enabled">
          <Switch v-model:checked="modalForm.enabled" />
        </FormItem>
      </Form>
    </Modal>

    <Modal
      v-model:open="copyOpen"
      :confirm-loading="copySaving"
      :mask-closable="false"
      title="复制为新编码"
      cancel-text="取消"
      ok-text="复制"
      @ok="submitCopy"
    >
      <Alert
        v-if="copySource"
        class="mb-3"
        :message="`源要素：${copySource.gateCode} / ${copySource.elementCode}（${copySource.elementName}）。新要素初始为草稿，编码全局唯一。`"
        show-icon
        type="info"
      />
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <FormItem label="新编码" required>
          <Input
            v-model:value="copyNewCode"
            :maxlength="64"
            placeholder="如 G1-E01-COPY"
          />
        </FormItem>
      </Form>
    </Modal>

    <Modal
      v-model:open="revertOpen"
      :confirm-loading="revertSaving"
      :mask-closable="false"
      title="回滚到审计快照"
      cancel-text="取消"
      ok-text="回滚"
      @ok="submitRevert"
    >
      <Alert
        v-if="revertSource"
        class="mb-3"
        :message="`源要素：${revertSource.gateCode} / ${revertSource.elementCode}（${revertSource.elementName}）。回滚为高危操作，将覆盖当前定义。`"
        show-icon
        type="warning"
      />
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <FormItem label="审计日志 ID" required>
          <Input
            v-model:value="revertAuditLogId"
            :maxlength="20"
            placeholder="如 12345"
          />
        </FormItem>
      </Form>
    </Modal>
  </div>
</template>