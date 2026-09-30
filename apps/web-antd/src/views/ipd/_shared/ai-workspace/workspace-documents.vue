<script setup lang="ts">
/** 当前项目的 AI 文档只读预览。先用有项目可见性守卫的详情接口验证访问。 */
import { onUnmounted, ref, watch } from 'vue';

import {
  listAiDocumentsByProject,
  listAiDocumentVersions,
  type AiDocument,
} from '../../../../api/ipd/ai-document';
import { getProject } from '../../../../api/ipd/project';
import { ipdErrorText } from '../ipd-error-text';

const props = defineProps<{ projectId: string }>();
const roots = ref<AiDocument[]>([]);
const selectedRootId = ref('');
const currentVersion = ref<AiDocument | null>(null);
const loading = ref(false);
const loadingVersion = ref(false);
const errorText = ref('');
let projectEpoch = 0;
let versionEpoch = 0;

async function selectDocument(rootId: string, projectAtStart = projectEpoch) {
  if (!roots.value.some((item) => item.id === rootId)) return;
  const versionAtStart = ++versionEpoch;
  selectedRootId.value = rootId;
  currentVersion.value = null;
  loadingVersion.value = true;
  errorText.value = '';
  try {
    const versions = await listAiDocumentVersions(rootId);
    if (projectAtStart !== projectEpoch || versionAtStart !== versionEpoch) return;
    if (versions.some((item) => item.projectId !== props.projectId)) {
      throw new Error('文档项目不一致');
    }
    currentVersion.value = versions.at(-1) ?? null;
  } catch (error) {
    if (projectAtStart !== projectEpoch || versionAtStart !== versionEpoch) return;
    errorText.value = ipdErrorText(error, { domain: 'ai_document', fallback: '文档版本暂不可用' });
  } finally {
    if (projectAtStart === projectEpoch && versionAtStart === versionEpoch) {
      loadingVersion.value = false;
    }
  }
}

async function loadProject(projectId: string) {
  const currentEpoch = ++projectEpoch;
  ++versionEpoch;
  roots.value = [];
  selectedRootId.value = '';
  currentVersion.value = null;
  errorText.value = '';
  loadingVersion.value = false;
  loading.value = !!projectId;
  if (!projectId) return;
  if (!/^\d+$/.test(projectId)) {
    loading.value = false;
    errorText.value = '当前项目上下文无效，文档未加载。';
    return;
  }
  try {
    // 文档列表接口目前只校验读码；本视图先验证当前 Person 对项目可见。
    const project = await getProject(projectId);
    if (currentEpoch !== projectEpoch) return;
    if (project.id !== projectId) throw new Error('项目访问校验失败');
    const documents = await listAiDocumentsByProject(projectId);
    if (currentEpoch !== projectEpoch) return;
    if (documents.some((item) => item.projectId !== projectId)) {
      throw new Error('文档项目不一致');
    }
    roots.value = documents;
    // 列表可用后立即展示，版本请求慢时仍能改选其他文档。
    loading.value = false;
    if (documents[0]) void selectDocument(documents[0].id, currentEpoch);
  } catch (error) {
    if (currentEpoch !== projectEpoch) return;
    errorText.value = ipdErrorText(error, { domain: 'ai_document', fallback: '当前项目文档暂不可用' });
  } finally {
    if (currentEpoch === projectEpoch) loading.value = false;
  }
}

watch(() => props.projectId, (projectId) => void loadProject(projectId), { immediate: true });
onUnmounted(() => { ++projectEpoch; ++versionEpoch; });
</script>

<template>
  <div class="workspace-documents" data-testid="ipd-ai-workspace-documents">
    <p v-if="!projectId" class="doc-empty">选择有权限的项目后，文档会在此自动显示。</p>
    <p v-else-if="loading" class="doc-empty" role="status">正在读取当前项目文档…</p>
    <div v-else-if="errorText && !roots.length" class="doc-empty" role="alert">
      <p>{{ errorText }}</p>
      <button class="doc-retry" type="button" @click="loadProject(projectId)">重试读取文档</button>
    </div>
    <p v-else-if="!roots.length" class="doc-empty">当前项目暂无 AI 文档。</p>
    <template v-else>
      <div class="doc-collection">
        <span class="doc-count">{{ roots.length }} 份文档</span>
        <div class="doc-list" aria-label="当前项目文档">
          <button
            v-for="root in roots"
            :key="root.id"
            :aria-pressed="selectedRootId === root.id"
            :data-testid="`ipd-ai-document-${root.id}`"
            class="doc-option"
            type="button"
            @click="selectDocument(root.id)"
          >
            {{ root.title }}（版本组）
          </button>
        </div>
      </div>
      <p v-if="loadingVersion" class="doc-empty" role="status">正在读取文档版本…</p>
      <div v-else-if="errorText" class="doc-empty" role="alert">
        <p>{{ errorText }}</p>
        <button class="doc-retry" type="button" @click="selectDocument(selectedRootId)">重试读取版本</button>
      </div>
      <article v-else-if="currentVersion" class="doc-preview" data-testid="ipd-ai-document-preview">
        <header class="doc-preview-head">
          <div>
            <h5>{{ currentVersion.title }}</h5>
            <small>版本 {{ currentVersion.versionNo }} · {{ currentVersion.docType || 'AI 文档' }}</small>
          </div>
          <span class="doc-status">{{ currentVersion.status }}</span>
        </header>
        <pre class="doc-content">{{ currentVersion.content }}</pre>
      </article>
      <p v-else class="doc-empty">这份文档没有可显示的版本。</p>
    </template>
  </div>
</template>

<style scoped>
.workspace-documents { display: grid; gap: 10px; }
.doc-empty { margin: 0; padding: 12px; border: 1px dashed var(--ipd-line); border-radius: 8px; background: var(--ipd-bg); color: var(--ipd-muted); font-size: 12px; line-height: 1.7; }
.doc-empty p { margin: 0 0 6px; }
.doc-retry { padding: 3px 8px; border: 1px solid var(--ipd-line); border-radius: 6px; background: var(--ipd-surface); color: var(--ipd-blue); cursor: pointer; }
.doc-retry:focus-visible { outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color); outline-offset: var(--ipd-focus-ring-offset); }
.doc-collection { display: grid; gap: 6px; }
.doc-count { color: var(--ipd-muted); font-size: 11px; }
.doc-list { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.doc-option { flex: 0 0 auto; max-width: 220px; padding: 6px 10px; overflow: hidden; border: 1px solid var(--ipd-line); border-radius: 7px; background: var(--ipd-surface); color: var(--ipd-text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.doc-option[aria-pressed='true'] { border-color: var(--ipd-blue); background: var(--ipd-blue-soft); color: var(--ipd-blue); }
.doc-option:focus-visible { outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color); outline-offset: var(--ipd-focus-ring-offset); }
.doc-preview { overflow: hidden; border: 1px solid var(--ipd-line); border-radius: 10px; background: var(--ipd-surface); }
.doc-preview-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 11px 13px; border-bottom: 1px solid var(--ipd-line); }
.doc-preview-head h5 { margin: 0 0 4px; color: var(--ipd-text); font-size: 13px; }
.doc-preview-head small { color: var(--ipd-muted); font-size: 11px; }
.doc-status { flex: 0 0 auto; padding: 3px 7px; border-radius: 999px; background: var(--ipd-blue-soft); color: var(--ipd-blue); font-size: 10px; }
.doc-content { max-height: 280px; margin: 0; padding: 14px; overflow: auto; color: var(--ipd-text); font-family: inherit; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
