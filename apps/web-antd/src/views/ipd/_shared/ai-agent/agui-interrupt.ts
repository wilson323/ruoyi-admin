import type { AgentRunEvent, AgentRunInterrupt, AgentRunResumeEntry } from '../../../../api/ipd/project-agent';

export interface AgentInterruptPause { seq: number; interrupts: AgentRunInterrupt[] }
export interface InterruptField { name: string; title: string; type: 'string' | 'number' | 'integer' | 'boolean'; required: boolean; enum?: Array<string | number | boolean>; schema: Record<string, unknown> }
export interface InterruptInput { fields: InterruptField[]; scalar: boolean; error: string }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** 只取持久化等待事件；当前是否仍等待由权威运行状态另行裁决。 */
export function agentInterruptPause(events: readonly AgentRunEvent[]): AgentInterruptPause | null {
  const waiting = [...events].reverse().find((event) => event.type === 'STEP' && record(event.payload) && event.payload.kind === 'AWAIT_USER');
  if (!waiting || !record(waiting.payload) || waiting.payload.reason !== 'AGUI_INTERRUPT' || !record(waiting.payload.interrupts)) return null;
  const entries = Object.entries(waiting.payload.interrupts);
  if (!entries.length) return null;
  const interrupts: AgentRunInterrupt[] = [];
  for (const [id, value] of entries) {
    if (!record(value) || value.id !== id || typeof value.reason !== 'string' || !id) return null;
    interrupts.push(value as unknown as AgentRunInterrupt);
  }
  return { seq: waiting.seq, interrupts };
}

/** 当前支持原字段的标量/枚举表单；组合、嵌套或数组结构明确留给可支持的回答入口。 */
export function interruptInput(interrupt: AgentRunInterrupt): InterruptInput {
  const raw = interrupt.responseSchema;
  const schema = raw == null ? { type: 'string' } : raw;
  const unsupported = '这个问题的回答格式暂不支持，请保留本次运行并联系负责人处理。';
  if (!record(schema)) return { fields: [], scalar: false, error: unsupported };
  const object = schema.type === 'object' || (schema.type === undefined && record(schema.properties));
  const properties = object ? schema.properties : { answer: schema };
  const structural = ['$ref', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas', 'patternProperties', 'const', 'format', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
  if (structural.some((key) => key in schema) || !record(properties)) return { fields: [], scalar: false, error: unsupported };
  const required = object && Array.isArray(schema.required) ? schema.required : ['answer'];
  const fields: InterruptField[] = [];
  for (const [name, rawField] of Object.entries(properties)) {
    if (!record(rawField) || structural.some((key) => key in rawField)) return { fields: [], scalar: !object, error: unsupported };
    const type = rawField.type ?? (Array.isArray(rawField.enum) ? typeof rawField.enum[0] : undefined);
    if (!['string', 'number', 'integer', 'boolean'].includes(String(type))) return { fields: [], scalar: !object, error: unsupported };
    const choices = rawField.enum;
    if (choices !== undefined && (!Array.isArray(choices) || choices.length === 0 || choices.some((value) => !['string', 'number', 'boolean'].includes(typeof value)))) return { fields: [], scalar: !object, error: unsupported };
    if (choices && (choices as unknown[]).some((value) => typeof value !== (type === 'integer' ? 'number' : type))) return { fields: [], scalar: !object, error: unsupported };
    if (typeof rawField.pattern === 'string') { try { new RegExp(rawField.pattern); } catch { return { fields: [], scalar: !object, error: unsupported }; } }
    fields.push({ name, title: typeof rawField.title === 'string' ? rawField.title : name === 'answer' ? '回答' : name, type: type as InterruptField['type'], required: required.includes(name), ...(choices ? { enum: choices as InterruptField['enum'] } : {}), schema: rawField });
  }
  if (required.some((name) => typeof name !== 'string' || !fields.some((field) => field.name === name))) return { fields: [], scalar: !object, error: unsupported };
  return { fields, scalar: !object, error: '' };
}

export function validateInterruptPayload(interrupt: AgentRunInterrupt, payload: unknown): string {
  if (interrupt.reason === 'tool_call') return record(payload) && typeof payload.approved === 'boolean' ? '' : '请选择允许或拒绝。';
  if (interrupt.reason !== 'input_required') return '这个问题的处理方式暂不支持，请联系负责人处理。';
  const input = interruptInput(interrupt);
  if (input.error) return input.error;
  if (!input.scalar && !record(payload)) return '请按问题填写回答。';
  if (!input.scalar && interrupt.responseSchema?.additionalProperties === false && Object.keys(payload as Record<string, unknown>).some((key) => !input.fields.some((field) => field.name === key))) return '回答包含问题之外的字段。';
  for (const field of input.fields) {
    const value = input.scalar ? payload : (payload as Record<string, unknown>)[field.name];
    if (value === undefined || value === '' || value === null) { if (field.required) return `请填写${field.title}。`; continue; }
    const expected = field.type === 'integer' ? 'number' : field.type;
    if (typeof value !== expected || (typeof value === 'number' && (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))))) return `${field.title}的回答格式不正确。`;
    if (field.enum && !field.enum.includes(value as string | number | boolean)) return `请从${field.title}的选项中选择。`;
    const schema = field.schema;
    if (typeof value === 'number' && ((typeof schema.minimum === 'number' && value < schema.minimum) || (typeof schema.maximum === 'number' && value > schema.maximum))) return `${field.title}超出允许范围。`;
    if (typeof value === 'string' && ((typeof schema.minLength === 'number' && value.length < schema.minLength) || (typeof schema.maxLength === 'number' && value.length > schema.maxLength) || (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)))) return `${field.title}不符合问题要求。`;
  }
  return '';
}

/** 普通输入口仅映射一个文本字段；复杂回答须使用本次运行内的原字段表单。 */
export function interruptTextResponse(pause: AgentInterruptPause, text: string): AgentRunResumeEntry[] | null {
  if (pause.interrupts.length !== 1) return null;
  const interrupt = pause.interrupts[0]!;
  if (interrupt.reason !== 'input_required') return null;
  const input = interruptInput(interrupt);
  if (input.error || input.fields.length !== 1 || input.fields[0]!.type !== 'string' || input.fields[0]!.enum) return null;
  const payload = input.scalar ? text : { [input.fields[0]!.name]: text };
  if (validateInterruptPayload(interrupt, payload)) return null;
  return [{ interruptId: interrupt.id, status: 'resolved', payload }];
}
