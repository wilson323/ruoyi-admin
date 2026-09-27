<script lang="ts" setup>
/**
 * 门禁预检清单卡（shape=checklist，R232 P1-06）。
 *
 * <p>渲染 gate.precheck（Catalog shape=checklist）data：门禁编号/轮次/评审单数/要素总数
 * + 要素预检明细 items[]。字段面与 types.ts GatePrecheckCardData 一一对应（Catalog 是
 * 唯一 schema 事实源，字段零增删）。
 *
 * <p>硬约束：
 * - BR-AI-04：头部常驻风险 Alert（复用 ai-assistant.vue 既有 Alert 形态，不做内容过滤）；
 * - CardDynString 收窄：string 直显、绑定对象取 path 展示（DynString 陷阱防御）；
 * - C08 零直写：「确认采纳」只 emit 给宿主 handler（P1-08 映射既有端点），组件内无任何
 *   写库/请求路径；清单建议不可直接生效，落表由宿主真人确认后进行。
 */
import { Alert, Button } from 'ant-design-vue';

import type { CardDynString, GatePrecheckCardData } from './types';

/** 组件 props（顶层具名 interface + defineProps<Props>()，见 ai-suggest.vue 注记）。 */
interface Props {
  /** gate.precheck data（= Catalog fields，字段零增删）。 */
  data: GatePrecheckCardData;
}

const props = defineProps<Props>();

/** 确认事件：宿主 handler 决定落表动作（C08：组件内零写入路径）。 */
const emit = defineEmits<{
  confirm: [payload: GatePrecheckCardData];
}>();

/** CardDynString 收窄渲染：字面量直显，绑定对象取 path（DynString 陷阱防御）。 */
function dynText(value: CardDynString): string {
  return typeof value === 'string' ? value : value.path;
}

function onConfirm() {
  emit('confirm', props.data);
}
</script>

<template>
  <section class="ipd-ai-card" data-testid="ai-card-gate-precheck">
    <h3 class="card-title">门禁预检清单（AI 建议）</h3>
    <Alert
      message="AI 生成内容由大模型产出，未经审核、不做内容过滤，仅供参考（BR-AI-04）。"
      show-icon
      type="warning"
      data-testid="ai-card-alert"
    />
    <div class="card-summary">
      <div class="cell">
        <span class="label">门禁编号</span>
        <span class="value" data-testid="ai-card-precheck-gate-code">{{ dynText(data.gateCode) }}</span>
      </div>
      <div class="cell">
        <span class="label">评审轮次</span>
        <span class="value">{{ data.round }}</span>
      </div>
      <div class="cell">
        <span class="label">评审单数量</span>
        <span class="value">{{ data.reviewCount }}</span>
      </div>
      <div class="cell">
        <span class="label">要素总数</span>
        <span class="value">{{ data.totalElements }}</span>
      </div>
    </div>
    <table class="card-table">
      <thead>
        <tr>
          <th scope="col">要素 ID</th>
          <th scope="col">评审结果</th>
          <th scope="col">条件说明</th>
          <th scope="col">证据引用</th>
          <th scope="col">遗留状态</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in data.items"
          :key="item.elementId"
          :data-testid="`ai-card-precheck-item-${item.elementId}`"
        >
          <td>{{ item.elementId }}</td>
          <td>{{ dynText(item.result) }}</td>
          <td>{{ dynText(item.conditionNote) }}</td>
          <td>{{ dynText(item.evidenceRef) }}</td>
          <td>{{ dynText(item.leftoverStatus) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="card-foot">
      <Button data-testid="ai-card-confirm" type="primary" @click="onConfirm">
        确认采纳（交宿主处理）
      </Button>
      <small class="foot-hint">确认后由宿主真人提交落表，本卡不直写业务数据（C08）。</small>
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
