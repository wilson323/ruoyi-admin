<script setup lang="ts">
import { Alert, Empty, Pagination, Spin } from 'ant-design-vue';

defineProps<{
  title: string;
  loading: boolean;
  error: boolean;
  total: number;
  page: number;
  pageSize: number;
  emptyText?: string;
}>();

const emit = defineEmits<{
  (e: 'page-change', page: number, size: number): void;
}>();
</script>

<template>
  <section class="ipd-catalog" :aria-label="title">
    <div class="ipd-catalog__header">
      <div>
        <h2>{{ title }}</h2>
        <span class="ipd-catalog__count">共 {{ total }} 条记录</span>
      </div>
      <div class="ipd-catalog__actions"><slot name="actions" /></div>
    </div>
    <div class="ipd-catalog__filters"><slot name="filters" /></div>
    <Alert v-if="error" type="error" show-icon message="列表加载失败，请重试" />
    <Spin :spinning="loading">
      <div class="ipd-catalog__grid"><slot /></div>
      <Empty
        v-if="!loading && !error && total === 0"
        :description="emptyText || '暂无数据'"
      />
    </Spin>
    <Pagination
      v-if="total > pageSize"
      :current="page"
      :page-size="pageSize"
      :total="total"
      show-size-changer
      :page-size-options="['12', '24', '48']"
      @change="(next, size) => emit('page-change', next, size)"
    />
  </section>
</template>

<style scoped>
.ipd-catalog {
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  padding: 20px;
}
.ipd-catalog__header,
.ipd-catalog__filters {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
}
.ipd-catalog__header h2 {
  color: var(--ipd-text);
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.ipd-catalog__count {
  color: var(--ipd-muted);
  font-size: 12px;
}
.ipd-catalog__actions,
.ipd-catalog__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ipd-catalog__grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
}
:deep(.ipd-catalog-card) {
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  height: 100%;
}
:deep(.ipd-catalog-card .ant-card-body) {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}
:deep(.ipd-catalog-card__title) {
  color: var(--ipd-text);
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
:deep(.ipd-catalog-card__description) {
  color: var(--ipd-muted);
  font-size: 13px;
  line-height: 20px;
  min-height: 40px;
  overflow-wrap: anywhere;
}
:deep(.ipd-catalog-card__meta) {
  color: var(--ipd-muted);
  display: flex;
  flex-wrap: wrap;
  font-size: 12px;
  gap: 6px 12px;
}
:deep(.ipd-catalog-card__actions) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}
</style>
