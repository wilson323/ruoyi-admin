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
 *
 * 三列布局（SA-4 重构）：
 * - 左 240px Gate 导航（RadioGroup，单选切换 gateFilter）
 * - 中 flex-1 表格 + CTA + 判定分布 + loading/error
 * - 右 360px 选中行详情编辑器（点行/9 按钮"编辑"均进入；modalForm 数据结构共享）
 */
import { computed, onMounted, reactive, ref } from 'vue';
import type { RadioChangeEvent } from 'ant-design-vue/es/radio/interface';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  RadioGroup,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  message as antMessage,
} from 'ant-design-vue';

import {
  IPD_GATE_CODES,
  archiveGateElement,
  copyGateElement,
  copyGateElementsBatch,
  createGateElement,
  disableGateElement,
  duplicateGateElement,
  enableGateElement,
  getGateElementResultStats,
  listGateElementAuditLogs,
  listGateElements,
  listGateElementsForManage,
  publishGateElement,
  restoreGateElement,
  revertGateElement,
  updateGateElement,
  type IpdGateElement,
  type IpdGateElementAuditLog,
  type IpdGateElementCreateReq,
  type IpdGateElementResultStats,
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

/** 新建/编辑弹窗共用状态；editingId 为空表示新建。
 *  B 段半截补口（页47 v3 BR-GATE-01b）：
 *  - vetoDualRequired：仅 isVeto='1' 时有效；双签确认位（评审侧 P2-5.2 消费）
 *  - thresholdJsonText：阈值 JSON 的可编辑字符串表示（如 {"minCustomerVerifications":3}）；
 *    保存时走 JSON.parse 校验，合法后传给后端。
 */
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
  vetoDualRequired: false as boolean,
  thresholdJsonText: '' as string,
});
const modalRules = {
  elementCode: [{ required: true, whitespace: true, message: '请输入要素编码' }],
  elementName: [{ required: true, whitespace: true, message: '请输入要素名称' }],
  gateCode: [{ required: true, message: '请选择适用 Gate' }],
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
/** 审计日志下拉选项（listGateElementAuditLogs 返回；加载失败时为空数组，UI 走「待后端交付」降级提示）。 */
const revertAuditLogs = ref<IpdGateElementAuditLog[]>([]);
const revertAuditLogsLoading = ref(false);
const revertAuditLogsError = ref(false);

/** 批量复制 Gate 弹窗（页47 v3 BR-GATE-01b 「复制 Gate」功能；后端待交付）。 */
const batchCopyOpen = ref(false);
const batchCopySaving = ref(false);
const batchCopySourceGate = ref<string>('');
const batchCopyTargetGate = ref<string>('G1');
const batchCopyCodePrefix = ref<string>('');

/** 判定分布小卡片（调 gate_element_results 统计接口，后端待交付）。 */
const judgmentStats = ref<IpdGateElementResultStats | null>(null);
const judgmentStatsLoading = ref(false);
const judgmentStatsError = ref(false);

/** 三列布局：右栏选中行（null 表示右栏空态）。 */
const selectedRow = ref<IpdGateElement | null>(null);

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
  // 表格刷新后顺带拉取判定分布；端点待后端交付，失败走诚实声明。
  void loadJudgmentStats();
  // 选中行可能已被过滤掉（如停用）— 保留选中态供后续编辑
}

onMounted(load);

/** 全生命周期开关切换：ant-design-vue Switch @change 回调签名是 (checked, event)。 */
function onFullLifecycleChange(next: boolean | string | number): void {
  fullLifecycle.value = Boolean(next);
  void load();
}

/** 左栏 Gate 导航切换：单选 RadioGroup value='' 或 'G1'..'G5'。 */
function onGateNavChange(next: string | number | boolean | undefined): void {
  gateFilter.value = typeof next === 'string' ? next : '';
  void load();
}

/** Vue template 内 RadioGroup @change 事件参数：使用 ant-design-vue 的 RadioChangeEvent。 */
function onGateNavRadioChange(event: RadioChangeEvent): void {
  onGateNavChange(typeof event.target.value === 'string' ? event.target.value : '');
}

