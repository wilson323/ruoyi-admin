<script setup lang="ts">
/**
 * Gate 评审详情页（页 R177-A6；admin 命名空间）。
 *
 * 后端真值：
 * - GET /api/v1/projects/{id}/gates（ProjectController）→ Gate 实例列表（含 id/gateCode/status/signDueAt/concludedAt/currentRound）
 * - GET /api/v1/gates/{gateId}/review（GateReviewController）→ 评审视图（双签盲签、轮次、延期次数、观察员）
 *
 * 按钮决策：与 button-policy.ts 状态机一一对应（PENDING/APPROVED/REJECTED/ABSTAINED_TIMEOUT × 9 按钮）。
 * 权限码：sign/reopen/arbitrate/final-ruling 走 GATE_REVIEW_APPROVE；extend 仅超管走 SYSTEM_CONFIG_READ（占位）；
 * refresh 走 GATE_REVIEW_LIST。权限层独立于状态决策矩阵（双闸门禁）。
 *
 * R212 ORPHAN-A1（2026-09-24）补接线 5 端点（此前 view.observers 仅静态渲染、legacy/submit 零调用）：
 * - GET  /gates/{gateId}/observers                    列席人+意见（后端仅组长/超管放行；前端 personType 双闸）
 * - POST /gates/{gateId}/observers/invite             邀约列席（仅超管/组长；role 白名单 5 类）
 * - POST /gates/{gateId}/observers/{observerId}/opinion 列席意见（仅 observer 本人，前端按 person.id 匹配）
 * - GET  /gates/{gateId}/legacy                       条件遗留清单（AC-GATE-17；本页新增卡片承接）
 * - POST /gates/{gateId}/submit                       评审提交——接在页24 评审工作台 gate-panel.vue
 *   「提交评审结论」按钮（要素判定流程宿主），本页不重复入口。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  message as antMessage,
} from 'ant-design-vue';

import {
  type GateDecision,
  type GateObserverRole,
  type GateObserverView,
  type GateReviewView,
  type GateStatus,
  type ProjectGateItem,
  GATE_OBSERVER_ROLE_OPTIONS,
  arbitrateGate,
  extendGateDeadline,
  finalRulingGate,
  getGateReview,
  inviteGateObservers,
  listGateObservers,
  listProjectGates,
  reopenGate,
  signGate,
  submitGateObserverOpinion,
} from '../../../../api/ipd/gate-review';
import { type IpdGateLegacyItem, listGateLegacyItems } from '../../../../api/ipd/gate-element-result';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { formatDateTime } from '../../_shared/format';
import {
  ROW_BUTTON_LABEL,
  ROW_BUTTON_ORDER,
  decideRowButton,
  type GateDetailRowButton,
  type GateDetailStatus,
} from './button-policy';

defineOptions({
  name: 'IpdAdminGateDetail',
  meta: {
    ipdBackend: 'GateReviewController GET /gates/{gateId}/review + POST /gates/{gateId}/{sign|reopen|arbitrate|final-ruling|extend-deadline} + ProjectController GET /projects/{id}/gates。',
    ipdCard: 'R177-A6',
  },
});

const route = useRoute();

/** 路由 query 参数：projectId（项目编号）、gateId（Gate 编号）。 */
const projectId = computed(() => String(route.query.projectId ?? '').trim());
const routeGateId = computed(() => String(route.query.gateId ?? '').trim());

/** 手输 Gate 编号兜底（无 query 时由用户输入）。 */
const manualGateId = ref('');

const gateList = ref<ProjectGateItem[]>([]);
const listLoading = ref(false);
const listError = ref('');

const view = ref<null | GateReviewView>(null);
const viewLoading = ref(false);
const viewError = ref('');

const busy = ref(false);
const actionError = ref('');

const GATE_STATUS_COLOR: Record<GateStatus, string> = {
  ABSTAINED_TIMEOUT: 'default',
  APPROVED: 'success',
  PENDING: 'processing',
  REJECTED: 'error',
};

const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  ABSTAINED_TIMEOUT: '超时弃权',
  APPROVED: '已通过',
  PENDING: '流转中',
  REJECTED: '已驳回',
};

const decisionText = (value?: string): string =>
  value === 'APPROVE' ? '通过' : value === 'REJECT' ? '驳回' : (value ?? '—');

