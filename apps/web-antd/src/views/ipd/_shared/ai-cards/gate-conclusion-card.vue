<script lang="ts" setup>
/**
 * 门禁判定汇总卡（shape=decision，R232 P1-06）。
 *
 * <p>渲染 gate.conclusion（Catalog shape=decision）data：门禁编号 + 各评审单判定
 * reviews[]（评审人类型/判定/意见/轮次）+ 三票汇总（passCount/conditionalCount/failCount）。
 * 字段面与 types.ts GateConclusionCardData 一一对应（Catalog 唯一 schema 事实源，零增删）。
 *
 * <p>硬约束：
 * - BR-AI-04：头部常驻风险 Alert（复用 ai-assistant.vue 既有 Alert 形态）；
 * - CardDynString 收窄：string 直显、绑定对象取 path 展示；
 * - C08 零直写：判定「确认」只 emit 给宿主 handler（P1-08 映射既有签署端点），
 *   组件内无写库/请求路径；判定结论不可直接生效，签署落表由宿主真人完成。
 */
import { Alert, Button, Tag } from 'ant-design-vue';

import type { CardDynString, GateConclusionCardData } from './types';

/** 组件 props（顶层具名 interface + defineProps<Props>()，见 ai-suggest.vue 注记）。 */
interface Props {
  /** gate.conclusion data（= Catalog fields，字段零增删）。 */
  data: GateConclusionCardData;
}

const props = defineProps<Props>();

/** 确认事件：宿主 handler 决定签署动作（C08：组件内零写入路径）。 */
const emit = defineEmits<{
  confirm: [payload: GateConclusionCardData];
}>();

/** CardDynString 收窄渲染：字面量直显，绑定对象取 path；null/undefined（如待签票）安全占位（DynString 陷阱防御）。 */
function dynText(value: CardDynString | null | undefined): string {
  if (value == null) return '—';
  return typeof value === 'string' ? value : value.path;
}

function onConfirm() {
  emit('confirm', props.data);
}
</script>

<template>
  <section class="ipd-ai-card" data-testid="ai-card-gate-conclusion">
    <h3 class="card-title">门禁判定汇总（AI 建议）</h3>
    <Alert
      message="AI 生成内容由大模型产出，未经审核、不做内容过滤，仅供参考（BR-AI-04）。"
      show-icon
      type="warning"
      data-testid="ai-card-alert"
    />
    <div class="card-summary">
      <div class="cell">
        <span class="label">门禁编号</span>
        <span class="value" data-testid="ai-card-conclusion-gate-code">{{ dynText(data.gateCode) }}</span>
      </div>
      <div class="cell votes">
        <Tag color="success" data-testid="ai-card-conclusion-pass">通过 {{ data.passCount }}</Tag>
        <Tag color="warning" data-testid="ai-card-conclusion-conditional">
          有条件通过 {{ data.conditionalCount }}
        </Tag>
        <Tag color="error" data-testid="ai-card-conclusion-fail">不通过 {{ data.failCount }}</Tag>
      </div>
    </div>
    <table class="card-table">
      <thead>
        <tr>
          <th scope="col">评审人类型</th>
          <th scope="col">判定</th>
          <th scope="col">评审意见</th>
          <th scope="col">轮次</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(review, index) in data.reviews"
          :key="`${dynText(review.reviewerType)}-${review.round}-${index}`"
          :data-testid="`ai-card-conclusion-review-${index}`"
        >
          <td>{{ dynText(review.reviewerType) }}</td>
          <td>{{ dynText(review.decision) }}</td>
          <td>{{ dynText(review.opinion) }}</td>
          <td>{{ review.round }}</td>
        </tr>
      </tbody>
    </table>
    <div class="card-foot">
      <Button data-testid="ai-card-confirm" type="primary" @click="onConfirm">
        确认判定（交宿主处理）
      </Button>
      <small class="foot-hint">签署由宿主真人提交既有端点落表，本卡不直写业务数据（C08）。</small>
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
  align-items: center;
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
