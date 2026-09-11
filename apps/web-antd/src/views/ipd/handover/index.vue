<!--
  项目移交页（原型 /handoffs HandoffWorkbench + /admin 交接区复刻 + 后端契约适配）—— P2-7.1~7.3

  一比一部分：Frame「项目移交」标题/副标题语义、handoff-inbox 双栏（待我接收 +
  我发起的）、详情头（项目/角色/from → to + 状态 pill）、发起表单语义、
  批量移交逐项目结果、超管交接（确认短语「确认移交管理员」）。

  必要适配（原型 /api/handoffs 与后端 /api/v1/handovers 不同构，逐条登记）：
  1. 原型 preview（未完成动作/项目资料/待决确认/AI 会话四卡）与 approvals 责任确认链、
     product-continuation、handoff-candidates 后端未交付：不渲染假数据，
     接收即原子完成（POST /{id}/accept，DRAFT→COMPLETED）；已生效移交撤销已由
     POST /{id}/cancel 交付（HIGH-3.1，R30 接线：COMPLETED 详情区撤销表单，
     reason + 确认短语「确认撤销该移交」双门控，24h 窗口后端校验）。
  2. 接任人候选改用真实 GET /pm-directory（在职目录，按角色 personType 过滤）。
  3. 原型批量任务单（/api/handoff-batches）为实体流程；后端 /handovers/batch 一次
     提交返回逐项目结果（失败保持原归属），按结果列表渲染。
  4. 原型超管交接需 currentPassword；后端 /handovers/super-admin 用 confirmation
     确认短语（输入「确认移交管理员」）+ 强制审计，无密码复核，按后端契约渲染。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { message } from 'ant-design-vue';
import { SendOutlined, SwapOutlined, UserSwitchOutlined } from '@ant-design/icons-vue';

import { useIpdAuthStore } from '../../../store/ipd-auth';
import { formatDateTime } from '../_shared/format';
import { ipdErrorText } from '../_shared/ipd-error-text';
import {
  acceptHandover,
  batchHandover,
  cancelHandover,
  getHandoverInbox,
  getPmDirectory,
  HANDOVER_CANCEL_CONFIRM_PHRASE,
  initiateHandover,
  transferSuperAdmin,
  type HandoverBatchResult,
  type HandoverRole,
  type HandoverView,
  type PmDirectoryEntry,
} from '../../../api/ipd/handover';
import { listProjects, type Project } from '../../../api/ipd/project';

const auth = useIpdAuthStore();
const meId = computed(() => auth.identity?.person.id ?? '');
const isLeader = computed(() =>
  ['GROUP_LEADER', 'SUPER_ADMIN'].includes(auth.identity?.person.personType ?? ''),
);
const isSuperAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');

const loading = ref(false);
const loadError = ref('');
const inbox = ref<HandoverView[]>([]);
const directory = ref<PmDirectoryEntry[]>([]);
const projects = ref<Project[]>([]);
const selectedId = ref('');
const nameOf = (id: string) => directory.value.find((entry) => entry.id === id)?.name ?? `人员${id}`;

/**
 * 「待我接收」= 收件人是我 + 状态 DRAFT（待办；COMPLETED 已落幕）。
 * 「我发起的」= 我作为发起人的全部移交（DRAFT/已生效统一展示，列表即为历史视图）。
 *   显式枚举状态而非不过滤，避免后端 inbox 增量返回含意外状态时把噪音混进历史。
 */
