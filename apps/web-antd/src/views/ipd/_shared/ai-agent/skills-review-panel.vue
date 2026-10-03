<script lang="ts" setup>
import { onUnmounted, ref, watch } from 'vue';
import { Button, Input } from 'ant-design-vue';
import { listAgentRunSkillReviews, reviewAgentRunSkill, type AgentSkillReview } from '../../../../api/ipd/project-agent';
import { ipdErrorText } from '../ipd-error-text';

const props = defineProps<{ runId: string; refreshSeq?: number }>();
const reviews = ref<AgentSkillReview[]>([]);
const loading = ref(false);
const acting = ref<string | null>(null);
const comments = ref<Record<string, string>>({});
const errorText = ref('');
const reviewListConfirmed = ref(false);
let scopeEpoch = 0;
let loadEpoch = 0;
onUnmounted(() => { scopeEpoch++; loadEpoch++; });
async function load(): Promise<void> {
  const scope = scopeEpoch;
  const request = ++loadEpoch;
  const id = props.runId;
  loading.value = true;
  errorText.value = '';
  try {
    const result = await listAgentRunSkillReviews(id);
    if (scope !== scopeEpoch || request !== loadEpoch || id !== props.runId) return;
    reviews.value = Array.isArray(result) ? result : [];
    reviewListConfirmed.value = true;
  } catch (error) {
    if (scope === scopeEpoch && request === loadEpoch) {
      reviewListConfirmed.value = false;
      errorText.value = ipdErrorText(error, { fallback: '技能审核内容暂时无法读取' });
    }
  } finally {
    if (scope === scopeEpoch && request === loadEpoch) loading.value = false;
  }
}
watch(() => props.runId, () => {
  scopeEpoch++; loadEpoch++;
  reviews.value = []; comments.value = {}; acting.value = null;
  reviewListConfirmed.value = false;
  void load();
}, { immediate: true });
watch(() => props.refreshSeq, () => { if (!acting.value) void load(); });
async function review(item: AgentSkillReview, approved: boolean): Promise<void> {
  if (acting.value || loading.value || !reviewListConfirmed.value || item.status !== 'PENDING') return;
  const id = props.runId;
  const epoch = scopeEpoch;
  acting.value = item.candidateSeq;
  errorText.value = '';
  // 作废审核前的在途列表，防止旧 PENDING 回包覆盖最新审核结果。
  loadEpoch++;
  try {
    await reviewAgentRunSkill(id, item.candidateSeq, {
      approved, sha256: item.sha256,
      ...(comments.value[item.candidateSeq]?.trim() ? { comment: comments.value[item.candidateSeq]!.trim() } : {}),
    });
    if (epoch !== scopeEpoch || id !== props.runId) return;
    reviewListConfirmed.value = false;
    // 发布成功只认服务端回读，不能把“同意”请求成功等同可用。
    await load();
  } catch (error) {
    if (epoch === scopeEpoch) errorText.value = ipdErrorText(error, { fallback: '技能审核暂未保存，请重试' });
  } finally { if (epoch === scopeEpoch) acting.value = null; }
}
const statusText = (status: AgentSkillReview['status']) => ({
  PENDING: '待你审核', PUBLISHED: '已发布', REJECTED: '已决定不采用', PUBLISH_FAILED: '已同意，发布未完成',
})[status] ?? '审核结果待确认';
</script>

<template>
  <section v-if="reviews.length || errorText" aria-label="本次运行的技能审核" data-testid="skills-review-panel">
    <header><strong>本次提议的技能</strong><Button size="small" :loading="loading" :disabled="!!acting" data-testid="skills-review-refresh" @click="load">刷新审核结果</Button></header>
    <p>请查看技能正文和所附资源，再决定是否采用。技能审核不代替文档审核、动作批准和阶段验收。</p>
    <p v-if="errorText" role="alert" data-testid="skills-review-error">{{ errorText }}</p>
    <p v-if="reviews.length && !loading && !reviewListConfirmed">审核结果尚未确认，请先刷新审核结果，再决定是否采用。</p>
    <article v-for="item in reviews" :key="item.candidateSeq" :data-candidate-seq="item.candidateSeq">
      <h4>{{ item.skillName }} · {{ statusText(item.status) }}</h4>
      <p v-if="item.scanSummary">{{ item.scanSummary }}</p>
      <p v-if="item.status === 'PUBLISHED'">已发布的版本将在后续运行按所选能力使用；本次运行保留原配置。</p>
      <p v-if="item.status === 'PUBLISH_FAILED'">发布还没完成，当前不能使用，请刷新结果查看处理进度。</p>
      <details v-for="file in item.files" :key="file.path" :open="file.path.endsWith('SKILL.md')">
        <summary>{{ file.path }}</summary>
        <p>内容校验值：{{ file.sha256 }}</p>
        <pre v-if="!file.encoding || file.encoding === 'utf-8' || file.encoding === 'text'">{{ file.content }}</pre>
        <p v-else>此资源以 {{ file.encoding }} 编码保存，请先核实资源内容再决定。</p>
      </details>
      <p v-if="item.reviewComment">审核意见：{{ item.reviewComment }}</p>
      <template v-if="item.status === 'PENDING'">
        <Input.TextArea v-model:value="comments[item.candidateSeq]" :maxlength="2000" placeholder="审核意见（可选）" :disabled="!!acting" />
        <Button type="primary" :loading="acting === item.candidateSeq" :disabled="!!acting || loading || !reviewListConfirmed" data-testid="skill-review-approve" @click="review(item, true)">同意使用</Button>
        <Button :disabled="!!acting || loading || !reviewListConfirmed" data-testid="skill-review-reject" @click="review(item, false)">不采用</Button>
      </template>
    </article>
  </section>
</template>

<style scoped>
header { display: flex; justify-content: space-between; align-items: center; }
article { margin-top: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; }
p { font-size: 12px; line-height: 1.6; }
</style>
