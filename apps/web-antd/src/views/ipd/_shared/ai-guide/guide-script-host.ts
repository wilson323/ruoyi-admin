/**
 * 引导上下文注入宿主（C4b）：把当前小阶段摘要注入 agent context。
 * description=GUIDE_CONTEXT_KEY（'pageContext'）——AgUiCopilotRun.lookup 仅消费
 * projectId/pageContext 两键，value 恒 JSON 字符串。
 * 挂载于 CopilotKitProvider 内（ai-assistant.vue 与 IpdAiCardRenderHost 并列）。
 */
import { defineComponent } from 'vue';

import { useAgentContext } from '@copilotkit/vue/v2';

import { GUIDE_CONTEXT_KEY } from './guide-script';

/**
 * renderless 宿主（同 ai-cards/copilotkit-render.ts IpdAiCardRenderHost 先例）。
 * value 传 getter（MaybeRefOrGetter 契约）保响应性：引导帧更新后上下文随动，
 * 无需重挂组件（较静态值的差异登记见交付说明）。
 */
export const IpdGuideScriptHost = defineComponent({
  name: 'IpdGuideScriptHost',
  props: {
    value: { required: true, type: String },
  },
  setup(props) {
    useAgentContext({
      description: GUIDE_CONTEXT_KEY,
      value: () => props.value,
    });
    return () => null; // 零渲染，仅上下文通道
  },
});
