<script setup lang="ts">
/**
 * 工具墙抽屉壳（Track E2）。Vben drawer 连接组件（与 market-drawer.vue 同款模式），
 * data 协议：{ marketId: number }。
 */
import { ref } from 'vue';

import { useVbenDrawer } from '@vben/common-ui';

import MarketToolWall from './market-tool-wall.vue';

const marketId = ref<null | number>(null);

const [BasicDrawer, drawerApi] = useVbenDrawer({
  onOpenChange(isOpen) {
    if (!isOpen) {
      return null;
    }
    const data = drawerApi.getData() as { marketId: number };
    marketId.value = data.marketId;
    return null;
  },
});
</script>

<template>
  <BasicDrawer class="w-[1000px]" title="市场工具墙">
    <MarketToolWall v-if="marketId !== null" :market-id="marketId" />
    <div v-else class="ipd-wall__empty">缺少市场标识：请从市场列表重新打开。</div>
  </BasicDrawer>
</template>

<style scoped>
.ipd-wall__empty {
  color: var(--ipd-muted);
  font-size: 12px;
}
</style>
