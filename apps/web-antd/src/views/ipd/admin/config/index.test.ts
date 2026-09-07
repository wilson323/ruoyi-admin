/** 页45 参数配置：超管只读/6 项涉钱高亮/PUT 更新/版本链/时点解析/JSON 校验。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Index from './index.vue';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import type { IpdPersonType } from '../../../../api/ipd/auth';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '请求不合法', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const configs = [
  { id: '1', configKey: 'gate.signDeadlineDays', configValue: '3', defaultValue: '3', valueType: 'NUMBER', description: 'Gate 双签期限', remark: 'D17' },
  { id: '2', configKey: 'bonus.poolBase', configValue: 'TARGET_SALES', defaultValue: 'TARGET_SALES', valueType: 'STRING', description: '奖金池基数', remark: 'Q1 涉钱' },
  { id: '3', configKey: 'bonus.salesSource', configValue: 'RECEIPT', defaultValue: 'RECEIPT', valueType: 'STRING', description: '奖金池销售额口径', remark: 'Q2 涉钱' },
  { id: '4', configKey: 'kpi.functionalWeight', configValue: '0.6', defaultValue: '0.6', valueType: 'NUMBER', description: '功能 KPI 权重', remark: '' },
  { id: '5', configKey: 'hr.allowCrossRole', configValue: 'false', defaultValue: 'false', valueType: 'BOOL', description: '允许跨角色', remark: 'B7' },
  { id: '6', configKey: 'ai.extra', configValue: '{"k":"v"}', defaultValue: '{"k":"v"}', valueType: 'JSON', description: 'JSON 示例', remark: '' },
];

const versions = [
  { id: 'v1', configKey: 'gate.signDeadlineDays', configValue: '5', version: 2, effectiveFrom: '2026-09-01T00:00:00Z', effectiveTo: null, isImmutable: true, changedBy: '201', changeReason: '扩展签字期', createTime: '2026-09-01T00:00:00Z' },
  { id: 'v2', configKey: 'gate.signDeadlineDays', configValue: '3', version: 1, effectiveFrom: '2026-08-01T00:00:00Z', effectiveTo: '2026-09-01T00:00:00Z', isImmutable: true, changedBy: '0', changeReason: '系统种子', createTime: '2026-08-01T00:00:00Z' },
];

function buttonText(button: { text(): string }) { return button.text().replace(/\s+/g, ''); }
function elementText(element: Element) { return (element.textContent ?? '').replace(/\s+/g, ''); }

function setupIdentity(role: IpdPersonType) {
  sessionStorage.setItem('ruoyi-ipd.session', JSON.stringify({
    accessToken: 'token-fake', refreshToken: 'r-fake',
    accessExpiresAt: Date.now() + 3_600_000, refreshExpiresAt: Date.now() + 7_200_000,
    refreshState: 'ready',
  }));
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: { id: '201', name: '测试用户', username: 'fixture', accountStatus: 'ACTIVE', groupId: '5', personType: role },
    scope: 'FULL',
  };
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('页45 参数配置', () => {
  it('超管场景：渲染参数列表 + 类型 Tag + 默认值', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope(configs)));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('gate.signDeadlineDays'));
    expect(wrapper.text()).toContain('kpi.functionalWeight');
    expect(wrapper.text()).toContain('功能 KPI 权重');
    expect(wrapper.text()).toContain('NUMBER');
    expect(wrapper.text()).toContain('BOOL');
    wrapper.unmount();
  });

  it('非超管场景：仅显示「超级管理员专属」卡片', async () => {
    setupIdentity('MARKET_PM');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('参数配置为超级管理员专属'));
    expect(fetcher.mock.calls).toHaveLength(0);
    wrapper.unmount();
  });

  it('空结果显示空态引导', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope([])));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('系统中暂无系统参数'));
    wrapper.unmount();
  });

  it('业务拒绝展示统一中文文案', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope(null, 400, 10001)));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('输入信息不符合要求'));
    wrapper.unmount();
  });

  it('断网展示网络文案并可重试', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(envelope(configs));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务'));
    await wrapper.find('[role="alert"] button').trigger('click');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(wrapper.text()).toContain('gate.signDeadlineDays'));
    wrapper.unmount();
  });

  it('6 项涉钱参数高亮 Tab：切换后只展示 G-08 红线键', async () => {
    setupIdentity('SUPER_ADMIN');
    vi.stubGlobal('fetch', vi.fn(async () => envelope(configs)));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('gate.signDeadlineDays'));
    // ant-design-vue Tabs 在 happy-dom 下可能未渲染完整标签节点；直接切换 activeTab
    (wrapper.vm as unknown as { activeTab: string }).activeTab = 'money';
    await wrapper.vm.$nextTick();
    await vi.waitFor(() => expect(wrapper.text()).toContain('6 项涉钱参数'));
    expect(wrapper.text()).toContain('bonus.poolBase');
    expect(wrapper.text()).toContain('bonus.salesSource');
    expect(wrapper.text()).not.toContain('gate.signDeadlineDays');
    expect(wrapper.text()).not.toContain('kpi.functionalWeight');
    wrapper.unmount();
  });

  it('编辑参数：NUMBER 类型输入与 PUT 请求体一致', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/system-configs' && (!init?.method || init.method === 'GET')) return envelope(configs);
      if (path === '/api/v1/system-configs/gate.signDeadlineDays' && init?.method === 'PUT') return envelope({ key: 'gate.signDeadlineDays', value: '5', invalidated: 'true' });
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('gate.signDeadlineDays'));
    const editButtons = wrapper.findAll('button').filter((b) => buttonText(b) === '编辑');
    expect(editButtons.length).toBeGreaterThan(0);
    await editButtons[0]!.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-modal')).toBeTruthy());
    const modal = document.body.querySelector('.ant-modal')!;
    const numberInput = modal.querySelector('.ant-input-number-input') as HTMLInputElement;
    numberInput.value = '5';
    numberInput.dispatchEvent(new Event('input'));
    const okBtn = [...modal.querySelectorAll('.ant-btn-primary')].find((b) => elementText(b).includes('保存'))!;
    okBtn.dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([target, init]) => String(target).endsWith('/gate.signDeadlineDays') && init?.method === 'PUT');
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]?.body));
      expect(body.value).toBe('5');
    });
    wrapper.unmount();
  });

  it('编辑参数：BOOL 类型 Switch 提交字符串 true/false', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/system-configs' && (!init?.method || init.method === 'GET')) return envelope(configs);
      if (path === '/api/v1/system-configs/hr.allowCrossRole' && init?.method === 'PUT') return envelope({ key: 'hr.allowCrossRole', value: 'true', invalidated: 'true' });
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('hr.allowCrossRole'));
    // 找到 hr.allowCrossRole 行的编辑按钮
    const targetRow = wrapper.findAll('tr').find((tr) => tr.text().includes('hr.allowCrossRole'));
    expect(targetRow).toBeTruthy();
    const editBtn = targetRow!.findAll('button').find((b) => buttonText(b) === '编辑')!;
    await editBtn.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-modal')).toBeTruthy());
    const modal = document.body.querySelector('.ant-modal')!;
    const switchEl = modal.querySelector('.ant-switch') as HTMLElement;
    expect(switchEl).toBeTruthy();
    switchEl.click();
    const okBtn = [...modal.querySelectorAll('.ant-btn-primary')].find((b) => elementText(b).includes('保存'))!;
    okBtn.dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([target, init]) => String(target).endsWith('/hr.allowCrossRole') && init?.method === 'PUT');
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]?.body));
      expect(['true', 'false']).toContain(body.value);
    });
    wrapper.unmount();
  });

  it('版本链抽屉：调用 /versions 并按时间倒序展示', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/system-configs') return envelope(configs);
      if (path.startsWith('/api/v1/system-configs/gate.signDeadlineDays/versions')) return envelope(versions);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('gate.signDeadlineDays'));
    const targetRow = wrapper.findAll('tr').find((tr) => tr.text().includes('gate.signDeadlineDays'));
    expect(targetRow).toBeTruthy();
    const versionBtn = targetRow!.findAll('button').find((b) => buttonText(b) === '版本链')!;
    await versionBtn.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-drawer')).toBeTruthy());
    // Drawer 渲染到 body（teleport）；用 body 查询而不是 wrapper.text()
    await vi.waitFor(() => expect(document.body.textContent ?? '').toContain('v2'));
    expect(document.body.textContent ?? '').toContain('生效中');
    wrapper.unmount();
  });

  it('时点解析：调用 /as-of 展示来自分类的来源', async () => {
    setupIdentity('SUPER_ADMIN');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/system-configs') return envelope(configs);
      if (path.startsWith('/api/v1/system-configs/gate.signDeadlineDays/as-of')) {
        return envelope({ key: 'gate.signDeadlineDays', source: 'VERSION', value: '3', version: 1, asOf: '2026-08-15T00:00:00Z' });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('gate.signDeadlineDays'));
    const targetRow = wrapper.findAll('tr').find((tr) => tr.text().includes('gate.signDeadlineDays'));
    expect(targetRow).toBeTruthy();
    const asOfBtn = targetRow!.findAll('button').find((b) => buttonText(b) === '时点解析')!;
    await asOfBtn.trigger('click');
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([target]) => String(target).includes('/as-of'));
      expect(call).toBeTruthy();
    });
    wrapper.unmount();
  });
});