/** 行点选（三列布局右栏入口）— 仅设置 selectedRow，不开 modal；用户可在右栏点「编辑」触发弹窗。 */
function selectRow(record: IpdGateElement): void {
  selectedRow.value = record;
  // 同步 modalForm 让右栏"编辑"按钮弹出的弹窗显示当前数据
  editingId.value = record.id;
  modalForm.gateCode = record.gateCode;
  modalForm.elementCode = record.elementCode;
  modalForm.elementName = record.elementName;
  modalForm.passStandard = record.passStandard ?? '';
  modalForm.isVeto = record.isVeto === '1';
  modalForm.vetoDualRequired = record.isVeto === '1' && record.vetoDualRequired === '1';
  modalForm.thresholdJsonText = record.thresholdJson ?? '';
  modalForm.sortOrder = record.sortOrder ?? 0;
  modalForm.enabled = record.enabled === '1';
}

function openCreate() {
  editingId.value = '';
  modalForm.gateCode = gateFilter.value || 'G1';
  modalForm.elementCode = '';
  modalForm.elementName = '';
  modalForm.passStandard = '';
  modalForm.isVeto = false;
  modalForm.vetoDualRequired = false;
  modalForm.thresholdJsonText = '';
  modalForm.sortOrder = 0;
  modalForm.enabled = true;
  modalOpen.value = true;
}

function openEdit(record: IpdGateElement) {
  editingId.value = record.id;
  modalForm.gateCode = record.gateCode;
  modalForm.elementCode = record.elementCode;
  modalForm.elementName = record.elementName;
  modalForm.passStandard = record.passStandard ?? '';
  modalForm.isVeto = record.isVeto === '1';
  // vetoDualRequired 仅当 isVeto='1' 时有效；后端为 0 或 null 时显示为 false
  modalForm.vetoDualRequired = record.isVeto === '1' && record.vetoDualRequired === '1';
  modalForm.thresholdJsonText = record.thresholdJson ?? '';
  modalForm.sortOrder = record.sortOrder ?? 0;
  modalForm.enabled = record.enabled === '1';
  selectedRow.value = record;
  modalOpen.value = true;
}

async function saveModal() {
  if (modalSaving.value) return;
  try {
    await modalFormRef.value?.validate();
  } catch {
    return;
  }
  // 阈值 JSON 校验：有填写则走 JSON.parse，无填写则不传后端该键。
  const rawThreshold = modalForm.thresholdJsonText.trim();
  let parsedThreshold: string | null = null;
  if (rawThreshold) {
    try {
      const parsed: unknown = JSON.parse(rawThreshold);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        antMessage.error('阈值 JSON 须为对象（如 {"minVerifications":3}）');
        return;
      }
      parsedThreshold = JSON.stringify(parsed);
    } catch (parseErr) {
      antMessage.error(`阈值 JSON 格式错误：${parseErr instanceof Error ? parseErr.message : '非合法 JSON'}`);
      return;
    }
  }
  // vetoDualRequired 仅当 isVeto='1' 时有效；不是否决项时强制 0。
  const vetoDual: '0' | '1' = modalForm.isVeto && modalForm.vetoDualRequired ? '1' : '0';
  modalSaving.value = true;
  const payload = {
    elementName: modalForm.elementName.trim(),
    enabled: (modalForm.enabled ? '1' : '0') as '0' | '1',
    isVeto: (modalForm.isVeto ? '1' : '0') as '0' | '1',
    passStandard: modalForm.passStandard.trim() ? modalForm.passStandard.trim() : null,
    sortOrder: modalForm.sortOrder ?? 0,
    vetoDualRequired: vetoDual,
    ...(parsedThreshold ? { thresholdJson: parsedThreshold } : {}),
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
      selectedRow.value = record;
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
      revertAuditLogs.value = [];
      revertAuditLogsError.value = false;
      revertOpen.value = true;
      void loadRevertAuditLogs(record.id);
      return;
  }
}

/** revert 弹窗打开后加载该要素的审计日志列表（端点 GET /gate-elements/{id}/audit-logs，后端待交付）。 */
async function loadRevertAuditLogs(elementId: string): Promise<void> {
  if (!elementId) return;
  revertAuditLogsLoading.value = true;
  revertAuditLogsError.value = false;
  try {
    revertAuditLogs.value = await listGateElementAuditLogs(elementId);
  } catch {
    // 后端未交付：按 AGENTS.md 规约走诚实声明，不臆造数据。
    revertAuditLogs.value = [];
    revertAuditLogsError.value = true;
  } finally {
    revertAuditLogsLoading.value = false;
  }
}

