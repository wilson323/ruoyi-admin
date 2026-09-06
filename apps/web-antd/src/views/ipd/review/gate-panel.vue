<!--
  五大关键联合 Gate 评审面板（原型 /reviews KeyGatePanel 复刻 + 后端契约适配）—— P2-5.2/5.4/5.5

  一比一部分：section-title「五大关键联合 Gate」标题/副标题/「双PM否决项不可管理覆盖」、
  卡片 header（Gate 编号 · 第 N 轮 · 双签/主导方）+ 状态 pill + mini-chain 双签行 +
  footer 操作按钮语义（签署通过/驳回/整改后重开/仲裁/终裁/延期）。

  必要适配（原型 /api/key-gates 与后端 /api/v1/gates/{gateId} 不同构，逐条登记）：
  1. 原型为项目维度 Gate 列表（/api/key-gates?projectId=）；后端无项目级 Gate 列表
     端点，Gate 评审经 Gate 编号定位（审计/通知侧提供编号）。
  2. 原型材料归档（会议纪要/评审材料 FormData 上传）与五节点顺序签署链后端未交付，
     维持真缺口登记，不做假数据。
  3. 后端双签轮次制已交付：盲签视图（在途互盲仅"对方已提交"）、签署（每方每轮一条，
     任一 REJECT ⇒ REJECTED）、reopen（round+1，第 3 轮组长列席）、超管延期（最多 3 次）、
     组长仲裁、超管终裁——按 GateReviewController 契约 1:1 渲染。
  4. Gate 要素判定（[CONSISTENCY-4] 蜂群审计线1）：
     - 层1：countVetoFailures 控提交按钮 disabled（硬阻断 is_veto+FAIL）；
     - 层2：每要素 PASS / FAIL / 条件通过 三选一 + 条件项必填 closeDeadline+responsiblePersonId；
     - 层3：逐项调 submitGateElementResult 提交判定结果；
     - 层4：提交前预检查 + 红字提示（否决项 FAIL 阻断、必填项缺失）。
-->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import { message } from 'ant-design-vue';
import { SafetyOutlined } from '@ant-design/icons-vue';

import { useIpdAuthStore } from '../../../store/ipd-auth';
import { ipdErrorText } from '../_shared/ipd-error-text';
import {
  arbitrateGate,
  extendGateDeadline,
  finalRulingGate,
  getGateReview,
  reopenGate,
  signGate,
  type GateDecision,
  type GateReviewView,
  type GateStatus,
} from '../../../api/ipd/gate-review';
import {
  countVetoFailures,
  listGateElements,
  submitGateElementResult,
  type GateElementResult,
  type IpdGateElementView,
} from '../../../api/ipd/gate-element-result';

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const isSuperAdmin = computed(() => personType.value === 'SUPER_ADMIN');
const isLeader = computed(() => personType.value === 'GROUP_LEADER');

const gateIdInput = ref('');
const loading = ref(false);
const loadError = ref('');
const busy = ref(false);
const actionError = ref('');
const opinion = ref('');
const view = ref<null | GateReviewView>(null);

/** Gate 要素判定（[CONSISTENCY-4] 层1/层2/层3/层4）。 */
const elements = ref<IpdGateElementView[]>([]);
const elementsLoading = ref(false);
const elementsError = ref('');
/** elementId → { result, closeDeadline, responsiblePersonId } 草稿态。 */
const draftResults = reactive<Record<string, { closeDeadline: string; conditionNote: string; responsiblePersonId: string; result: GateElementResult | '' }>>({});
/** 已成功提交到后端的 elementId → result（用于 countVetoFailures）。 */
const committedResults = reactive<Record<string, GateElementResult>>({});
const submittingElementId = ref('');

/** 后端 Gate 状态 → 原型 status-pill 文案。 */
const statusText: Record<GateStatus, string> = {
  ABSTAINED_TIMEOUT: '超时弃权',
  APPROVED: '已通过',
  PENDING: '流转中',
  REJECTED: '已驳回',
};

const reviewerText: Record<string, string> = {
  GROUP_LEADER: '产品组长',
  MARKET_PM: '市场PM',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
};

const statusClass = computed(() => view.value?.status.toLowerCase() ?? '');
const decisionText = (value?: string) =>
  value === 'APPROVE' ? '通过' : value === 'REJECT' ? '驳回' : (value ?? '—');