const HANDOFF_INBOUND_STATUSES = ['DRAFT'] as const;
const HANDOFF_INITIATED_STATUSES = ['DRAFT', 'COMPLETED'] as const;
const received = computed(() =>
  inbox.value.filter(
    (item) => item.toPersonId === meId.value && (HANDOFF_INBOUND_STATUSES as readonly string[]).includes(item.status),
  ),
);
const initiated = computed(() =>
  inbox.value.filter(
    (item) => item.fromPersonId === meId.value && (HANDOFF_INITIATED_STATUSES as readonly string[]).includes(item.status),
  ),
);
const selected = computed(() => inbox.value.find((item) => item.id === selectedId.value) ?? null);
const canAccept = computed(
  () => selected.value?.status === 'DRAFT' && selected.value.toPersonId === meId.value,
);
const roleText: Record<string, string> = { MARKET_PM: '市场PM', RD_PM: '研发PM' };
const statusText: Record<string, string> = { COMPLETED: '已生效', DRAFT: '待接收', ROLLED_BACK: '已撤销' };

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [box, dir] = await Promise.all([getHandoverInbox(), getPmDirectory()]);
    inbox.value = box;
    directory.value = dir.directory;
    if (!selectedId.value) selectedId.value = received.value[0]?.id ?? initiated.value[0]?.id ?? '';
  } catch (cause) {
    loadError.value = ipdErrorText(cause, { fallback: '移交收件箱加载失败，请稍后重试' });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  try {
    projects.value = await listProjects();
  } catch { /* 发起表单的项目候选加载失败不阻断收件箱 */ }
});

/**
 * HandoverRole → 接任人 personType 一致性映射（HandoverService.HANDOVER_ROLES：
 * 接任人 personType 必须与 role 完全一致，否则后端拒收）。
 * 此处同时用于前端候选过滤与发起前的客户端二次断言，避免目录快照陈旧时漏判。
 */
const ROLE_TO_PERSON_TYPE: Record<HandoverRole, string> = {
  MARKET_PM: 'MARKET_PM',
  RD_PM: 'RD_PM',
};

const personTypeForRole = (value: HandoverRole): string => ROLE_TO_PERSON_TYPE[value];

/** —— 发起移交（单项目） —— */
const projectId = ref('');
const role = ref<HandoverRole>('MARKET_PM');
const toPersonId = ref('');
const note = ref('请接收项目、未完成责任、资料与完整决策历史。');
const approvalRef = ref('');
const initiating = ref(false);
const candidates = computed(() =>
  directory.value.filter(
    (entry) => entry.personType === role.value && entry.id !== meId.value,
  ),
);

async function submitInitiate(): Promise<void> {
  if (!projectId.value || !toPersonId.value || initiating.value) return;
  initiating.value = true;
  try {
    // Bug 4: 客户端二次断言接任人 personType 与 role 一致；快照陈旧时也绝不漏判
    const successor = directory.value.find((entry) => entry.id === toPersonId.value);
    if (!successor) {
      throw new Error('所选接任人不在当前在职目录中，请刷新后重选');
    }
    const expected = personTypeForRole(role.value);
    if (successor.personType !== expected) {
      throw new Error(
        `接任人角色类型不匹配：role=${role.value} 要求 personType=${expected}，实际 ${successor.personType}`,
      );
    }
    await initiateHandover({
      approvalRef: approvalRef.value.trim() || undefined,
      note: note.value.trim() || undefined,
      projectId: projectId.value,
      role: role.value,
      toPersonId: toPersonId.value,
    });
    message.success('移交已发起，接任人收件箱已收到任务');
    await load();
  } catch (cause) {
    message.error(
      cause instanceof Error ? cause.message : ipdErrorText(cause, { fallback: '发起失败，请稍后重试' }),
    );
  } finally {
    initiating.value = false;
  }
}

/** —— 接收 —— */
const accepting = ref(false);
const acceptRef = ref('');
async function accept(): Promise<void> {
  if (!selected.value || accepting.value) return;
  accepting.value = true;
  try {
    await acceptHandover(selected.value.id, acceptRef.value.trim() || undefined);
    message.success('已确认接收，项目责任已原子转移到你名下');
    acceptRef.value = '';
    await load();
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '接收失败，请稍后重试' }));
  } finally {
    accepting.value = false;
  }
}

/**
 * —— 撤销已生效移交（HIGH-3.1：COMPLETED → ROLLED_BACK） ——
 * 24h 窗口/权限（发起人、接手人、项目组长、超管）均由后端校验并报错；
 * 前端仅做短语+原因双门控防误触，不在客户端预判窗口时间。
 */
const cancelReason = ref('');
const cancelConfirmation = ref('');
const cancelling = ref(false);
async function submitCancel(): Promise<void> {
  if (!selected.value || cancelling.value) return;
  cancelling.value = true;
  try {
    await cancelHandover(selected.value.id, {
      confirmation: cancelConfirmation.value,
      reason: cancelReason.value.trim(),
    });
    message.success('移交已撤销，项目责任已反转回原归属');
    cancelReason.value = '';
    cancelConfirmation.value = '';
    selectedId.value = '';
    await load();
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '撤销失败，请稍后重试' }));
  } finally {
    cancelling.value = false;
  }
}

