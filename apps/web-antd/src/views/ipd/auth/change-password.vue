<!--
  首次登录改密页（原型 FirstLoginPage /reviews 前置态 一比一复刻）—— 任务 p12（2026-09-06）

  一比一部分：login-page 双栏（brand-lockup 品牌 + eyebrow「首次登录安全设置」+ h1/p 文案）、
  login-panel 表单（h2「完成首次登录设置」、managed-profile-card、当前临时密码/新密码/确认
  新密码三字段、「设置密码并进入工作台」/「退出并返回登录」按钮、form-error 形态）；
  CSS 取自原型 styles.css 与 login.vue 既有同源样式。

  行为保留（既有验收资产，不动）：validateNewPassword 校验、auth.changePassword 成功后
  清空并回登录页（改密后所有旧会话退出，由后端行为决定）、logout、autocomplete/72 字节
  上限/禁用态。原型字段级 has-error 红框依赖 per-field 校验器，本仓 validateNewPassword
  返回整串文案（有测试锁定），错误统一走 form-error 展示，特此登记。
  原型 managed-profile-card 的 employee_no/organization_name 本仓 Person 无此字段：
  显示「{姓名} · 本地治理账号」（原型缺省词）与「{角色名} · 身份资料只读」。
  原型无密码强度条，已移除（passwordStrength 仍由 password-rules 测试覆盖）。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { DatabaseOutlined, LeftOutlined, WarningFilled } from '@ant-design/icons-vue';

import ipdLogoUrl from '../../../assets/ipd-logo.png';
import { IPD_LOGIN } from '../../../router/ipd-guard';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import { validateNewPassword } from './password-rules';

const PERSON_TYPE_TEXT: Record<string, string> = {
  GROUP_LEADER: '产品组长',
  MARKET_PM: '市场PM',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
};

const auth = useIpdAuthStore();
const router = useRouter();
const form = reactive({ confirmation: '', currentPassword: '', newPassword: '' });
const validationError = ref('');
const roleText = computed(
  () => PERSON_TYPE_TEXT[auth.identity?.person.personType ?? ''] ?? 'IPD 成员',
);
function clearFields() {
  form.currentPassword = form.newPassword = form.confirmation = '';
}
onBeforeUnmount(clearFields);
onDeactivated(clearFields);

async function submit() {
  if (auth.busy) return;
  validationError.value = validateNewPassword(form.currentPassword, form.newPassword, form.confirmation);
  if (validationError.value) return;
  try {
    await auth.changePassword(form.currentPassword, form.newPassword);
    clearFields();
    await router.replace(IPD_LOGIN);
  } catch {
    if (!auth.token || auth.requiresReauthentication) {
      clearFields();
      await router.replace(IPD_LOGIN);
    }
  }
}

