<!--
  阶段确认页（原型 /reviews · StageConfirmPage 一比一复刻）—— 卡 ZK-D2 / 任务 p7（2026-09-06）

  一比一部分：页头标题/副标题/提交按钮、review-layout 双栏（阶段确认事项 + 确认条件四条
  policy + gate-status-card）、双PM阶段确认链 / 开发双周评审 / 五大关键联合 Gate / 例外豁免
  四个后置面板的结构与全部文案、空态措辞；CSS 取自原型 styles.css 原文（变量映射 --ipd-*）。

  必要适配（原型 boot 全局上下文本仓不存在，逐条登记）：
  1. 原型隐含唯一"当前项目"（boot.project）；本页改顶部项目选择器（复用原型
     change-project-selector 类，与变更页同形态），选定后并行拉取项目与门禁清单。
  2. 原型左栏列表是评审单（GET /api/reviews，后端无此 Controller）；改用真实门禁清单
     GET /projects/{id}/gate-checklist 的 items 以 review-row 形态展示（名称 + 原因 +
     通过 pill）。原型行的组长决策按钮（退回补充/确认通过）依附于评审单，checklist 为
     系统自动计算不可人工决策，不渲染。
  3. gate-status-card"还缺 N 个动作"数据源改为 checklist 未通过项数（原型为未完成动作数）。
  4. 提交按钮接真实 POST /projects/{id}/advance-stage（与 flow.vue 同款；门禁失败
     400/10001，错误明细原样展示，不放宽）。
  5. 双PM阶段确认链（/api/collaboration）、开发双周评审、例外豁免
     （/api/gates/{id}/waive）后端均未交付：按原型渲染外壳与空态文案，另加灰色
     说明条如实登记，不做假数据；豁免/双周评审按钮禁用 + title 提示。
  6. 五大关键联合 Gate：后端 GateReviewController 双签轮次链已交付（/api/v1/gates/
     {gateId}/review|sign|reopen|extend-deadline|arbitrate|final-ruling，P2-5.2/5.4），
     由 gate-panel.vue 承接（Gate 编号定位 + 盲签视图 + 签署/重开/仲裁/终裁/延期）；
     原型材料归档与五节点链仍为真缺口，在面板内登记。
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { Alert, Spin, message } from 'ant-design-vue';
import {
  AimOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  InfoCircleFilled,
  PlusOutlined,
  SafetyOutlined,
  SendOutlined,
} from '@ant-design/icons-vue';

import {
  advanceProjectStage,
  getGateChecklist,
  getProject,
  listProjects,
  type GateChecklistView,
  type Project,
} from '../../../api/ipd/project';
import { isTransportError, projectErrorText } from '../project/project-error';
import { STAGE_ORDER, stageText } from '../project/project-display';
import GatePanel from './gate-panel.vue';

const loading = ref(false);
const loadError = ref('');
const projects = ref<Project[]>([]);
const activeId = ref('');
const project = ref<null | Project>(null);
const checklist = ref<null | GateChecklistView>(null);
const submitting = ref(false);
const advanceError = ref('');
const waiverReason = ref('');

const items = computed(() => checklist.value?.items ?? []);
const missing = computed(() => items.value.filter((item) => !item.ok).length);
/** 原型 stage.name 为短名（概念/计划/…），与 STAGE_ORDER label 对齐。 */
const stageShort = computed(
  () => STAGE_ORDER.find((stage) => stage.code === project.value?.currentStage)?.label ?? '当前',
);
const gateStatusText = computed(() => {
  if (!checklist.value) return '—';
  if (items.value.length === 0) return '暂无门禁检查项';
  return missing.value > 0 ? `还缺 ${missing.value} 个动作` : '可提交阶段确认';
});
/** 原型仅 develop 阶段渲染双周评审面板；后端阶段码 DEV。 */
const isDevStage = computed(() => project.value?.currentStage === 'DEV');

async function loadProject(id: string): Promise<void> {
  if (!id) {
    project.value = null;
    checklist.value = null;
    return;
  }
  loading.value = true;
  loadError.value = '';
  advanceError.value = '';
  try {
    const [detail, gate] = await Promise.all([getProject(id), getGateChecklist(id)]);
    project.value = detail;
    checklist.value = gate;
  } catch (cause) {
    loadError.value = projectErrorText(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    projects.value = await listProjects();
    activeId.value = projects.value[0]?.id ?? '';
  } catch (cause) {
    loadError.value = projectErrorText(cause);
  }
  await loadProject(activeId.value);
});

watch(activeId, (next) => {
  void loadProject(next);
});