const REVIEWER_LABEL: Readonly<Record<string, string>> = Object.freeze({
  GROUP_LEADER: '产品组长',
  MARKET_PM: '市场PM',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
});

const reviewerName = (value: string): string => REVIEWER_LABEL[value] ?? value;

function toGateStatus(value: string): GateDetailStatus {
  if (value === 'APPROVED' || value === 'PENDING' || value === 'REJECTED' || value === 'ABSTAINED_TIMEOUT') {
    return value;
  }
  return 'PENDING';
}

/** 当前激活的 Gate 编号：query 注入优先，手输兜底。 */
const activeGateId = computed(() => routeGateId.value || manualGateId.value.trim());

async function loadList(): Promise<void> {
  const id = projectId.value;
  if (!id) return;
  listLoading.value = true;
  listError.value = '';
  try {
    gateList.value = await listProjectGates(id);
  } catch (cause) {
    gateList.value = [];
    listError.value = ipdErrorText(cause, { fallback: '项目 Gate 列表加载失败' });
  } finally {
    listLoading.value = false;
  }
}

async function loadView(): Promise<void> {
  const gid = activeGateId.value;
  if (!gid) {
    view.value = null;
    return;
  }
  viewLoading.value = true;
  viewError.value = '';
  try {
    view.value = await getGateReview(gid);
  } catch (cause) {
    view.value = null;
    viewError.value = ipdErrorText(cause, { fallback: 'Gate 评审视图加载失败' });
  } finally {
    viewLoading.value = false;
  }
}

/* ---------- R212 ORPHAN-A1：列席（MEDIUM-1.3）与条件遗留（AC-GATE-17）接线 ---------- */

const auth = useIpdAuthStore();
/** 后端 GateReviewService 语义：查名单/邀约仅 GROUP_LEADER/SUPER_ADMIN（personType 双闸，减少必然失败的请求）。 */
const isLeader = computed(() => auth.identity?.person.personType === 'GROUP_LEADER');
const isSuperAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');
const canManageObservers = computed(() => isLeader.value || isSuperAdmin.value);
/** 列席意见仅 observer 本人可提交（后端 recordOpinion 断言 actor.id == observerId）。 */
const myPersonId = computed(() => auth.identity?.person.id ?? '');

const observers = ref<GateObserverView[]>([]);
const observersLoading = ref(false);
const observersError = ref('');
const observerBusy = ref(false);

/** 邀约表单：personId 手输（后端无人员列表端点，逗号分隔多值）+ 角色白名单单选。 */
const inviteObserverIdsText = ref('');
const inviteRole = ref<GateObserverRole>('SALES');

/** 解析手输 personId（逗号/空格分隔，去空去重，剔除非数字项）。 */
function parseObserverIds(): string[] {
  return [...new Set(
    inviteObserverIdsText.value.split(/[,，\s]+/).map((v) => v.trim()).filter((v) => /^\d+$/.test(v)),
  )];
}

async function loadObservers(): Promise<void> {
  const gid = activeGateId.value;
  if (!gid) return;
  observersLoading.value = true;
  observersError.value = '';
  try {
    observers.value = await listGateObservers(gid);
  } catch (cause) {
    observers.value = [];
    observersError.value = ipdErrorText(cause, { fallback: '列席名单加载失败' });
  } finally {
    observersLoading.value = false;
  }
}

async function doInviteObservers(): Promise<void> {
  const gid = activeGateId.value;
  if (!gid || observerBusy.value) return;
  const ids = parseObserverIds();
  if (ids.length === 0) {
    observersError.value = '请填写至少 1 个列席人 personId（数字，逗号分隔）';
    return;
  }
  observerBusy.value = true;
  observersError.value = '';
  try {
    const result = await inviteGateObservers(gid, ids, inviteRole.value);
    antMessage.success(`已邀约 ${result.invitedCount} 位列席人（角色 ${result.role}）`);
    inviteObserverIdsText.value = '';
    await loadObservers();
  } catch (cause) {
    observersError.value = ipdErrorText(cause, { fallback: '邀约列席失败' });
  } finally {
    observerBusy.value = false;
  }
}

/** 本人意见草稿（按 observerId 分桶，避免多行串值）。 */
const opinionDrafts = ref<Record<string, string>>({});

