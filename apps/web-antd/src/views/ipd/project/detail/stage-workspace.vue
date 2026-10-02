<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button } from 'ant-design-vue';

import { buildStageWorkspace, type StageWorkspaceInput } from './stage-workspace-model';

const props = defineProps<{ input: StageWorkspaceInput; stageLabel: string }>();
const view = computed(() => buildStageWorkspace(props.input));

const open = ref(false);
const openSub = ref<null | string>(null);

/** 浏览阶段变化时收起小阶段。只有正在看的就是当前阶段，才展开当前小阶段。 */
function applyDefaultOpen(): void {
  const onCurrent = !!props.input.stageCode && props.input.stageCode === props.input.currentStageCode;
  const code = props.input.currentSubStageCode;
  if (onCurrent && code) {
    open.value = true;
    openSub.value = code;
    return;
  }
  open.value = false;
  openSub.value = null;
}

watch(() => props.input.stageCode, applyDefaultOpen);
watch(() => props.input.currentSubStageCode, applyDefaultOpen);
applyDefaultOpen();

/** 展开或收起本阶段的小阶段名单，不请求推进接口。 */
function toggleDetails(): void {
  open.value = !open.value;
  if (!open.value) openSub.value = null;
}

/** 一次只展开一个小阶段的动作，避免把全部分动作铺开。 */
function toggleSub(code: string): void {
  openSub.value = openSub.value === code ? null : code;
}
</script>

<template>
  <section class="stage-workspace" data-testid="stage-workspace">
    <h3>{{ stageLabel }}</h3>
    <dl data-testid="stage-workspace-site">
      <div>
        <dt>现在在哪个阶段</dt>
        <dd data-testid="site-now-stage">{{ view.nowStage }}</dd>
      </div>
      <div>
        <dt>AI 正在做什么</dt>
        <dd data-testid="site-ai-doing">{{ view.aiDoingNow }}</dd>
      </div>
      <div>
        <dt>哪些成果等我审核</dt>
        <dd data-testid="site-awaiting-review">{{ view.awaitingReview }}</dd>
      </div>
      <div>
        <dt>哪些条件阻碍推进</dt>
        <dd data-testid="site-blocking">{{ view.blockingAdvance }}</dd>
      </div>
    </dl>
    <dl>
      <div>
        <dt>阶段目的</dt>
        <dd>{{ view.purpose }}</dd>
      </div>
      <div>
        <dt>必需成果</dt>
        <dd>{{ view.requiredOutcomes }}</dd>
      </div>
      <div>
        <dt>AI 工作</dt>
        <dd>{{ view.aiWork }}</dd>
      </div>
      <div>
        <dt>我的职责</dt>
        <dd>{{ view.myDuty }}</dd>
      </div>
      <div>
        <dt>通过条件</dt>
        <dd>{{ view.passConditions }}</dd>
      </div>
      <div>
        <dt>当前缺口</dt>
        <dd>{{ view.gaps }}</dd>
      </div>
    </dl>
    <Button size="small" data-testid="stage-workspace-toggle" @click="toggleDetails">
      {{ open ? '收起小阶段和动作' : '展开小阶段和动作' }}
    </Button>
    <ul v-if="open" data-testid="stage-workspace-details">
      <li v-if="!view.subStages.length">没有小阶段</li>
      <li v-for="stage in view.subStages" :key="stage.code">
        <button type="button" class="substage-toggle" @click="toggleSub(stage.code)">
          {{ openSub === stage.code ? '收起' : '展开' }} {{ stage.name }}（{{ stage.code }}）
        </button>
        <ul v-if="openSub === stage.code">
          <li v-if="!stage.actions.length">没有动作</li>
          <li v-for="action in stage.actions" :key="action.code">{{ action.name }}（{{ action.code }}）</li>
        </ul>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.stage-workspace { margin-top: 16px; display: grid; gap: 8px; }
.stage-workspace h3 { font-size: 16px; font-weight: 600; }
.stage-workspace dl { display: grid; gap: 6px; margin: 0; }
.stage-workspace div { display: grid; grid-template-columns: 9em minmax(0, 1fr); gap: 8px; }
.stage-workspace dt { color: var(--ipd-muted); }
.stage-workspace dd { margin: 0; }
.substage-toggle { background: none; border: 0; color: inherit; cursor: pointer; padding: 0; text-align: left; }
</style>