/** —— 批量移交（组长/超管；原型 /api/handoff-batches 的后端等价能力） —— */
const batchFrom = ref('');
const batchRole = ref<HandoverRole>('MARKET_PM');
const batchTo = ref('');
const batchNote = ref('');
const batchProjects = ref('');
const batchApprovalRef = ref('');
const batchBusy = ref(false);
const batchResults = ref<HandoverBatchResult[]>([]);
const batchCandidates = computed(
  () =>
    directory.value.filter(
      (entry) => entry.personType === batchRole.value && entry.id !== meId.value,
    ),
);
async function submitBatch(): Promise<void> {
  if (!batchFrom.value || !batchTo.value || batchBusy.value) return;
  batchBusy.value = true;
  try {
    const ids = batchProjects.value.split(/[,,\s]+/).filter(Boolean);
    batchResults.value = await batchHandover({
      approvalRef: batchApprovalRef.value.trim() || undefined,
      fromPersonId: batchFrom.value,
      note: batchNote.value.trim() || undefined,
      projectIds: ids.length ? ids : undefined,
      role: batchRole.value,
      toPersonId: batchTo.value,
    });
    message.success(`批量移交完成：${batchResults.value.filter((r) => r.status === 'COMPLETED').length} 项成功`);
    await load();
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '批量移交失败，请稍后重试' }));
  } finally {
    batchBusy.value = false;
  }
}

/** —— 超管权限移交（P2-7.3，页49 原型确认短语） —— */
const adminTo = ref('');
const adminConfirmation = ref('');
const adminBusy = ref(false);
const adminCandidates = computed(
  () => directory.value.filter((entry) => entry.personType === 'GROUP_LEADER'),
);
async function submitAdminTransfer(): Promise<void> {
  if (!adminTo.value || adminBusy.value) return;
  adminBusy.value = true;
  try {
    await transferSuperAdmin({
      confirmation: adminConfirmation.value,
      note: '超管权限移交（页49 原型：高风险操作，交接对象为产品组长）',
      toPersonId: adminTo.value,
    });
    message.success('超级管理员已移交，请使用新身份重新登录');
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '移交失败，请稍后重试' }));
  } finally {
    adminBusy.value = false;
  }
}
</script>