const reviewerName = (value: string) => reviewerText[value] ?? value;

/** 签署按钮：在途且本轮未签（超管走终裁/延期，不出现在签署位）。 */
const canSign = computed(
  () => view.value?.status === 'PENDING' && !view.value.my && !isSuperAdmin.value,
);
/** 否决后重开（AC-GATE-06）。 */
const canReopen = computed(() => view.value?.status === 'REJECTED');
/** 延期：仅超管，最多 3 次（AC-GATE-21）。 */
const canExtend = computed(
  () => view.value?.status === 'PENDING' && isSuperAdmin.value && (view.value.extensionCount ?? 0) < 3,
);

/** 层1：否决项 FAIL 数（草稿 + 已提交均计入；>0 则提交按钮硬阻断）。 */
const vetoFailureCount = computed(() => {
  const merged: Record<string, GateElementResult> = { ...committedResults };
  for (const [id, draft] of Object.entries(draftResults)) {
    if (draft.result) merged[id] = draft.result;
  }
  return countVetoFailures(elements.value, new Map(Object.entries(merged)));
});

/** 层4：要素判定预检查结果（缺失必填 / 否决项失败）。 */
const elementValidation = computed(() => {
  const missing: string[] = [];
  for (const el of elements.value) {
    const draft = draftResults[el.id];
    if (!draft || !draft.result) continue;
    if (draft.result === 'PASS_WITH_CONDITION') {
      if (!draft.responsiblePersonId.trim()) missing.push(`${el.title}：条件通过必填责任人`);
      if (!draft.closeDeadline.trim()) missing.push(`${el.title}：条件通过必填关闭期限`);
    }
  }
  return missing;
});

const canSubmitElements = computed(() => {
  if (!view.value || view.value.status !== 'PENDING') return false;
  if (vetoFailureCount.value > 0) return false;
  if (elementValidation.value.length > 0) return false;
  return elements.value.length > 0;
});

const elementResultOptions: Array<{ label: string; value: GateElementResult }> = [
  { label: '通过', value: 'PASS' },
  { label: '不通过', value: 'FAIL' },
  { label: '条件通过', value: 'PASS_WITH_CONDITION' },
];

function ensureDraft(elementId: string): void {
  if (!draftResults[elementId]) {
    draftResults[elementId] = { closeDeadline: '', conditionNote: '', responsiblePersonId: '', result: '' };
  }
}

function onResultChange(elementId: string, value: GateElementResult): void {
  ensureDraft(elementId);
  draftResults[elementId].result = value;
}

async function submitElement(el: IpdGateElementView): Promise<void> {
  if (!view.value || submittingElementId.value) return;
  ensureDraft(el.id);
  const draft = draftResults[el.id];
  if (!draft.result) {
    message.warning(`请先勾选「${el.title}」的判定结果`);
    return;
  }
  if (draft.result === 'PASS_WITH_CONDITION') {
    if (!draft.responsiblePersonId.trim() || !draft.closeDeadline.trim()) {
      message.warning(`条件通过项必须填写责任人与关闭期限`);
      return;
    }
  }
  submittingElementId.value = el.id;
  try {
    await submitGateElementResult(view.value.gateId, {
      closeDeadline: draft.result === 'PASS_WITH_CONDITION' ? draft.closeDeadline.trim() : null,
      conditionNote: draft.conditionNote.trim() || null,
      elementId: el.id,
      responsiblePersonId: draft.result === 'PASS_WITH_CONDITION' ? draft.responsiblePersonId.trim() : null,
      result: draft.result,
    });
    committedResults[el.id] = draft.result;
    message.success(`已提交「${el.title}」判定：${resultLabel(draft.result)}`);
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '要素判定提交失败' }));
  } finally {
    submittingElementId.value = '';
  }
}

function resultLabel(value: GateElementResult | ''): string {
  if (value === 'PASS') return '通过';
  if (value === 'FAIL') return '不通过';
  if (value === 'PASS_WITH_CONDITION') return '条件通过';
  return '未判定';
}

