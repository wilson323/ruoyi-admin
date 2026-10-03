<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Alert, Button } from 'ant-design-vue';
import type { AgentRunResumeEntry } from '../../../../api/ipd/project-agent';
import { clarificationOptionLabel, interruptInput, isClarificationInterrupt, validateInterruptPayload, type AgentInterruptPause, type InterruptField } from './agui-interrupt';

const props = defineProps<{ pause: AgentInterruptPause; loading?: boolean; errorText?: string }>();
const emit = defineEmits<{ respond: [entries: AgentRunResumeEntry[]]; refresh: [] }>();
const answers = reactive<Record<string, Record<string, unknown>>>(Object.create(null));
const decisions = reactive<Record<string, boolean | undefined>>(Object.create(null));
const skipped = reactive<Record<string, boolean>>(Object.create(null));
const error = ref('');
const submitted = ref(false);
const inputs = computed(() => props.pause.interrupts.map((interrupt) => ({ interrupt, input: interruptInput(interrupt) })));
watch(() => props.pause.seq, () => {
  for (const key of Object.keys(answers)) delete answers[key];
  for (const key of Object.keys(decisions)) delete decisions[key];
  for (const key of Object.keys(skipped)) delete skipped[key];
  for (const interrupt of props.pause.interrupts) answers[interrupt.id] = Object.create(null);
  error.value = '';
  submitted.value = false;
}, { immediate: true });
watch(() => props.errorText, (value) => { if (value) submitted.value = false; });
function update(id: string, field: InterruptField, event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  answers[id] ??= Object.create(null);
  const value = raw === '' ? undefined : field.enum ? field.enum[Number(raw)]
    : field.type === 'boolean' ? raw === 'true' : field.type === 'number' || field.type === 'integer' ? Number(raw) : raw;
  if (value === undefined) delete answers[id]![field.name];
  else answers[id]![field.name] = value;
}
function choose(id: string, field: InterruptField, option: string | number | boolean): void {
  if (props.loading || submitted.value || !field.enum?.includes(option)) return;
  answers[id] ??= Object.create(null);
  answers[id]![field.name] = option;
}
function respond(): void {
  if (props.loading || submitted.value) return;
  const entries: AgentRunResumeEntry[] = [];
  for (const { interrupt, input } of inputs.value) {
    if (interrupt.expiresAt && Date.parse(interrupt.expiresAt) <= Date.now()) { error.value = '这个问题已过期，请恢复运行记录后查看。'; return; }
    if (interrupt.reason === 'input_required' && skipped[interrupt.id]) {
      entries.push({ interruptId: interrupt.id, status: 'cancelled' });
      continue;
    }
    const payload = interrupt.reason === 'tool_call' && !isClarificationInterrupt(interrupt) ? { approved: decisions[interrupt.id] }
      : input.scalar ? answers[interrupt.id]?.[input.fields[0]?.name ?? 'answer'] : answers[interrupt.id];
    const invalid = validateInterruptPayload(interrupt, payload);
    if (invalid) { error.value = invalid; return; }
    entries.push({ interruptId: interrupt.id, status: 'resolved', payload });
  }
  error.value = '';
  submitted.value = true;
  emit('respond', entries);
}
</script>

<template>
  <section class="interrupt-form" data-testid="agui-interrupt-form" aria-label="本次运行需要你的回答">
    <h4>需要你的回答</h4>
    <fieldset v-for="{ interrupt, input } in inputs" :key="interrupt.id" :disabled="loading || submitted">
      <legend>{{ interrupt.message || '请确认后继续本次运行。' }}</legend>
      <template v-if="interrupt.reason === 'tool_call' && !isClarificationInterrupt(interrupt)">
        <p v-if="typeof interrupt.metadata?.toolName === 'string'">工具：{{ interrupt.metadata.toolName }}</p>
        <pre v-if="interrupt.metadata?.toolInput">{{ JSON.stringify(interrupt.metadata.toolInput, null, 2) }}</pre>
        <label><input type="radio" :name="`interrupt-${interrupt.id}`" :checked="decisions[interrupt.id] === true" data-testid="interrupt-allow" @change="decisions[interrupt.id] = true">允许这次操作</label>
        <label><input type="radio" :name="`interrupt-${interrupt.id}`" :checked="decisions[interrupt.id] === false" data-testid="interrupt-deny" @change="decisions[interrupt.id] = false">拒绝这次操作</label>
      </template>
      <template v-else-if="interrupt.reason === 'input_required' || isClarificationInterrupt(interrupt)">
        <label v-if="!isClarificationInterrupt(interrupt)"><input v-model="skipped[interrupt.id]" type="checkbox" data-testid="interrupt-skip">暂不回答这个问题</label>
        <Alert v-if="input.error" type="warning" :message="input.error" data-testid="interrupt-unsupported" />
        <label v-for="field in input.fields" v-else :key="field.name">
          {{ field.title }}{{ field.required ? '（必填）' : '' }}
          <span v-if="isClarificationInterrupt(interrupt) && field.enum" class="clarification-options">
            <Button v-for="option in field.enum" :key="String(option)" :data-question-id="field.name" :data-option-id="String(option)"
              :type="answers[interrupt.id]?.[field.name] === option ? 'primary' : 'default'" :disabled="loading || submitted"
              @click="choose(interrupt.id, field, option)">{{ clarificationOptionLabel(interrupt, field.name, option) }}</Button>
            <span v-if="answers[interrupt.id]?.[field.name] !== undefined">已选：{{ clarificationOptionLabel(interrupt, field.name, answers[interrupt.id]?.[field.name]) }}。</span>
          </span>
          <select v-else-if="field.enum || field.type === 'boolean'" :disabled="skipped[interrupt.id]" :aria-label="field.title" :data-field="field.name" @change="update(interrupt.id, field, $event)">
            <option value="">请选择</option>
            <template v-if="field.enum"><option v-for="(option, index) in field.enum" :key="index" :value="String(index)">{{ option }}</option></template>
            <template v-else><option value="true">是</option><option value="false">否</option></template>
          </select>
          <input v-else :disabled="skipped[interrupt.id]" :type="field.type === 'string' ? 'text' : 'number'" :step="field.type === 'integer' ? 1 : 'any'" :aria-label="field.title" :data-field="field.name" @input="update(interrupt.id, field, $event)">
        </label>
      </template>
      <Alert v-else type="warning" message="这个问题的处理方式暂不支持，请联系负责人处理。" data-testid="interrupt-unsupported" />
    </fieldset>
    <p v-if="error || errorText" role="alert">{{ error || errorText }}</p>
    <Button v-if="error || errorText" :disabled="loading" data-testid="interrupt-refresh" @click="emit('refresh')">重新读取</Button>
    <Button type="primary" :loading="loading" :disabled="loading || submitted" data-testid="interrupt-submit" @click="respond">提交回答并继续</Button>
  </section>
</template>

<style scoped>
.interrupt-form { display: grid; gap: 10px; }
fieldset { display: grid; gap: 8px; border: 1px solid var(--ipd-line); border-radius: 6px; }
label { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; }
h4, p { margin: 0; }
.clarification-options { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
