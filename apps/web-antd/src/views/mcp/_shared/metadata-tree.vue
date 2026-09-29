<script setup lang="ts">
/**
 * 元数据 Schema 树（Track E2）。自递归组件（metadata-tree.vue 文件名自引用）。
 * 取色 `var(--ipd-*)`、Tag 圆角 4px（约束 #21）。kind 三态 Tag 呼应 29970
 * Schema Viewer 的类型着色语义，色板只用 ipd token。
 */
import type { MetadataNode } from './market-metadata';

defineProps<{ nodes: MetadataNode[] }>();

const kindLabel: Record<MetadataNode['kind'], string> = {
  array: '数组',
  object: '对象',
  scalar: '值',
};
</script>

<template>
  <ul class="ipd-md-tree">
    <li v-for="node in nodes" :key="node.key + node.value" class="ipd-md-node">
      <div class="ipd-md-line">
        <span :class="`ipd-md-kind ipd-md-kind--${node.kind}`">
          {{ kindLabel[node.kind] }}
        </span>
        <span class="ipd-md-key">{{ node.key }}</span>
        <span class="ipd-md-value">{{ node.value }}</span>
      </div>
      <MetadataTree
        v-if="node.children.length > 0"
        :nodes="node.children"
        class="ipd-md-children"
      />
    </li>
  </ul>
</template>

<style scoped>
.ipd-md-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.ipd-md-children {
  border-left: 1px solid var(--ipd-line);
  margin-left: 10px;
  padding-left: 10px;
}

.ipd-md-line {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  font-size: 12px;
  gap: 6px;
  line-height: 20px;
}

.ipd-md-kind {
  border: 1px solid var(--ipd-line);
  border-radius: 4px;
  color: var(--ipd-muted);
  flex: 0 0 auto;
  font-size: 11px;
  padding: 0 6px;
}

.ipd-md-kind--object {
  background: var(--ipd-blue-soft);
  border-color: var(--ipd-blue);
  color: var(--ipd-blue-dark);
}

.ipd-md-kind--array {
  background: var(--ipd-bg);
  border-color: var(--ipd-amber);
  color: var(--ipd-amber);
}

.ipd-md-key {
  color: var(--ipd-text);
  font-weight: 600;
  word-break: break-all;
}

.ipd-md-value {
  color: var(--ipd-muted);
  word-break: break-all;
}
</style>