async function loadElements(gateId: string): Promise<void> {
  elementsLoading.value = true;
  elementsError.value = '';
  try {
    elements.value = await listGateElements(gateId);
    // 为每个要素初始化草稿
    for (const el of elements.value) ensureDraft(el.id);
  } catch (cause) {
    elements.value = [];
    elementsError.value = ipdErrorText(cause, { fallback: '评审要素加载失败' });
  } finally {
    elementsLoading.value = false;
  }
}

async function loadGate(): Promise<void> {
  const id = gateIdInput.value.trim();
  if (!id || loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    view.value = await getGateReview(id);
    await loadElements(id);
  } catch (cause) {
    view.value = null;
    elements.value = [];
    loadError.value = ipdErrorText(cause, { fallback: 'Gate 评审视图加载失败，请稍后重试' });
  } finally {
    loading.value = false;
  }
}

async function run(action: () => Promise<unknown>, successText: string): Promise<void> {
  if (busy.value || !view.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    await action();
    message.success(successText);
    view.value = await getGateReview(view.value.gateId);
  } catch (cause) {
    actionError.value = ipdErrorText(cause, { fallback: '操作失败，请稍后重试' });
  } finally {
    busy.value = false;
  }
}

function sign(decision: GateDecision): void {
  void run(
    () => signGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '已签署通过' : '已驳回，Gate 进入否决状态',
  );
}

function reopen(): void {
  void run(() => reopenGate(view.value!.gateId), '已发起新一轮评审');
}

function extend(days: number): void {
  void run(() => extendGateDeadline(view.value!.gateId, days), `签署期限已延长 ${days} 天`);
}

function arbitrate(decision: GateDecision): void {
  void run(
    () => arbitrateGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '仲裁意见已提交：同意' : '仲裁意见已提交：驳回',
  );
}

function finalRuling(decision: GateDecision): void {
  void run(
    () => finalRulingGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '终裁已锁定：通过' : '终裁已锁定：驳回',
  );
}
</script>

