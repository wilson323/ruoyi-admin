<!--
  变更管理页（原型 /changes · ChangesPage 一比一复刻）—— 卡 ZK-D2 / 任务 p5（2026-09-06）

  一比一部分：页头（标题/副标题/发起变更按钮）、change-project-selector、metric-strip
  四格、business-list 变更申请单卡列表（change-card-head/change-impact/change-reason/
  decision-buttons）、需求变更链面板外壳与空态、发起变更自绘弹窗（modal-backdrop/
  create-modal/create-form/modal-actions）；CSS 取自原型 styles.css 原文（--ipd-* 映射）。

  契约适配（原型 /api/changes 与本仓 RequirementChange P2-6.1 不同构，逐条登记）：
  1. 原型审批链是「产品组长 + 超级管理员」双审批；本仓是 BR-GATE-07 双PM双签
     （signatures 聚合 MARKET_PM/RD_PM，单方 REJECT 即整体驳回，双 APPROVE 回写需求池）。
     状态机 DRAFT/PENDING_SIGN/APPROVED/REJECTED → pill 文案 草稿/待双签/已批准/已驳回。
  2. change-impact 四格：原型为 排期影响/成本影响/组长审批/超管审批；本仓无排期/成本字段，
     改为 变更前快照/变更后快照（有·无）/市场PM 签署/研发PM 签署（自 signatures 解析）。
  3. 原型卡头 code/title；本仓无编号字段 → 「变更单 #{id}」+ changeType 作标题位。
  4. 发起弹窗：原型 排期影响/成本影响 数字输入 → 本仓为四维度影响快照 JSON（before/after）；
     关联需求下拉接入 DemandController.list（按当前项目 productId 过滤），2026-09-07 修复。
  5. 决策按钮：DRAFT→提交双签；PENDING_SIGN→拒绝/同意签署（服务端校验 MARKET_PM/RD_PM）。
  6. 「需求变更五节点链」面板：本仓为双PM两节点模型，五节点协作链（/api/collaboration）
     后端未交付，按原型渲染外壳与空态并如实登记，不做假数据。
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { Alert, message } from 'ant-design-vue';
import {
  AimOutlined,
  CheckCircleFilled,
  CloseOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons-vue';

import {
  createRequirementChange,
  listRequirementChanges,
  signRequirementChange,
  submitRequirementChange,
  type RequirementChange,
} from '../../../api/ipd/change';
import { listProjects, type Project } from '../../../api/ipd/project';
import { fetchDemands, type IpdDemand } from '../../../api/ipd/demand';
import { ipdErrorText } from '../_shared/ipd-error-text';
import { changeStateLabel } from '../_shared/ipd-enums';

/** V6 系统漂移修复：状态机集中查表（_shared/ipd-state-machines.CHANGE_STATUS_MACHINE），
 *  本页仅留展示别名映射（CSS 类名 → tone）。 */
const STATUS_TEXT: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const code of ['DRAFT', 'PENDING_SIGN', 'APPROVED', 'REJECTED']) {
    const label = changeStateLabel(code, code);
    if (label !== code) map[code] = label;
  }
  return map;
})();
const STATUS_TONE: Record<string, string> = {
  APPROVED: 'approved',
  DRAFT: 'draft',
  PENDING_SIGN: 'pending',
  REJECTED: 'rejected',
};

/** 未知 status 兜底由模板内联承担：label 兜底原始 code（?? item.status）、tone 兜底空串（?? ''）。 */

const loading = ref(false);
const loadError = ref('');
const projects = ref<Project[]>([]);
const activeId = ref('');
const changes = ref<RequirementChange[]>([]);
const total = ref(0);
const modalOpen = ref(false);
const submitting = ref(false);
const createError = ref('');
const createForm = ref({ afterSnapshot: '', beforeSnapshot: '', changeType: '', reason: '', requirementId: '' });
const demands = ref<IpdDemand[]>([]);
const demandsLoading = ref(false);

const activeProject = computed(() => projects.value.find((project) => project.id === activeId.value) ?? null);
const countBy = (status: string) => changes.value.filter((item) => item.status === status).length;

/** signatures 形如 "MARKET_PM:12=APPROVE;RD_PM:34=REJECT"；同角色多签取最后一条。 */
function signatureOf(signatures: null | string, role: 'MARKET_PM' | 'RD_PM'): null | 'APPROVE' | 'REJECT' {
  if (!signatures) return null;
  let result: null | 'APPROVE' | 'REJECT' = null;
  for (const part of signatures.split(';')) {
    const match = new RegExp(`^${role}(:\\d+)?=(APPROVE|REJECT)$`).exec(part.trim());
    if (match) result = match[2] as 'APPROVE' | 'REJECT';
  }
  return result;
}
const signatureText = (value: null | 'APPROVE' | 'REJECT') =>
  value === 'APPROVE' ? '已同意' : value === 'REJECT' ? '已拒绝' : '待签';

