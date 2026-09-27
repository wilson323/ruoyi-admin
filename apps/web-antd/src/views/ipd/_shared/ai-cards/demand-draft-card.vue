<script lang="ts" setup>
/**
 * 需求草稿卡（shape=draft，R232 P1-06）。
 *
 * <p>渲染 demand.draft（Catalog shape=draft）data：上下文项目（id/编号/名称）
 * + 来源需求草稿明细 requirements[]（需求 id/标题/状态/来源）。
 * 字段面与 types.ts DemandDraftCardData 一一对应（Catalog 唯一 schema 事实源，零增删）。
 *
 * <p>硬约束：
 * - BR-AI-04：头部常驻风险 Alert（复用 ai-assistant.vue 既有 Alert 形态）；
 * - CardDynString 收窄：string 直显、绑定对象取 path 展示；
 * - C08 零直写：「确认生成需求草稿」只 emit 给宿主 handler（P1-08 映射既有端点），
 *   组件内无写库/请求路径；草稿不可直接生效，落表由宿主真人确认后进行。
 */
import { Alert, Button } from 'ant-design-vue';

import type { CardDynString, DemandDraftCardData } from './types';

/** 组件 props（顶层具名 interface + defineProps<Props>()，见 ai-suggest.vue 注记）。 */
interface Props {
  /** demand.draft data（= Catalog fields，字段零增删）。 */
  data: DemandDraftCardData;
}

const props = defineProps<Props>();

/** 确认事件：宿主 handler 决定需求落表动作（C08：组件内零写入路径）。 */
const emit = defineEmits<{
  confirm: [payload: DemandDraftCardData];
}>();

/** CardDynString 收窄渲染：字面量直显，绑定对象取 path；null/undefined 安全占位（DynString 陷阱防御）。 */
function dynText(value: CardDynString | null | undefined): string {
  if (value == null) return '—';
  return typeof value === 'string' ? value : value.path;
}

function onConfirm() {
  emit('confirm', props.data);
}
</script>

<template>
  <section class="ipd-ai-card" data-testid="ai-card-demand-draft">
    <h3 class="card-title">需求草稿（AI 建议）</h3>
    <Alert
      message="AI 生成内容由大模型产出，未经审核、不做内容过滤，仅供参考（BR-AI-04）。"
      show-icon
      type="warning"
      data-testid="ai-card-alert"
    />
    <div class="card-summary">
      <div class="cell">
        <span class="label">项目 ID</span>
        <span class="value" data-testid="ai-card-draft-project-id">{{ data.contextProjectId }}</span>
      </div>
      <div class="cell">
        <span class="label">项目编号</span>
        <span class="value" data-testid="ai-card-draft-project-code">{{ dynText(data.contextProjectCode) }}</span>
      </div>
      <div class="cell">
        <span class="label">项目名称</span>
        <span class="value" data-testid="ai-card-draft-project-name">{{ dynText(data.contextProjectName) }}</span>
      </div>
    </div>
    <table class="card-table">
      <thead>
        <tr>
          <th scope="col">需求 ID</th>
          <th scope="col">标题</th>
          <th scope="col">状态</th>
          <th scope="col">来源</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="req in data.requirements"
          :key="req.requirementId"
          :data-testid="`ai-card-draft-req-${req.requirementId}`"
        >
          <td>{{ req.requirementId }}</td>
          <td>{{ dynText(req.title) }}</td>
          <td>{{ dynText(req.status) }}</td>
          <td>{{ dynText(req.source) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="card-foot">
      <Button data-testid="ai-card-confirm" type="primary" @click="onConfirm">
        确认生成需求草稿（交宿主处理）
      </Button>
      <small class="foot-hint">草稿由宿主真人确认后提交落表，本卡不直写业务数据（C08）。</small>
    </div>
  </section>
</template>

<style scoped>
/* 色板沿用 _shared/ipd-theme.css 的 --ipd-* token（暗色自动翻转） */
.ipd-ai-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ipd-line, #e2e8f0);
  border-radius: 10px;
  background: var(--ipd-surface, #fff);
}
.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--ipd-text, #26303f);
}
.card-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.card-summary .label {
  margin-right: 6px;
  font-size: 12px;
  color: var(--ipd-muted, #6b7488);
}
.card-summary .value {
  font-size: 13px;
  color: var(--ipd-text, #26303f);
}
.card-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.card-table th,
.card-table td {
  padding: 6px 8px;
  border: 1px solid var(--ipd-line, #e2e8f0);
  text-align: left;
  word-break: break-word;
}
.card-table th {
  background: var(--ipd-surface, #f5f7fa);
  color: var(--ipd-muted, #6b7488);
  font-weight: 600;
}
.card-foot {
  display: flex;
  gap: 8px;
  align-items: center;
}
.foot-hint {
  color: var(--ipd-muted, #6b7488);
}
</style>