<template>
  <section class="surface final-gates">
    <div class="section-title">
      <div>
        <h2>五大关键联合 Gate</h2>
        <p>与六阶段确认独立显示；双 PM 盲签互不可见，任一否决即整单驳回。</p>
      </div>
      <span>双PM否决项不可管理覆盖</span>
    </div>

    <div class="gate-locate">
      <input
        v-model="gateIdInput"
        placeholder="输入 Gate 编号定位评审（由审计/通知提供）"
        @keyup.enter="loadGate"
      />
      <button :disabled="!gateIdInput.trim() || loading" class="primary-button" type="button" @click="loadGate">
        加载评审视图
      </button>
    </div>
    <div class="rev-pending">
      原型材料归档（会议纪要/评审材料上传）与五节点顺序签署链后端未交付，维持真缺口登记；Gate
      双签轮次评审链已交付，经 Gate 编号定位后在本面板办理。
    </div>

    <div v-if="loadError" class="gate-error">{{ loadError }}</div>

    <div v-if="loading" class="gate-loading">正在加载 Gate 评审视图…</div>

    <template v-if="view">
      <article class="gate-card">
        <header>
          <span>
            <strong>{{ view.gateCode }}</strong>
            <small>
              第 {{ view.round }} 轮 · {{ view.dualSign ? '双PM盲签' : `主导方：${reviewerName(view.leadSide)}` }}
            </small>
          </span>
          <i class="status-pill" :class="statusClass">{{ statusText[view.status] }}</i>
        </header>

        <div class="gate-meta">
          <span>签署期限：{{ view.signDueAt || '—' }}</span>
          <span>已延期 {{ view.extensionCount ?? 0 }}/3 次</span>
          <span v-if="view.observers?.length">
            第 3 轮起组长列席：{{ view.observers.map((item) => item.name).join('、') }}
          </span>
        </div>

        <div class="mini-chain">
          <span :class="view.my?.decision?.toLowerCase() || 'pending'">
            <i>{{ view.my ? decisionText(view.my.decision) : '未签' }}</i>
            <small>我（{{ reviewerName(personType) }}）</small>
          </span>
          <span v-if="view.other" :class="view.other.decision?.toLowerCase() || 'pending'">
            <i>{{ view.other.decision ? decisionText(view.other.decision) : '已提交' }}</i>
            <small>{{ reviewerName(view.other.reviewerType) }}</small>
          </span>
          <span v-else-if="view.otherSubmitted" class="blind">
            <i>已提交</i>
            <small>对方（盲签中）</small>
          </span>
          <span v-else class="blind">
            <i>—</i>
            <small>对方未签</small>
          </span>
        </div>

        <p v-if="view.hint" class="gate-hint">{{ view.hint }}</p>
        <template v-if="view.other?.opinion">
          <p class="gate-opinion"><strong>{{ reviewerName(view.other.reviewerType) }}意见：</strong>{{ view.other.opinion }}</p>
        </template>
        <p v-if="view.my?.opinion" class="gate-opinion"><strong>我的意见：</strong>{{ view.my.opinion }}</p>

        <footer>
          <template v-if="canSign">
            <input
              v-model="opinion"
              class="gate-opinion-input"
              placeholder="签署意见（可空）；驳回请写明整改要求"
            />
            <button :disabled="busy" class="secondary-button" type="button" @click="sign('REJECT')">驳回</button>
            <button :disabled="busy" class="primary-button" type="button" @click="sign('APPROVE')">
              签署通过本节点
            </button>
          </template>
          <span v-else-if="view.status === 'PENDING' && view.my" class="gate-done">
            本轮已签署（{{ decisionText(view.my.decision) }}），等待对方或系统推进。
          </span>
          <template v-if="canReopen">
            <button :disabled="busy" class="secondary-button" type="button" @click="reopen">
              整改后发起新版本
            </button>
          </template>
          <template v-if="isLeader && view.status === 'PENDING'">
            <button :disabled="busy" class="secondary-button" type="button" @click="arbitrate('REJECT')">
              仲裁驳回
            </button>
            <button :disabled="busy" class="primary-button" type="button" @click="arbitrate('APPROVE')">
              仲裁同意
            </button>
          </template>
          <template v-if="isSuperAdmin && view.status === 'PENDING'">
            <button :disabled="busy" class="secondary-button" type="button" @click="finalRuling('REJECT')">
              终裁驳回
            </button>
            <button :disabled="busy" class="primary-button" type="button" @click="finalRuling('APPROVE')">
              终裁通过
            </button>
            <template v-if="canExtend">
              <button :disabled="busy" class="panel-action" type="button" @click="extend(7)">延长 7 天</button>
              <button :disabled="busy" class="panel-action" type="button" @click="extend(15)">延长 15 天</button>
            </template>
          </template>
        </footer>
      </article>

      <!-- [CONSISTENCY-4] 评审要素逐项打勾面板 -->
      <article class="gate-elements-card">
        <header class="elements-header">
          <strong>评审要素判定（{{ elements.length }} 项）</strong>
          <span v-if="vetoFailureCount > 0" class="elements-veto">否决项 FAIL {{ vetoFailureCount }} 项 → 提交被阻断</span>
          <span v-else-if="elementValidation.length > 0" class="elements-warn">要素待补：{{ elementValidation.length }} 项</span>
          <span v-else-if="elements.length > 0" class="elements-ok">要素预检查通过</span>
        </header>

        <div v-if="elementsError" class="gate-error">{{ elementsError }}</div>
        <div v-if="elementsLoading" class="gate-loading">正在加载评审要素…</div>

        <ul v-if="elements.length > 0" class="elements-list">
          <li v-for="el in elements" :key="el.id" class="element-row" :class="{ 'is-veto-fail': draftResults[el.id]?.result === 'FAIL' && el.isVeto }">
            <div class="element-head">
              <span class="element-title">
                <strong>{{ el.title }}</strong>
                <em v-if="el.isVeto" class="element-veto-tag">否决项</em>
                <em v-else class="element-must-tag">必审</em>
              </span>
              <span v-if="committedResults[el.id]" class="element-committed">已提交：{{ resultLabel(committedResults[el.id]) }}</span>
            </div>
            <p v-if="el.description" class="element-desc">{{ el.description }}</p>
            <p v-if="el.passStandard" class="element-std">通过标准：{{ el.passStandard }}</p>

            <div class="element-radios">
              <label v-for="opt in elementResultOptions" :key="opt.value" class="element-radio" :class="{ active: draftResults[el.id]?.result === opt.value }">
                <input
                  type="radio"
                  :name="`el-${el.id}`"
                  :value="opt.value"
                  :checked="draftResults[el.id]?.result === opt.value"
                  @change="onResultChange(el.id, opt.value)"
                />
                <span>{{ opt.label }}</span>
              </label>
            </div>

            <div v-if="draftResults[el.id]?.result === 'PASS_WITH_CONDITION'" class="element-cond">
              <input
                v-model="draftResults[el.id]!.responsiblePersonId"
                class="element-input"
                placeholder="责任人编号（必填）"
              />
              <input
                v-model="draftResults[el.id]!.closeDeadline"
                class="element-input"
                placeholder="关闭期限 YYYY-MM-DD（必填）"
              />
              <input
                v-model="draftResults[el.id]!.conditionNote"
                class="element-input"
                placeholder="条件说明（可选）"
              />
            </div>

            <div class="element-actions">
              <button
                class="panel-action"
                type="button"
                :disabled="!draftResults[el.id]?.result || submittingElementId === el.id"
                @click="submitElement(el)"
              >
                {{ submittingElementId === el.id ? '提交中…' : '提交此项判定' }}
              </button>
            </div>
          </li>
        </ul>
        <div v-else-if="!elementsLoading && !elementsError" class="empty-state">
          <div><SafetyOutlined /></div>
          <strong>本 Gate 暂无评审要素</strong>
          <p>若后端未配置 33 项种子要素，请联系超管在「Gate 评审要素」页登记。</p>
        </div>

        <div v-if="elementValidation.length > 0" class="gate-error">
          提交前必填：
          <ul class="mt-1 list-disc pl-5">
            <li v-for="(msg, idx) in elementValidation" :key="idx">{{ msg }}</li>
          </ul>
        </div>
        <div class="gate-elements-foot">
          <button
            type="button"
            class="primary-button"
            :disabled="!canSubmitElements || busy"
            :title="vetoFailureCount > 0 ? `否决项 FAIL ${vetoFailureCount} 项被阻断` : (elementValidation.length > 0 ? '必填项未完成' : '提交评审结论')"
          >
            提交评审结论（{{ elements.length }} 项）
          </button>
        </div>
      </article>
    </template>
    <div v-else-if="!loading && !loadError" class="empty-state">
      <div><SafetyOutlined /></div>
      <strong>尚未加载 Gate</strong>
      <p>输入 Gate 编号后加载双签评审视图；在途双方互不可见结论。</p>
    </div>

    <div v-if="actionError" class="gate-error">{{ actionError }}</div>
  </section>
