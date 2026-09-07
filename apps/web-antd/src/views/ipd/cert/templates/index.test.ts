// 页18 国别认证清单模板库：五态（加载/列表/空态/拒绝/断网）+ 国别侧栏切换 + 新增/删除。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import Index from './index.vue';

const api = vi.hoisted(() => ({
  createCertTemplate: vi.fn(),
  listCertCountryCounts: vi.fn(),
  listCertTemplates: vi.fn(),
  removeCertTemplate: vi.fn(),
}));
vi.mock('../../../../api/ipd/cert-template', () => api);

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ params: {} }) }));

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

const rows = [
  { id: '1', countryCode: 'SA', countryName: '沙特阿拉伯', certName: 'SABER', certAuthority: 'SASO', requirementDesc: '装运前合规认证', isMandatory: '1' },
  { id: '2', countryCode: 'SA', countryName: '沙特阿拉伯', certName: 'IECEE', certAuthority: 'SASO', requirementDesc: '电气安全', isMandatory: '1' },
  { id: '3', countryCode: 'AE', countryName: '阿联酋', certName: 'ECAS', certAuthority: 'ESMA', requirementDesc: '能效合规', isMandatory: '1' },
  { id: '4', countryCode: 'EU', countryName: '欧盟', certName: 'CE-EMC', certAuthority: 'EU', requirementDesc: '电磁兼容', isMandatory: '0' },
];
const counts = { SA: 2, AE: 1, EU: 1 };

const buttonText = (button: { text(): string }) => button.text().replace(/\s+/g, '');

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  api.createCertTemplate.mockReset();
  api.listCertCountryCounts.mockReset();
  api.listCertTemplates.mockReset();
  api.removeCertTemplate.mockReset();
  api.listCertTemplates.mockResolvedValue(rows);
  api.listCertCountryCounts.mockResolvedValue(counts);
});

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

async function mountPage() {
  const wrapper = mount(Index);
  await flushPromises();
  await vi.waitFor(() => {
    if (wrapper.find('.ant-spin').exists()) throw new Error('still loading');
  });
  return wrapper;
}

describe('页18 国别认证清单模板库', () => {
  it('列表态：左侧 3 个国别 + 右侧默认 SA 详情 + SABER/IECEE 渲染', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('国别认证清单');
    expect(wrapper.text()).toContain('沙特阿拉伯');
    expect(wrapper.text()).toContain('阿联酋');
    expect(wrapper.text()).toContain('欧盟');
    expect(wrapper.text()).toContain('SABER');
    expect(wrapper.text()).toContain('IECEE');
    expect(api.listCertTemplates).toHaveBeenCalled();
    expect(api.listCertCountryCounts).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('国别侧栏切换：点「阿联酋」右侧出现 ECAS，SA 不再出现', async () => {
    const wrapper = await mountPage();
    const aeBtn = wrapper.findAll('button').find((b) => b.text().includes('阿联酋'));
    expect(aeBtn).toBeTruthy();
    await aeBtn!.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('ECAS');
      expect(wrapper.text()).not.toContain('SABER');
    });
    wrapper.unmount();
  });

  it('空态：rows 与 counts 都为空时引导新增', async () => {
    api.listCertTemplates.mockResolvedValue([]);
    api.listCertCountryCounts.mockResolvedValue({});
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('暂无国别认证模板');
    wrapper.unmount();
  });

  it('拒绝（30001）展示权限不足文案', async () => {
    api.listCertTemplates.mockRejectedValue(new Error('权限不足'));
    api.listCertCountryCounts.mockResolvedValue(counts);
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('权限不足');
    wrapper.unmount();
  });

  it('断网：失败后提供重新加载并可重试成功', async () => {
    const offline = new IpdRequestError('无法连接服务，请检查网络后重试', 0, 0, 'transport');
    api.listCertTemplates.mockRejectedValueOnce(offline).mockResolvedValueOnce(rows);
    api.listCertCountryCounts.mockResolvedValue(counts);
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('无法连接服务');
    expect(wrapper.html()).toContain('重新加载');
    const retry = wrapper.findAll('button').find((b) => buttonText(b) === '重新加载');
    expect(retry).toBeTruthy();
    await retry!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('SABER'));
    expect(api.listCertTemplates).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('点击「新增认证项」打开弹窗 + 提交调用 createCertTemplate', async () => {
    api.createCertTemplate.mockResolvedValue({
      id: '99', countryCode: 'SA', countryName: '沙特阿拉伯',
      certName: 'SABER-CoC', certAuthority: 'SASO', requirementDesc: null, isMandatory: '1',
    });
    const wrapper = await mountPage();
    const add = wrapper.findAll('button').find((b) => buttonText(b) === '新增认证项');
    expect(add).toBeTruthy();
    await add!.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    const inputs = document.body.querySelectorAll('.ant-modal input');
    const nameInput = [...inputs].find((i) => (i as HTMLInputElement).placeholder?.includes('沙特')) as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    nameInput.value = '沙特阿拉伯';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    const certInput = [...inputs].find((i) => (i as HTMLInputElement).placeholder?.includes('SABER')) as HTMLInputElement;
    expect(certInput).toBeTruthy();
    certInput.value = 'SABER-CoC';
    certInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const okBtn = [...document.body.querySelectorAll('.ant-modal .ant-btn')]
      .find((b) => (b.textContent ?? '').replace(/\s+/g, '') === '保存') as HTMLButtonElement;
    expect(okBtn).toBeTruthy();
    okBtn.click();
    await vi.waitFor(() => {
      expect(api.createCertTemplate).toHaveBeenCalledWith(expect.objectContaining({
        certName: 'SABER-CoC',
        countryCode: 'SA',
        countryName: '沙特阿拉伯',
        isMandatory: '1',
      }));
    });
    wrapper.unmount();
  });

  it('行级「删除」调用 removeCertTemplate(id) 并刷新', async () => {
    api.removeCertTemplate.mockResolvedValue(undefined);
    const wrapper = await mountPage();
    const del = wrapper.findAll('button').find((b) => buttonText(b) === '删除');
    expect(del).toBeTruthy();
    await del!.trigger('click');
    await vi.waitFor(() => expect(api.removeCertTemplate).toHaveBeenCalledWith('1'));
    await vi.waitFor(() => expect(api.listCertTemplates).toHaveBeenCalledTimes(2));
    wrapper.unmount();
  });
});