async function doSubmitObserverOpinion(observer: GateObserverView): Promise<void> {
  const gid = activeGateId.value;
  if (!gid || observerBusy.value) return;
  const opinion = (opinionDrafts.value[observer.observerId] ?? '').trim();
  if (!opinion) {
    observersError.value = '列席意见不能为空（1~2000 字）';
    return;
  }
  observerBusy.value = true;
  observersError.value = '';
  try {
    const updated = await submitGateObserverOpinion(gid, observer.observerId, opinion);
    const idx = observers.value.findIndex((row) => row.observerId === observer.observerId);
    if (idx >= 0) observers.value.splice(idx, 1, updated);
    antMessage.success('列席意见已提交（不入主审投票）');
  } catch (cause) {
    observersError.value = ipdErrorText(cause, { fallback: '列席意见提交失败' });
  } finally {
    observerBusy.value = false;
  }
}

/** 表格行操作包装：slot record 为宽松类型，收窄后转调（vue-tsc 严格检查）。 */
function submitOpinionFromRow(record: Record<string, unknown>): void {
  void doSubmitObserverOpinion(record as unknown as GateObserverView);
}

/** 列席角色 → 中文标签（白名单外的原样透出）。 */
const OBSERVER_ROLE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  AFTERSALES: '售后',
  COMPLIANCE: '合规',
  QUALITY: '品质',
  SALES: '销售',
  SUPPLY: '供应',
});

const observerRoleLabel = (role: string): string => OBSERVER_ROLE_LABEL[role] ?? role;

const observerColumns = [
  { title: '列席人 personId', dataIndex: 'observerId', key: 'observerId', width: 120 },
  { title: '角色', key: 'role', width: 90 },
  { title: '出席', key: 'attended', width: 70 },
  { title: '意见', key: 'opinion' },
  { title: '邀约时间', key: 'invitedAt', width: 170 },
  { title: '操作', key: 'opinionAction', width: 260 },
];

/* ---------- 条件遗留清单（GET /legacy；AC-GATE-17） ---------- */

const legacyItems = ref<IpdGateLegacyItem[]>([]);
const legacyLoading = ref(false);
const legacyError = ref('');
/** 手动加载（低频查看数据，不随视图自动拉取）。 */
const legacyLoadedOnce = ref(false);

async function loadLegacy(): Promise<void> {
  const gid = activeGateId.value;
  if (!gid || legacyLoading.value) return;
  legacyLoading.value = true;
  legacyError.value = '';
  try {
    legacyItems.value = await listGateLegacyItems(gid);
    legacyLoadedOnce.value = true;
  } catch (cause) {
    legacyItems.value = [];
    legacyError.value = ipdErrorText(cause, { fallback: '条件遗留清单加载失败' });
  } finally {
    legacyLoading.value = false;
  }
}

const legacyColumns = [
  { title: '要素', key: 'element', width: 220 },
  { title: '判定', dataIndex: 'result', key: 'result', width: 150 },
  { title: '遗留项', dataIndex: 'leftoverItem', key: 'leftoverItem' },
  { title: '状态', key: 'leftoverStatus', width: 100 },
  { title: '关闭期限', key: 'leftoverDueAt', width: 170 },
  { title: '责任人', dataIndex: 'responsiblePersonId', key: 'responsiblePersonId', width: 100 },
  { title: '关闭证据', dataIndex: 'closedEvidence', key: 'closedEvidence' },
];

const LEFTOVER_STATUS_LABEL: Readonly<Record<string, string>> = Object.freeze({
  CLOSED: '已关闭',
  OPEN: '未关闭',
});

onMounted(async () => {
  await loadList();
  await loadView();
  // 列席名单仅组长/超管可查（后端 400 拒绝其余角色），前端按 personType 前置避免必然失败的请求
  if (canManageObservers.value && activeGateId.value) {
    void loadObservers();
  }
});

watch(activeGateId, () => {
  void loadView();
  // 切换 Gate 时重置列席/遗留数据（避免跨 Gate 展示脏数据）
  observers.value = [];
  observersError.value = '';
  legacyItems.value = [];
  legacyError.value = '';
  legacyLoadedOnce.value = false;
  if (canManageObservers.value && activeGateId.value) {
    void loadObservers();
  }
});