</template>

<style scoped>
/* 原型 styles.css 摘录；--blue/--line/--muted/--text/--green 映射为 --ipd-*，
   --blue-soft/--blue-dark 原型字面量 #edf2ff/#1747d7 直接保留。 */
.final-gates {
  margin: 18px 0;
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
  color: var(--ipd-muted);
  font-size: 12px;
}
.section-title p {
  margin: 3px 0 0;
  color: var(--ipd-muted);
  font-size: 12px;
}
.primary-button,
.secondary-button,
.panel-action {
  border: 0;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.primary-button {
  background: var(--ipd-blue);
  color: white;
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}
.primary-button:hover {
  background: #1747d7;
}
.primary-button:disabled,
.secondary-button:disabled,
.panel-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.secondary-button {
  background: white;
  border: 1px solid #cdd4df;
  color: #465168;
}
.panel-action {
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid #cfd6e1;
  background: white;
  color: var(--ipd-text);
  font-size: 12px;
}
.gate-locate {
  display: flex;
  gap: 10px;
  padding: 16px 20px 0;
}
.gate-locate input {
  min-width: 0;
  flex: 1;
  max-width: 420px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
  color: var(--ipd-text);
}
.rev-pending {
  margin: 12px 20px 0;
  padding: 10px 12px;
  background: #f6f8fb;
  border: 1px dashed #cfd9e5;
  border-radius: 6px;
  color: #6b7a90;
  font-size: 12px;
  line-height: 1.6;
}
.gate-error {
  margin: 12px 20px 0;
  padding: 10px 12px;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 6px;
  color: #a8071a;
  font-size: 12px;
}
.gate-loading {
  padding: 24px 20px;
  color: var(--ipd-muted);
  font-size: 12px;
}
.gate-card {
  margin: 16px 20px 20px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}
.gate-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ipd-line);
}
.gate-card header strong {
  font-size: 14px;
}
.gate-card header small {
  display: block;
  margin-top: 3px;
  color: var(--ipd-muted);
  font-size: 11px;
}
.status-pill {
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  border-radius: 4px;
  padding: 4px 8px;
}
.status-pill.pending {
  color: var(--ipd-blue);
  background: #edf2ff;
}
.status-pill.approved {
  color: var(--ipd-green);
  background: #eaf7ed;
}
.status-pill.rejected {
  color: #b42318;
  background: #fee4e2;
}
.status-pill.abstained_timeout {
  color: #9a6509;
  background: #fff4df;
}
.gate-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 12px 16px;
  color: var(--ipd-muted);
  font-size: 11px;
}
.mini-chain {
  display: flex;
  gap: 10px;
  padding: 0 16px 4px;
}
.mini-chain span {
  display: grid;
  justify-items: center;
  gap: 4px;
}
.mini-chain i {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  background: #f1f4f9;
  color: var(--ipd-muted);
}
.mini-chain span.approve i {
  background: #eaf7ed;
  color: var(--ipd-green);
}
.mini-chain span.reject i {
  background: #fee4e2;
  color: #b42318;
}
.mini-chain span.blind i {
  background: #edf2ff;
  color: var(--ipd-blue);
}
.mini-chain small {
  color: var(--ipd-muted);
  font-size: 10px;
}
.gate-hint {
  margin: 8px 16px 0;
  padding: 8px 10px;
  background: #edf2ff;
  border-radius: 6px;
  color: var(--ipd-blue);
  font-size: 12px;
}
.gate-opinion {
  margin: 8px 16px 0;
  color: #56647c;
  font-size: 12px;
}
.gate-opinion strong {
  color: var(--ipd-text);
}
.gate-card footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
}
.gate-opinion-input {
  min-width: 0;
  flex: 1;
  height: 38px;
  padding: 0 10px;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
  color: var(--ipd-text);
}
.gate-done {
  color: var(--ipd-muted);
  font-size: 12px;
}
.empty-state {
  min-height: 200px;
  display: grid;
  place-content: center;
  justify-items: center;
  text-align: center;
  color: var(--ipd-muted);
}
.empty-state > div {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 50%;
  font-size: 28px;
}
.empty-state strong {
  color: var(--ipd-text);
  margin: 12px 0 4px;
}
.empty-state p {
  margin: 0;
  max-width: 380px;
  font-size: 12px;
  line-height: 1.6;
}

