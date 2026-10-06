// 页26 变更单详情（P0-10.25 真实现）：
// 1. 四态齐全：草稿（DRAFT）/ 待双签（PENDING_SIGN）/ 双签通过（APPROVED）/ 双签否决（REJECTED）；
// 2. 错误态：API 404/500/transport → 错误面板 + 错误文案，无崩溃；
// 3. 动作契约：DRAFT 显示「提交签署」/PENDING_SIGN 显示「签署：通过 + 驳回」/
//    终态显示「已结束，不可再操作」徽标，触发后调用对应后端；
// 4. signatures 解析：MARKET_PM / RD_PM 双 APPROVE ⇒ APPROVED；任一 REJECT ⇒ REJECTED。
// 2026-10-06 D6/D14 同步：按钮与徽标文案白话化（APPROVE/REJECT 英文不再直接上屏）。

import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import type { RequirementChange } from '../../../../api/ipd/change';
import { useIpdAuthStore } from '../../../../store/ipd-auth';

import ChangeDetail from './index.vue';

const api = vi.hoisted(() => ({
  getRequirementChange: vi.fn(),
  signRequirementChange: vi.fn(),
  submitRequirementChange: vi.fn(),
}));
vi.mock('../../../../api/ipd/change', () => api);

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { projectId: 'P-1', changeId: 'C-1' } }),
}));

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

function fixture(over: Partial<RequirementChange> = {}): RequirementChange {
  return {
    afterSnapshot: '{"scope":"扩大支持","cost":"+5w"}',
    beforeSnapshot: '{"scope":"基础支持","cost":"0"}',
    changeType: 'REQUIREMENT',
    createBy: 'pm-001',
    createTime: '2026-09-01 10:00:00',
    id: 'C-1',
    projectId: 'P-1',
    reason: '客户新增云端同步能力',
    requirementId: 'R-1',
    signatures: null,
    status: 'DRAFT',
    updateTime: '2026-09-01 10:00:00',
    ...over,
  };
}

function loginAs(personType: 'MARKET_PM' | 'RD_PM'): void {
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    person: {
      accountStatus: 'ACTIVE',
      groupId: 'G1',
      id: '1',
      name: personType,
      personType,
      username: personType.toLowerCase(),
    },
    scope: 'FULL',
  };
}

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  api.getRequirementChange.mockReset();
  api.signRequirementChange.mockReset();
  api.submitRequirementChange.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function mountDetail() {
  const wrapper = mount(ChangeDetail);
  await flushPromises();
  return wrapper;
}