/** 当前 Gate 在列表中的索引行（用于导航 / 详情显示）。 */
const currentListItem = computed<ProjectGateItem | null>(() => {
  const gid = activeGateId.value;
  if (!gid) return null;
  return gateList.value.find((g) => String(g.id) === gid) ?? null;
});

const currentStatus = computed<GateStatus>(() => {
  if (view.value?.status) return view.value.status;
  const item = currentListItem.value;
  return item?.status ? toGateStatus(String(item.status)) : 'PENDING';
});

/** 用 button-policy 决策每按钮可见性。 */
function buttonVisible(button: GateDetailRowButton): boolean {
  return decideRowButton(button, { status: currentStatus.value }).visible;
}

/** 用 button-policy 决策每按钮隐藏原因（用于 Tooltip）。 */
function buttonReason(button: GateDetailRowButton): string {
  return decideRowButton(button, { status: currentStatus.value }).reason ?? '当前状态不支持该操作';
}

/** 各按钮对应权限码（双闸门禁：状态可见 + 权限允许）。 */
function permissionFor(button: GateDetailRowButton): string {
  switch (button) {
    case 'signApprove':
    case 'signReject':
      return IPD_PERMISSION_CODES.GATE_REVIEW_APPROVE;
    case 'reopen':
      return IPD_PERMISSION_CODES.GATE_REVIEW_INITIATE;
    case 'extend':
      return IPD_PERMISSION_CODES.SYSTEM_CONFIG_READ; // 超管专属延期
    case 'arbitrateApprove':
    case 'arbitrateReject':
      return IPD_PERMISSION_CODES.GATE_REVIEW_APPROVE;
    case 'finalRulingApprove':
    case 'finalRulingReject':
      return IPD_PERMISSION_CODES.GATE_REVIEW_APPROVE;
    case 'refresh':
      return IPD_PERMISSION_CODES.GATE_REVIEW_LIST;
  }
}

const opinion = ref('');

async function runAction(action: () => Promise<unknown>, successText: string): Promise<void> {
  if (busy.value || !view.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    await action();
    antMessage.success(successText);
    view.value = await getGateReview(view.value.gateId);
  } catch (cause) {
    actionError.value = ipdErrorText(cause, { fallback: '操作失败，请稍后重试' });
  } finally {
    busy.value = false;
  }
}

function doSign(decision: GateDecision): void {
  if (!view.value) return;
  void runAction(
    () => signGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '已签署通过' : '已驳回，Gate 进入 REJECTED 终态',
  );
}

function doReopen(): void {
  if (!view.value) return;
  void runAction(() => reopenGate(view.value!.gateId), '已发起新一轮评审（round+1）');
}

function doExtend(days: number): void {
  if (!view.value) return;
  void runAction(() => extendGateDeadline(view.value!.gateId, days), `签署期限已延长 ${days} 天`);
}

function doArbitrate(decision: GateDecision): void {
  if (!view.value) return;
  void runAction(
    () => arbitrateGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '仲裁同意已提交' : '仲裁驳回已提交',
  );
}

function doFinalRuling(decision: GateDecision): void {
  if (!view.value) return;
  void runAction(
    () => finalRulingGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '终裁通过已锁定' : '终裁驳回已锁定',
  );
}

function doRefresh(): void {
  void loadView();
  void loadList();
}

/** 触发按钮 → 对应 API 调用（统一入口）。 */
function invokeButton(button: GateDetailRowButton): void {
  switch (button) {
    case 'signApprove':
      doSign('APPROVE');
      return;
    case 'signReject':
      doSign('REJECT');
      return;
    case 'reopen':
      doReopen();
      return;
    case 'extend':
      doExtend(7);
      return;
    case 'arbitrateApprove':
      doArbitrate('APPROVE');
      return;
    case 'arbitrateReject':
      doArbitrate('REJECT');
      return;
    case 'finalRulingApprove':
      doFinalRuling('APPROVE');
      return;
    case 'finalRulingReject':
      doFinalRuling('REJECT');
      return;
    case 'refresh':
      doRefresh();
      return;
  }
}

