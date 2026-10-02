<script lang="ts" setup>
/**
 * 本次运行里、定档之前的生成预览。
 *
 * HTML 只进 sandbox 为空的 iframe（srcdoc 已去掉 script 与 on*）。
 * 文档保持纯文本。流式中标题固定为「正在生成」。
 */
import type { LiveGeneratedPreview } from './artifact-live-preview';

interface Props {
  /** 为 true 时标题固定为「正在生成」，正文仍随回答变长。 */
  loading?: boolean;
  /** liveGeneratedPreview 的非空结果。 */
  preview: LiveGeneratedPreview;
}

withDefaults(defineProps<Props>(), {
  loading: false,
});
</script>

<template>
  <section class="live-preview" data-testid="artifact-live-preview">
    <p class="live-preview-title">{{ loading ? '正在生成' : preview.title }}</p>
    <iframe
      v-if="preview.kind === 'html'"
      class="live-preview-frame"
      sandbox=""
      :srcdoc="preview.body"
      title="生成的页面"
      data-testid="artifact-html-frame"
    />
    <pre v-else class="live-preview-doc">{{ preview.body }}</pre>
  </section>
</template>

<style scoped>
.live-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 8px 10px;
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
}
.live-preview-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.live-preview-frame {
  width: 100%;
  height: 320px;
  background: #fff;
  border: 1px solid var(--ipd-line);
  border-radius: 4px;
}
.live-preview-doc {
  max-height: 320px;
  padding: 8px;
  margin: 0;
  overflow: auto;
  font-family: var(--ipd-font, inherit);
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
  background: var(--ipd-bg);
  border: 1px solid var(--ipd-line);
  border-radius: 4px;
}
</style>
