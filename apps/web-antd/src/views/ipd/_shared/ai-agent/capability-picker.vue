<script lang="ts" setup>
/**
 * 项目智能体能力选择器（能力包 / 模型 / Skill / 工具）。
 *
 * <p>只展示并提交服务端返回且可用的模型。未启用的模型不进入下拉，也不在下方逐条
 * 列出原因，避免探测配置把对话框撑开。能力包的不可用原因仍保留。本组件不发请求，
 * 选择变化经 update:modelValue 交给宿主。
 */
import { computed, useId } from 'vue';
import { Checkbox, Select, Tag } from 'ant-design-vue';

import type { ProjectAgentCapabilities } from '../../../../api/ipd/project-agent';
import {
  findSelectedPack,
  packKey,
  selectPackByKey,
  type AgentCapabilitySelection,
} from './capability-selection';

/** 组件 props。 */
interface Props {
  capabilities: ProjectAgentCapabilities;
  modelValue: AgentCapabilitySelection;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), { disabled: false });

const emit = defineEmits<{ 'update:modelValue': [value: AgentCapabilitySelection] }>();

/** 不可用原因兜底（后端未给原因时明确说明，而不是留空）。 */
const NO_REASON = '服务端未提供原因';

/** 标签 ID（同页多实例不冲突）。 */
const uid = useId();
const packLabelId = `${uid}-pack`;
const modelLabelId = `${uid}-model`;

const packOptions = computed(() =>
  props.capabilities.packs.map((pack) => ({
    disabled: !pack.available,
    label: `${pack.name}（v${pack.version}）`,
    value: packKey(pack),
  })),
);
const availableModels = computed(() => props.capabilities.models.filter((model) => model.available));
const modelOptions = computed(() =>
  availableModels.value.map((model) => ({ label: model.name, value: model.id })),
);
const unavailablePacks = computed(() => props.capabilities.packs.filter((p) => !p.available));
const selectedPack = computed(() => findSelectedPack(props.capabilities, props.modelValue));
const selectedPackKey = computed(() => (selectedPack.value ? packKey(selectedPack.value) : undefined));

/** 选中能力包（默认勾选包内可用 Skill / 工具）。 */
function onPackChange(value: unknown): void {
  emit('update:modelValue', selectPackByKey(props.capabilities, props.modelValue, String(value ?? '')));
}

/** 选中模型（只接受清单内且可用的 ID）。 */
function onModelChange(value: unknown): void {
  const model = availableModels.value.find((m) => m.id === value);
  emit('update:modelValue', { ...props.modelValue, modelConfigId: model ? model.id : null });
}

/** 勾选 / 取消 Skill。 */
function toggleSkill(name: string, checked: boolean): void {
  const rest = props.modelValue.skillNames.filter((n) => n !== name);
  emit('update:modelValue', { ...props.modelValue, skillNames: checked ? [...rest, name] : rest });
}

/** 勾选 / 取消工具。 */
function toggleTool(id: string, checked: boolean): void {
  const rest = props.modelValue.toolIds.filter((t) => t !== id);
  emit('update:modelValue', { ...props.modelValue, toolIds: checked ? [...rest, id] : rest });
}

/** Checkbox change 事件取勾选值。 */
function checkedOf(event: { target: { checked?: boolean } }): boolean {
  return event.target.checked === true;
}
</script>

<template>
  <div class="ipd-agent-picker" data-testid="agent-capability-picker">
    <p v-if="capabilities.packs.length === 0" class="picker-hint" data-testid="picker-no-packs">
      当前项目暂无能力包。
    </p>

    <div v-else class="picker-field">
      <span :id="packLabelId" class="picker-label">能力包</span>
      <Select
        :value="selectedPackKey"
        :options="packOptions"
        :disabled="disabled"
        placeholder="请选择能力包"
        :aria-labelledby="packLabelId"
        class="picker-select"
        data-testid="picker-pack"
        @update:value="onPackChange"
      />
      <p v-if="selectedPack?.description" class="picker-desc">{{ selectedPack.description }}</p>
    </div>

    <ul v-if="unavailablePacks.length > 0" class="picker-reasons" aria-label="不可用能力包" data-testid="picker-pack-reasons">
      <li v-for="pack in unavailablePacks" :key="`${pack.code}@${pack.version}`">
        {{ pack.name }}（v{{ pack.version }}）不可用：{{ pack.unavailableReason || NO_REASON }}
      </li>
    </ul>

    <div class="picker-field">
      <span :id="modelLabelId" class="picker-label">模型</span>
      <p v-if="availableModels.length === 0" class="picker-hint" data-testid="picker-no-models">暂无可选模型。</p>
      <Select
        v-else
        :value="modelValue.modelConfigId ?? undefined"
        :options="modelOptions"
        :disabled="disabled"
        placeholder="请选择模型"
        :aria-labelledby="modelLabelId"
        class="picker-select"
        data-testid="picker-model"
        @update:value="onModelChange"
      />
    </div>

    <fieldset v-if="selectedPack && selectedPack.skills.length > 0" class="picker-group" data-testid="picker-skills">
      <legend class="picker-label">技能</legend>
      <div v-for="skill in selectedPack.skills" :key="skill.name" class="picker-option">
        <Checkbox
          :checked="modelValue.skillNames.includes(skill.name)"
          :disabled="disabled || !skill.available"
          @change="toggleSkill(skill.name, checkedOf($event))"
        >
          {{ skill.name }}（v{{ skill.version }}）
        </Checkbox>
        <span v-if="!skill.available" class="picker-reason">不可用：{{ skill.reason || NO_REASON }}</span>
      </div>
    </fieldset>

    <fieldset v-if="selectedPack && selectedPack.tools.length > 0" class="picker-group" data-testid="picker-tools">
      <legend class="picker-label">工具</legend>
      <div v-for="tool in selectedPack.tools" :key="tool.id" class="picker-option">
        <Checkbox
          :checked="modelValue.toolIds.includes(tool.id)"
          :disabled="disabled || !tool.available"
          @change="toggleTool(tool.id, checkedOf($event))"
        >
          {{ tool.name }}
        </Checkbox>
        <Tag :color="tool.readOnly ? 'default' : 'warning'">{{ tool.readOnly ? '只读' : '可写' }}</Tag>
        <span v-if="!tool.available" class="picker-reason">不可用：{{ tool.reason || NO_REASON }}</span>
      </div>
    </fieldset>
    <p class="picker-hint">技能和工具来自服务端能力目录，只列出当前能力包已收录的条目。市场上还没纳入这个能力包的，这次运行不能勾选。</p>
  </div>
</template>

<style scoped>
.ipd-agent-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-family: var(--ipd-font, inherit);
  color: var(--ipd-text);
}
.picker-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.picker-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ipd-navy);
}
.picker-select {
  width: 100%;
}
.picker-desc,
.picker-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ipd-muted);
}
.picker-reasons {
  padding-left: 18px;
  margin: 0;
  font-size: 12px;
  color: var(--ipd-amber);
}
.picker-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  margin: 0;
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
}
.picker-option {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.picker-reason {
  font-size: 12px;
  color: var(--ipd-amber);
}
</style>