async function logout() {
  try {
    await auth.logout();
    await router.replace(IPD_LOGIN);
  } catch {
    if (auth.requiresReauthentication) {
      clearFields();
      await router.replace(IPD_LOGIN);
    }
    // Other logout failures retain the existing retry action.
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-brand">
      <div class="brand-lockup">
        <div class="brand-logo"><img :src="ipdLogoUrl" alt="IPD 工作台" /></div>
        <span>IPD 工作台</span>
      </div>
      <div class="login-message">
        <span class="eyebrow">首次登录安全设置</span>
        <h1>设置个人密码，开始安全工作。</h1>
        <p>
          姓名、工号、组织、角色和能力等级均由第三方人员系统同步并保持只读；首次登录只需修改临时密码。
        </p>
      </div>
    </section>
    <section class="login-panel">
      <form @submit.prevent="submit">
        <h2>完成首次登录设置</h2>
        <p class="panel-sub">{{ roleText }} · 用户名：{{ auth.identity?.person.username }}</p>
        <div class="managed-profile-card">
          <DatabaseOutlined />
          <span>
            <strong>{{ auth.identity?.person.name }} · 本地治理账号</strong>
            <small>{{ roleText }} · 身份资料只读</small>
          </span>
        </div>
        <label>
          当前临时密码
          <input
            v-model="form.currentPassword"
            type="password"
            autocomplete="current-password"
            :maxlength="72"
            :disabled="auth.busy"
            required
          />
        </label>
        <div class="field-grid two">
          <label>
            新密码
            <input
              v-model="form.newPassword"
              type="password"
              autocomplete="new-password"
              :maxlength="72"
              :disabled="auth.busy"
              required
            />
          </label>
          <label>
            确认新密码
            <input
              v-model="form.confirmation"
              type="password"
              autocomplete="new-password"
              :maxlength="72"
              :disabled="auth.busy"
              required
            />
          </label>
        </div>
        <div v-if="validationError || auth.error" class="form-error" role="alert">
          <WarningFilled />
          {{ validationError || auth.error }}
        </div>
        <button class="primary-button login-button" :disabled="auth.busy" type="submit">
          {{ auth.busy ? '正在保存…' : '设置密码并进入工作台' }}
        </button>
        <button class="secondary-button login-back-button" :disabled="auth.busy" type="button" @click="logout">
          <LeftOutlined />
          退出并返回登录
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>

/* V12-F3: 原 900px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-brand {
    padding: 34px 28px;
  }

  .field-grid.two {
    grid-template-columns: 1fr;
  }
}

.login-page {
  --blue: #245bf4;

  /* V12/a11y：#697388 对比不足（axe serious）加深至 #556479 = 5.36:1 on #eef1f6 */
  --muted: #556479;
  --text: #172033;
  --navy: #071426;

  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  min-height: 100vh;
  font-family: Inter, 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif;
  color: var(--text);
  background: white;
}

.login-brand {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 54px 68px;
  overflow: hidden;
  color: white;
  background: var(--navy);
}

.login-brand::after {
  position: absolute;
  right: -150px;
  bottom: -150px;
  width: 320px;
  height: 320px;
  content: '';
  border: 1px solid rgb(93 132 255 / 32%);
  border-radius: 50%;
}

.brand-lockup {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 14px;
  align-items: center;
  font-size: 20px;
  font-weight: 750;
}

.brand-logo {
  width: 34px;
  height: 34px;
  overflow: hidden;
  border-radius: 6px;
}

.brand-logo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.login-message {
  position: relative;
  z-index: 1;
  max-width: 640px;
  margin: auto 0;
}

.login-message .eyebrow {
  font-size: 14px;
  font-weight: 700;
  color: #7fa0ff;
  letter-spacing: 0.08em;
}

.login-message h1 {
  margin: 24px 0;
  font-size: clamp(40px, 4vw, 62px);
  line-height: 1.2;
  letter-spacing: -0.035em;
}

.login-message p {
  max-width: 580px;
  font-size: 18px;
  line-height: 1.8;
  color: #b8c3d6;
}

.login-panel {
  display: grid;
  place-items: center;
  padding: 40px;
}

.login-panel form {
  width: min(460px, 100%);
}

.login-panel h2 {
  margin: 0 0 8px;
  font-size: 32px;
}

.panel-sub {
  margin: 0 0 20px;
  color: var(--muted);
}

.managed-profile-card {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px;
  margin-bottom: 8px;
  background: #edf2ff;
  border: 1px solid #ccd8ff;
  border-radius: 7px;
}

.managed-profile-card :deep(.anticon) {
  font-size: 28px;
  color: var(--blue);
}

.managed-profile-card span {
  display: grid;
}

.managed-profile-card small {
  margin-top: 4px;
  color: var(--muted);
}

.login-panel label {
  display: grid;
  gap: 8px;
  margin: 18px 0;
  font-size: 13px;
  font-weight: 650;
  color: #465168;
}

.login-panel input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  font-size: 14px;
  font-weight: 400;
  color: var(--text);
  background: white;
  border: 1px solid #ccd3df;
  border-radius: 7px;
}

.login-panel input:focus {
  outline: 3px solid rgb(36 91 244 / 12%);
  border-color: var(--blue);
}

.field-grid {
  display: grid;
  gap: 16px;
}

.field-grid.two {
  grid-template-columns: repeat(2, 1fr);
}

.field-grid.two label {
  margin: 0;
}

.form-error {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  margin: 12px 0 0;
  font-size: 13px;
  color: #bd2835;
  background: #fdf0f0;
  border: 1px solid #f3c6c6;
  border-radius: 7px;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  font-weight: 700;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  border: 0;
  border-radius: 6px;
}

.primary-button {
  color: white;
  background: var(--blue);
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}

.primary-button:hover {
  background: #1747d7;
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.secondary-button {
  color: #465168;
  background: white;
  border: 1px solid #cdd4df;
}

.login-button {
  width: 100%;
  height: 46px;
  margin-top: 10px;
}

.login-back-button {
  justify-content: center;
  width: 100%;
  margin-top: 10px;
}

/* 与 login.vue 同源的双栏样式 + 原型 styles.css 的 managed-profile-card /
   field-grid.two / secondary-button / login-back-button 摘录。 */
</style>
