import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import Login from './login.vue';

beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

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
});
