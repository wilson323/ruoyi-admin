/** 页47 Gate 评审要素：加载/成功/空态/拒绝/断网与新增/停用契约。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Index from './index.vue';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '请求不合法', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const elements = [
  { id: '501', gateCode: 'G1', elementCode: 'G1-E01', elementName: '客户验证完成', passStandard: '5 份客户验证记录', isVeto: '1', sortOrder: 1, enabled: '1' },
  { id: '502', gateCode: 'G1', elementCode: 'G1-E02', elementName: '市场需求说明', passStandard: null, isVeto: '0', sortOrder: 2, enabled: '1' },
];

const buttonText = (button: { text(): string }) => button.text().replace(/\s+/g, '');
const elementText = (element: Element) => (element.textContent ?? '').replace(/\s+/g, '');

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('页47 Gate 评审要素', () => {
  it('加载成功渲染要素清单与真实统计（不造种子数据）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/gate-elements') return envelope(elements);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('G1-E01'));
    expect(wrapper.text()).toContain('客户验证完成');
    expect(wrapper.text()).toContain('否决项');
    expect(wrapper.text()).toContain('共 2 项');
    expect(wrapper.text()).toContain('否决项 1 项');
    // 通过标准为空时显示「待补充」（G-06 不留空白）
    expect(wrapper.text()).toContain('待补充');
    wrapper.unmount();
  });

  it('空结果显示空态引导', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope([])));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无启用的评审要素'));
    expect(wrapper.text()).toContain('新增要素');
    wrapper.unmount();
  });

  it('业务拒绝展示统一中文文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope(null, 400, 10001)));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('输入信息不符合要求'));
    wrapper.unmount();
  });

  it('断网展示网络文案并可重试', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(envelope(elements));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务'));
    await wrapper.find('[role="alert"] button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('G1-E01'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('新增要素按白名单提交（否决位/启用位序列化为 1/0）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/gate-elements' && (!init?.method || init.method === 'GET')) return envelope(elements);
      if (path === '/api/v1/gate-elements' && init?.method === 'POST') {
        return envelope({ id: '503', ...JSON.parse(String(init.body)), passStandard: null, sortOrder: 5 });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('G1-E01'));
    await wrapper.findAll('button').find((button) => buttonText(button) === '新增要素')!.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-modal')).toBeTruthy());
    const modal = document.body.querySelector('.ant-modal')!;
    const inputs = [...modal.querySelectorAll('input.ant-input')] as HTMLInputElement[];
    // 表单输入顺序：要素编码、要素名称（Select 不用 ant-input）
    const codeInput = inputs.find((input) => input.placeholder?.includes('G1-E01'))!;
    codeInput.value = 'G1-E09';
    codeInput.dispatchEvent(new Event('input'));
    const nameInput = inputs.find((input) => input.placeholder?.includes('客户验证'))!;
    nameInput.value = '毛利率达标';
    nameInput.dispatchEvent(new Event('input'));
    // 开启否决位
    (modal.querySelector('.ant-switch') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const saveButton = [...modal.querySelectorAll('.ant-btn-primary')]
      .find((button) => elementText(button).includes('保存'))!;
    saveButton.dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]?.body));
      expect(body.elementCode).toBe('G1-E09');
      expect(body.elementName).toBe('毛利率达标');
      expect(body.gateCode).toBe('G1');
      expect(body.isVeto).toBe('1');
      expect(body.enabled).toBe('1');
      expect(body.passStandard).toBeNull();
    });
    wrapper.unmount();
  });

  it('停用需确认且只调用 disable（禁删）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/gate-elements' && (!init?.method || init.method === 'GET')) return envelope(elements);
      if (path === '/api/v1/gate-elements/501/disable') return envelope({ ...elements[0], enabled: '0' });
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('G1-E01'));
    await wrapper.findAll('button').find((button) => buttonText(button) === '停用')!.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-popconfirm')).toBeTruthy());
    expect(document.body.querySelector('.ant-popconfirm')?.textContent).toContain('历史判定记录不受影响');
    (document.body.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLElement)
      .dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      expect(fetcher.mock.calls.some(([target]) => String(target).endsWith('/501/disable'))).toBe(true);
    });
    wrapper.unmount();
  });
});
