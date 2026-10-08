<script lang="ts" setup>
/**
 * IPD 域统一内容查看弹窗（规范见《IPD前端内容查看接入规范-20261008.md》）。
 *
 * text 纯文本 / html 过 sanitize 进 sandbox iframe / image viewer / binary 下载兜底。
 * 附件拉取由调用方注入 fetch（页面侧包 ipdDownload），组件不自接会话层。
 */
import { Button, Image, Modal, Spin } from 'ant-design-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { ipdErrorText } from '../ipd-error-text';
import {
  downloadBlob,
  isImageBlob,
  isPdfBlob,
  isTextualBlob,
  resolveContentViewKind,
  type IpdContentViewPayload,
} from './ipd-content-view';
import { sanitizeHtml } from './sanitize';

const props = defineProps<{
  open: boolean;
  payload: IpdContentViewPayload | null;
}>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const loading = ref(false);
const loadError = ref('');
/** download 拉回后的实际展示分流：objectURL 图片/PDF / 读出的文本。 */
const fetchedImage = ref('');
const fetchedPdf = ref('');
const fetchedText = ref('');
let fetchedObjectUrl = '';

const kind = computed(() => (props.payload ? resolveContentViewKind(props.payload) : null));

const sanitizedHtml = computed(() => {
  if (!props.payload?.html) return '';
  return sanitizeHtml(props.payload.html);
});

function resetFetched(): void {
  if (fetchedObjectUrl) URL.revokeObjectURL(fetchedObjectUrl);
  fetchedObjectUrl = '';
  fetchedImage.value = '';
  fetchedPdf.value = '';
  fetchedText.value = '';
  loadError.value = '';
  loading.value = false;
}

async function loadAttachment(): Promise<void> {
  const payload = props.payload;
  const download = payload?.download;
  if (!payload || !download) return;
  loading.value = true;
  loadError.value = '';
  try {
    const blob = await download.fetch();
    if (props.payload !== payload) return; // 弹窗已切到别的内容，丢弃本次结果
    if (isPdfBlob(blob, download.filename)) {
      fetchedObjectUrl = URL.createObjectURL(blob);
      fetchedPdf.value = fetchedObjectUrl;
    } else if (isImageBlob(blob, download.filename)) {
      fetchedObjectUrl = URL.createObjectURL(blob);
      fetchedImage.value = fetchedObjectUrl;
    } else if (isTextualBlob(blob, download.filename)) {
      fetchedText.value = await blob.text();
    }
    // 其余保持 binary 兜底（提示 + 下载），不视为错误。
  } catch (error) {
    if (props.payload === payload) {
      loadError.value = ipdErrorText(error, { fallback: '附件加载失败，请重试' });
    }
  } finally {
    if (props.payload === payload) loading.value = false;
  }
}

watch(
  () => [props.open, props.payload] as const,
  ([open]) => {
    resetFetched();
    if (!open) return;
    // 只有依赖附件 blob 的形态才需要拉取（imageUrl 直连的图片不必）。
    if (kind.value === 'binary' || kind.value === 'pdf'
      || (kind.value === 'image' && !props.payload?.imageUrl)) {
      void loadAttachment();
    }
  },
  { immediate: true },
);

onBeforeUnmount(resetFetched);

const downloading = ref(false);
async function handleDownload(): Promise<void> {
  const download = props.payload?.download;
  if (!download || downloading.value) return;
  downloading.value = true;
  try {
    downloadBlob(await download.fetch(), download.filename);
  } catch (error) {
    loadError.value = ipdErrorText(error, { fallback: '附件下载失败，请重试' });
  } finally {
    downloading.value = false;
  }
}

function close(): void {
  emit('update:open', false);
}
</script>

<template>
  <Modal
    :open="open"
    :title="payload?.title ?? '查看内容'"
    :width="720"
    :footer="null"
    destroy-on-close
    data-testid="ipd-content-view"
    @cancel="close"
  >
    <div v-if="payload" class="content-view-body">
      <div v-if="loading" class="content-view-state"><Spin /></div>
      <div v-else-if="loadError" class="content-view-state">
        <p class="content-view-error">{{ loadError }}</p>
        <Button size="small" @click="loadAttachment">重试</Button>
      </div>
      <p v-else-if="kind === null" class="content-view-state">暂无内容</p>
      <pre v-else-if="kind === 'text'" class="content-view-text" data-testid="ipd-content-text">{{ payload.text }}</pre>
      <iframe
        v-else-if="kind === 'html'"
        class="content-view-frame"
        sandbox=""
        :srcdoc="sanitizedHtml"
        title="内容预览"
        data-testid="ipd-content-frame"
      />
      <template v-else-if="kind === 'image'">
        <div v-if="fetchedImage || payload.imageUrl" class="content-view-image" data-testid="ipd-content-image">
          <Image :src="fetchedImage || payload.imageUrl" />
        </div>
        <p v-else class="content-view-state">暂无内容</p>
      </template>
      <template v-else-if="kind === 'pdf'">
        <!-- PDF：objectURL 进 iframe，浏览器原生 viewer 完整渲染（含分页/缩放/搜索）。 -->
        <iframe
          v-if="fetchedPdf"
          class="content-view-frame"
          :src="fetchedPdf"
          title="PDF 预览"
          data-testid="ipd-content-pdf"
        />
        <p v-else class="content-view-state">PDF 加载中…</p>
      </template>
      <template v-else>
        <pre v-if="fetchedText" class="content-view-text" data-testid="ipd-content-fetched-text">{{ fetchedText }}</pre>
        <p v-else class="content-view-hint">该格式不支持在线查看，请下载后打开。</p>
      </template>
      <div v-if="payload.download" class="content-view-actions">
        <Button size="small" type="primary" :loading="downloading" @click="handleDownload">下载</Button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.content-view-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 120px;
}
.content-view-state,
.content-view-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  margin: 0;
  font-size: 13px;
  color: var(--ipd-text-2, #666);
}
.content-view-error {
  margin: 0;
  color: var(--ipd-danger, #cf1322);
}
.content-view-text {
  max-height: 60vh;
  padding: 10px;
  margin: 0;
  overflow: auto;
  font-family: var(--ipd-font, inherit);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
  background: var(--ipd-bg, #fafafa);
  border: 1px solid var(--ipd-line, #eee);
  border-radius: 4px;
}
.content-view-frame {
  width: 100%;
  height: 60vh;
  background: #fff;
  border: 1px solid var(--ipd-line, #eee);
  border-radius: 4px;
}
.content-view-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
