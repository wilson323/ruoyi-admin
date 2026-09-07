/** 页46 SOP 模板：五态（引导/加载/成功/空态/拒绝/断网）与版本动作契约。 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Index from './index.vue';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '请求不合法', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const versions = [
  { id: '301', actionCode: 'P03', title: '产品章程 SOP', version: 2, status: 'PUBLISHED', contentLen: 120 },
  { id: '302', actionCode: 'P03', title: '产品章程草稿', version: 3, status: 'DRAFT', contentLen: 9 },
];

const buttonText = (button: { text(): string }) => button.text().replace(/\s+/g, '');

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function query(wrapper: ReturnType<typeof mount>, code = 'P03') {
  await wrapper.find('input').setValue(code);
  await wrapper.findAll('button')[0]!.trigger('click');
}

describe('页46 SOP 模板', () => {
  it('初始为查询引导态，不发起请求', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    expect(wrapper.text()).toContain('输入动作编码后查询');
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('查询成功后渲染版本列表与状态标签', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/sop-templates?actionCode=P03') return envelope(versions);
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await query(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain('v3'));
    expect(wrapper.text()).toContain('产品章程 SOP');
    expect(wrapper.text()).toContain('已发布');
    expect(wrapper.text()).toContain('草稿');
    expect(wrapper.text()).toContain('共 2 个版本');
    // 草稿行可编辑/发布；已发布行出现复制为草稿
    const buttons = wrapper.findAll('button').map(buttonText);
    expect(buttons).toContain('编辑');
    expect(buttons).toContain('发布');
    expect(buttons).toContain('复制为草稿');
    wrapper.unmount();
  });

  it('空结果显示空态引导', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope([])));
    const wrapper = mount(Index);
    await query(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无 SOP 版本记录'));
    wrapper.unmount();
  });

  it('业务拒绝展示统一中文文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope(null, 400, 10001)));
    const wrapper = mount(Index);
    await query(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain('输入信息不符合要求'));
    wrapper.unmount();
  });

  it('断网展示网络文案并提供重新加载', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(envelope(versions));
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await query(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务'));
    await wrapper.find('[role="alert"] button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('v3'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('编辑草稿取全文快照并按白名单提交 title/content', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/sop-templates?actionCode=P03') return envelope(versions);
      if (path === '/api/v1/sop-templates/302' && (!init?.method || init.method === 'GET')) {
        return envelope({ ...versions[1], content: '原始正文内容' });
      }
      if (path === '/api/v1/sop-templates/302/update') {
        return envelope({ ...versions[1], title: '新标题', contentLen: 6 });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await query(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain('v3'));
    const editButton = wrapper.findAll('button').find((button) => buttonText(button) === '编辑')!;
    await editButton.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-modal')).toBeTruthy());
    // 打开编辑即拉取全文快照（整段覆盖语义）
    await vi.waitFor(() => {
      const textarea = document.body.querySelector('.ant-modal textarea') as HTMLTextAreaElement | null;
      expect(textarea?.value).toBe('原始正文内容');
    });
    const titleInput = document.body.querySelector('.ant-modal input') as HTMLInputElement;
    titleInput.value = '新标题';
    titleInput.dispatchEvent(new Event('input'));
    const saveButton = [...document.body.querySelectorAll('.ant-modal .ant-btn-primary')]
      .find((button) => button.textContent?.includes('保存草稿'))!;
    saveButton.dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      const call = fetcher.mock.calls.find(([target]) => String(target).endsWith('/302/update'));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toEqual({ title: '新标题', content: '原始正文内容' });
    });
    // 等待保存后的列表刷新与 Modal 关闭动画完成，再卸载组件（避免 antd 内部 nextTick 在卸载后访问已置空的输入引用）
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    await new Promise((resolve) => setTimeout(resolve, 50));
    wrapper.unmount();
  });

  it('查看当前生效 SOP 成功：返回全文快照', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/v1/sop-templates/current')) {
        return envelope({ ...versions[1], status: 'PUBLISHED', content: '当前生效正文' });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await wrapper.find('input').setValue('P03');
    await wrapper.findAll('button').find((button) => buttonText(button) === '查看当前生效SOP')!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('当前生效正文'));
    expect(wrapper.text()).toContain('v3');
    // 拉取走 current 端点，未触发版本列表（/sop-templates? 不带 /current 前缀的查询）
    expect(fetcher.mock.calls.some(([target]) => String(target).startsWith('/api/v1/sop-templates/current'))).toBe(true);
    expect(fetcher.mock.calls.every(([target]) => !/sop-templates\?/.test(String(target)))).toBe(true);
    wrapper.unmount();
  });

  it('查看当前生效 SOP：无模板时按业务码 50001 提示资源不存在', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith('/api/v1/sop-templates/current')) {
        return new Response(JSON.stringify({ code: 50001, message: '资源不存在', data: null }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await wrapper.find('input').setValue('P03');
    await wrapper.findAll('button').find((button) => buttonText(button) === '查看当前生效SOP')!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('资源不存在'));
    wrapper.unmount();
  });

  it('发布需二次确认，确认后调用 publish 并提示仅影响新项目', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/v1/sop-templates?actionCode=P03') return envelope(versions);
      if (path === '/api/v1/sop-templates/302/publish') {
        return envelope({ ...versions[1], status: 'PUBLISHED' });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Index);
    await query(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain('v3'));
    const publishButton = wrapper.findAll('button').find((button) => buttonText(button) === '发布')!;
    await publishButton.trigger('click');
    await vi.waitFor(() => expect(document.body.querySelector('.ant-popconfirm')).toBeTruthy());
    expect(document.body.querySelector('.ant-popconfirm')?.textContent).toContain('在研项目保持原版本');
    const confirmButton = document.body.querySelector('.ant-popconfirm .ant-btn-primary') as HTMLButtonElement;
    confirmButton.dispatchEvent(new Event('click'));
    await vi.waitFor(() => {
      expect(fetcher.mock.calls.some(([target]) => String(target).endsWith('/302/publish'))).toBe(true);
    });
    // 等待发布后的列表刷新完成再卸载，避免在途请求落到真实网络
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    // 再等一拍，让 antd 组件内部的 nextTick 队列清空后再卸载
    await new Promise((resolve) => setTimeout(resolve, 50));
    wrapper.unmount();
  });
});
