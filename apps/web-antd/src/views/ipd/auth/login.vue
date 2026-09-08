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


/** 原型 App.jsx LoginPage「演示账号快捷选择」：点选即填入表单，不自动提交。
 *  修复：原型的 5 个中文人名在 ipd_dev 库不存在（点选后必然登录失败＝死功能），
 *  改映射为库中真实存在的 4 个 bootstrap 账号。账号清单/角色/密码配置方法的
 *  单一信源文档：apps/web-antd 同仓 docs/dev-accounts.md；运行时真源为后端仓
 *  .codex/ipd-dev/config/bootstrap-accounts.json（gitignore 未入库）。
 *  各账号密码已轮换且互不相同，不写进源码：仅 dev 构建从本地未跟踪的
 *  .env.development.local 读 VITE_IPD_DEMO_PASSWORDS="ipd-admin=x,ipd-leader=y,…"；
 *  生产构建取不到即留空，且整个演示区块仅在 dev 渲染，且字面量被
 *  `if (import.meta.env.DEV)` 包裹由 Vite DCE 在 prod bundle 中抹除（v-if 模板
 *  门禁+JS 字面量抹除双重保护，避免向公网暴露内部账号名）。 */
const isDev = import.meta.env.DEV;
const demoAccounts: { label: string; username: string }[] = [];
const demoPasswords: Record<string, string> = {};
function fillDemoAccount(account: { label: string; username: string }): void {
  if (!isDev || auth.busy) return;
  form.username = account.username;
  form.password = demoPasswords[account.username] ?? '';
}
if (import.meta.env.DEV) {
  demoAccounts.push(
    { label: '超管', username: 'ipd-admin' },
    { label: '组长', username: 'ipd-leader' },
    { label: '市场 PM', username: 'ipd-market' },
    { label: '研发 PM', username: 'ipd-rd' },
  );
  Object.assign(demoPasswords, Object.fromEntries(
    String(import.meta.env.VITE_IPD_DEMO_PASSWORDS ?? '')
      .split(',')
      .map((pair) => pair.split('='))
      .filter((parts): parts is [string, string] => parts.length === 2 && parts[0] !== '' && parts[1] !== ''),
  ));
}
/* fail-fast 不用全局 throw：无 .env.development.local 的会话/成员不该被挡在应用外。
   缺配置降级为「可见警告 + 只填用户名」，配置方法单一信源见 docs/dev-accounts.md。 */
const demoPasswordsMissing = isDev && Object.keys(demoPasswords).length === 0;
if (demoPasswordsMissing) {
  console.warn('[ipd-login] VITE_IPD_DEMO_PASSWORDS 未配置：演示账号仅填充用户名，密码需手动输入。配置方法见 docs/dev-accounts.md');
}

