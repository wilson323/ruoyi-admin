/** Explicit opt-in: existing local fixture login/logout only; never changes a password. */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { ipdNavigationGuard, IPD_ACCOUNT, IPD_HOME, IPD_LOGIN } from '../../../router/ipd-guard';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import Login from './login.vue';
import Account from './account.vue';
import Workbench from '../workbench/index.vue';

const evidence = '/Users/mac/Documents/ruoyi-ai/.codex/ruflo/swarm-20260905-decisions/frontend/auth';
const credentialPath = `${evidence}/private/market-current.json`;
const naturalExpiry = process.env.IPD_LIVE_ACCEPTANCE === 'market-900103-natural-expiry';
const live = naturalExpiry || process.env.IPD_LIVE_ACCEPTANCE === 'market-900103-existing-password';
const resultPath = `${evidence}/refresh/${naturalExpiry ? 'live-natural-expiry' : 'live-client'}-verification.json`;

describe.skipIf(!live)('real Vue components with local Java authentication', () => {
  it('uses the real login form, optionally waits for natural access expiry, and revokes logout', async () => {
    expect(statSync(credentialPath).mode & 0o777).toBe(0o600);
    const credential = JSON.parse(readFileSync(credentialPath, 'utf8'));
    if (credential.phase !== 'VERIFIED' || credential.personId !== '900103' || credential.username !== 'ipd-market') throw new Error('Expected verified market-only private fixture');
    const events: Array<{ path: string; http: number; code: number; envelopeComplete: boolean; at: string }> = [];
    let serverAccessTtlSeconds = 0;
    let naturalExpiryPassed = false;
    // Real loopback HTTP transport for happy-dom; response bodies come from Java unchanged.
    const nativeFetch = (url: string, init?: RequestInit): Promise<Response> => new Promise((resolve, reject) => {
      const req = httpRequest(url, { method: init?.method ?? 'GET', headers: init?.headers as Record<string, string> }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status: response.statusCode, headers: { 'Content-Type': String(response.headers['content-type'] ?? '') } })));
      });
      req.setTimeout(5000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject);
      if (typeof init?.body === 'string') req.write(init.body);
      req.end();
    });
    const attempts: Array<{path: string; error?: string}> = [];
    const networkFetch: typeof fetch = async (input, init) => {
      const path = String(input);
      if (!['/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/auth/logout', '/api/v1/auth/refresh'].includes(path)) throw new Error('Live test refuses any other endpoint');
      const attempt: {path: string; error?: string} = {path}; attempts.push(attempt);
      let response: Response;
      try { response = await nativeFetch(`http://127.0.0.1:15666${path}`, init); } catch (error) { attempt.error = error instanceof Error ? error.name : 'unknown'; throw error; }
      const payload = await response.clone().json();
      if (path.endsWith('/login') && payload.code === 0) serverAccessTtlSeconds = payload.data.expiresIn;
      events.push({ path, at: new Date().toISOString(), http: response.status, code: payload.code, envelopeComplete: ['code', 'message', 'data', 'timestamp', 'traceId'].every(key => key in payload) });
      return response;
    };
    vi.stubGlobal('fetch', networkFetch);
    sessionStorage.clear();
    const pinia = createPinia(); setActivePinia(pinia);
    const auth = useIpdAuthStore();
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: IPD_LOGIN, component: Login }, { path: IPD_ACCOUNT, component: Account }, { path: IPD_HOME, component: Workbench }] });
    router.beforeEach((to) => ipdNavigationGuard(to, router));
    await router.push(IPD_LOGIN); await router.isReady();
    const wrapper = mount(defineComponent({ setup: () => () => h(RouterView) }), { global: { plugins: [pinia, router] } });
    let passed = false;
    try {
      await wrapper.find('input[autocomplete="username"]').setValue(credential.username);
      await wrapper.find('input[autocomplete="current-password"]').setValue(credential.currentPassword);
      await wrapper.find('form').trigger('submit');
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(IPD_HOME), { timeout: 8000 });
      expect(auth.identity?.person.id).toBe('900103');
      expect(auth.identity?.scope).toBe('FULL');
      expect(auth.identity?.mustChangePwd).toBe(false);
      expect(wrapper.text()).toContain('市场产品经理');
      expect(wrapper.text()).toContain('您的账户已通过身份验证。');
      if (naturalExpiry) {
        const before = JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}');
        expect(serverAccessTtlSeconds).toBeGreaterThan(0); expect(serverAccessTtlSeconds).toBeLessThanOrEqual(900);
        const waitUntil = before.accessExpiresAt + 2500;
        while (Date.now() < waitUntil) {
          writeFileSync(resultPath, JSON.stringify({ status: 'WAITING_NATURAL_EXPIRY', account_id: '900103', server_access_ttl_seconds: serverAccessTtlSeconds,
            wait_until: new Date(waitUntil).toISOString(), remaining_seconds: Math.ceil((waitUntil - Date.now()) / 1000), events }, null, 2));
          await delay(Math.min(30_000, Math.max(1, waitUntil - Date.now())));
        }
        const start = events.length;
        const identities = await Promise.all([auth.refreshIdentity(), auth.refreshIdentity()]);
        expect(identities.every(value => value?.person.id === '900103' && value.scope === 'FULL')).toBe(true);
        const refreshEvents = events.slice(start);
        expect(refreshEvents.filter(event => event.path.endsWith('/me') && event.http === 401 && event.code === 20001)).toHaveLength(2);
        expect(refreshEvents.filter(event => event.path.endsWith('/refresh') && event.http === 200 && event.code === 0)).toHaveLength(1);
        expect(refreshEvents.filter(event => event.path.endsWith('/me') && event.http === 200 && event.code === 0)).toHaveLength(2);
        const after = JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') ?? '{}');
        expect(after.accessToken !== before.accessToken).toBe(true);
        expect(after.refreshState).toBe('ready'); expect(after.accessExpiresAt).toBeGreaterThan(before.accessExpiresAt);
        expect(router.currentRoute.value.path).toBe(IPD_HOME);
        naturalExpiryPassed = true;
      }
      const previousToken = auth.token;
      expect(Boolean(previousToken)).toBe(true);
      await wrapper.find('button').trigger('click');
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(IPD_LOGIN), { timeout: 8000 });
      expect(Boolean(auth.token)).toBe(false);
      expect(auth.identity).toBeNull();
      expect(sessionStorage.getItem('ruoyi-ipd.session')).toBeNull();
      expect(sessionStorage.getItem('ruoyi-ipd.session-token')).toBeNull();
      const revoked = await networkFetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${previousToken}` } });
      expect(revoked.status).toBe(401);
      expect((await revoked.json()).code).toBe(20001);
      const revokedRotation = await networkFetch('/api/v1/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${previousToken}` } });
      expect(revokedRotation.status).toBe(401); expect((await revokedRotation.json()).code).toBe(20001);
      expect(events.every(event => event.envelopeComplete)).toBe(true);
      expect(events.some(event => event.path.endsWith('/login') && event.code === 0)).toBe(true);
      expect(events.some(event => event.path.endsWith('/logout') && event.code === 0)).toBe(true);
      passed = true;
    } finally {
      if (auth.token) await auth.logout().catch(() => {});
      wrapper.unmount(); vi.unstubAllGlobals();
      writeFileSync(resultPath, JSON.stringify({ status: passed ? 'PASS' : 'FAIL', account_id: '900103', target: 'http://127.0.0.1:15666/api/v1', mode: 'real AntDV Vue components + actual router guard/store/client + node:http transport to real Java; happy-dom, not a full browser', password_change_performed: false, natural_expiry_requested: naturalExpiry, natural_expiry_passed: naturalExpiryPassed, server_access_ttl_seconds: serverAccessTtlSeconds, synthetic_http_responses: 0, server_ttl_or_redis_modified: false, ui_error: auth.error, attempts, events }, null, 2));
    }
  });
});
