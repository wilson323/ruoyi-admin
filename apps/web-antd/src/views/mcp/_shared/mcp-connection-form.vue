<template>
  <div class="conn-form" data-testid="mcp-conn-form">
    <!-- 方案 a 空态卡（#19）：编辑态且未点「替换配置」时的唯一呈现 -->
    <div
      v-if="mode === 'edit' && !replaced"
      class="conn-sealed"
      data-testid="mcp-conn-sealed"
    >
      <div class="conn-sealed-title">连接配置已安全保存，不显示明文</div>
      <div class="conn-sealed-help">
        出于安全设计，接口不回显连接配置。留空提交将保留原配置；如需更换，点「替换配置」重新填写（原配置将被覆写）。
      </div>
      <a-button data-testid="mcp-conn-replace" @click="replaced = true">
        替换配置
      </a-button>
    </div>

    <template v-else>
      <div class="conn-mode-row">
        <a-radio-group v-model:value="view" button-style="solid" size="small">
          <a-radio-button value="structured">结构化</a-radio-button>
          <a-radio-button value="json">高级/JSON</a-radio-button>
        </a-radio-group>
        <a-button
          v-if="mode === 'edit'"
          size="small"
          type="link"
          @click="replaced = false"
        >
          取消替换（留空保留原配置）
        </a-button>
      </div>

      <template v-if="view === 'structured'">
        <template v-if="type === 'LOCAL'">
          <label class="conn-label" for="mcp-conn-command">command（必填）</label>
          <a-input
            id="mcp-conn-command"
            v-model:value="draft.command"
            class="conn-control"
            data-testid="mcp-conn-command"
            placeholder="npx"
          />
          <label class="conn-label">args（数组，按序追加）</label>
          <div
            v-for="(_arg, index) in draft.args"
            :key="index"
            class="conn-arg-row"
          >
            <a-input
              v-model:value="draft.args[index]"
              :data-testid="`mcp-conn-arg-${index}`"
              class="conn-control"
              placeholder="-y"
            />
            <a-button danger size="small" @click="draft.args.splice(index, 1)">
              移除
            </a-button>
          </div>
          <a-button
            data-testid="mcp-conn-arg-add"
            size="small"
            @click="draft.args.push('')"
          >
            + 追加参数
          </a-button>
        </template>
        <template v-else-if="type === 'REMOTE'">
          <label class="conn-label" for="mcp-conn-base-url">baseUrl（必填）</label>
          <a-input
            id="mcp-conn-base-url"
            v-model:value="draft.baseUrl"
            class="conn-control"
            data-testid="mcp-conn-base-url"
            placeholder="https://host/mcp"
          />
        </template>
        <template v-else>
          <div class="conn-builtin" data-testid="mcp-conn-builtin">
            内置工具无需连接配置。
          </div>
        </template>
      </template>

      <template v-else>
        <label class="conn-label" for="mcp-conn-json">
          连接配置 JSON（高级视图）
        </label>
        <a-textarea
          id="mcp-conn-json"
          v-model:value="jsonText"
          :rows="6"
          class="conn-control"
          data-testid="mcp-conn-json"
          @change="syncFromJson"
        />
        <div
          v-if="jsonError"
          class="conn-error"
          data-testid="mcp-conn-json-error"
        >
          {{ jsonError }}
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

import {
  Button as AButton,
  Input as AInput,
  RadioButton as ARadioButton,
  RadioGroup as ARadioGroup,
  Textarea as ATextarea,
} from 'ant-design-vue';

import {
  buildConfigJson,
  emptyConnectionDraft,
  parseConfigJson,
  validateConnectionDraft,
  type ConnectionDraft,
  type McpToolType,
} from './connection-config';

const props = defineProps<{ mode: 'create' | 'edit'; type: McpToolType }>();

const draft = defineModel<ConnectionDraft>('draft', {
  default: () => emptyConnectionDraft(),
});
const replaced = defineModel<boolean>('replaced', { default: false });

const view = ref<'json' | 'structured'>('structured');
const jsonText = ref('');
const jsonError = ref('');

/**
 * JSON 框输入回同步期间置位：跳过「草稿→JSON」投影回写，避免把用户正在敲的
 * 文本规范化后重写（光标跳尾）。视图切换/结构化改动仍按草稿重建投影。
 */
let jsonSyncing = false;

watch(
  [draft, view],
  () => {
    if (view.value === 'json' && !jsonSyncing) {
      jsonText.value = buildConfigJson(props.type, draft.value);
    }
    jsonSyncing = false;
  },
  { deep: true, immediate: true },
);

function syncFromJson() {
  const parsed = parseConfigJson(props.type, jsonText.value);
  if (!parsed) {
    jsonError.value =
      'JSON 非法或形状不符（LOCAL 需 command+args[]；REMOTE 需 baseUrl）';
    return;
  }
  jsonError.value = '';
  jsonSyncing = true;
  draft.value = parsed;
}

/** 校验（提交前调用）：空数组=通过；edit 未替换时直接通过（留空保留）。 */
function validate(): string[] {
  if (props.mode === 'edit' && !replaced.value) return [];
  return validateConnectionDraft(props.type, draft.value);
}

/** 提交载荷：null = 不带 configJson 键（方案 a 留空保留）。 */
function getConfigJson(): null | string {
  if (props.type === 'BUILTIN') return null;
  if (props.mode === 'edit' && !replaced.value) return null;
  if (validate().length > 0) return null;
  return buildConfigJson(props.type, draft.value);
}

defineExpose({ getConfigJson, validate });
</script>

<style scoped>
.conn-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-bg);
}
.conn-sealed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px dashed var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-surface);
}
.conn-sealed-title {
  color: var(--ipd-text);
  font-size: 13px;
  font-weight: 600;
}
.conn-sealed-help {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 1.8;
}
.conn-mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.conn-label {
  color: var(--ipd-text);
  font-size: 12px;
}
.conn-control {
  border-radius: 6px;
}
.conn-arg-row {
  display: flex;
  gap: 6px;
}
.conn-error {
  color: var(--ipd-red);
  font-size: 12px;
}
.conn-builtin {
  color: var(--ipd-muted);
  font-size: 12px;
}
</style>