/** 与 flow.vue 同款：advance-stage 服务端权威推进，门禁失败原样展示明细。 */
async function submitStage(): Promise<void> {
  if (!project.value || submitting.value) return;
  submitting.value = true;
  advanceError.value = '';
  try {
    project.value = await advanceProjectStage(project.value.id);
    message.success(`已进入「${stageText(project.value.currentStage)}」`);
    await loadProject(project.value.id);
  } catch (cause) {
    advanceError.value = isTransportError(cause)
      ? '服务暂不可用，请稍后重试。'
      : projectErrorText(cause);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="rev-page">
    <header class="page-heading">
      <div>
        <h1>阶段确认</h1>
        <p>
          用于确认一个 IPD
          阶段是否具备进入下一阶段的条件，防止缺项、无证据或未决风险被带入后续工作。
        </p>
      </div>
      <button
        class="primary-button"
        :disabled="!project || submitting"
        :title="project ? '提交当前阶段确认，服务端校验门禁' : '先选择项目'"
        type="button"
        @click="submitStage"
      >
        <SendOutlined />
        提交{{ stageShort }}阶段确认
      </button>
    </header>

    <div class="change-project-selector">
      <AimOutlined />
      <label>
        阶段确认项目
        <select v-model="activeId">
          <option disabled value="">选择项目</option>
          <option v-for="item in projects" :key="item.id" :value="item.id">
            {{ item.name }} · {{ item.code }}
          </option>
        </select>
      </label>
      <span>当前阶段：{{ project ? stageText(project.currentStage) : '—' }}</span>
    </div>

    <Alert v-if="loadError" class="rev-alert" type="error" show-icon :message="loadError" />
    <Alert
      v-if="advanceError"
      class="rev-alert"
      type="warning"
      show-icon
      :message="advanceError"
      closable
      @close="advanceError = ''"
    />

    <Spin :spinning="loading">
      <div v-if="!project && !loading" class="empty-state">
        <div><SafetyOutlined /></div>
        <strong>暂无 IPD 项目</strong>
        <p>先在项目空间新建或导入项目，再回到本页提交阶段确认。</p>
      </div>
      <template v-else>
        <div class="review-layout">
          <section class="surface">
            <div class="section-title">
              <h2>阶段确认事项</h2>
              <span>{{ items.length }} 项</span>
            </div>
            <div class="handoff-note">
              <InfoCircleFilled />
              <span>
                产品经理完成系统内动作并上传研发、市场等线下评审证据；所属产品组长负责阶段确认。外部人员不需要登录系统。
              </span>
            </div>
            <template v-if="items.length">
              <div v-for="item in items" :key="item.code" class="review-row">
                <div class="review-icon"><SafetyOutlined /></div>
                <div>
                  <strong>{{ item.name }}</strong>
                  <p>{{ item.reason || '—' }}</p>
                </div>
                <span class="pill" :class="item.ok ? 'success' : 'warning'">
                  {{ item.ok ? '已通过' : '未通过' }}
                </span>
              </div>
            </template>
            <div v-else class="empty-state">
              <div><SafetyOutlined /></div>
              <strong>暂无阶段确认</strong>
              <p>完成当前阶段全部动作后即可提交。</p>
            </div>
          </section>
          <section class="surface">
            <div class="section-title">
              <h2>确认条件</h2>
              <span class="pill blue">顺序控制</span>
            </div>
            <div class="policy-list">
              <p><CheckCircleFilled />当前阶段所有动作已按 SOP 顺序完成</p>
              <p><CheckCircleFilled />保存时系统自动完整性检查全部通过</p>
              <p><CheckCircleFilled />研发、市场等外部意见以附件证据留存</p>
              <p><CheckCircleFilled />产品组长确认后下一阶段自动点亮</p>
            </div>
            <div class="gate-status-card">
              <span>{{ stageShort }}阶段状态</span>
              <strong>{{ gateStatusText }}</strong>
              <p>阶段确认不是额外工作，而是控制产品定义和承诺质量的决策点。</p>
            </div>
          </section>
        </div>

        <section class="surface decision-chain-panel">
          <div class="section-title">
            <h2>双PM阶段确认链</h2>
            <span>市场PM → 研发PM → 市场组长 → 研发组长 → 超级管理员</span>
          </div>
          <div class="empty-state">
            <div><SafetyOutlined /></div>
            <strong>暂无五节点决策</strong>
            <p>阶段或变更提交后，系统按顺序把任务投递给双PM、双组长和超级管理员。</p>
          </div>
          <div class="rev-pending">
            五节点签署链（协作决策 /api/collaboration）后端未交付，当前仅呈现原型结构，不做假数据。
          </div>
        </section>

        <section v-if="isDevStage" class="surface biweekly-panel">
          <div class="section-title">
            <h2>开发双周评审</h2>
            <button class="panel-action" disabled title="双周评审接口后端未交付" type="button">
              <PlusOutlined />
              记录本期评审
            </button>
          </div>
          <div class="empty-state">
            <div><CalendarOutlined /></div>
            <strong>尚无双周评审</strong>
            <p>开发阶段激活后每14天评审市场窗口、交付、质量和风险。</p>
          </div>
          <div class="rev-pending">双周评审接口后端未交付，当前仅呈现原型结构与空态文案。</div>
        </section>

        <GatePanel />

        <section class="surface waiver-section">
          <div class="section-title">
            <h2>例外豁免</h2>
            <span>产品组长 + 超级管理员双重审批</span>
          </div>
          <div class="waiver-request">
            <input
              v-model="waiverReason"
              placeholder="说明至少 10 个字的豁免原因、风险和补救计划"
            />
            <button
              class="secondary-button"
              disabled
              title="豁免审批接口后端未交付，暂不可申请"
              type="button"
            >
              申请豁免
            </button>
          </div>
        </section>
      </template>
    </Spin>
  </div>
</template>

<style scoped>
/* 原型 styles.css 摘录；--blue/--line/--muted/--text/--green 映射为 --ipd-*，
   --blue-soft/--blue-dark 原型字面量 #edf2ff/#1747d7 直接保留。 */
.rev-page {
  padding: 28px 32px 60px;
  max-width: 1600px;
  margin: auto;
}
.page-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 24px;
}
.page-heading h1 {
  margin: 0 0 8px;
  font-size: 25px;
  letter-spacing: -0.02em;
}
.page-heading p {
  margin: 0;
  color: var(--ipd-muted);
  font-size: 13px;
}
.primary-button,
.secondary-button {
  border: 0;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-weight: 700;
  text-decoration: none;
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
.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.secondary-button {
  background: white;
  border: 1px solid #cdd4df;
  color: #465168;
}
.rev-alert {
  margin-bottom: 16px;
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
.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 4px;
  padding: 4px 8px;
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
}
.pill.blue {
  color: var(--ipd-blue);
  background: #edf2ff;
}
.pill.warning {
  color: #9a6509;
  background: #fff4df;
}
.pill.success {
  color: var(--ipd-green);
  background: #eaf7ed;
}
.review-layout {
  display: grid;
  grid-template-columns: 1.3fr 0.8fr;
  gap: 18px;
}
.review-row {
  margin: 0 20px;
  min-height: 72px;
  display: grid;
  grid-template-columns: 38px 1fr auto;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--ipd-line);
}
.review-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 6px;
  font-size: 20px;
}
.review-row p {
  margin: 5px 0 0;
  color: var(--ipd-muted);
  font-size: 11px;
}
.policy-list {
  padding: 16px 20px 8px;
}
.policy-list p {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin: 0 0 10px;
}
.policy-list :deep(.anticon) {
  color: var(--ipd-green);
}
.gate-status-card {
  margin: 10px 20px 20px;
  padding: 15px;
  background: #fff8ec;
  border-radius: 6px;
  display: grid;
  gap: 5px;
}
.gate-status-card span,
.gate-status-card p {
  color: #806b45;
  font-size: 11px;
  margin: 0;
}
.gate-status-card strong {
  color: #9b650b;
}
.handoff-note {
  margin: 0 20px 18px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: #56647c;
  background: #f2f6ff;
  border-radius: 6px;
  font-size: 12px;
}
.handoff-note :deep(.anticon) {
  color: var(--ipd-blue);
}
.change-project-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
  background: #edf5ff;
  border: 1px solid #c9ddf6;
  border-radius: 10px;
}
.change-project-selector :deep(.anticon) {
  color: var(--ipd-blue);
  font-size: 17px;
}
.change-project-selector label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
}
.change-project-selector select {
  min-width: 330px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
  background: white;
  color: var(--ipd-text);
}
.change-project-selector span {
  margin-left: auto;
  color: #587493;
}
.empty-state {
  min-height: 260px;
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
.decision-chain-panel,
.biweekly-panel {
  padding: 20px;
  margin-top: 18px;
}
.decision-chain-panel .section-title,
.biweekly-panel .section-title {
  padding: 0 0 14px;
}
.final-gates {
  margin: 18px 24px;
}
.panel-action {
  height: 30px;
  padding: 0 11px;
  border: 1px solid #cfd6e1;
  border-radius: 5px;
  background: white;
  color: var(--ipd-text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.panel-action:disabled,
.waiver-request button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.rev-pending {
  margin-top: 12px;
  padding: 10px 12px;
  background: #f6f8fb;
  border: 1px dashed #cfd9e5;
  border-radius: 6px;
  color: #6b7a90;
  font-size: 12px;
  line-height: 1.6;
}
.waiver-section {
  margin-top: 18px;
  overflow: hidden;
}
.waiver-request {
  padding: 16px 20px;
  display: flex;
  gap: 10px;
}
.waiver-request input {
  min-width: 0;
  flex: 1;
  height: 38px;
  padding: 0 10px;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
  color: var(--ipd-text);
}
.waiver-request input::placeholder {
  color: #98a5b6;
}
/* V12-F3: 原 900px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .change-project-selector {
    align-items: flex-start;
    flex-direction: column;
  }
  .change-project-selector select {
    min-width: 0;
    width: 100%;
  }
}
</style>