<template>
  <div class="handover-page">
    <header class="page-heading">
      <div>
        <h1>项目移交</h1>
        <p>
          独立收件箱不依赖接任人原有项目权限；接收后原子转移未完成市场责任，研发责任与历史保持不变。
        </p>
      </div>
    </header>

    <div v-if="loadError" class="handover-error">{{ loadError }}</div>

    <div class="handover-inbox-grid">
      <section class="surface handover-inbox">
        <div class="section-title">
          <h2>待我接收</h2>
          <span>{{ received.length }} 项</span>
        </div>
        <button
          v-for="item in received"
          :key="item.id"
          class="inbox-item"
          :class="{ active: selectedId === item.id }"
          type="button"
          @click="selectedId = item.id"
        >
          <UserSwitchOutlined />
          <span>
            <strong>项目 {{ item.projectId }} · {{ roleText[item.handoverRole] ?? item.handoverRole }}</strong>
            <small>{{ nameOf(item.fromPersonId) }} → {{ nameOf(item.toPersonId) }}</small>
          </span>
          <i class="status-pill draft">待接收</i>
        </button>
        <div v-if="!received.length" class="inbox-blank">暂无待接收移交，指定给你的移交会直接出现在这里。</div>
        <div class="section-title second">
          <h2>我发起的</h2>
          <span>{{ initiated.length }} 项</span>
        </div>
        <button
          v-for="item in initiated"
          :key="item.id"
          class="inbox-item"
          :class="{ active: selectedId === item.id }"
          type="button"
          @click="selectedId = item.id"
        >
          <SendOutlined />
          <span>
            <strong>项目 {{ item.projectId }} · {{ roleText[item.handoverRole] ?? item.handoverRole }}</strong>
            <small>接任 {{ nameOf(item.toPersonId) }}</small>
          </span>
          <i class="status-pill" :class="item.status.toLowerCase()">{{ statusText[item.status] ?? item.status }}</i>
        </button>
        <div v-if="!initiated.length" class="inbox-blank">尚未发起移交。</div>
      </section>

      <section class="surface handover-detail">
        <template v-if="selected">
          <div class="detail-head">
            <span class="detail-icon"><SwapOutlined /></span>
            <div>
              <i>项目 {{ selected.projectId }}</i>
              <h2>{{ roleText[selected.handoverRole] ?? selected.handoverRole }}责任移交</h2>
              <p>{{ nameOf(selected.fromPersonId) }} → {{ nameOf(selected.toPersonId) }}</p>
            </div>
            <i class="status-pill" :class="selected.status.toLowerCase()">
              {{ statusText[selected.status] ?? selected.status }}
            </i>
          </div>
          <p v-if="selected.note" class="detail-note">{{ selected.note }}</p>
          <div class="detail-meta">
            <span>发起确认：{{ formatDateTime(selected.confirmedAt) }}</span>
            <span>完成时间：{{ formatDateTime(selected.completedAt) }}</span>
          </div>
          <div v-if="canAccept" class="accept-row">
            <input v-model="acceptRef" placeholder="备案号（接任后达项目数上限时必填，AC-TEAM-11）" />
            <button :disabled="accepting" class="primary-button" type="button" @click="accept">
              <UserSwitchOutlined />
              确认接收项目
            </button>
          </div>
          <p v-else-if="selected.status === 'DRAFT'" class="detail-waiting">
            移交已发起，等待 {{ nameOf(selected.toPersonId) }} 登录确认。
          </p>
          <div v-if="selected.status === 'COMPLETED'" class="cancel-block">
            <p class="cancel-hint">
              已生效移交在完成后 24 小时内可撤销（发起人 / 接手人 / 项目组长 / 超管），撤销会把项目责任反转回原归属。
            </p>
            <div class="cancel-row">
              <input v-model="cancelReason" placeholder="撤销原因（必填）" />
              <input v-model="cancelConfirmation" :placeholder="`输入：${HANDOVER_CANCEL_CONFIRM_PHRASE}`" />
              <button
                :disabled="!cancelReason.trim() || cancelConfirmation !== HANDOVER_CANCEL_CONFIRM_PHRASE || cancelling"
                class="primary-button danger-action"
                type="button"
                @click="submitCancel"
              >
                撤销移交
              </button>
            </div>
          </div>
        </template>
        <div v-else class="empty-state">
          <div><SwapOutlined /></div>
          <strong>未选择移交</strong>
          <p>从左侧收件箱选择一条移交查看详情并办理。</p>
        </div>
      </section>
    </div>

    <section class="surface create-section">
      <div class="section-title">
        <div>
          <h2>发起移交</h2>
          <p>接任人须与移交角色同类型（市场PM/研发PM）；组长与超管可代办离职/冻结人员移交。</p>
        </div>
      </div>
      <div class="create-form">
        <label>
          项目
          <select v-model="projectId">
            <option disabled value="">选择项目</option>
            <option v-for="item in projects" :key="item.id" :value="item.id">{{ item.name }} · {{ item.code }}</option>
          </select>
        </label>
        <label>
          移交角色
          <select v-model="role">
            <option value="MARKET_PM">市场PM</option>
            <option value="RD_PM">研发PM</option>
          </select>
        </label>
        <label>
          接任人
          <select v-model="toPersonId">
            <option disabled value="">选择接任人</option>
            <option v-for="entry in candidates" :key="entry.id" :value="entry.id">
              {{ entry.name }}{{ entry.groupName ? ` · ${entry.groupName}` : '' }}
            </option>
          </select>
        </label>
        <label>
          备案号（可选）
          <input v-model="approvalRef" placeholder="接任后达项目数上限时必填" />
        </label>
        <label class="wide">
          交接说明
          <input v-model="note" />
        </label>
        <button :disabled="!projectId || !toPersonId || initiating" class="primary-button" type="button" @click="submitInitiate">
          <SendOutlined />
          发起移交
        </button>
      </div>
    </section>

    <template v-if="isLeader">
      <section class="surface batch-section">
        <div class="section-title">
          <div>
            <h2>批量移交</h2>
            <p>项目编号留空 = 原负责人名下该角色全部活跃项目；失败项保持原归属，重试自动跳过已成功项。</p>
          </div>
        </div>
        <div class="create-form">
          <label>
            原负责人
            <select v-model="batchFrom">
              <option disabled value="">选择原负责人</option>
              <option v-for="entry in directory" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
            </select>
          </label>
          <label>
            移交角色
            <select v-model="batchRole">
              <option value="MARKET_PM">市场PM</option>
              <option value="RD_PM">研发PM</option>
            </select>
          </label>
          <label>
            接任人
            <select v-model="batchTo">
              <option disabled value="">选择接任人</option>
              <option v-for="entry in batchCandidates" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
            </select>
          </label>
          <label>
            项目编号（可选）
            <input v-model="batchProjects" placeholder="逗号分隔；留空=全部活跃项目" />
          </label>
          <label>
            统一备案号
            <input v-model="batchApprovalRef" />
          </label>
          <label class="wide">
            统一交接说明
            <input v-model="batchNote" placeholder="本批移交的总体说明（与单项目发起表单相互独立）" />
          </label>
          <button :disabled="!batchFrom || !batchTo || batchBusy" class="primary-button" type="button" @click="submitBatch">
            批量移交
          </button>
        </div>
        <div v-if="batchResults.length" class="batch-results">
          <div v-for="result in batchResults" :key="result.projectId" class="batch-row">
            <span>项目 {{ result.projectId }}</span>
            <i class="status-pill" :class="result.status.toLowerCase()">{{ result.status }}</i>
            <small v-if="result.reason">{{ result.reason }}</small>
          </div>
        </div>
      </section>

      <section v-if="isSuperAdmin" class="surface admin-transfer">
        <div class="section-title">
          <div>
            <h2>更换超级管理员</h2>
            <p>高风险操作：交接对象须为产品组长；提交立即生效并写入不可覆盖审计。</p>
          </div>
          <span>仅超管本人可发起</span>
        </div>
        <div class="create-form">
          <label>
            新超级管理员
            <select v-model="adminTo">
              <option disabled value="">选择交接对象</option>
              <option v-for="entry in adminCandidates" :key="entry.id" :value="entry.id">
                {{ entry.name }}{{ entry.employeeNo ? ` · ${entry.employeeNo}` : '' }}
              </option>
            </select>
          </label>
          <label>
            确认短语
            <input v-model="adminConfirmation" placeholder="输入：确认移交管理员" />
          </label>
          <button
            :disabled="!adminTo || adminConfirmation !== '确认移交管理员' || adminBusy"
            class="primary-button danger-action"
            type="button"
            @click="submitAdminTransfer"
          >
            <UserSwitchOutlined />
            确认移交超级管理员
          </button>
        </div>
      </section>
    </template>

    <div class="handover-pending">
      原型移交范围预览（未完成动作/项目资料/待决确认/AI 会话四卡）、责任确认链、产品长期责任续交与候选端点后端未交付，维持真缺口登记；当前接收即按后端契约原子完成，已生效移交可在完成后 24 小时内撤销。
    </div>
  </div>
