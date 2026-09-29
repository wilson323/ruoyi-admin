/**
 * 蜂群进度订阅宿主（AG-UI 单轨，2026-09-29）：useAgent 订阅 SUBAGENT_ 与 STEP_ 事件 → 增量构建 VM → 条件渲染。
 *
 * 走 CopilotKit 一等订阅子系统（AbstractAgent.subscribe + AgentSubscriber 的 onSubagentStartedEvent 等
 * 原生回调），<b>非平行卡片体系</b>（单轨红线 #2）：不进卡片注册表、不新建聊天 UI、复用同一
 * agentId 'ipd_copilot'（契约 §3.1）。事件词表与后端 AgUiEvents 工厂、AgUiEventType 枚举同源
 * （SSOT：docs/copilotkit单轨融合契约-20260928.md）。
 *
 * 无生产者时（当前 chatStream 为单一 RAG 流，不下发 SUBAGENT_ 与 STEP_ 事件）VM 为空 → 渲染 null
 * （优雅空态，不谎称有实时数据）。挂载于 CopilotKitProvider 内（ai-assistant.vue 与
 * IpdAiCardRenderHost / IpdGuideScriptHost 并列）。
 */
import { computed, defineComponent, h, onBeforeUnmount, ref, watch } from 'vue';

import { useAgent } from '@copilotkit/vue/v2';

import { foldSwarmEvents, type SwarmEvent } from './swarm-progress';
import SwarmProgressCard from './swarm-progress.vue';

/** 与 ai-assistant.vue / 契约 §3.1 同口径的 agentId（单轨：不新建第二个 agent）。 */
const SWARM_AGENT_ID = 'ipd_copilot';

/**
 * 订阅宿主（renderless 之外唯一职责=条件渲染进度卡）。
 * 事件缓冲为不可变数组（每次 push 换新引用触发响应）；vm 由纯函数 foldSwarmEvents 派生，
 * 订阅接线与折叠逻辑解耦（折叠行为由 swarm-progress.test.ts 钉死，接线由本宿主的 onEvent 契约保证）。
 */
export const IpdSwarmProgressHost = defineComponent({
  name: 'IpdSwarmProgressHost',
  setup() {
    const { agent } = useAgent({ agentId: SWARM_AGENT_ID });
    const events = ref<SwarmEvent[]>([]);
    let unsubscribe: null | (() => void) = null;

    const vm = computed(() => foldSwarmEvents(events.value));

    function push(event: SwarmEvent): void {
      events.value = [...events.value, event];
    }

    // 订阅随 agent 实例切换重建；agent 为 null（未连接/已卸载）时退订并清空缓冲。
    watch(
      agent,
      (instance) => {
        unsubscribe?.();
        unsubscribe = null;
        events.value = [];
        if (!instance) return;
        const sub = instance.subscribe({
          // 每个 run 起点重置缓冲：进度卡只呈现当前 run 的蜂群，不跨 run 累积。
          onRunStartedEvent: () => {
            events.value = [];
          },
          // 子智能体生命周期：缺 timestamp 时补挂壁钟到达时间，使 durationMs 可算（fold 契约）。
          onSubagentStartedEvent: ({ event }) => {
            push({ ...event, timestamp: event.timestamp ?? Date.now() });
          },
          onSubagentFinishedEvent: ({ event }) => {
            push({ ...event, timestamp: event.timestamp ?? Date.now() });
          },
          onSubagentErrorEvent: ({ event }) => {
            push({ ...event, timestamp: event.timestamp ?? Date.now() });
          },
          // 步骤节拍：归属由 event.subagentRunId 决定（fold 内惰性建任务，步骤永不丢失）。
          onStepStartedEvent: ({ event }) => {
            push({ ...event });
          },
          onStepFinishedEvent: ({ event }) => {
            push({ ...event });
          },
        });
        unsubscribe = sub.unsubscribe;
      },
      { immediate: true },
    );

    onBeforeUnmount(() => {
      unsubscribe?.();
      unsubscribe = null;
    });

    // 优雅空态：无子任务时渲染 null（不占位、不谎称有数据）；有任务才挂进度卡。
    return () =>
      vm.value.tasks.length === 0
        ? null
        : h(SwarmProgressCard, { vm: vm.value });
  },
});
