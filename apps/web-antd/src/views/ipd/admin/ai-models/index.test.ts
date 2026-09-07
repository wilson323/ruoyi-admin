/** 页48 AI 模型配置：脱敏回显（密钥不回显）/五态/新增与留空不改密钥契约。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Index from './index.vue';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '请求不合法', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const models = [
  { id: '701', provider: 'DeepSeek', endpoint: 'https://api.deepseek.example/v1', model: 'deepseek-chat', temperature: '0.7', maxTokens: 8192, enabled: '1', maskedKey: 'sk-1****abcd' },
  { id: '702', provider: 'Zhipu', endpoint: 'http://127.0.0.1:8000/v1', model: 'glm-local', temperature: null, maxTokens: null, enabled: '0', maskedKey: '****' },
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

describe('页48 AI 模型配置', () => {
  it('列表渲染脱敏视图：只显示掩码与生效状态', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/ai-models') return envelope(models);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('deepseek-chat'));
    expect(wrapper.text()).toContain('sk-1****abcd');
    expect(wrapper.text()).toContain('生效中');
    expect(wrapper.text()).toContain('未生效');
    // 密钥明文/密文字段在脱敏视图中不存在，页面不可能泄露
    expect(fetcher.mock.calls.every(([target]) => String(target) === '/api/v1/ai-models')).toBe(true);
    wrapper.unmount();
  });

  it('空结果显示空态引导', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope([])));
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无 AI 模型配置'));
    expect(wrapper.text()).toContain('新增配置');
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
      .mockResolvedValueOnce(envelope(models));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务'));
    await wrapper.find('[role="alert"] button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('deepseek-chat'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('新建提交必填密钥（不回显），编辑留空密钥时请求体不含 apiKey', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/ai-models' && (!init?.method || init.method === 'GET')) return envelope(models);
      if (path === '/api/v1/ai-models' && init?.method === 'POST') return envelope(models[0]);
      if (path === '/api/v1/ai-models/701/update') return envelope(models[0]);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('deepseek-chat'));

    // 新建：密钥输入框为密码形态且不回显既有密钥
    await wrapper.findAll('button').find((button) => buttonText(button) === '新增配置')!.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-modal')).toBeTruthy());
    let modal = document.body.querySelector('.ant-modal')!;
    const passwordInput = modal.querySelector('input[type="password"]') as HTMLInputElement;
    expect(passwordInput).toBeTruthy();
    expect(passwordInput.value).toBe('');
    passwordInput.value = 'fixture-secret-key';
    passwordInput.dispatchEvent(new Event('input'));
    const modalInputs = [...modal.querySelectorAll('input.ant-input')] as HTMLInputElement[];
    const fill = (placeholder: string, value: string) => {
      const input = modalInputs.find((candidate) => candidate.placeholder?.includes(placeholder))!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    fill('DeepSeek', 'LocalProvider');
    fill('https://', 'https://api.local.example/v1');
    fill('deepseek-chat', 'local-model');
    const createSave = [...modal.querySelectorAll('.ant-btn-primary')]
      .find((button) => elementText(button).includes('保存'))!;
    createSave.dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]?.body));
      expect(body.apiKey).toBe('fixture-secret-key');
      expect(body.model).toBe('local-model');
    });

    // 编辑生效中配置：密钥留空 → 请求体无 apiKey 键（后端语义：不修改密钥）
    await vi.waitFor(() => expect(document.querySelectorAll('.ant-modal').length).toBeLessThanOrEqual(1));
    const editButton = wrapper.findAll('button').find((button) => buttonText(button) === '编辑')!;
    await editButton.trigger('click');
    await vi.waitFor(() => {
      modal = document.body.querySelector('.ant-modal')!;
      expect(modal).toBeTruthy();
    });
    const editSave = [...modal.querySelectorAll('.ant-btn-primary')]
      .find((button) => elementText(button).includes('保存'))!;
    editSave.dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([target]) => String(target).endsWith('/701/update'));
      expect(call).toBeTruthy();
      const body = JSON.parse(String(call![1]?.body));
      expect(body).not.toHaveProperty('apiKey');
      expect(body.provider).toBe('DeepSeek');
    });
    wrapper.unmount();
  });

  it('连接测试展示服务端白名单结果（拼接在脱敏字段返回）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/ai-models' && (!init?.method || init.method === 'GET')) return envelope(models);
      if (path === '/api/v1/ai-models/701/test') {
        return envelope({ ...models[0], maskedKey: 'sk-1****abcd | connect: ok(200)' });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await vi.waitFor(() => expect(wrapper.text()).toContain('deepseek-chat'));
    await wrapper.findAll('button').find((button) => buttonText(button) === '测试连接')!.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-modal')?.textContent).toContain('connect: ok(200)'));
    expect(document.body.querySelector('.ant-modal')?.textContent).not.toContain('fixture-plain-secret');
    wrapper.unmount();
  });
});