</template>

<style scoped>

/* V12-F3: 原 1100px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .handover-inbox-grid {
    grid-template-columns: 1fr;
  }

  .create-form {
    grid-template-columns: 1fr 1fr;
  }
}

.handover-page {
  max-width: 1600px;
  padding: 28px 32px 60px;
  margin: auto;
}

.page-heading {
  margin-bottom: 24px;
}

.page-heading h1 {
  margin: 0 0 8px;
  font-size: 25px;
  letter-spacing: -0.02em;
}

.page-heading p {
  margin: 0;
  font-size: 13px;
  color: var(--ipd-muted);
}

.handover-error {
  padding: 10px 12px;
  margin-bottom: 16px;
  font-size: 12px;
  color: #a8071a;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 6px;
}

.surface {
  background: white;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ipd-line);
}

.section-title.second {
  padding-top: 16px;
  margin-top: 8px;
  border-top: 1px solid var(--ipd-line);
  border-bottom: 0;
}

.section-title h2 {
  margin: 0;
  font-size: 15px;
}

.section-title p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--ipd-muted);
}

.section-title > span {
  font-size: 12px;
  color: var(--ipd-muted);
}

.primary-button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  font-weight: 700;
  color: white;
  white-space: nowrap;
  cursor: pointer;
  background: var(--ipd-blue);
  border: 0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}

.primary-button:hover {
  background: #1747d7;
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.danger-action {
  background: #b42318;
  box-shadow: 0 4px 12px rgb(180 35 24 / 20%);
}

.handover-inbox-grid {
  display: grid;
  grid-template-columns: 0.9fr 1.4fr;
  gap: 18px;
  margin-bottom: 18px;
}

.inbox-item {
  display: grid;
  grid-template-columns: 30px 1fr auto;
  gap: 10px;
  align-items: center;
  width: calc(100% - 40px);
  padding: 12px 0;
  margin: 0 20px;
  color: var(--ipd-text);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--ipd-line);
}

.inbox-item.active {
  background: #f5f8ff;
}

.inbox-item strong {
  display: block;
  font-size: 13px;
}

.inbox-item small {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ipd-muted);
}

.inbox-item > :deep(.anticon) {
  font-size: 16px;
  color: var(--ipd-blue);
}

.inbox-blank {
  padding: 18px 20px;
  font-size: 12px;
  color: var(--ipd-muted);
}

.status-pill {
  padding: 4px 8px;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  border-radius: 4px;
}

.status-pill.draft,
.status-pill.pending {
  color: var(--ipd-blue);
  background: #edf2ff;
}

.status-pill.completed {
  color: var(--ipd-green);
  background: #eaf7ed;
}

.status-pill.rolled_back {
  color: #6b7a90;
  background: #f1f3f7;
}

.detail-head {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ipd-line);
}

.detail-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  font-size: 20px;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 8px;
}

.detail-head i {
  font-size: 11px;
  font-style: normal;
  color: var(--ipd-muted);
}

.detail-head h2 {
  margin: 3px 0;
  font-size: 16px;
}

.detail-head p {
  margin: 0;
  font-size: 12px;
  color: var(--ipd-muted);
}

.detail-head .status-pill {
  margin-left: auto;
}

.detail-note {
  padding: 12px;
  margin: 14px 20px 0;
  font-size: 12px;
  color: #56647c;
  background: #f2f6ff;
  border-radius: 6px;
}

.detail-meta {
  display: flex;
  gap: 18px;
  padding: 12px 20px;
  font-size: 11px;
  color: var(--ipd-muted);
}

.accept-row {
  display: flex;
  gap: 10px;
  padding: 0 20px 18px;
}

.accept-row input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  color: var(--ipd-text);
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.cancel-block {
  padding: 0 20px 18px;
}

.cancel-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ipd-muted);
}

.cancel-row {
  display: flex;
  gap: 10px;
}

.cancel-row input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  color: var(--ipd-text);
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.detail-waiting {
  padding: 0 20px 18px;
  font-size: 12px;
  color: var(--ipd-muted);
}

.empty-state {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 200px;
  color: var(--ipd-muted);
  text-align: center;
}

.empty-state > div {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  font-size: 26px;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 50%;
}

.empty-state strong {
  margin: 12px 0 4px;
  color: var(--ipd-text);
}

.empty-state p {
  max-width: 340px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.create-section,
.batch-section,
.admin-transfer {
  margin-bottom: 18px;
}

.create-form {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  align-items: end;
  padding: 16px 20px 20px;
}

.create-form label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
}

.create-form label.wide {
  grid-column: span 2;
}

.create-form input,
.create-form select {
  height: 38px;
  padding: 0 10px;
  font-weight: 400;
  color: var(--ipd-text);
  background: white;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.batch-results {
  display: grid;
  gap: 8px;
  padding: 0 20px 16px;
}

.batch-row {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}

.batch-row small {
  color: #a8071a;
}

.handover-pending {
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7a90;
  background: #f6f8fb;
  border: 1px dashed #cfd9e5;
  border-radius: 6px;
}

/* 原型 styles.css 摘录；--blue/--line/--muted/--text/--green 映射为 --ipd-*。 */
</style>