async function submit() {
  if (auth.busy) return;
  // 空凭据守卫：给明确文案，避免空密码打到后端换来误导性的「用户名或密码不对」。
  if (!form.username.trim() || !form.password) {
    auth.error = '请输入用户名和密码';
    return;
  }
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
          <div v-if="isDev" class="demo-accounts">
            <strong>演示账号快捷选择</strong>
            <button
              v-for="account in demoAccounts"
              :key="account.username"
              type="button"
              :disabled="auth.busy"
              @click="fillDemoAccount(account)"
            >
              {{ account.label }}（{{ account.username }}）
            </button>
            <span v-if="demoPasswordsMissing" class="demo-password-missing">
              未配置 VITE_IPD_DEMO_PASSWORDS：快捷选择只填用户名，密码请手动输入（配置方法见 docs/dev-accounts.md）
            </span>
            <span v-else>开发库真实账号；密码已从本地 .env.development.local 自动填充</span>
          </div>
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


/* V12-F3: 原 960px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
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

.login-page {
  --navy: #071426;
  --blue: #245bf4;

  /* V12/a11y：#697388 对比不足（axe serious）加深至 #556479 = 5.36:1 on #eef1f6 */
  --muted: #556479;
  --text: #172033;

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

.login-stage-dots {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 13px;
  color: #aab6cb;
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
  margin: 0 0 8px;
  font-size: 32px;
}

.login-entry > p {
  margin: 0 0 24px;
  color: var(--muted);
}

.login-mode-tabs {
  display: flex;
  gap: 5px;
  padding: 4px;
  margin-bottom: 18px;
  background: #eef1f6;
  border-radius: 8px;
}

.login-mode-tabs button {
  display: flex;
  flex: 1;
  gap: 7px;
  align-items: center;
  justify-content: center;
  height: 40px;
  font-weight: 700;

  /* V12/a11y color-contrast：#667085 on #eef1f6 = 4.02:1 < WCAG AA 4.5:1（axe serious）
     加深至 #475467 = 6.79:1 达标（antd colorText 系） */
  color: #475467;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
}

.login-mode-tabs button.active {
  color: var(--blue);
  background: white;
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
  padding: 0 12px;
  font-size: 14px;
  font-weight: 400;
  color: var(--text);
  background: white;
  border: 1px solid #ccd3df;
  border-radius: 7px;
}

.login-entry input:focus {
  outline: 3px solid rgb(36 91 244 / 12%);
  border-color: var(--blue);
}

.login-button {
  width: 100%;
  height: 46px;
  margin-top: 10px;
  font-size: 15px;
  font-weight: 700;
  color: white;
  cursor: pointer;
  background: var(--blue);
  border: 0;
  border-radius: 7px;
}

.login-button:disabled {
  cursor: default;
  opacity: 0.6;
}

/* 原型 styles.css 57-59 逐字复刻（var(--line) 以登录页输入框边框色落地） */
.demo-accounts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 16px;
  margin-top: 28px;
  font-size: 12px;
  color: var(--muted);
  background: #fafbfc;
  border: 1px solid #ccd3df;
  border-radius: 8px;
}

.demo-accounts strong {
  width: 100%;
  color: #3a455b;
}

.demo-password-missing {
  width: 100%;
  color: #8a5a12;
}

/* a11y：#8a5a12 on #fafbfc ≈ 5.1:1，缺失警告需可读 */

.demo-accounts button {
  padding: 5px 8px;
  cursor: pointer;
  background: white;
  border: 1px solid #d6dce6;
  border-radius: 4px;
}

.form-error {
  padding: 10px 12px;
  margin: 12px 0 0;
  font-size: 13px;
  color: #bd2835;
  background: #fdf0f0;
  border: 1px solid #f3c6c6;
  border-radius: 7px;
}

.form-success {
  padding: 10px 12px;
  margin: 12px 0 0;
  font-size: 13px;
  color: #227a43;
  background: #effaf3;
  border: 1px solid #bfe5cd;
  border-radius: 7px;
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
  font-size: 14px;
  color: var(--muted);
  border: 1px dashed #ccd3df;
  border-radius: 10px;
}

.wecom-pending {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted);
}

.guest-demand-entry {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  margin-top: 28px;
  background: #f5f7fb;
  border-radius: 10px;
}

.guest-demand-entry span {
  display: grid;
  gap: 2px;
}

.guest-demand-entry strong {
  font-size: 14px;
}

.guest-demand-entry small {
  font-size: 12px;
  color: var(--muted);
}

.guest-link {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  height: 38px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 650;
  color: var(--text);
  text-decoration: none;
  background: white;
  border: 1px solid #ccd3df;
  border-radius: 7px;
}

/* V10 深化（移动端走查 2026-09-07）：guest-demand-entry 在 ≤768px 换行，
   guest-link 撤销 flex-shrink:0 改可收缩+自适应，消除 375 视口 10px 横向溢出 */
@media (max-width: 768px) {
  .guest-demand-entry {
    flex-wrap: wrap;
    gap: 10px;
  }
  .guest-demand-entry .guest-link {
    flex: 1 1 auto;
    justify-content: center;
    flex-shrink: 1;
  }
}

.guest-link:hover {
  color: var(--blue);
  border-color: var(--blue);
}
</style>