/* [CONSISTENCY-4] Gate 要素判定面板 */
.gate-elements-card {
  margin: 0 20px 20px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  background: #fbfcfe;
}
.elements-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ipd-line);
  background: white;
  border-radius: 8px 8px 0 0;
}
.elements-header strong {
  font-size: 13px;
}
.elements-veto {
  color: #b42318;
  background: #fee4e2;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
}
.elements-warn {
  color: #9a6509;
  background: #fff4df;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
}
.elements-ok {
  color: var(--ipd-green);
  background: #eaf7ed;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
}
.elements-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.element-row {
  padding: 14px 16px;
  border-bottom: 1px solid var(--ipd-line);
}
.element-row:last-child {
  border-bottom: 0;
}
.element-row.is-veto-fail {
  background: #fff5f5;
}
.element-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.element-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.element-veto-tag {
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: #b42318;
  color: white;
}
.element-must-tag {
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  background: #edf2ff;
  color: var(--ipd-blue);
}
.element-committed {
  color: var(--ipd-green);
  font-size: 11px;
}
.element-desc {
  margin: 4px 0 2px;
  color: #56647c;
  font-size: 12px;
}
.element-std {
  margin: 0 0 8px;
  color: var(--ipd-muted);
  font-size: 11px;
}
.element-radios {
  display: flex;
  gap: 8px;
  margin: 6px 0 6px;
}
.element-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid #cfd6e1;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  background: white;
}
.element-radio.active {
  border-color: var(--ipd-blue);
  color: var(--ipd-blue);
  background: #edf2ff;
}
.element-cond {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0 6px;
}
.element-input {
  min-width: 0;
  flex: 1;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #cfd6e1;
  border-radius: 4px;
  font-size: 12px;
}
.element-actions {
  margin-top: 4px;
}
.gate-elements-foot {
  padding: 12px 16px;
  border-top: 1px solid var(--ipd-line);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  background: white;
  border-radius: 0 0 8px 8px;
}
</style>