/** 高危按钮的二次确认文案（避免误触）。 */
function confirmText(button: GateDetailRowButton): string {
  const code = view.value?.gateCode ?? '';
  switch (button) {
    case 'signApprove':
      return `确认签署通过 ${code}？每方每轮一条，任一 REJECT ⇒ Gate REJECTED。`;
    case 'signReject':
      return `确认驳回 ${code}？驳回后须走 reopen 流程（round+1）。`;
    case 'reopen':
      return `确认对 ${code} 发起新一轮评审？第 3 轮起组长自动列席。`;
    case 'extend':
      return '确认延长签署期限 7 天？最多 3 次延期（AC-GATE-21）。';
    case 'arbitrateApprove':
      return `确认仲裁同意 ${code}？（组长权限）`;
    case 'arbitrateReject':
      return `确认仲裁驳回 ${code}？（组长权限）`;
    case 'finalRulingApprove':
      return `确认终裁通过 ${code}？（超管权限，写入项目审计日志）`;
    case 'finalRulingReject':
      return `确认终裁驳回 ${code}？（超管权限，写入项目审计日志）`;
    case 'refresh':
      return '';
  }
}

/** 是否需要高危二次确认（sign/reopen/extend/arbitrate/finalRuling）。 */
function needsConfirm(button: GateDetailRowButton): boolean {
  return button !== 'refresh';
}

const listColumns = [
  { title: 'Gate 编号', dataIndex: 'gateCode', key: 'gateCode', width: 140 },
  { title: '状态', key: 'status', width: 110 },
  { title: '轮次', key: 'currentRound', width: 70 },
  { title: '签署期限', key: 'signDueAt', width: 170 },
  { title: '完结时间', key: 'concludedAt', width: 170 },
  { title: '打开', key: 'open', width: 90 },
];

function fmtDate(value: null | number | string | undefined): string {
  return formatDateTime(value, '—');
}

