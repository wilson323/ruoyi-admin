<script lang="ts" setup>
/**
 * IPD 列表页三态组件（V9）。
 *
 * <p>覆盖 4 态：
 * <ul>
 *   <li>loading — Spin 加载中</li>
 *   <li>empty — 数据为空，customDescription 可覆写</li>
 *   <li>error — 业务错误（HTTP 4xx/5xx 业务码），含 retry</li>
 *   <li>network — 断网 / 超时（transport 错误），含 retry + 醒目提示</li>
 * </ul>
 *
 * <p>使用方式：
 * <pre>
 * &lt;ThreeState
 *   :loading="loading"
 *   :error="loadError"
 *   :items="rows"
 *   :retry="load"
 *   empty-text="暂无项目"
 * &gt;
 *   &lt;Table :data-source="rows" /&gt;
 * &lt;/ThreeState&gt;
 * </pre>
 *
 * <p>error 区分 network / business：基于 IpdRequestError.kind === 'transport' 判定。
 */
import { computed } from 'vue';
import { Alert, Button, Empty, Spin } from 'ant-design-vue';

import { isTransportError, ipdErrorText } from './ipd-error-text';

interface Props {
  loading?: boolean;
  /** 业务错误 / 断网错误。null 表示无错误。 */
  error?: null | unknown;
  /** 列表数据：用于 empty 判定。空数组视作 empty。 */
  items?: readonly unknown[];
  /** 点击重试按钮的回调（必填，error 态显示） */
  retry: () => void | Promise<void>;
  /** empty 态描述（可覆盖默认文案） */
  emptyText?: string;
  /** empty 态图片类型（ant-design-vue Empty 组件 type） */
  emptyType?: 'default' | 'simple' | 'noResult' | 'noData' | 'notFound' | 'forbidden' | 'network' | 'noAuth';
  /** loading 高度（CSS） */
  height?: string;
  /** error 态覆写错误码文案（页面级 codeTexts） */
  codeTexts?: Record<number, string>;
  /** error 态指定域（用于 ipdErrorText 域默认值查找） */
  domain?: 'ai_document' | 'bid' | 'portal' | 'project';
}

const props = withDefaults(defineProps<Props>(), {
  codeTexts: () => ({}),
  emptyText: '暂无数据',
  emptyType: 'noData',
  height: '160px',
  items: () => [],
  loading: false,
});

const errorMessage = computed(() => {
  if (!props.error) return '';
  if (isTransportError(props.error)) return '网络异常：无法连接服务，请检查网络后重试';
  return ipdErrorText(props.error, { codeTexts: props.codeTexts, domain: props.domain });
});

const isNetworkError = computed(() => isTransportError(props.error));
const hasError = computed(() => Boolean(props.error));
const isEmpty = computed(() => !props.loading && !hasError.value && props.items.length === 0);
</script>

<template>
  <div class="ipd-three-state">
    <div v-if="loading" class="ipd-loading" :style="{ minHeight: height }">
      <Spin tip="加载中..." />
    </div>

    <Alert
      v-else-if="hasError"
      :message="isNetworkError ? '网络异常' : '加载失败'"
      :description="errorMessage"
      :type="isNetworkError ? 'warning' : 'error'"
      show-icon
      class="ipd-error"
    >
      <template #description>
        <div class="ipd-error-desc">
          <span>{{ errorMessage }}</span>
          <Button size="small" @click="retry">重新加载</Button>
        </div>
      </template>
    </Alert>

    <Empty
      v-else-if="isEmpty"
      :description="emptyText"
      :image="emptyType"
      class="ipd-empty"
    />

    <template v-else>
      <slot />
    </template>
  </div>
</template>

<style scoped>
.ipd-three-state {
  width: 100%;
}
.ipd-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.ipd-error-desc {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.ipd-empty {
  padding: 32px 0;
}
</style>
