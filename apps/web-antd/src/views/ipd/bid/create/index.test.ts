// 创建招标单组件测试：校验、提交、权限提示与五态。
// R215 GAP-F2：提交入口切换至 createBidInvitationP231（POST /bid-invitations/p231-create），
// 表单补 projectId（string 透传禁 Number）；PUBLIC 模式选填 requiredLevel/slaDays、整键省略 targetPersonId。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker, InputNumber, Select } from 'ant-design-vue';

import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import Create from './index.vue';

const api = vi.hoisted(() => ({ createBidInvitationP231: vi.fn() }));
vi.mock('../../../../api/ipd/bid', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => routerMock, useRoute: () => ({ params: {} }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActivePinia(createPinia());
  api.createBidInvitationP231.mockReset();
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

async function fillById(wrapper: ReturnType<typeof mount>, id: string, value: string): Promise<void> {
  const el = wrapper.find(`#${id}`);
  await el.setValue(value);
}

function findSubmit(wrapper: ReturnType<typeof mount>) {
  const btn = wrapper.findAll('button').find((b) => b.text().includes('提交创建'));
  if (!btn) throw new Error('提交按钮未找到');
  return btn;
}

/** 填齐 ONE_TO_ONE 合法表单（含 F2 新增 projectId）。 */
async function fillOneToOne(wrapper: ReturnType<typeof mount>, projectId = '2096266884247736321'): Promise<void> {
  await fillById(wrapper, 'bid-project-id', projectId);
  await fillById(wrapper, 'bid-title', '定向邀请智慧园区');
  await fillTextareas(wrapper, 0, '客户问题、应用场景与核心功能描述');
  await fillById(wrapper, 'bid-target-person-id', '9007199254740993');
}

describe('页20 发起招标 - 校验与提交（GAP-F2 校验型入口）', () => {
  it('空表单提交：字段错误提示出现 + 后端未调用', async () => {
    const wrapper = await mountCreate();
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    const html = wrapper.html();
    expect(html).toContain('请填写所属项目 ID（纯数字）');
    expect(html).toContain('招标标题不少于 4 字');
    expect(html).toContain('招标内容不少于 4 字');
    expect(api.createBidInvitationP231).not.toHaveBeenCalled();
  });

  it('缺 projectId（F2 新增必填）→ 视图校验拦截，api 不被调用（准备包 §F2 用例）', async () => {
    const wrapper = await mountCreate();
    await fillById(wrapper, 'bid-title', '合法标题十字');
    await fillTextareas(wrapper, 0, '合法内容描述超过四字');
    await fillById(wrapper, 'bid-target-person-id', '9007199254740993');
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('请填写所属项目 ID（纯数字）');
    expect(api.createBidInvitationP231).not.toHaveBeenCalled();
  });

  it('定向邀请模式：未填写研发PM ID 时显示错误', async () => {
    const wrapper = await mountCreate();
    await fillById(wrapper, 'bid-project-id', '2096266884247736321');
    await fillById(wrapper, 'bid-title', '超过四字的招标标题');
    await fillTextareas(wrapper, 0, '超过四字的招标内容，包含客户问题、应用场景与核心功能');
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('定向邀请须填写受邀研发PM 的人员 ID（纯数字）');
  });

  it('合法 ONE_TO_ONE 提交：走 p231 新入口并跳转；projectId 19 位雪花 string 逐字符无损（禁 Number 塌缩）', async () => {
    api.createBidInvitationP231.mockResolvedValueOnce({ id: '1', status: 'OPEN' });
    const wrapper = await mountCreate();
    await fillOneToOne(wrapper);
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    expect(api.createBidInvitationP231).toHaveBeenCalledTimes(1);
    const body = api.createBidInvitationP231.mock.calls[0]![0];
    expect(body.mode).toBe('ONE_TO_ONE');
    expect(body.targetPersonId).toBe('9007199254740993');
    expect(body.title).toBe('定向邀请智慧园区');
    // 精度边界哨兵（hr-sync.test.ts:86-87 同款）：Number() 塌缩形态 2096266884247736300 必须不出现
    expect(body.projectId).toBe('2096266884247736321');
    expect(typeof body.projectId).toBe('string');
    expect(routerMock.push).toHaveBeenCalledWith('/ipd/bids');
  });

  it('ONE_TO_ONE 合法：targetPersonId 入参；过期时间通过 DatePicker 注入', async () => {
    api.createBidInvitationP231.mockResolvedValueOnce({ id: '2', status: 'OPEN' });
    const wrapper = await mountCreate();
    await fillOneToOne(wrapper);
    await wrapper.findComponent(DatePicker).vm.$emit('update:value', '2026-12-31 23:59:59');
    await flushPromises();
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    const body = api.createBidInvitationP231.mock.calls[0]![0];
    expect(body.mode).toBe('ONE_TO_ONE');
    expect(body.targetPersonId).toBe('9007199254740993');
    expect(body.expireAt).toBe('2026-12-31 23:59:59');
  });

  it('PUBLIC 模式：body 不含 targetPersonId 键（后端 BidP231Validator 拒填）；选填控件未填不塞键', async () => {
    api.createBidInvitationP231.mockResolvedValueOnce({ id: '3', status: 'OPEN' });
    const wrapper = await mountCreate();
    await fillById(wrapper, 'bid-project-id', '2096266884247736321');
    await fillById(wrapper, 'bid-title', '公开征集标题');
    await fillTextareas(wrapper, 0, '公开征集内容描述');
    const publicRadio = wrapper.findAll('input[type="radio"]').find((i) => i.attributes('value') === 'PUBLIC');
    await publicRadio!.setValue();
    await flushPromises();
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    const body = api.createBidInvitationP231.mock.calls[0]![0];
    expect(body.mode).toBe('PUBLIC');
    expect('targetPersonId' in body).toBe(false);
    expect('requiredLevel' in body).toBe(false);
    expect('slaDays' in body).toBe(false);
    expect(body.projectId).toBe('2096266884247736321');
  });

  it('PUBLIC 选填扩展：requiredLevel=L3、slaDays=7 透传进 body', async () => {
    api.createBidInvitationP231.mockResolvedValueOnce({ id: '4', status: 'OPEN' });
    const wrapper = await mountCreate();
    await fillById(wrapper, 'bid-project-id', '2096266884247736321');
    await fillById(wrapper, 'bid-title', '公开征集带扩展');
    await fillTextareas(wrapper, 0, '公开征集内容描述');
    const publicRadio = wrapper.findAll('input[type="radio"]').find((i) => i.attributes('value') === 'PUBLIC');
    await publicRadio!.setValue();
    await flushPromises();
    await wrapper.findComponent(Select).vm.$emit('update:value', 'L3');
    await wrapper.findComponent(InputNumber).vm.$emit('update:value', 7);
    await flushPromises();
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    const body = api.createBidInvitationP231.mock.calls[0]![0];
    expect(body.requiredLevel).toBe('L3');
    expect(body.slaDays).toBe(7);
    expect('targetPersonId' in body).toBe(false);
  });

  it('拒绝态：10001 输入错误映射为字段级文案', async () => {
    api.createBidInvitationP231.mockRejectedValueOnce(new IpdRequestError('x', 400, 10001, 'http'));
    const wrapper = await mountCreate();
    await fillOneToOne(wrapper);
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('输入信息不符合要求');
  });

  it('权限拒绝态：非项目创建人 403/30001 映射为无权文案（准备包 §F2 用例）', async () => {
    api.createBidInvitationP231.mockRejectedValueOnce(new IpdRequestError('x', 403, 30001, 'http'));
    const wrapper = await mountCreate();
    await fillOneToOne(wrapper);
    await findSubmit(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('当前账号无权发起招标');
  });

  it('断网态：transport 异常显示网络异常文案', async () => {
    api.createBidInvitationP231.mockRejectedValueOnce(new IpdRequestError('x', 0, 0, 'transport'));
    const wrapper = await mountCreate();
    await fillOneToOne(wrapper);
    await findSubmit(wrapper).trigger('click');
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