void decisionText; // 保留函数供潜在扩展（如详情对话框），避免未用警告
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      :message="`Gate 评审详情页（R177-A6 接入 button-policy）。项目 ${projectId || '尚未选择'} · 评审数据 GET /gates/{gateId}/review · 操作按钮按 4 状态 × 9 按钮决策矩阵渲染（v-access:code + button-policy 双闸门禁）。`"
      show-icon
      type="info"
    />

    <Card title="Gate 元信息（来自项目维度列表 + 评审视图）">
      <Spin :spinning="listLoading || viewLoading">
        <Empty
          v-if="!projectId"
          description="缺少 projectId（请通过 ?projectId=X&gateId=Y 进入，或从项目空间 → Gate 评审跳转）"
        />
        <Descriptions v-else bordered :column="2" size="small">
          <DescriptionsItem label="项目编号">{{ projectId }}</DescriptionsItem>
          <DescriptionsItem label="Gate 编号">
            <Tag :color="GATE_STATUS_COLOR[currentStatus]">{{ GATE_STATUS_LABEL[currentStatus] }}</Tag>
            <strong>{{ ((view?.gateCode ?? currentListItem?.gateCode ?? activeGateId) || '尚未选择') }}</strong>
          </DescriptionsItem>
          <DescriptionsItem label="评审轮次">第 {{ view?.round ?? '—' }} 轮</DescriptionsItem>
          <DescriptionsItem label="双签/主导方">
            {{ view?.dualSign ? '双PM盲签' : `主导方：${reviewerName(view?.leadSide ?? '')}` }}
          </DescriptionsItem>
          <DescriptionsItem label="签署期限">{{ fmtDate(view?.signDueAt ?? currentListItem?.signDueAt) }}</DescriptionsItem>
          <DescriptionsItem label="延期次数">{{ view?.extensionCount ?? 0 }} / 3</DescriptionsItem>
          <DescriptionsItem v-if="view?.observers?.length" label="第 3 轮起列席" :span="2">
            {{ view.observers.map((o) => o.name).join('、') }}
          </DescriptionsItem>
        </Descriptions>
      </Spin>
    </Card>

    <Card title="评审动作（button-policy 决策矩阵 + 权限码双闸）">
      <div v-if="viewError" class="mb-3">
        <Alert :message="viewError" show-icon type="error" />
      </div>
      <div v-if="actionError" class="mb-3">
        <Alert :message="actionError" show-icon type="error" />
      </div>

      <Spin :spinning="viewLoading">
        <Empty v-if="!view" description="尚未加载 Gate 评审视图（无 activeGateId 或后端无数据）" />
        <template v-else>
          <div class="mb-3">
            <span class="text-muted-foreground">我的意见（签署/仲裁/终裁时随单提交，可空）：</span>
            <Input v-model:value="opinion" :maxlength="1000" placeholder="例如：材料齐全、决策通过 / 请补充市场数据再决议" />
          </div>
          <Space :size="6" wrap>
            <template v-for="button in ROW_BUTTON_ORDER" :key="button">
              <Tooltip v-if="!buttonVisible(button)" :title="buttonReason(button)">
                <Button :disabled="true" size="small" style="opacity: 0.5; cursor: not-allowed;">
                  {{ ROW_BUTTON_LABEL[button] }}
                </Button>
              </Tooltip>
              <Popconfirm
                v-else-if="needsConfirm(button)"
                :title="confirmText(button)"
                @confirm="invokeButton(button)"
              >
                <Button
                  v-access:code="permissionFor(button)"
                  size="small"
                  :danger="button === 'signReject' || button === 'finalRulingReject' || button === 'arbitrateReject'"
                  :type="button === 'signApprove' || button === 'finalRulingApprove' ? 'primary' : 'default'"
                >
                  {{ ROW_BUTTON_LABEL[button] }}
                </Button>
              </Popconfirm>
              <Button
                v-else
                v-access:code="permissionFor(button)"
                size="small"
                @click="invokeButton(button)"
              >
                {{ ROW_BUTTON_LABEL[button] }}
              </Button>
            </template>
          </Space>
          <div class="mt-2 text-xs text-muted-foreground">
            <span>隐藏按钮（灰色）当前状态不可用，hover 查看原因；显示按钮仍受 v-access:code 权限闸门控制（无权限直接不渲染）</span>
          </div>
        </template>
      </Spin>
    </Card>

    <Card title="列席人员与意见（MEDIUM-1.3 · GET /gates/{gateId}/observers）">
      <template #extra>
        <Button
          v-if="canManageObservers && activeGateId"
          v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_LIST"
          size="small"
          :loading="observersLoading"
          @click="loadObservers"
        >
          刷新列席名单
        </Button>
      </template>

      <div v-if="observersError" class="mb-3">
        <Alert :message="observersError" show-icon type="error" />
      </div>

      <template v-if="!canManageObservers">
        <Empty description="列席名单仅组长/超管可查（后端 GateReviewService 权限语义）；列席人本人可在下方被邀约行的操作位提交意见" />
      </template>
      <template v-else>
        <div v-if="!activeGateId" class="mb-3">
          <Empty description="缺少 gateId：请先在下方列表选择或手输 Gate 编号" />
        </div>
        <template v-else>
          <!-- 邀约列席：后端无人员列表端点，personId 手输（逗号分隔）；role 白名单 5 类 -->
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <Input
              v-model:value="inviteObserverIdsText"
              placeholder="列席人 personId（数字，多个用逗号分隔）"
              style="width: 320px"
              :maxlength="200"
            />
            <Select
              v-model:value="inviteRole"
              :options="[...GATE_OBSERVER_ROLE_OPTIONS]"
              style="width: 110px"
            />
            <Popconfirm
              title="确认邀约所选人员列席本 Gate 评审？（将发送知会通知）"
              @confirm="doInviteObservers"
            >
              <Button
                v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_APPROVE"
                size="small"
                type="primary"
                :disabled="observerBusy || !parseObserverIds().length"
              >
                邀约列席
              </Button>
            </Popconfirm>
            <span class="text-xs text-muted-foreground">邀请后审计留痕并知会被邀请人；重复邀请幂等不报错</span>
          </div>

          <Table
            :columns="observerColumns"
            :data-source="observers"
            :loading="observersLoading"
            :pagination="false"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'role'">
                <Tag>{{ observerRoleLabel(String(record.role)) }}</Tag>
              </template>
              <template v-else-if="column.key === 'attended'">
                <Tag :color="record.attended ? 'success' : 'default'">{{ record.attended ? '已出席' : '未出席' }}</Tag>
              </template>
              <template v-else-if="column.key === 'opinion'">
                <span v-if="record.opinion">{{ record.opinion }}</span>
                <span v-else class="text-muted-foreground">未提交</span>
              </template>
              <template v-else-if="column.key === 'invitedAt'">{{ fmtDate(record.invitedAt) }}</template>
              <template v-else-if="column.key === 'opinionAction'">
                <!-- 仅 observer 本人可提交意见（后端 recordOpinion 断言 actor.id == observerId） -->
                <Space v-if="String(record.observerId) === myPersonId" :size="6" wrap>
                  <Input
                    v-model:value="opinionDrafts[String(record.observerId)]"
                    placeholder="我的列席意见（1~2000 字）"
                    size="small"
                    style="width: 180px"
                    :maxlength="2000"
                  />
                  <Button
                    size="small"
                    :disabled="observerBusy"
                    @click="submitOpinionFromRow(record)"
                  >
                    提交意见
                  </Button>
                </Space>
                <span v-else class="text-xs text-muted-foreground">仅列席人本人可提交</span>
              </template>
            </template>
          </Table>
          <div class="mt-2 text-xs text-muted-foreground">
            列席意见不入主审投票（不动 gate_reviews）；邀约/名单查询权限码走 GATE_REVIEW_APPROVE / GATE_REVIEW_LIST 双闸
          </div>
        </template>
      </template>
    </Card>

    <Card title="条件遗留清单（AC-GATE-17 · GET /gates/{gateId}/legacy）">
      <template #extra>
        <Button
          v-if="activeGateId"
          v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_LIST"
          size="small"
          :loading="legacyLoading"
          @click="loadLegacy"
        >
          {{ legacyLoadedOnce ? '刷新遗留清单' : '加载遗留清单' }}
        </Button>
      </template>

      <div v-if="legacyError" class="mb-3">
        <Alert :message="legacyError" show-icon type="error" />
      </div>

      <Empty
        v-if="!activeGateId"
        description="缺少 gateId：请先在下方列表选择或手输 Gate 编号"
      />
      <Table
        v-else-if="legacyLoadedOnce || legacyLoading"
        :columns="legacyColumns"
        :data-source="legacyItems"
        :loading="legacyLoading"
        :pagination="false"
        row-key="resultId"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'element'">
            <span>{{ record.elementCode }} · {{ record.elementName }}</span>
          </template>
          <template v-else-if="column.key === 'leftoverStatus'">
            <Tag :color="record.leftoverStatus === 'CLOSED' ? 'success' : 'processing'">
              {{ LEFTOVER_STATUS_LABEL[String(record.leftoverStatus)] ?? String(record.leftoverStatus) }}
            </Tag>
            <Tag v-if="record.overdue" color="error">已逾期</Tag>
          </template>
          <template v-else-if="column.key === 'leftoverDueAt'">{{ fmtDate(record.leftoverDueAt) }}</template>
        </template>
      </Table>
      <Empty
        v-else
        description="条件通过项的遗留跟踪视图：点击右上角「加载遗留清单」拉取（要素停用/删除不消除遗留）"
      />
      <div v-if="legacyLoadedOnce && legacyItems.length === 0 && !legacyLoading" class="mt-2 text-xs text-muted-foreground">
        当前 Gate 无条件遗留项（PASS_WITH_CONDITION 关闭后仍可在本清单查看 CLOSED 记录）
      </div>
    </Card>

    <Card title="项目维度 Gate 列表（GET /projects/{id}/gates）">
      <Empty :description="listError || (projectId ? '该列表用于跨 Gate 跳转（点击「打开」即填到 activeGateId）' : '缺少 projectId')" />
      <Table
        v-if="projectId"
        :columns="listColumns"
        :data-source="gateList"
        :loading="listLoading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <Tag :color="GATE_STATUS_COLOR[toGateStatus(String(record.status))]">
              {{ GATE_STATUS_LABEL[toGateStatus(String(record.status))] }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'currentRound'">{{ record.currentRound ?? '—' }}</template>
          <template v-else-if="column.key === 'signDueAt'">{{ fmtDate(record.signDueAt) }}</template>
          <template v-else-if="column.key === 'concludedAt'">{{ fmtDate(record.concludedAt) }}</template>
          <template v-else-if="column.key === 'open'">
            <Button size="small" type="link" @click="manualGateId = String(record.id ?? '')">打开</Button>
          </template>
        </template>
      </Table>
      <div v-if="projectId" class="mt-3">
        <span class="text-muted-foreground text-xs">手输 Gate 编号（兜底定位，绕过列表）：</span>
        <Input v-model:value="manualGateId" :maxlength="20" placeholder="Gate 编号（纯数字 ID）" style="width: 220px; margin-left: 8px" />
      </div>
    </Card>
  </div>
</template>
