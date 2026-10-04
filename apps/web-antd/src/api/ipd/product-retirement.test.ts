import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProductRetirement, submitProductRetirement, editProductRetirementPolicy, decideProductRetirement } from './product-retirement';
const http=vi.hoisted(()=>({ipdGet:vi.fn(),ipdPost:vi.fn(),ipdPut:vi.fn()}));
vi.mock('./http',()=>http);
beforeEach(()=>vi.resetAllMocks());
describe('原产品退市API合同',()=>{
 it('路径编码与读取权限投影不损失字符串ID',async()=>{
  const view={retirement:{id:'9007199254740993123'},canDecide:false,history:[]}; http.ipdGet.mockResolvedValue(view);
  expect(await fetchProductRetirement('9007199254740993999/')).toBe(view); expect(http.ipdGet).toHaveBeenCalledWith('/products/9007199254740993999%2F/retirement');
 });
 it('提交与决策只带原版本理由和决策白名单',async()=>{
  await submitProductRetirement('19',0,'理由'); await decideProductRetirement('19',7,'REJECT','意见');
  expect(http.ipdPost.mock.calls).toEqual([['/products/19/retirement',{expectedVersion:0,reason:'理由'}],['/products/19/retirement/decision',{expectedVersion:7,decision:'REJECT',opinion:'意见'}]]);
 });
 it('政策正文不透传注入的状态或批准者',async()=>{
  const body={expectedVersion:1,marketingStopAt:null,orderStopAt:null,productionStopAt:null,spareSupportStopAt:null,softwareSupportStopAt:null,softwareSupportPolicy:null,status:'APPROVED',rdLeaderId:'19'};
  await editProductRetirementPolicy('19',body);
  expect(http.ipdPut.mock.calls[0]![1]).not.toHaveProperty('status'); expect(http.ipdPut.mock.calls[0]![1]).not.toHaveProperty('rdLeaderId');
 });
});