/** 打开「复制 Gate」弹窗（页47 v3 BR-GATE-01b：跨 Gate 复制所有要素；后端待交付）。 */
function openBatchCopy() {
  batchCopySourceGate.value = gateFilter.value || 'G1';
  batchCopyTargetGate.value = 'G1';
  batchCopyCodePrefix.value = '';
  batchCopyOpen.value = true;
}

/** 提交批量复制请求。 */
async function submitBatchCopy() {
  if (batchCopySaving.value) return;
  const sourceGate = batchCopySourceGate.value;
  const targetGate = batchCopyTargetGate.value;
  const codePrefix = batchCopyCodePrefix.value.trim();
  if (!sourceGate || !targetGate) {
    antMessage.error('请选择源 Gate 和目标 Gate');
    return;
  }
  if (sourceGate === targetGate) {
    antMessage.error('源 Gate 与目标 Gate 不能相同');
    return;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(codePrefix)) {
    antMessage.error('编码前缀须为英文/数字/下划线/短横线（如 G1_ 或 COPY-）');
    return;
  }
  batchCopySaving.value = true;
  try {
    const resp = await copyGateElementsBatch({ codePrefix, sourceGate, targetGate });
    const skipped = resp.skipped?.length ?? 0;
    antMessage.success(`已复制 ${resp.copied} 项要素${skipped ? `（跳过 ${skipped} 项）` : ''}`);
    batchCopyOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    batchCopySaving.value = false;
  }
}

