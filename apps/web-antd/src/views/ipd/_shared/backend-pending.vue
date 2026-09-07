<script setup lang="ts">
/**
 * 后端接口未交付页面的统一占位视图。
 * 规则（验收底线 + G-06）：不展示任何模拟数据；只说明看板卡号与后端依赖。
 * 兼容两种用法：路由 meta（ipdCard / ipdBackend / ipdNote）或直接传 props。
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Card } from 'ant-design-vue';

const props = defineProps<{ backend?: string; card?: string; note?: string }>();
const route = useRoute();
const card = computed(() => props.card ?? String(route.meta.ipdCard ?? '待补充'));
const backend = computed(() => props.backend ?? String(route.meta.ipdBackend ?? '待补充'));
const note = computed(() => props.note ?? String(route.meta.ipdNote ?? ''));
</script>

<template>
  <div class="flex min-h-[320px] items-center justify-center p-4">
    <Card class="w-full max-w-[560px]" role="status">
      <Alert
        message="该页面已登记，后端接口尚未交付"
        show-icon
        type="info"
      >
        <template #description>
          <p>看板卡：{{ card }}</p>
          <p>后端依赖：{{ backend }}</p>
          <p v-if="note">{{ note }}</p>
          <p class="text-muted-foreground mt-2 text-xs">
            后端接口交付前本页不展示任何模拟数据；交付后将按真实接口实现。
          </p>
        </template>
      </Alert>
    </Card>
  </div>
</template>