describe('页26 变更单详情', () => {
  it('挂载即调用 getRequirementChange(changeId)', async () => {
    api.getRequirementChange.mockResolvedValueOnce(fixture());
    await mountDetail();
    expect(api.getRequirementChange).toHaveBeenCalledTimes(1);
    expect(api.getRequirementChange).toHaveBeenCalledWith('C-1');
  });

  it('DRAFT 草稿：标签「草稿」，展示「提交签署」按钮，不出现签署按钮', async () => {
    api.getRequirementChange.mockResolvedValueOnce(fixture({ status: 'DRAFT' }));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('草稿');
    expect(text).toContain('提交签署');
    expect(text).not.toContain('签署：通过');
    expect(text).not.toContain('确认驳回');
    expect(text).not.toContain('已结束，不可再操作');
  });

  it('PENDING_SIGN 待双签：标签「待双签」，展示通过/驳回双签按钮 + 待签署徽标', async () => {
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      signatures: JSON.stringify({}),
      status: 'PENDING_SIGN',
    }));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('待双签');
    expect(text).toContain('签署：通过');
    // antd Button 对两字中文按钮自动插入空格（「驳 回」），匹配前去除空白
    expect(wrapper.findAll('button').map((b) => b.text().replace(/\s+/g, ''))).toContain('驳回');
    expect(text).toContain('待签署');
    expect(text).not.toContain('提交签署');
    expect(text).not.toContain('已结束，不可再操作');
  });

  it('APPROVED 双签通过：标签「已批准」，双 PM 均 APPROVE，时间线 APPROVED 节点染色', async () => {
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      signatures: JSON.stringify({
        MARKET_PM: { decision: 'APPROVE', opinion: '范围合理', signedAt: '2026-09-02 10:00:00' },
        RD_PM: { decision: 'APPROVE', opinion: '资源到位', signedAt: '2026-09-02 11:00:00' },
      }),
      status: 'APPROVED',
      updateTime: '2026-09-02 11:00:00',
    }));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('已批准');
    const approveCount = (text.match(/通过/g) ?? []).length;
    expect(approveCount).toBeGreaterThanOrEqual(2);
    expect(text).toContain('已结束，不可再操作');
    expect(text).not.toContain('提交签署');
    expect(text).not.toContain('确认驳回');
  });

  it('REJECTED 双签否决：标签「已驳回」，展示否决方意见 + 终态禁操作', async () => {
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      signatures: JSON.stringify({
        MARKET_PM: { decision: 'APPROVE', opinion: '范围合理', signedAt: '2026-09-02 10:00:00' },
        RD_PM: { decision: 'REJECT', opinion: '工时超预算', signedAt: '2026-09-02 11:00:00' },
      }),
      status: 'REJECTED',
      updateTime: '2026-09-02 11:00:00',
    }));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('已驳回');
    expect(text).toContain('工时超预算');
    expect(text).toContain('已结束，不可再操作');
    expect(text).not.toContain('签署：通过');
    expect(text).not.toContain('提交签署');
  });

  it('signatures 格式异常 → 渲染原文 + 「签署记录格式异常」徽标', async () => {
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      signatures: '{not-json',
      status: 'PENDING_SIGN',
    }));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('签署记录格式异常');
    expect(text).toContain('{not-json');
  });

  it('beforeSnapshot 格式异常 → 渲染原文 + 「格式异常」徽标', async () => {
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      beforeSnapshot: '{broken',
      status: 'DRAFT',
    }));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('格式异常');
    expect(text).toContain('{broken');
  });

  it('API 404：渲染错误面板 + 「加载失败」+ 错误描述，不崩溃', async () => {
    api.getRequirementChange.mockRejectedValueOnce(new IpdRequestError('变更单不存在', 404, 50001, 'http'));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('加载失败');
    expect(text).toContain('变更单不存在');
  });

  it('API 500：渲染错误面板 + 「加载失败」+ 错误描述，不崩溃', async () => {
    api.getRequirementChange.mockRejectedValueOnce(new IpdRequestError('系统内部错误', 500, 90001, 'http'));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('加载失败');
    expect(text).toContain('系统内部错误');
  });

  it('transport 异常：渲染「网络异常」+ 重试文案', async () => {
    api.getRequirementChange.mockRejectedValueOnce(new IpdRequestError('无法连接服务', 0, 0, 'transport'));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('网络异常');
    expect(text).toContain('无法连接服务，请检查网络后重试');
  });

  it('DRAFT 点击「提交签署」调用 submitRequirementChange', async () => {
    loginAs('MARKET_PM');
    api.getRequirementChange.mockResolvedValueOnce(fixture({ status: 'DRAFT' }));
    api.submitRequirementChange.mockResolvedValueOnce(fixture({ status: 'PENDING_SIGN' }));
    const wrapper = await mountDetail();
    const btn = wrapper.findAll('button').find((b) => b.text().includes('提交签署'));
    expect(btn).toBeDefined();
    await btn!.trigger('click');
    await flushPromises();
    expect(api.submitRequirementChange).toHaveBeenCalledWith('C-1');
  });

  it('PENDING_SIGN 点击「签署：通过」调用 signRequirementChange(APPROVE)', async () => {
    loginAs('MARKET_PM');
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      signatures: JSON.stringify({}),
      status: 'PENDING_SIGN',
    }));
    api.signRequirementChange.mockResolvedValueOnce(fixture({
      signatures: JSON.stringify({ MARKET_PM: { decision: 'APPROVE', opinion: null, signedAt: '2026-09-02 10:00:00' } }),
      status: 'PENDING_SIGN',
    }));
    const wrapper = await mountDetail();
    const btn = wrapper.findAll('button').find((b) => b.text().includes('签署：通过'));
    expect(btn).toBeDefined();
    await btn!.trigger('click');
    await flushPromises();
    expect(api.signRequirementChange).toHaveBeenCalledWith('C-1', 'APPROVE', null);
  });

  it('PENDING_SIGN 点「驳回」→ 弹窗填意见 → 确认驳回，调用 signRequirementChange(REJECT, 意见)', async () => {
    loginAs('RD_PM');
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      signatures: JSON.stringify({}),
      status: 'PENDING_SIGN',
    }));
    api.signRequirementChange.mockResolvedValueOnce(fixture({
      signatures: JSON.stringify({ RD_PM: { decision: 'REJECT', opinion: '工时不够', signedAt: '2026-09-02 11:00:00' } }),
      status: 'REJECTED',
    }));
    const wrapper = await mountDetail();
    const rejectBtn = wrapper.findAll('button').find((b) => b.text().replace(/\s+/g, '') === '驳回');
    expect(rejectBtn).toBeDefined();
    await rejectBtn!.trigger('click');
    await flushPromises();
    // D14：Modal 渲染在 document.body（teleport 容器），从 body 操作弹窗内控件
    const textarea = document.querySelector('textarea');
    expect(textarea).not.toBeNull();
    (textarea as HTMLTextAreaElement).value = '工时不够';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const confirmBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('确认驳回'));
    expect(confirmBtn).toBeDefined();
    confirmBtn!.click();
    await flushPromises();
    expect(api.signRequirementChange).toHaveBeenCalledWith('C-1', 'REJECT', '工时不够');
  });

  it('非 MARKET_PM/RD_PM 点击签署 → 不调用 signRequirementChange', async () => {
    useIpdAuthStore().identity = null;
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      signatures: JSON.stringify({}),
      status: 'PENDING_SIGN',
    }));
    const wrapper = await mountDetail();
    const btn = wrapper.findAll('button').find((b) => b.text().includes('签署：通过'));
    await btn!.trigger('click');
    await flushPromises();
    expect(api.signRequirementChange).not.toHaveBeenCalled();
  });

  it('快照为空：渲染「待补充」占位', async () => {
    api.getRequirementChange.mockResolvedValueOnce(fixture({
      afterSnapshot: null,
      beforeSnapshot: null,
      signatures: null,
      status: 'DRAFT',
    }));
    const wrapper = await mountDetail();
    const text = wrapper.text();
    expect(text).toContain('待补充');
  });
});
