<!--
  页49 超级管理员移交（原型 /admin SuperAdminSuccessionPanel 复刻 + 后端契约适配）
  —— P0-10.49 前端最后一环（P2-7.3 后端已交付）。

  一比一部分：更换超级管理员面板——交接对象为产品组长候选、确认短语「确认移交管理员」
  二次确认、高风险红色按钮立即生效语义、「仅超管本人可发起」标记。

  契约：POST /api/v1/handovers/super-admin {toPersonId, note, confirmation}
  （HandoverController 2026-09-06 磁盘核实）；候选取 GET /pm-directory 在职 GROUP_LEADER。
  移交成功原超管账号即 DISABLED（旧会话 scopeOf→NONE 每请求 401 兜底），
  前端清会话回登录页，与后端强制登出语义一致。

  原型四点对照（验收文档 P2-7.3-超管移交-验收-20260906.md §四）：
  1. confirmation 确认短语 —— 已实现（后端精确匹配强制 + 前端门控）；
  2. currentPassword —— 登记差异：本系统无密码登录交互，会话凭证即身份证明；
  3. replacementLeadId（接任人承接原产品组组长）—— 登记增量：后端未交付，归 DOC-09 排期；
  4. readiness 准备度端点 —— 登记增量：后端未交付，以本页前端预检替代（候选在职/
     非本人），独立端点归 DOC-09 排期。

  多名在任超管为违例存量：后端拒绝移交并提示先收敛（P2-7.3 防御），错误原文展示。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { message } from 'ant-design-vue';
import { UserSwitchOutlined } from '@ant-design/icons-vue';

import { getPmDirectory, transferSuperAdmin, type PmDirectoryEntry } from '../../../../api/ipd/handover';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { useIpdAuthStore } from '../../../../store/ipd-auth';

const CONFIRM_PHRASE = '确认移交管理员';

const auth = useIpdAuthStore();
const router = useRouter();
const meId = computed(() => auth.identity?.person.id ?? '');
const isSuperAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');

const loading = ref(false);
const loadError = ref('');
const directory = ref<PmDirectoryEntry[]>([]);
const adminTo = ref('');
const note = ref('');
const confirmation = ref('');
const busy = ref(false);

const candidates = computed(() =>
  directory.value.filter((entry) => entry.personType === 'GROUP_LEADER'),
);
const selected = computed(() => candidates.value.find((entry) => entry.id === adminTo.value) ?? null);

/** readiness 前端预检（后端独立端点未交付，见页头登记）：候选来自在职目录即存在/在职。 */
const checks = computed(() => [
  { ok: Boolean(selected.value), text: '已选择交接对象' },
  { ok: Boolean(selected.value), text: '交接对象为在职产品组长（候选即在职目录）' },
  { ok: !selected.value || selected.value.id !== meId.value, text: '交接对象非本人' },
]);
const ready = computed(() => checks.value.every((check) => check.ok));
const canSubmit = computed(() =>
  Boolean(selected.value) && ready.value && confirmation.value === CONFIRM_PHRASE && !busy.value,
);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    directory.value = (await getPmDirectory()).directory;
  } catch (cause) {
    loadError.value = ipdErrorText(cause, { fallback: '在职目录加载失败，请稍后重试' });
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  busy.value = true;
  try {
    await transferSuperAdmin({
      confirmation: confirmation.value,
      note: note.value.trim() || '超级管理员移交（页49：高风险操作，交接对象为产品组长）',
      toPersonId: adminTo.value,
    });
    message.success('超级管理员已移交：原账号已停用，请使用新身份登录');
    auth.clearSession();
    await router.push('/auth/login');
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '移交失败，请稍后重试' }));
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (isSuperAdmin.value) void load();
});
</script>

