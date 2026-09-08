import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import Login from './login.vue';

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function mountLogin(): ReturnType<typeof mount> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: Login }, { path: '/ipd/login', component: Login }],
  });
  return router.push('/').then(() => router.isReady()).then(() =>
    mount(Login, { global: { plugins: [router] } }),
  ) as unknown as ReturnType<typeof mount>;
}

type DemoVm = {
  isDev: boolean;
  demoAccounts: ReadonlyArray<{ label: string; username: string }>;
  demoPasswords: Record<string, string>;
};

describe('login.vue demo accounts DCE guard', () => {
  it('populates the demo block and fills the form when DEV is true', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_IPD_DEMO_PASSWORDS', 'ipd-admin=a,ipd-leader=b,ipd-market=c,ipd-rd=d');
    const wrapper = await mountLogin();
    try {
      const vm = wrapper.vm as unknown as DemoVm;
      expect(vm.isDev).toBe(true);
      expect(vm.demoAccounts.map((a) => a.username)).toEqual(['ipd-admin', 'ipd-leader', 'ipd-market', 'ipd-rd']);
      expect(vm.demoPasswords).toEqual({ 'ipd-admin': 'a', 'ipd-leader': 'b', 'ipd-market': 'c', 'ipd-rd': 'd' });
      const buttons = wrapper.findAll('.demo-accounts button');
      expect(buttons).toHaveLength(4);
      expect(wrapper.text()).toContain('ipd-admin');
      await buttons[0]?.trigger('click');
      const inputs = wrapper.findAll('input');
      expect(inputs[0]?.element.value).toBe('ipd-admin');
      expect(inputs[1]?.element.value).toBe('a');
    } finally { wrapper.unmount(); }
  });

  it('drops the demo block and leaks no internal usernames when DEV is false (prod)', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_IPD_DEMO_PASSWORDS', '');
    const wrapper = await mountLogin();
    try {
      const vm = wrapper.vm as unknown as DemoVm;
      expect(vm.isDev).toBe(false);
      expect(vm.demoAccounts).toEqual([]);
      expect(vm.demoPasswords).toEqual({});
      expect(wrapper.findAll('.demo-accounts button')).toHaveLength(0);
      for (const username of ['ipd-admin', 'ipd-leader', 'ipd-market', 'ipd-rd']) {
        expect(wrapper.text()).not.toContain(username);
      }
    } finally { wrapper.unmount(); }
  });

  it('shows a visible missing-config hint and fills no password when VITE_IPD_DEMO_PASSWORDS is unset in dev', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_IPD_DEMO_PASSWORDS', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = await mountLogin();
    try {
      // 配置缺失必须显式可见（不能用全局 throw 把没配 .env 的会话挡在应用外）
      expect(wrapper.text()).toContain('未配置 VITE_IPD_DEMO_PASSWORDS');
      const buttons = wrapper.findAll('.demo-accounts button');
      expect(buttons).toHaveLength(4);
      await buttons[0]?.trigger('click');
      const inputs = wrapper.findAll('input');
      expect(inputs[0]?.element.value).toBe('ipd-admin');
      expect(inputs[1]?.element.value).toBe('');
    } finally { wrapper.unmount(); }
  });

  it('rejects empty credentials with a clear message and never hits the network', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_IPD_DEMO_PASSWORDS', '');
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = await mountLogin();
    try {
      const inputs = wrapper.findAll('input');
      await inputs[0]?.setValue('sysadmin');
      await inputs[1]?.setValue('');
      await wrapper.find('form').trigger('submit');
      // 明确文案替代误导性的「用户名或密码不对」；守卫拦截后不发任何请求
      expect(wrapper.text()).toContain('请输入用户名和密码');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
});