/** 加载判定分布统计（端点 GET /gate-element-results/stats，后端待交付）。 */
async function loadJudgmentStats(): Promise<void> {
  judgmentStatsLoading.value = true;
  judgmentStatsError.value = false;
  try {
    judgmentStats.value = await getGateElementResultStats(gateFilter.value || undefined);
  } catch {
    judgmentStats.value = null;
    judgmentStatsError.value = true;
  } finally {
    judgmentStatsLoading.value = false;
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
    antMessage.error('请选择审计日志条目（从下拉列表选择）');
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

/** 右栏：选中行的 9 按钮入口（与表格行共享 button-policy）。 */
const rightActions = ROW_BUTTON_ORDER;
</script>

<template>
  <!-- 三列布局：左 240px Gate 导航 / 中 flex-1 表格 / 右 360px 详情编辑器 -->
  <div class="flex gap-4 p-4">
    <!-- 左栏：Gate 导航 -->
    <div class="w-[240px] shrink-0">
      <Card size="small" title="Gate 导航">
        <RadioGroup
          class="flex flex-col gap-2"
          :value="gateFilter"
          @change="onGateNavRadioChange"
        >
          <Radio value="">全部 Gate</Radio>
          <Radio v-for="code in IPD_GATE_CODES" :key="code" :value="code">{{ code }}</Radio>
        </RadioGroup>
        <Alert
          class="mt-3"
          message="仅显示已启用要素；切换到「全生命周期视图」可看草稿/归档/停用。"
          show-icon
          type="info"
        />
      </Card>
    </div>

    <!-- 中栏：主内容（CTA + 判定分布 + 加载/错误/表格） -->
    <div class="flex min-w-0 flex-1 flex-col gap-4">
      <Alert
        message="Gate 评审要素定义五大 Gate 的判定标准；否决项判定不通过时无法提交通过（硬阻断）。要素只可停用不可删除，历史判定记录不受停用影响。开启「全生命周期视图」可查看草稿/归档/停用要素及其生命周期按钮。"
        show-icon
        type="info"
      />

      <Card>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Space :size="12">
            <span class="text-muted-foreground text-sm">全生命周期视图</span>
            <Switch v-model:checked="fullLifecycle" @change="onFullLifecycleChange" />
            <span class="text-muted-foreground text-xs">
              当前视图：草稿 {{ statusCounts.draft }} · 已发布 {{ statusCounts.published }} · 已停用 {{ statusCounts.disabled }} · 已归档 {{ statusCounts.archived }}
            </span>
          </Space>
          <Space :size="8">
            <Tooltip
              :title="!fullLifecycle ? '仅在「全生命周期视图」下可见批量复制（按需避免误操作）' : '把源 Gate 下全部启用的要素复制到目标 Gate（新编码加前缀）'"
            >
              <Button
                :disabled="!fullLifecycle"
                v-access:code="IPD_PERMISSION_CODES.GATE_ELEMENT_COPY"
                @click="openBatchCopy"
              >
                复制 Gate
              </Button>
            </Tooltip>
            <Button type="primary" v-access:code="IPD_PERMISSION_CODES.GATE_ELEMENT_CREATE" @click="openCreate">新增要素</Button>
          </Space>
        </div>
      </Card>

      <!-- SA-3 软实施：判定分布小卡片（后端待交付时走诚实声明「待后端交付」） -->
      <Card size="small">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-muted-foreground text-sm">判定分布（当前 Gate 筛选下）</span>
          <Spin v-if="judgmentStatsLoading" size="small" />
          <template v-else-if="judgmentStatsError">
            <Tag color="default">判定统计待后端交付</Tag>
            <Button size="small" @click="loadJudgmentStats">重试</Button>
          </template>
          <template v-else-if="judgmentStats">
            <Space :size="16">
              <span><Tag color="success">✅ 通过 {{ judgmentStats.pass }}</Tag></span>
              <span><Tag color="warning">⚠️ 有条件通过 {{ judgmentStats.passWithCondition }}</Tag></span>
              <span><Tag color="error">❌ 不通过 {{ judgmentStats.fail }}</Tag></span>
              <span class="text-muted-foreground text-xs">总判定数 {{ judgmentStats.total }}</span>
            </Space>
          </template>
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
              当前筛选下共 {{ rows.length }} 项，其中否决项 {{ vetoCount }} 项（点行查看右栏详情）
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
            :custom-row="(record: IpdGateElement) => ({ onClick: () => selectRow(record) })"
            :row-class-name="(record: IpdGateElement) => selectedRow?.id === record.id ? 'ipd-row-selected' : ''"
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
    </div>

    <!-- 右栏：选中行详情编辑器（SA-4 三列布局） -->
    <div class="w-[360px] shrink-0">
      <Card size="small" title="要素详情" class="sticky top-4">
        <template v-if="!selectedRow">
          <Empty
            description="请选择左侧 Gate + 中间要素查看详情（点行或点 9 按钮中的「编辑」进入编辑器）"
          />
        </template>
        <template v-else>
          <Descriptions
            :column="1"
            size="small"
            class="mb-3"
            bordered
          >
            <DescriptionsItem label="要素编码">{{ selectedRow.elementCode }}</DescriptionsItem>
            <DescriptionsItem label="要素名称">{{ selectedRow.elementName }}</DescriptionsItem>
            <DescriptionsItem label="适用 Gate">
              <Tag color="blue">{{ selectedRow.gateCode }}</Tag>
            </DescriptionsItem>
            <DescriptionsItem label="状态">
              <Tag :color="statusLabel(selectedRow).color">{{ statusLabel(selectedRow).text }}</Tag>
            </DescriptionsItem>
            <DescriptionsItem label="否决项">
              <Tag v-if="selectedRow.isVeto === '1'" color="error">是</Tag>
              <span v-else class="text-muted-foreground">否</span>
            </DescriptionsItem>
            <DescriptionsItem v-if="selectedRow.isVeto === '1'" label="双签确认">
              <Tag v-if="selectedRow.vetoDualRequired === '1'" color="warning">需要</Tag>
              <span v-else class="text-muted-foreground">否</span>
            </DescriptionsItem>
            <DescriptionsItem label="通过标准">
              <div class="text-muted-foreground whitespace-pre-wrap">{{ selectedRow.passStandard || '待补充' }}</div>
            </DescriptionsItem>
            <DescriptionsItem label="阈值 JSON">
              <div v-if="selectedRow.thresholdJson" class="whitespace-pre-wrap text-xs">
                <pre class="m-0">{{ selectedRow.thresholdJson }}</pre>
              </div>
              <span v-else class="text-muted-foreground">未配置</span>
            </DescriptionsItem>
            <DescriptionsItem label="排序号">{{ selectedRow.sortOrder ?? 0 }}</DescriptionsItem>
            <DescriptionsItem v-if="selectedRow.version != null" label="版本">{{ selectedRow.version }}</DescriptionsItem>
          </Descriptions>
          <Space :size="8" wrap>
            <Button
              size="small"
              type="primary"
              v-access:code="IPD_PERMISSION_CODES.GATE_ELEMENT_UPDATE"
              @click="openEdit(selectedRow)"
            >
              编辑要素
            </Button>
            <template v-for="button in rightActions" :key="`right-${button}`">
              <template v-if="button !== 'edit' && decideRowButton(button, buttonState(selectedRow)).visible">
                <Popconfirm
                  :title="confirmText(button, selectedRow)"
                  @confirm="invokeButton(button, selectedRow)"
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
            </template>
          </Space>
        </template>
      </Card>
    </div>

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
        <FormItem label="阈值 JSON" name="thresholdJsonText">
          <Input.TextArea
            v-model:value="modalForm.thresholdJsonText"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            placeholder='如 {"minCustomerVerifications":3}'
          />
          <div class="text-muted-foreground mt-1 text-xs">
            可选。键非空、值均为整数（如 {"minVerifications":3}）。保存时走 JSON.parse 校验。
          </div>
        </FormItem>
        <FormItem :value-prop-name="'checked'" label="否决项" name="isVeto">
          <Space>
            <Switch v-model:checked="modalForm.isVeto" />
            <span class="text-muted-foreground text-xs">开启后判定不通过将阻断 Gate 提交通过</span>
          </Space>
        </FormItem>
        <FormItem :value-prop-name="'checked'" label="双签确认" name="vetoDualRequired">
          <Space>
            <Switch
              :checked="modalForm.vetoDualRequired"
              :disabled="!modalForm.isVeto"
              @change="(val: boolean | string | number) => (modalForm.vetoDualRequired = Boolean(val))"
            />
            <span class="text-muted-foreground text-xs">
              仅「否决项」开启时有效；命中需双签确认（评审侧 P2-5.2 消费）
            </span>
          </Space>
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
        <FormItem label="审计快照" required>
          <Spin v-if="revertAuditLogsLoading" size="small" />
          <template v-else-if="revertAuditLogsError">
            <Alert
              class="mb-2"
              message="审计日志查询端点待后端交付。暂不提供回滚能力。"
              show-icon
              type="info"
            />
          </template>
          <Select
            v-else
            v-model:value="revertAuditLogId"
            :disabled="revertAuditLogs.length === 0"
            :options="revertAuditLogs.map((log) => ({
              label: `#${log.id} · ${log.action} · ${log.operator} · ${log.createTime}${log.summary ? `（${log.summary}）` : ''}`,
              value: String(log.id),
            }))"
            placeholder="选择审计日志条目"
            show-search
          />
        </FormItem>
      </Form>
    </Modal>

    <!-- SA-3 软实施：批量复制 Gate 弹窗（后端待交付） -->
    <Modal
      v-model:open="batchCopyOpen"
      :confirm-loading="batchCopySaving"
      :mask-closable="false"
      title="复制 Gate（跨 Gate 批量复制）"
      cancel-text="取消"
      ok-text="复制"
      @ok="submitBatchCopy"
    >
      <Alert
        class="mb-3"
        message="复制 Gate 为高危批量操作：把源 Gate 下全部启用的要素复制为草稿，新编码 = 「前缀-原编码」。后端端点待交付，调通后本弹窗生效。"
        show-icon
        type="warning"
      />
      <Form :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <FormItem label="源 Gate" required>
          <Select
            v-model:value="batchCopySourceGate"
            :options="IPD_GATE_CODES.map((code) => ({ label: code, value: code }))"
          />
        </FormItem>
        <FormItem label="目标 Gate" required>
          <Select
            v-model:value="batchCopyTargetGate"
            :options="IPD_GATE_CODES.map((code) => ({ label: code, value: code }))"
          />
        </FormItem>
        <FormItem label="编码前缀" required>
          <Input
            v-model:value="batchCopyCodePrefix"
            :maxlength="32"
            placeholder="如 G2_ 或 COPY-"
          />
          <div class="text-muted-foreground mt-1 text-xs">
            新要素编码 = 「前缀-原编码」，确保跨 Gate 不撞名。
          </div>
        </FormItem>
      </Form>
    </Modal>
  </div>
</template>