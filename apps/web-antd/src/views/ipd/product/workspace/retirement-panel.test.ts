import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Panel from './retirement-panel.vue';
const api = vi.hoisted(() => ({ fetchProductRetirement: vi.fn(), submitProductRetirement: vi.fn(), editProductRetirementPolicy: vi.fn(), decideProductRetirement: vi.fn() }));
vi.mock('../../../../api/ipd/product-retirement', () => api);
const row = { id:'9007199254740993123', productId:'9007199254740993999', proposerId:'9007199254740993111', version:4, status:'PENDING_RD_LEADER', reason:'旧理由', rdOpinion:null };
const view = (overrides = {}) => ({ retirement:row, canSubmit:false, canEditPolicy:false, canDecide:false, history:[], ...overrides });
beforeEach(() => { vi.resetAllMocks(); api.fetchProductRetirement.mockResolvedValue(view()); });
const setup = async () => { const wrapper=mount(Panel,{props:{productId:row.productId}}); await flushPromises(); return wrapper; };
describe('原产品空间退市业务', () => {
  it('初次提交用版本0和字符串产品ID，重读真实权限', async () => {
    api.fetchProductRetirement.mockResolvedValueOnce(view({retirement:null,canSubmit:true}));
    const wrapper=await setup();
    await wrapper.get('[data-testid="retirement-reason"]').setValue('停止经营');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.submitProductRetirement).toHaveBeenCalledWith(row.productId,0,'停止经营');
    expect(api.decideProductRetirement).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('驳回修改重提沿原记录版本，旧驳回意见留在审计历史', async () => {
    api.fetchProductRetirement.mockResolvedValue(view({retirement:{...row,status:'REJECTED',rdOpinion:'补政策'},canSubmit:true,history:[{operatorId:'91',operatorName:'负责人',action:'REJECT_RETIREMENT',reason:'原驳回意见',createTime:'2026-10-04 12:00:00'}]}));
    const wrapper=await setup(); expect(wrapper.text()).toContain('原驳回意见');
    await wrapper.get('[data-testid="retirement-reason"]').setValue('补充理由'); await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.submitProductRetirement).toHaveBeenCalledWith(row.productId,4,'补充理由'); wrapper.unmount();
  });
  it('政策只发送五明确时间和政策；软件截止须同时有政策', async () => {
    api.fetchProductRetirement.mockResolvedValue(view({canEditPolicy:true})); const wrapper=await setup();
    await wrapper.get('[data-testid="softwareSupportStopAt"]').setValue('2026-12-01T18:05:09');
    await wrapper.get('form').trigger('submit'); expect(api.editProductRetirementPolicy).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="software-policy"]').setValue('仅安全维护');
    await wrapper.get('[data-testid="marketingStopAt"]').setValue('2026-11-01T09:30:00');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.editProductRetirementPolicy).toHaveBeenCalledWith(row.productId,{expectedVersion:4,marketingStopAt:'2026-11-01 09:30:00',orderStopAt:null,productionStopAt:null,spareSupportStopAt:null,softwareSupportStopAt:'2026-12-01 18:05:09',softwareSupportPolicy:'仅安全维护'}); wrapper.unmount();
  });
  it('仅真实当前审批权限显示操作，驳回必须意见，不自动决策', async () => {
    api.fetchProductRetirement.mockResolvedValue(view({canDecide:true})); const wrapper=await setup();
    expect(api.decideProductRetirement).not.toHaveBeenCalled();
    const reject=wrapper.findAll('button').find(button=>button.text()==='驳回退市')!;
    await reject.trigger('click'); expect(api.decideProductRetirement).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="retirement-opinion"]').setValue('需明确备件'); await reject.trigger('click'); await flushPromises();
    expect(api.decideProductRetirement).toHaveBeenCalledWith(row.productId,4,'REJECT','需明确备件'); wrapper.unmount();
  });
  it('批准后只读政策及历史，不显示审批和修改表单', async () => {
    api.fetchProductRetirement.mockResolvedValue(view({retirement:{...row,status:'APPROVED',marketingStopAt:'2026-11-01 18:00:00',softwareSupportPolicy:'继续安全维护'}}));
    const wrapper=await setup(); expect(wrapper.text()).toContain('历史记录只读'); expect(wrapper.text()).toContain('继续安全维护'); expect(wrapper.findAll('form')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('检查通过'); expect(api.decideProductRetirement).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('切换产品后迟到读取不覆盖当前产品权限和历史', async () => {
    let resolveOld!: (value: ReturnType<typeof view>) => void;
    api.fetchProductRetirement.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const wrapper=mount(Panel,{props:{productId:row.productId}});
    await wrapper.setProps({productId:'新产品'}); await flushPromises();
    resolveOld(view({retirement:{...row,reason:'旧产品迟到内容'},canSubmit:true})); await flushPromises();
    expect(wrapper.text()).not.toContain('旧产品迟到内容'); expect(wrapper.find('[data-testid="retirement-reason"]').exists()).toBe(false);
    expect(api.fetchProductRetirement).toHaveBeenLastCalledWith('新产品'); wrapper.unmount();
  });
  it('权限或读取失败可见重读，不把未授权当无申请', async () => {
    api.fetchProductRetirement.mockRejectedValueOnce(new Error('读取失败'));
    const wrapper=await setup(); expect(wrapper.get('[role="alert"]').text()).toContain('退市申请暂时无法读取'); expect(wrapper.findAll('form')).toHaveLength(0);
    await wrapper.get('button').trigger('click'); await flushPromises(); expect(api.fetchProductRetirement).toHaveBeenCalledTimes(2); wrapper.unmount();
  });
});