async function loadChanges(): Promise<void> {
  if (!activeId.value) {
    changes.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    const page = await listRequirementChanges(activeId.value);
    changes.value = page.records;
    total.value = page.total;
  } catch (cause) {
    loadError.value = ipdErrorText(cause, { domain: 'project' });
  } finally {
    loading.value = false;
  }
}

/** 加载当前项目所属产品的需求列表（用于发起变更时的关联需求下拉）。 */
async function loadDemands(): Promise<void> {
  const productId = activeProject.value?.productId;
  if (!productId) {
    demands.value = [];
    return;
  }
  demandsLoading.value = true;
  try {
    const result = await fetchDemands({ productId });
    demands.value = result.demands;
  } catch {
    demands.value = [];
  } finally {
    demandsLoading.value = false;
  }
}

onMounted(async () => {
  try {
    projects.value = await listProjects();
    activeId.value = projects.value[0]?.id ?? '';
  } catch (cause) {
    loadError.value = ipdErrorText(cause, { domain: 'project' });
  }
  await Promise.all([loadChanges(), loadDemands()]);
});

watch(activeId, () => {
  void loadChanges();
  void loadDemands();
});

async function submitForSign(item: RequirementChange): Promise<void> {
  try {
    await submitRequirementChange(item.id);
    message.success('变更单已进入双签队列');
    await loadChanges();
  } catch (cause) {
    message.error(ipdErrorText(cause, { domain: 'project' }));
  }
}

async function sign(item: RequirementChange, decision: 'APPROVE' | 'REJECT'): Promise<void> {
  try {
    const updated = await signRequirementChange(item.id, decision);
    message.success(
      decision === 'REJECT'
        ? '已拒绝，变更单整体驳回'
        : updated.status === 'APPROVED'
          ? '双签通过，变更单生效并回写需求池'
          : '已同意，等待另一方PM签署',
    );
    await loadChanges();
  } catch (cause) {
    message.error(ipdErrorText(cause, { domain: 'project' }));
  }
}

function openModal(): void {
  createForm.value = { afterSnapshot: '', beforeSnapshot: '', changeType: '', reason: '', requirementId: '' };
  createError.value = '';
  modalOpen.value = true;
}

