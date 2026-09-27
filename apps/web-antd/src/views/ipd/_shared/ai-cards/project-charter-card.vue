<script lang="ts" setup>
/**
 * 立项要素对比卡（shape=compare，R232 P1-06）。
 *
 * <p>渲染 project.charter（Catalog shape=compare）data：上下文项目实况
 * （id/编号/名称/当前阶段/产品 id）。字段面与 types.ts ProjectCharterCardData
 * 一一对应（Catalog 唯一 schema 事实源，零增删）。
 *
 * <p>布局：左「AI 建议值」区（具名槽位 suggested，宿主随卡文案填入）vs 右「上下文项目
 * 实况」区（data 回读值）。金额/评分/系数类建议只进左区展示、不可直接生效（P1-08 口径）；
 * 两区对照供真人判断，「确认采纳」只 emit 给宿主 handler（C08 零直写）。
 *
 * <p>硬约束：
 * - BR-AI-04：头部常驻风险 Alert（复用 ai-assistant.vue 既有 Alert 形态）；
 * - CardDynString 收窄：string 直显、绑定对象取 path 展示；
 * - C08 零直写：组件内无写库/请求路径，落表由宿主真人确认后进行。
 */
import { Alert, Button } from 'ant-design-vue';

import type { CardDynString, ProjectCharterCardData } from './types';

/** 组件 props（顶层具名 interface + defineProps<Props>()，见 ai-suggest.vue 注记）。 */
interface Props {
  /** project.charter data（= Catalog fields，字段零增删）。 */
  data: ProjectCharterCardData;
}

const props = defineProps<Props>();

/** 确认事件：宿主 handler 决定立项表单动作（C08：组件内零写入路径）。 */
const emit = defineEmits<{
  confirm: [payload: ProjectCharterCardData];
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
  <section class="ipd-ai-card" data-testid="ai-card-project-charter">
    <h3 class="card-title">立项要素对比（AI 建议 vs 上下文实况）</h3>
    <Alert
      message="AI 生成内容由大模型产出，未经审核、不做内容过滤，仅供参考（BR-AI-04）。"
      show-icon
      type="warning"
      data-testid="ai-card-alert"
    />
    <div class="compare">
      <div class="col suggest-col">
        <h4 class="col-title">AI 建议值（仅建议 · 不可直接生效）</h4>
        <slot name="suggested">
          <p class="slot-hint">建议值以随卡建议文案为准，请与右栏实况对照后人工核对采纳。</p>
        </slot>
      </div>
      <div class="col context-col">
        <h4 class="col-title">上下文项目实况</h4>
        <div class="cell">
          <span class="label">项目 ID</span>
          <span class="value" data-testid="ai-card-charter-project-id">{{ data.contextProjectId }}</span>
        </div>
        <div class="cell">
          <span class="label">项目编号</span>
          <span class="value" data-testid="ai-card-charter-project-code">{{ dynText(data.contextProjectCode) }}</span>
        </div>
        <div class="cell">
          <span class="label">项目名称</span>
          <span class="value" data-testid="ai-card-charter-project-name">{{ dynText(data.contextProjectName) }}</span>
        </div>
        <div class="cell">
          <span class="label">当前阶段</span>
          <span class="value" data-testid="ai-card-charter-stage">{{ dynText(data.contextCurrentStage) }}</span>
        </div>
        <div class="cell">
          <span class="label">产品 ID</span>
          <span class="value" data-testid="ai-card-charter-product-id">{{ data.contextProductId }}</span>
        </div>
      </div>
    </div>
    <div class="card-foot">
      <Button data-testid="ai-card-confirm" type="primary" @click="onConfirm">
        确认采纳（交宿主处理）
      </Button>
      <small class="foot-hint">采纳后由宿主真人填入立项表单提交，本卡不直写业务数据（C08）。</small>
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
.compare {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.col {
  flex: 1 1 260px;
  padding: 10px;
  border: 1px solid var(--ipd-line, #e2e8f0);
  border-radius: 8px;
}
.suggest-col {
  background: var(--ipd-surface, #f5f7fa);
}
.col-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 650;
  color: var(--ipd-text, #26303f);
}
.slot-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.8;
  color: var(--ipd-muted, #6b7488);
}
.cell {
  display: flex;
  gap: 6px;
  padding: 3px 0;
  font-size: 13px;
}
.cell .label {
  flex: 0 0 72px;
  color: var(--ipd-muted, #6b7488);
  font-size: 12px;
}
.cell .value {
  color: var(--ipd-text, #26303f);
  word-break: break-word;
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
