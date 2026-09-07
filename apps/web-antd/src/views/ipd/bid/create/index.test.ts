// 创建招标单组件测试：校验、提交、权限提示与五态。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from 'ant-design-vue';

import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import Create from './index.vue';

const api = vi.hoisted(() => ({ createBidInvitation: vi.fn() }));
vi.mock('../../../../api/ipd/bid', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => routerMock, useRoute: () => ({ params: {} }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActivePinia(createPinia());
  api.createBidInvitation.mockReset();
  routerMock.push.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function mountCreate() {
  const wrapper = mount(Create);
  await flushPromises();
  return wrapper;
}

async function fillTextareas(wrapper: ReturnType<typeof mount>, idx: number, value: string): Promise<void> {
  const el = wrapper.findAll('textarea')[idx];
  await el!.setValue(value);
}

async function fillInput(wrapper: ReturnType<typeof mount>, selector: string, value: string): Promise<void> {
  const el = wrapper.find(selector);
  await el.setValue(value);
}

describe('页20 发起招标 - 校验与提交', () => {
  it('空表单提交：字段错误提示出现 + 后端未调用', async () => {
    const wrapper = await mountCreate();
    const submit = wrapper.findAll('button').find((b) => b.text().includes('提交创建'));
    await submit!.trigger('click');
    await flushPromises();
    const html = wrapper.html();
    expect(html).toContain('招标标题不少于 4 字');
    expect(html).toContain('招标内容不少于 4 字');
    expect(api.createBidInvitation).not.toHaveBeenCalled();
  });

  it('定向邀请模式：未填写研发PM ID 时显示错误', async () => {
    const wrapper = await mountCreate();
    await fillInput(wrapper, 'input.ant-input', '超过四字的招标标题');
    await fillTextareas(wrapper, 0, '超过四字的招标内容，包含客户问题、应用场景与核心功能');
    const submit = wrapper.findAll('button').find((b) => b.text().includes('提交创建'));
    await submit!.trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('定向邀请须填写受邀研发PM 的人员 ID（纯数字）');
  });

  it('合法表单提交：调用后端并跳转', async () => {
    api.createBidInvitation.mockResolvedValueOnce({ id: '1', status: 'OPEN' });
    const wrapper = await mountCreate();
    await fillInput(wrapper, 'input.ant-input', '定向邀请智慧园区');
    await fillTextareas(wrapper, 0, '客户问题、应用场景与核心功能描述');
    // 第二个 input.ant-input 是 targetPersonId
    const inputs = wrapper.findAll('input.ant-input');
    await inputs[1]!.setValue('9007199254740993');
    const submit = wrapper.findAll('button').find((b) => b.text().includes('提交创建'));
    await submit!.trigger('click');
    await flushPromises();
    expect(api.createBidInvitation).toHaveBeenCalledTimes(1);
    const body = api.createBidInvitation.mock.calls[0]![0];
    expect(body.mode).toBe('ONE_TO_ONE');
    expect(body.targetPersonId).toBe('9007199254740993');
    expect(body.title).toBe('定向邀请智慧园区');
    expect(routerMock.push).toHaveBeenCalledWith('/ipd/bids');
  });

  it('ONE_TO_ONE 合法：targetPersonId 入参；过期时间通过 DatePicker 注入', async () => {
    api.createBidInvitation.mockResolvedValueOnce({ id: '2', status: 'OPEN' });
    const wrapper = await mountCreate();
    await fillInput(wrapper, 'input.ant-input', '定向邀请：智算场景');
    await fillTextareas(wrapper, 0, '客户问题、应用场景与核心功能描述');
    // 第二个 input.ant-input 是 targetPersonId
    const inputs = wrapper.findAll('input.ant-input');
    await inputs[1]!.setValue('9007199254740993');
    // 注入 expireAt
    await wrapper.findComponent(DatePicker).vm.$emit('update:value', '2026-12-31 23:59:59');
    await flushPromises();
    const submit = wrapper.findAll('button').find((b) => b.text().includes('提交创建'));
    await submit!.trigger('click');
    await flushPromises();
    const body = api.createBidInvitation.mock.calls[0]![0];
    expect(body.mode).toBe('ONE_TO_ONE');
    expect(body.targetPersonId).toBe('9007199254740993');
    expect(body.expireAt).toBe('2026-12-31 23:59:59');
  });

  it('拒绝态：10001 输入错误映射为字段级文案', async () => {
    api.createBidInvitation.mockRejectedValueOnce(new IpdRequestError('x', 400, 10001, 'http'));
    const wrapper = await mountCreate();
    await fillInput(wrapper, 'input.ant-input', '超过四字标题');
    await fillTextareas(wrapper, 0, '超过四字的招标内容');
    const inputs = wrapper.findAll('input.ant-input');
    await inputs[1]!.setValue('9007199254740993');
    const submit = wrapper.findAll('button').find((b) => b.text().includes('提交创建'));
    await submit!.trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('输入信息不符合要求');
  });

  it('断网态：transport 异常显示网络异常文案', async () => {
    api.createBidInvitation.mockRejectedValueOnce(new IpdRequestError('x', 0, 0, 'transport'));
    const wrapper = await mountCreate();
    await fillInput(wrapper, 'input.ant-input', '超过四字标题');
    await fillTextareas(wrapper, 0, '超过四字的招标内容');
    const inputs = wrapper.findAll('input.ant-input');
    await inputs[1]!.setValue('9007199254740993');
    const submit = wrapper.findAll('button').find((b) => b.text().includes('提交创建'));
    await submit!.trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('无法连接服务');
  });

  it('角色提示：RD_PM 直接访问看到非市场角色提示', async () => {
    useIpdAuthStore().identity = {
      mustChangePwd: false, scope: 'FULL',
      person: { id: '99', groupId: null, name: '研发人员', username: 'rd', personType: 'RD_PM', accountStatus: 'ACTIVE' },
    };
    const wrapper = await mountCreate();
    expect(wrapper.html()).toContain('发起招标通常由市场PM 操作');
  });
});