async function createChange(): Promise<void> {
  const form = createForm.value;
  if (!form.changeType.trim() || !form.reason.trim() || !form.requirementId.trim()) {
    createError.value = '变更类型、变更原因与关联需求 ID 均为必填。';
    return;
  }
  if (!/^\d+$/.test(form.requirementId.trim())) {
    createError.value = '关联需求 ID 必须为数字。';
    return;
  }
  submitting.value = true;
  createError.value = '';
  try {
    await createRequirementChange({
      afterSnapshot: form.afterSnapshot.trim() || null,
      beforeSnapshot: form.beforeSnapshot.trim() || null,
      changeType: form.changeType.trim(),
      projectId: activeId.value || null,
      reason: form.reason.trim(),
      requirementId: form.requirementId.trim(),
    });
    modalOpen.value = false;
    message.success('变更单草稿已创建，确认四维度快照后可提交双签');
    await loadChanges();
  } catch (cause) {
    createError.value = ipdErrorText(cause, { domain: 'project' });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="chg-page">
    <header class="page-heading">
      <div>
        <h1>变更管理</h1>
        <p>先选择变更项目，再加载该项目的变更单；双PM 双签通过后变更生效并回写需求池。</p>
      </div>
      <button class="primary-button" type="button" @click="openModal">
        <PlusOutlined />
        发起变更
      </button>
    </header>

    <div class="change-project-selector">
      <AimOutlined />
      <label>
        变更项目
        <select v-model="activeId">
          <option disabled value="">选择项目</option>
          <option v-for="item in projects" :key="item.id" :value="item.id">
            {{ item.name }} · {{ item.code }}
          </option>
        </select>
      </label>
      <span>已加载 {{ total }} 条变更单</span>
    </div>

    <Alert v-if="loadError" class="chg-alert" type="error" show-icon :message="loadError" />

    <div class="metric-strip requirement-metrics">
      <div class="metric">
        <span>全部变更</span>
        <strong>{{ total }}</strong>
        <small>保留完整决策记录</small>
      </div>
      <div class="metric warning">
        <span>待双签</span>
        <strong>{{ countBy('PENDING_SIGN') }}</strong>
        <small>市场PM + 研发PM</small>
      </div>
      <div class="metric">
        <span>已批准</span>
        <strong>{{ countBy('APPROVED') }}</strong>
        <small>进入版本执行</small>
      </div>
      <div class="metric">
        <span>已驳回</span>
        <strong>{{ countBy('REJECTED') }}</strong>
        <small>任一方否决即整体驳回</small>
      </div>
    </div>

    <section class="surface business-list">
      <div class="section-title">
        <h2>变更申请单 · {{ activeProject?.name ?? '—' }}</h2>
        <span>缺少任一签署均不得生效</span>
      </div>
      <div v-if="changes.length" class="change-cards">
        <article v-for="item in changes" :key="item.id">
          <div class="change-card-head">
            <div>
              <span>变更单 #{{ item.id }}</span>
              <h3>{{ item.changeType || '未命名变更' }}</h3>
              <p>关联需求 #{{ item.requirementId ?? '—' }}</p>
            </div>
            <i class="status-pill" :class="STATUS_TONE[item.status] ?? ''">
              {{ STATUS_TEXT[item.status] ?? item.status }}
            </i>
          </div>
          <div class="change-impact">
            <span>
              <small>变更前快照</small>
              <strong>{{ item.beforeSnapshot ? '已冻结' : '未填写' }}</strong>
            </span>
            <span>
              <small>变更后快照</small>
              <strong>{{ item.afterSnapshot ? '已冻结' : '未填写' }}</strong>
            </span>
            <span>
              <small>市场PM 签署</small>
              <strong>{{ signatureText(signatureOf(item.signatures, 'MARKET_PM')) }}</strong>
            </span>
            <span>
              <small>研发PM 签署</small>
              <strong>{{ signatureText(signatureOf(item.signatures, 'RD_PM')) }}</strong>
            </span>
          </div>
          <p class="change-reason"><strong>变更原因：</strong>{{ item.reason || '—' }}</p>
          <details v-if="item.beforeSnapshot || item.afterSnapshot" class="snapshot-details">
            <summary>变更影响快照（范围/成本/时限/质量四维度）</summary>
            <pre v-if="item.beforeSnapshot">变更前：{{ item.beforeSnapshot }}</pre>
            <pre v-if="item.afterSnapshot">变更后：{{ item.afterSnapshot }}</pre>
          </details>
          <div v-if="item.status === 'DRAFT' || item.status === 'PENDING_SIGN'" class="decision-buttons change-actions">
            <template v-if="item.status === 'DRAFT'">
              <button type="button" @click="submitForSign(item)">提交双签</button>
            </template>
            <template v-else>
              <button type="button" @click="sign(item, 'REJECT')">拒绝</button>
              <button type="button" @click="sign(item, 'APPROVE')">同意签署</button>
            </template>
          </div>
        </article>
      </div>
      <div v-else class="empty-state">
        <div><SyncOutlined /></div>
        <strong>暂无变更申请单</strong>
        <p>该项目尚未发起需求变更；点击右上角「发起变更」创建草稿。</p>
      </div>
    </section>

    <section class="surface decision-chain-panel">
      <div class="section-title">
        <h2>需求变更五节点链</h2>
        <span>市场PM → 研发PM → 市场组长 → 研发组长 → 超级管理员</span>
      </div>
      <div class="empty-state">
        <div><SyncOutlined /></div>
        <strong>暂无五节点决策</strong>
        <p>阶段或变更提交后，系统按顺序把任务投递给双PM、双组长和超级管理员。</p>
      </div>
      <div class="chg-pending">
        本仓变更模型为双PM双签两节点（BR-GATE-07，见上方卡片签署格）；五节点协作链
        （/api/collaboration）后端未交付，此处仅呈现原型结构，不做假数据。
      </div>
    </section>

    <div v-if="modalOpen" class="modal-backdrop" @click.self="modalOpen = false">
      <form class="create-modal wide-modal" @submit.prevent="createChange">
        <div class="modal-head">
          <div>
            <SyncOutlined />
            <span>
              <strong>发起需求变更</strong>
              <small>先锁定变更项目，再填写变更类型、原因与影响快照</small>
            </span>
          </div>
          <button type="button" @click="modalOpen = false"><CloseOutlined /></button>
        </div>
        <div class="create-form">
          <label>
            变更项目
            <select :value="activeId" disabled>
              <option v-if="activeProject">{{ activeProject.name }} · {{ activeProject.code }}</option>
              <option v-else value="">未选择项目</option>
            </select>
          </label>
          <label>
            关联需求
            <select v-model="createForm.requirementId" required :disabled="demandsLoading">
              <option value="" disabled>请选择需求（{{ demands.length }} 条）</option>
              <option v-for="d in demands" :key="d.id" :value="d.id">{{ d.title ?? '未命名需求' }} · #{{ d.id }}</option>
            </select>
          </label>
          <label>
            变更类型
            <input v-model="createForm.changeType" placeholder="如：功能范围调整 / 性能目标修订" required />
          </label>
          <label>
            变更原因
            <textarea v-model="createForm.reason" required rows="3" />
          </label>
          <div class="field-grid two">
            <label>
              变更前快照（JSON）
              <textarea v-model="createForm.beforeSnapshot" placeholder="范围/成本/时限/质量四维度，提交双签前必填" />
            </label>
            <label>
              变更后快照（JSON）
              <textarea v-model="createForm.afterSnapshot" placeholder="范围/成本/时限/质量四维度，提交双签前必填" />
            </label>
          </div>
          <div class="handoff-note">
            <CheckCircleFilled />
            前后快照可先留空创建草稿；提交双签前必须补齐（服务端强校验）。
          </div>
          <div v-if="createError" class="form-error" role="alert">{{ createError }}</div>
        </div>
        <div class="modal-actions">
          <button class="secondary-button" type="button" @click="modalOpen = false">取消</button>
          <button class="primary-button" :disabled="submitting" type="submit">
            {{ submitting ? '提交中…' : '创建变更草稿' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>

/* V12-F3: 原 900px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .metric-strip {
    grid-template-columns: 1fr 1fr;
  }

  .change-cards {
    grid-template-columns: 1fr;
  }

  .change-impact {
    grid-template-columns: 1fr 1fr;
  }

  .change-project-selector {
    flex-direction: column;
    align-items: flex-start;
  }

  .change-project-selector select {
    width: 100%;
    min-width: 0;
  }

  .field-grid.two {
    grid-template-columns: 1fr;
  }
}

.chg-page {
  max-width: 1600px;
  padding: 28px 32px 60px;
  margin: auto;
}

.page-heading {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  justify-content: space-between;
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

.primary-button,
.secondary-button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  border: 0;
  border-radius: 6px;
}

.primary-button {
  color: white;
  background: var(--ipd-blue);
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}

.primary-button:hover {
  background: #1747d7;
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.secondary-button {
  color: #465168;
  background: white;
  border: 1px solid #cdd4df;
}

.chg-alert {
  margin-bottom: 16px;
}

.change-project-selector {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  margin-bottom: 16px;
  background: #edf5ff;
  border: 1px solid #c9ddf6;
  border-radius: 10px;
}

.change-project-selector :deep(.anticon) {
  font-size: 17px;
  color: var(--ipd-blue);
}

.change-project-selector label {
  display: flex;
  gap: 10px;
  align-items: center;
  font-weight: 700;
}

.change-project-selector select {
  min-width: 330px;
  height: 38px;
  padding: 0 10px;
  color: var(--ipd-text);
  background: white;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.change-project-selector span {
  margin-left: auto;
  color: #587493;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}

.metric {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px 10px;
  padding: 17px 20px;
  background: white;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.metric > span {
  font-size: 12px;
  color: var(--ipd-muted);
}

.metric > strong {
  grid-row: 1 / 3;
  grid-column: 2;
  font-size: 25px;
}

.metric small {
  color: #8d96a6;
}

.metric.warning > strong {
  color: var(--ipd-amber);
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

.section-title h2 {
  margin: 0;
  font-size: 15px;
}

.section-title > span {
  font-size: 12px;
  color: var(--ipd-muted);
}

.business-list {
  overflow: hidden;
}

.change-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 16px;
}

.change-cards article {
  padding: 16px;
  background: white;
  border: 1px solid var(--ipd-line);
  border-radius: 7px;
}

.change-card-head {
  display: flex;
  gap: 14px;
  justify-content: space-between;
}

.change-card-head > div > span {
  font-size: 10px;
  font-weight: 750;
  color: var(--ipd-blue);
}

.change-card-head h3 {
  margin: 5px 0;
  font-size: 15px;
}

.change-card-head p {
  margin: 0;
  font-size: 10px;
  color: var(--ipd-muted);
}

.status-pill {
  display: inline-flex;
  width: fit-content;
  padding: 4px 7px;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  color: #58657b;
  white-space: nowrap;
  background: #eef1f5;
  border-radius: 4px;
}

.status-pill.pending {
  color: #9b6509;
  background: #fff4df;
}

.status-pill.approved {
  color: var(--ipd-green);
  background: #eaf7ed;
}

.status-pill.rejected {
  color: #a33c3c;
  background: #ffeded;
}

.change-impact {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  margin: 15px 0;
  overflow: hidden;
  background: var(--ipd-line);
  border: 1px solid var(--ipd-line);
  border-radius: 5px;
}

.change-impact span {
  display: grid;
  gap: 5px;
  padding: 9px;
  background: #f8f9fb;
}

.change-impact small {
  font-size: 9px;
  color: var(--ipd-muted);
}

.change-impact strong {
  font-size: 11px;
}

.change-reason {
  margin: 8px 0;
  font-size: 10px;
  line-height: 1.6;
  color: #5d687c;
}

.snapshot-details {
  margin: 8px 0 0;
  font-size: 11px;
  color: #68778a;
}

.snapshot-details summary {
  font-weight: 650;
  color: var(--ipd-blue);
  cursor: pointer;
}

.snapshot-details pre {
  padding: 9px 10px;
  margin: 8px 0 0;
  font-size: 10px;
  line-height: 1.6;
  color: #39465d;
  word-break: break-all;
  white-space: pre-wrap;
  background: #f7f8fa;
  border-radius: 6px;
}

.decision-buttons {
  display: flex;
  gap: 6px;
}

.decision-buttons button {
  height: 30px;
  padding: 0 11px;
  color: var(--ipd-text);
  cursor: pointer;
  background: white;
  border: 1px solid #cfd6e1;
  border-radius: 5px;
}

.decision-buttons button:last-child {
  color: white;
  background: var(--ipd-blue);
  border-color: var(--ipd-blue);
}

.change-actions {
  justify-content: flex-end;
  margin-top: 13px;
}

.decision-chain-panel {
  padding: 20px;
  margin-top: 18px;
}

.decision-chain-panel .section-title {
  padding: 0 0 14px;
}

.chg-pending {
  padding: 10px 12px;
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7a90;
  background: #f6f8fb;
  border: 1px dashed #cfd9e5;
  border-radius: 6px;
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
  font-size: 28px;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 50%;
}

.empty-state strong {
  margin: 12px 0 4px;
  color: var(--ipd-text);
}

.empty-state p {
  max-width: 380px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(7 20 38 / 56%);
}

.create-modal {
  width: min(560px, 100%);
  overflow: hidden;
  background: white;
  border-radius: 10px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 25%);
}

.wide-modal {
  width: min(700px, 100%);
}

.wide-modal .create-form {
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 22px;
  border-bottom: 1px solid var(--ipd-line);
}

.modal-head > div {
  display: flex;
  gap: 10px;
  align-items: center;
}

.modal-head :deep(.anticon) {
  font-size: 20px;
  color: var(--ipd-blue);
}

.modal-head span {
  display: grid;
  gap: 4px;
}

.modal-head small {
  color: var(--ipd-muted);
}

.modal-head button {
  cursor: pointer;
  background: transparent;
  border: 0;
}

.create-form {
  padding: 18px 22px;
}

.create-form label {
  display: grid;
  gap: 7px;
  margin-bottom: 15px;
  font-size: 12px;
  font-weight: 650;
  color: #4d586c;
}

.create-form input,
.create-form select {
  width: 100%;
  height: 40px;
  padding: 0 10px;
  color: var(--ipd-text);
  background: white;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.create-form textarea {
  width: 100%;
  min-height: 78px;
  padding: 9px 10px;
  font-family: inherit;
  line-height: 1.55;
  color: var(--ipd-text);
  resize: vertical;
  background: white;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.field-grid {
  display: grid;
  gap: 16px;
}

.field-grid.two {
  grid-template-columns: repeat(2, 1fr);
}

.handoff-note {
  display: flex;
  gap: 9px;
  align-items: center;
  padding: 12px;
  margin: 0 0 12px;
  font-size: 12px;
  color: #56647c;
  background: #f2f6ff;
  border-radius: 6px;
}

.handoff-note :deep(.anticon) {
  color: var(--ipd-green);
}

.form-error {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  font-size: 13px;
  color: #b43131;
  background: #fff1f1;
  border-radius: 6px;
}

.modal-actions {
  display: flex;
  gap: 9px;
  justify-content: flex-end;
  padding: 18px 20px;
  border-top: 1px solid var(--ipd-line);
}

/* 原型 styles.css 摘录；--blue/--line/--muted/--text/--amber 映射为 --ipd-*。 */
</style>
