<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { fetchProductRetirement, submitProductRetirement, editProductRetirementPolicy, decideProductRetirement, type RetirementView, type RetirementPolicyBody } from '../../../../api/ipd/product-retirement';
import { ipdErrorText } from '../../_shared/ipd-error-text';
const props = defineProps<{ productId: string }>();
const emit = defineEmits<{ changed: [] }>();
const view = ref<RetirementView | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const reason = ref('');
const opinion = ref('');
const softwarePolicy = ref('');
const fields = [
  { key: 'marketingStopAt', label: '营销截止时间' },
  { key: 'orderStopAt', label: '订货截止时间' },
  { key: 'productionStopAt', label: '生产截止时间' },
  { key: 'spareSupportStopAt', label: '备件支持截止时间' },
  { key: 'softwareSupportStopAt', label: '软件支持截止时间' },
] as const;
const dates = reactive<Record<typeof fields[number]['key'], string>>({ marketingStopAt: '', orderStopAt: '', productionStopAt: '', spareSupportStopAt: '', softwareSupportStopAt: '' });
const row = computed(() => view.value?.retirement);
const statusTexts: Record<string, string> = { PENDING_RD_LEADER: '待产品线负责人批准', APPROVED: '已批准退市，历史记录只读', REJECTED: '已驳回，提交人可修改后重新提交' };
const status = computed(() => statusTexts[row.value?.status ?? ''] ?? '尚未申请退市');
const actions: Record<string, string> = { SUBMIT_RETIREMENT: '提交退市申请', EDIT_RETIREMENT_POLICY: '修改退市政策', APPROVE_RETIREMENT: '批准退市', REJECT_RETIREMENT: '驳回退市' };
let epoch = 0;
async function load() {
  const current = ++epoch;
  const id = props.productId;
  view.value = null;
  error.value = '';
  loading.value = true;
  try {
    const result = await fetchProductRetirement(id);
    if (current !== epoch || id !== props.productId) return;
    view.value = result;
    reason.value = result.retirement?.reason ?? '';
    opinion.value = '';
    softwarePolicy.value = result.retirement?.softwareSupportPolicy ?? '';
    for (const field of fields) dates[field.key] = (result.retirement?.[field.key] ?? '').replace(' ', 'T');
  } catch (failure) {
    if (current === epoch) error.value = ipdErrorText(failure, { fallback: '退市申请暂时无法读取，请重试' });
  } finally { if (current === epoch) loading.value = false; }
}
async function perform(task: () => Promise<unknown>) {
  if (busy.value || loading.value) return;
  busy.value = true;
  error.value = '';
  const id = props.productId;
  try { await task(); if (id === props.productId) { await load(); emit('changed'); } }
  catch (failure) { if (id === props.productId) error.value = ipdErrorText(failure, { fallback: '退市申请未保存，请刷新后重试' }); }
  finally { busy.value = false; }
}
function submit() {
  if (!view.value?.canSubmit || !reason.value.trim()) return;
  const id = props.productId;
  const version = row.value?.version ?? 0;
  const text = reason.value.trim();
  void perform(() => submitProductRetirement(id, version, text));
}
function savePolicy() {
  if (!view.value?.canEditPolicy || !row.value) return;
  if (dates.softwareSupportStopAt && !softwarePolicy.value.trim()) { error.value = '填写软件支持截止时间时，请同时填写软件支持政策'; return; }
  const body: RetirementPolicyBody = { expectedVersion: row.value.version, marketingStopAt: null, orderStopAt: null, productionStopAt: null, spareSupportStopAt: null, softwareSupportStopAt: null, softwareSupportPolicy: softwarePolicy.value.trim() || null };
  for (const field of fields) {
    const date = dates[field.key];
    body[field.key] = date ? `${date.replace('T', ' ')}${date.length === 16 ? ':00' : ''}` : null;
  }
  const id = props.productId;
  void perform(() => editProductRetirementPolicy(id, body));
}
function decide(decision: 'APPROVE' | 'REJECT') {
  if (!view.value?.canDecide || !row.value) return;
  if (decision === 'REJECT' && !opinion.value.trim()) { error.value = '请填写驳回意见'; return; }
  const id = props.productId;
  const version = row.value.version;
  const text = opinion.value.trim();
  void perform(() => decideProductRetirement(id, version, decision, text));
}
watch(() => props.productId, () => { void load(); }, { immediate: true });
</script>
<template>
  <section class="retirement" data-testid="product-retirement" aria-label="产品退市">
    <h2>产品退市</h2>
    <p>{{ status }}</p>
    <p v-if="loading">正在读取退市申请…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" type="button" :disabled="busy || loading" @click="load">重新读取</button>
    <div v-if="view">
      <p v-if="row?.rdOpinion">负责人意见：{{ row.rdOpinion }}</p>
      <form v-if="view.canSubmit" @submit.prevent="submit">
        <label>退市理由<textarea v-model="reason" maxlength="500" required :disabled="busy" data-testid="retirement-reason" /></label>
        <button type="submit" :disabled="busy || !reason.trim()">{{ row?.status === 'REJECTED' ? '修改并重新提交' : '提交退市申请' }}</button>
      </form>
      <p v-else-if="row">退市理由：{{ row.reason }}</p>
      <form v-if="view.canEditPolicy" @submit.prevent="savePolicy">
        <label v-for="field in fields" :key="field.key">{{ field.label }}<input v-model="dates[field.key]" type="datetime-local" step="1" :disabled="busy" :data-testid="field.key" /></label>
        <label>软件支持政策<textarea v-model="softwarePolicy" maxlength="2000" :disabled="busy" data-testid="software-policy" /></label>
        <button type="submit" :disabled="busy">保存退市政策</button>
      </form>
      <dl v-else-if="row">
        <template v-for="field in fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ row[field.key] || '未填写' }}</dd></template>
        <dt>软件支持政策</dt><dd>{{ row.softwareSupportPolicy || '未填写' }}</dd>
      </dl>
      <p v-if="row">截止时间和政策已登记的内容见上方；营销、订单和生产等外部执行结果仍需相应业务记录证明。</p>
      <form v-if="view.canDecide" @submit.prevent="decide('APPROVE')">
        <label>负责人审批意见<textarea v-model="opinion" maxlength="500" :disabled="busy" data-testid="retirement-opinion" /></label>
        <button type="submit" :disabled="busy">批准退市</button>
        <button type="button" :disabled="busy" @click="decide('REJECT')">驳回退市</button>
      </form>
      <h3>申请与审批历史</h3>
      <ul v-if="view.history.length"><li v-for="(entry, index) in view.history" :key="index">{{ entry.createTime }} · {{ entry.operatorName || '经办人' }} · {{ actions[entry.action] || '退市记录' }}<span v-if="entry.reason">：{{ entry.reason }}</span></li></ul>
      <p v-else>暂无历史记录</p>
    </div>
  </section>
</template>
<style scoped>
.retirement { padding:20px; margin-top:18px; background:white; border:1px solid var(--ipd-line,#dfe4ed); border-radius:8px; }
h2 { font-size:15px; } h3 { font-size:14px; } p,li,dt,dd { font-size:13px; }
form { display:grid; gap:12px; margin:16px 0; } label { display:grid; gap:6px; font-size:13px; } input,textarea { padding:8px; border:1px solid #dfe4ed; border-radius:5px; } button { width:fit-content; padding:7px 12px; cursor:pointer; } button:disabled { cursor:default; opacity:.6; }
[role=alert] { color:#b42318; }
</style>
