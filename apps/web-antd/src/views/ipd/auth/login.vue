<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { IPD_HOME, IPD_PASSWORD } from '../../../router/ipd-guard';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import ipdLogoUrl from '../../../assets/ipd-logo.png';
import '../_shared/ipd-theme.css';

const auth = useIpdAuthStore();
const router = useRouter();
const form = reactive({ username: '', password: '' });
const mode = ref<'account' | 'wecom'>('account');
const passwordChanged = ref(false);
let noticeTimeout: ReturnType<typeof setTimeout> | undefined;
function clearNotice() {
  clearTimeout(noticeTimeout);
  passwordChanged.value = false;
}
function receivePasswordChangedNotice() {
  if (auth.consumePasswordChangedNotice()) {
    passwordChanged.value = true;
    clearTimeout(noticeTimeout);
    noticeTimeout = setTimeout(clearNotice, 60_000);
  }
}
onMounted(receivePasswordChangedNotice);
onActivated(receivePasswordChangedNotice);
onDeactivated(clearNotice);
onBeforeUnmount(clearNotice);


async function submit() {
  if (auth.busy) return;
  try {
    await auth.login(form.username.trim(), form.password);
    form.password = '';
    const redirect = router.currentRoute.value.query.redirect;
    const target = typeof redirect === 'string' && redirect.startsWith('/ipd')
      ? decodeURIComponent(redirect)
      : IPD_HOME;
    await router.replace(auth.mustChangePassword ? IPD_PASSWORD : target);
  } catch {
    form.password = '';
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
        <span class="eyebrow">产品经理的标准化工作系统</span>
        <h1>让每一个产品决策<br />都有方法、有证据、有沉淀。</h1>
        <p>六阶段流程、任务 SOP、AI 副驾、阶段门禁和项目移交，在同一个工作台内完成。</p>
      </div>
      <div class="login-stage-dots">
        <span>概念</span><i /><span>计划</span><i /><span>开发</span><i /><span>验证</span><i /><span>发布</span><i /><span>生命周期</span>
      </div>
    </section>
    <section class="login-panel">
      <div class="login-entry">
        <h2>欢迎回来</h2>
        <p>全球市场及产品共享中心</p>
        <div class="login-mode-tabs">
          <button type="button" :class="{ active: mode === 'account' }" @click="mode = 'account'">姓名账号</button>
          <button type="button" :class="{ active: mode === 'wecom' }" @click="mode = 'wecom'">企业微信扫码</button>
        </div>
        <form v-if="mode === 'account'" @submit.prevent="submit">
          <label>
            用户名（姓名；重名时为姓名-工号）
            <input
              v-model="form.username"
              autocomplete="username"
              :maxlength="64"
              :disabled="auth.busy"
              placeholder="请输入姓名账号"
              required
            />
          </label>
          <label>
            密码
            <input
              v-model="form.password"
              type="password"
              autocomplete="current-password"
              :maxlength="72"
              :disabled="auth.busy"
              placeholder="请输入密码"
              required
            />
          </label>
          <div v-if="passwordChanged" class="form-success" role="status">密码已修改，请使用新密码重新登录。</div>
          <div v-if="auth.error" class="form-error" role="alert">{{ auth.error }}</div>
          <button class="login-button" type="submit" :disabled="auth.busy">
            {{ auth.busy ? '正在登录…' : '登录工作台' }}
          </button>
        </form>
        <div v-else class="wecom-login">
          <div class="qr-placeholder"><span>企业微信正式扫码</span></div>
          <p class="wecom-pending">企业微信登录暂未开放，请切换「姓名账号」登录。无法登录时请联系产品组长。</p>
        </div>
        <div class="guest-demand-entry">
          <span>
            <strong>客户需求反馈</strong>
            <small>无需登录，提交后自动进入产品需求池</small>
          </span>
          <router-link class="guest-link" to="/portal/submit">游客提交需求</router-link>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  --navy: #071426;
  --blue: #245bf4;
  --muted: #697388;
  --text: #172033;

  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  background: white;
  color: var(--text);
  font-family: Inter, 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif;
}

.login-brand {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 54px 68px;
  color: white;
  background: var(--navy);
  overflow: hidden;
}

.login-brand::after {
  content: '';
  position: absolute;
  width: 320px;
  height: 320px;
  right: -150px;
  bottom: -150px;
  border: 1px solid rgb(93 132 255 / 32%);
  border-radius: 50%;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 20px;
  font-weight: 750;
  position: relative;
  z-index: 1;
}

.brand-logo {
  width: 34px;
  height: 34px;
  overflow: hidden;
  border-radius: 6px;
}

.brand-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.login-message {
  margin: auto 0;
  max-width: 640px;
  position: relative;
  z-index: 1;
}

.login-message .eyebrow {
  color: #7fa0ff;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.08em;
}

.login-message h1 {
  font-size: clamp(40px, 4vw, 62px);
  line-height: 1.2;
  letter-spacing: -0.035em;
  margin: 24px 0;
}

.login-message p {
  color: #b8c3d6;
  font-size: 18px;
  line-height: 1.8;
  max-width: 580px;
}

.login-stage-dots {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #aab6cb;
  font-size: 13px;
  position: relative;
  z-index: 1;
}

.login-stage-dots i {
  width: 20px;
  height: 1px;
  background: #35435a;
}

.login-panel {
  display: grid;
  place-items: center;
  padding: 40px;
}

.login-entry {
  width: min(460px, 100%);
}

.login-entry > h2 {
  font-size: 32px;
  margin: 0 0 8px;
}

.login-entry > p {
  color: var(--muted);
  margin: 0 0 24px;
}

.login-mode-tabs {
  display: flex;
  gap: 5px;
  padding: 4px;
  background: #eef1f6;
  border-radius: 8px;
  margin-bottom: 18px;
}

.login-mode-tabs button {
  flex: 1;
  height: 40px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-weight: 700;
  color: #667085;
  cursor: pointer;
}

.login-mode-tabs button.active {
  background: white;
  color: var(--blue);
  box-shadow: 0 2px 8px rgb(18 32 57 / 10%);
}

.login-entry label {
  display: grid;
  gap: 8px;
  margin: 18px 0;
  font-size: 13px;
  font-weight: 650;
  color: #465168;
}

.login-entry input {
  width: 100%;
  height: 44px;
  border: 1px solid #ccd3df;
  border-radius: 7px;
  padding: 0 12px;
  color: var(--text);
  background: white;
  font-size: 14px;
  font-weight: 400;
}

.login-entry input:focus {
  border-color: var(--blue);
  outline: 3px solid rgb(36 91 244 / 12%);
}

.login-button {
  width: 100%;
  height: 46px;
  margin-top: 10px;
  border: 0;
  border-radius: 7px;
  background: var(--blue);
  color: white;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.login-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.form-error {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 7px;
  background: #fdf0f0;
  border: 1px solid #f3c6c6;
  color: #bd2835;
  font-size: 13px;
}

.form-success {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 7px;
  background: #effaf3;
  border: 1px solid #bfe5cd;
  color: #227a43;
  font-size: 13px;
}

.wecom-login {
  display: grid;
  gap: 14px;
  text-align: center;
}

.qr-placeholder {
  display: grid;
  place-items: center;
  height: 180px;
  border: 1px dashed #ccd3df;
  border-radius: 10px;
  color: var(--muted);
  font-size: 14px;
}

.wecom-pending {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}

.guest-demand-entry {
  margin-top: 28px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #f5f7fb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.guest-demand-entry span {
  display: grid;
  gap: 2px;
}

.guest-demand-entry strong {
  font-size: 14px;
}

.guest-demand-entry small {
  color: var(--muted);
  font-size: 12px;
}

.guest-link {
  flex-shrink: 0;
  height: 38px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  border-radius: 7px;
  border: 1px solid #ccd3df;
  background: white;
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.guest-link:hover {
  border-color: var(--blue);
  color: var(--blue);
}

@media (max-width: 960px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-brand {
    min-height: 340px;
    padding: 30px;
  }

  .login-message h1 {
    font-size: 34px;
  }

  .login-stage-dots {
    flex-wrap: wrap;
  }

  .login-panel {
    padding: 32px 20px;
  }
}
</style>
