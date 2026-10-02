<script lang="ts" setup>
/**
 * 当前产物版本的审核通过 / 退回修改。
 *
 * 挂在已有项目智能体侧栏或文档版本链上，不新开页面、不发起运行。
 * 意见只提交到链头这一版。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { Alert, Button, Input, Modal } from 'ant-design-vue';

import {
  type AiDocument,
  listAiDocumentVersions,
  rejectAiDocumentVersion,
  reviewAiDocumentVersion,
} from '../../../../api/ipd/ai-document';
import { ipdErrorText } from '../ipd-error-text';
import { documentStatusLabel, headReviewActions } from './document-review-actions';

const props = defineProps<{
  documentId: string;
  projectId: string;
}>();

const chain = ref<AiDocument[]>([]);
const loading = ref(false);
const acting = ref(false);
const errorText = ref('');
const returnOpen = ref(false);
const returnComment = ref('');
let identityEpoch = 0;
let loadEpoch = 0;
onUnmounted(() => { identityEpoch++; loadEpoch++; });

const ordered = computed(() =>
  [...chain.value].sort((left, right) => left.versionNo - right.versionNo),
);
const root = computed(() => ordered.value[0] ?? null);
const head = computed(() => ordered.value[ordered.value.length - 1] ?? null);
const actions = computed(() => headReviewActions(head.value?.status ?? ''));
const commentReady = computed(() => returnComment.value.trim().length > 0);

/** 按文档编号拉版本链。项目不一致时不给出审核按钮。 */
async function loadChain(): Promise<void> {
  const epoch = ++loadEpoch;
  const identity = identityEpoch;
  const documentId = props.documentId;
  const projectId = props.projectId;
  if (!/^\d+$/.test(props.documentId) || !/^\d+$/.test(props.projectId)) {
    chain.value = [];
    loading.value = false;
    errorText.value = '缺少项目或文档编号，无法审核这一版。';
    return;
  }
  loading.value = true;
  errorText.value = '';
  try {
    const rows = await listAiDocumentVersions(documentId);
    if (epoch !== loadEpoch || identity !== identityEpoch) return;
    if (!rows.every((row) => row.projectId === projectId) || rows.length === 0) {
      chain.value = [];
      errorText.value = '该文档不属于当前项目，或还没有可审核的版本。';
      return;
    }
    chain.value = rows;
  } catch (error) {
    if (epoch !== loadEpoch || identity !== identityEpoch) return;
    chain.value = [];
    errorText.value = ipdErrorText(error, { domain: 'ai_document', fallback: '版本链加载失败' });
  } finally {
    if (epoch === loadEpoch && identity === identityEpoch) loading.value = false;
  }
}

watch(() => [props.documentId, props.projectId], () => {
  identityEpoch++;
  chain.value = [];
  returnOpen.value = false;
  returnComment.value = '';
  acting.value = false;
  void loadChain();
}, { immediate: true });

/** 审核通过当前链头。不发起新的项目智能体运行。 */
async function approveHead(): Promise<void> {
  if (!root.value || !head.value || !actions.value.approve || acting.value) return;
  const identity = identityEpoch;
  acting.value = true;
  errorText.value = '';
  try {
    await reviewAiDocumentVersion(root.value.id, head.value.id);
    if (identity !== identityEpoch) return;
    await loadChain();
  } catch (error) {
    if (identity !== identityEpoch) return;
    errorText.value = ipdErrorText(error, { domain: 'ai_document', fallback: '审核通过失败' });
  } finally {
    if (identity === identityEpoch) acting.value = false;
  }
}

function openReturn(): void {
  if (!actions.value.reject) return;
  returnComment.value = '';
  returnOpen.value = true;
}

/** 退回修改。意见绑定链头版本，空意见不提交。 */
async function submitReturn(): Promise<void> {
  const comment = returnComment.value.trim();
  if (!root.value || !head.value || !actions.value.reject || !comment || acting.value) return;
  const identity = identityEpoch;
  acting.value = true;
  errorText.value = '';
  try {
    await rejectAiDocumentVersion(root.value.id, head.value.id, { comment });
    if (identity !== identityEpoch) return;
    returnOpen.value = false;
    await loadChain();
  } catch (error) {
    if (identity !== identityEpoch) return;
    errorText.value = ipdErrorText(error, { domain: 'ai_document', fallback: '退回修改失败' });
  } finally {
    if (identity === identityEpoch) acting.value = false;
  }
}
</script>

<template>
  <section class="doc-review" data-testid="document-version-review">
    <h3>当前产物</h3>
    <p v-if="loading">正在读取这一版……</p>
    <Alert v-if="errorText" :message="errorText" show-icon type="error" />
    <template v-if="head && root">
      <p>
        v{{ head.versionNo }} · {{ head.title }} · {{ documentStatusLabel(head.status) }}
      </p>
      <p v-if="head.reviewComment" data-testid="document-review-comment-bound">
        这一版的意见：{{ head.reviewComment }}
      </p>
      <pre>{{ head.content }}</pre>
      <div class="doc-review-actions">
        <Button
          v-if="actions.approve"
          :loading="acting"
          data-testid="document-review-approve"
          type="primary"
          @click="approveHead"
        >
          审核通过
        </Button>
        <Button
          v-if="actions.reject"
          :disabled="acting"
          danger
          data-testid="document-review-reject"
          @click="openReturn"
        >
          退回修改
        </Button>
      </div>
      <p class="doc-review-note">只处理这一版。不会同时批准动作或放行 Gate，也不会自动再跑项目智能体。</p>
    </template>
    <Modal
      v-model:open="returnOpen"
      :confirm-loading="acting"
      :ok-button-props="{ disabled: !commentReady }"
      cancel-text="取消"
      ok-text="确认退回"
      title="退回修改"
      @ok="submitReturn"
    >
      <p>意见只写在 v{{ head?.versionNo }}（版本 {{ head?.id }}）。</p>
      <Input.TextArea
        v-model:value="returnComment"
        data-testid="document-review-comment"
        :maxlength="1000"
        placeholder="填写退回意见"
        :rows="4"
      />
    </Modal>
  </section>
</template>

<style scoped>
.doc-review {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ipd-line, #e5e7eb);
}

.doc-review h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.doc-review pre {
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 12px;
}

.doc-review-actions {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}

.doc-review-note {
  margin: 0;
  color: #667085;
  font-size: 12px;
}
</style>