<template>
  <div class="admin-handover-page">
    <header class="page-heading">
      <div>
        <h1>超级管理员移交</h1>
        <p>治理权限整体交接：交接对象须为在职产品组长；提交立即生效并写入不可覆盖审计，原超管账号随即停用。</p>
      </div>
    </header>

    <template v-if="isSuperAdmin">
      <section class="surface">
        <div class="section-title">
          <div>
            <h2>更换超级管理员</h2>
            <p>系统始终只有一名在任超管；多名在任为违例存量，后端会拒绝移交并要求先收敛。</p>
          </div>
          <span>仅超管本人可发起</span>
        </div>

        <div v-if="loading" class="state-block">正在加载在职产品组长候选…</div>
        <div v-else-if="loadError" class="state-block error">
          {{ loadError }}
          <button class="retry" type="button" @click="load">重试</button>
        </div>
        <div v-else-if="!candidates.length" class="state-block">
          暂无可交接的在职产品组长，请先在组织架构中启用组长账号。
        </div>

        <div v-else class="create-form">
          <label>
            新超级管理员
            <select v-model="adminTo">
              <option disabled value="">选择交接对象</option>
              <option v-for="entry in candidates" :key="entry.id" :value="entry.id">
                {{ entry.name }}{{ entry.groupName ? ` · ${entry.groupName}` : '' }}
              </option>
            </select>
          </label>
          <label>
            交接说明（可选）
            <input v-model="note" placeholder="默认写入：超级管理员移交（页49）" />
          </label>
          <label>
            确认短语
            <input v-model="confirmation" :placeholder="`输入：${CONFIRM_PHRASE}`" />
          </label>
          <ul class="readiness" :class="{ ready }">
            <li v-for="check in checks" :key="check.text" :class="{ ok: check.ok }">
              {{ check.ok ? '✓' : '×' }} {{ check.text }}
            </li>
          </ul>
          <button
            :disabled="!canSubmit"
            class="primary-button danger-action"
            type="button"
            @click="submit"
          >
            <UserSwitchOutlined />
            确认移交超级管理员
          </button>
        </div>
      </section>

      <div class="pending-note">
        原型差异与增量登记：① currentPassword（原型需输当前密码）——本系统无密码登录交互，会话凭证即身份证明，登记差异；
        ② replacementLeadId（接任人承接原产品组组长）与 readiness 准备度端点——后端未交付，登记增量归 DOC-09/P0-10.49 排期，准备度以本页预检替代。
      </div>
    </template>
    <div v-else class="state-block">仅超级管理员可访问本页。</div>
  </div>
</template>

<style scoped>
/* 原型 styles.css 摘录；--blue/--line/--muted/--text 映射为 --ipd-*。 */
.admin-handover-page {
  padding: 28px 32px 60px;
  max-width: 1200px;
  margin: auto;
}
.page-heading {
  margin-bottom: 24px;
}
.page-heading h1 {
  margin: 0 0 8px;
  font-size: 25px;
  letter-spacing: -0.02em;
}
.page-heading p {
  margin: 0;
  color: var(--ipd-muted);
  font-size: 13px;
}
.surface {
  background: white;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ipd-line);
}
.section-title h2 {
  margin: 0;
  font-size: 15px;
}
.section-title p {
  margin: 3px 0 0;
  color: var(--ipd-muted);
  font-size: 12px;
}
.section-title > span {
  color: var(--ipd-muted);
  font-size: 12px;
}
.state-block {
  padding: 18px 20px;
  color: var(--ipd-muted);
  font-size: 12px;
}
.state-block.error {
  color: #a8071a;
}
.state-block .retry {
  margin-left: 10px;
  border: 1px solid #cfd6e1;
  background: white;
  border-radius: 6px;
  padding: 2px 10px;
  cursor: pointer;
  color: var(--ipd-text);
}
.create-form {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  padding: 16px 20px 20px;
  align-items: end;
}
.create-form label {
  display: grid;
  gap: 6px;
  font-weight: 700;
  font-size: 12px;
}
.create-form input,
.create-form select {
  height: 38px;
  padding: 0 10px;
  border: 1px solid #cfd6e1;
  border-radius: 6px;
  background: white;
  color: var(--ipd-text);
  font-weight: 400;
}
.readiness {
  grid-column: span 2;
  margin: 0;
  padding: 10px 12px;
  list-style: none;
  border: 1px dashed #cfd9e5;
  border-radius: 6px;
  color: var(--ipd-muted);
  font-size: 12px;
  display: grid;
  gap: 4px;
}
.readiness li:not(.ok) {
  color: #a8071a;
}
.readiness.ready {
  border-color: #b7dfc1;
  color: var(--ipd-green);
}
.primary-button {
  border: 0;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  background: var(--ipd-blue);
  color: white;
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}
.primary-button:hover {
  background: #1747d7;
}
.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.danger-action {
  background: #b42318;
  box-shadow: 0 4px 12px rgb(180 35 24 / 20%);
}
.pending-note {
  margin-top: 18px;
  padding: 10px 12px;
  background: #f6f8fb;
  border: 1px dashed #cfd9e5;
  border-radius: 6px;
  color: #6b7a90;
  font-size: 12px;
  line-height: 1.6;
}
@media (max-width: 900px) {
  .create-form {
    grid-template-columns: 1fr;
  }
  .readiness {
    grid-column: span 1;
  }
}
</style>
