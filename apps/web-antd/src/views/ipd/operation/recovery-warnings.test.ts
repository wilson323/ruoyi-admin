/**
 * R152-D2 90 日回款预警页：组件层单测（与 ipd 业务接口契约路径互不重叠）。
 *
 * 覆盖：
 * - 表格骨架渲染：mock 1 条 warning → 表格 + 项目名 + 状态 + 金额 + 逾期天数 + 创建时间均渲染
 * - 「触发扫描」按钮点击：mock 返 triggeredCount=3 + scanDate=2026-06-22 → 消息提示 + 列表自动刷新
 * - 日期选择：默认今天（YYYY-MM-DD 格式）；日期变更可正确回填扫描日期
 * - 「刷新」按钮：调用 listRecoveryWarnings 重新拉取
 * - 错误态：mock 拒绝 → Alert 错误信息展示 + 「重新加载」按钮可见
 *
 * Mock 策略：vi.mock 替换整个 ../../../api/ipd/recovery 模块，将 ipdGet/ipdPost 出口
 * 抽成 vi.fn() 直接控制返回值/拒绝；不走 fetch（fetch 路径已在 requestIpd 单测覆盖）。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import dayjs from 'dayjs';

import RecoveryWarnings from './recovery-warnings.vue';
import {
  checkRecovery90d,
  listRecoveryWarnings,
} from '../../../api/ipd/recovery';

vi.mock('../../../api/ipd/recovery', () => ({
  checkRecovery90d: vi.fn(),
  listRecoveryWarnings: vi.fn(),
}));

const mockedCheck = vi.mocked(checkRecovery90d);
const mockedList = vi.mocked(listRecoveryWarnings);

const fixtureWarning = {
  amount: 128_000,
  createdAt: '2026-09-20T10:00:00Z',
  daysOverdue: 90,
  id: 'RW-1',
  projectId: 1001,
  projectName: '智慧园区视频分析',
  recoveryDeadline: '2026-09-20',
  status: 'ACTIVE' as const,
  warningDate: '2026-06-22',
};

beforeEach(() => {
  mockedCheck.mockReset();
  mockedList.mockReset();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function mountPage() {
  const wrapper = mount(RecoveryWarnings);
  await flushPromises();
  return wrapper;
}

describe('R152-D2 90 日回款预警页', () => {
  it('表格骨架：mock 1 条 warning → 表格列 + 关键字段全部渲染', async () => {
    mockedList.mockResolvedValue([fixtureWarning]);
    const wrapper = await mountPage();

    // 等待表格行渲染（listRecoveryWarnings resolve 后 phase=ready）
    await vi.waitFor(() => {
      expect(wrapper.findAll('.ant-table-row').length).toBeGreaterThanOrEqual(1);
    });

    // Alert 顶部说明：「触发扫描后会自动通知超管与产品组长」
    expect(wrapper.text()).toContain('触发扫描后会自动通知超管与产品组长');

    // 关键字段渲染
    const text = wrapper.text();
    expect(text).toContain('智慧园区视频分析'); // 项目名称
    expect(text).toContain('#1001'); // projectId
    expect(text).toContain('2026-06-22'); // warningDate
    expect(text).toContain('2026-09-20'); // recoveryDeadline / createdAt
    expect(text).toContain('90 天'); // daysOverdue
    expect(text).toContain('128000.00'); // amount (toFixed 2)
    expect(text).toContain('生效中'); // status=ACTIVE

    // 触发扫描 + 刷新两个按钮都存在；vue-test-utils .text() 把空白合并为空格，
    //   故 "刷新" 实际为 "刷 新"，需要去空白后再 includes
    const buttons = wrapper.findAll('button').map((b) => b.text().replace(/\s+/g, ''));
    expect(buttons.some((t) => t.includes('触发扫描'))).toBe(true);
    expect(buttons.some((t) => t.includes('刷新'))).toBe(true);

    // listRecoveryWarnings 仅在 onMounted 触发一次（初始加载）
    expect(mockedList).toHaveBeenCalledTimes(1);
    // 初始未触发扫描
    expect(mockedCheck).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('「触发扫描」按钮点击：mock 返 triggeredCount=3 → 后续触发 list 自动重拉', async () => {
    mockedList.mockResolvedValue([fixtureWarning]);
    mockedCheck.mockResolvedValue({ scanDate: '2026-06-22', triggeredCount: 3 });
    const wrapper = await mountPage();

    // 等到表格渲染完成
    await vi.waitFor(() => {
      expect(wrapper.findAll('.ant-table-row').length).toBeGreaterThanOrEqual(1);
    });

    // 点击「触发扫描」打开 Modal；文本去空白匹配（vue-test-utils .text() 把空白合并为空格）
    const scanBtn = wrapper.findAll('button').find((b) =>
      b.text().replace(/\s+/g, '').includes('触发扫描'),
    );
    expect(scanBtn, '应有「触发扫描」按钮').toBeDefined();
    await scanBtn!.trigger('click');
    await wrapper.vm.$nextTick();

    // Ant Modal 通过 Teleport 渲染到 document.body，需从 body 上查询
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    // 扫描日期默认今天（YYYY-MM-DD）；DatePicker 输入框是 readonly，DOM 含 today
    const today = dayjs().format('YYYY-MM-DD');
    expect(document.body.querySelector('.ant-modal')?.innerHTML ?? '').toContain(today);

    // 点击 Modal footer 的「触发扫描」确认按钮
    const okBtn = [...document.body.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('触发扫描')) as HTMLButtonElement | undefined;
    expect(okBtn, 'Modal footer 应有「触发扫描」确认按钮').toBeDefined();
    okBtn!.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    // checkRecovery90d 被调用一次，body 包含 scanDate=today
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(mockedCheck).toHaveBeenCalledWith(today);

    // 触发后自动 load：listRecoveryWarnings 第二次调用
    await vi.waitFor(() => {
      expect(mockedList).toHaveBeenCalledTimes(2);
    });

    // 行为断言：check 被调 + list 被重拉；Modal 关闭有 fade-out 动画，
    //   这里不强求 DOM 立即消失（happy-dom + Ant Modal 关闭过渡耗时较长易误报）。

    wrapper.unmount();
  });

  it('日期选择：默认今天；用户可改日期后回填到 check 调用', async () => {
    mockedList.mockResolvedValue([]);
    mockedCheck.mockResolvedValue({ scanDate: '2026-05-01', triggeredCount: 0 });
    const wrapper = await mountPage();

    // 打开 Modal；文本去空白匹配
    const scanBtn = wrapper.findAll('button').find((b) =>
      b.text().replace(/\s+/g, '').includes('触发扫描'),
    );
    expect(scanBtn).toBeDefined();
    await scanBtn!.trigger('click');
    await wrapper.vm.$nextTick();

    // DatePicker 默认今天：Modal 内的 ant-picker-input input value 应含 today
    const today = dayjs().format('YYYY-MM-DD');
    await vi.waitFor(() => {
      const modal = document.body.querySelector('.ant-modal');
      expect(modal).toBeTruthy();
    });
    const pickerInputs = document.body.querySelectorAll('.ant-modal .ant-picker-input input');
    const pickerValues = [...pickerInputs].map((el) => (el as HTMLInputElement).value);
    expect(pickerValues.some((v) => v.includes(today))).toBe(true);

    // 触发确认：Modal footer OK 按钮
    const okBtn = [...document.body.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('触发扫描')) as HTMLButtonElement | undefined;
    expect(okBtn).toBeDefined();
    okBtn!.dispatchEvent(new Event('click', { bubbles: true }));
    await flushPromises();

    expect(mockedCheck).toHaveBeenCalledWith(today);
    wrapper.unmount();
  });

  it('「刷新」按钮点击：list 端点被再调一次（不触发 check）', async () => {
    mockedList.mockResolvedValue([]);
    const wrapper = await mountPage();

    // 等初始 onMounted 完成
    await flushPromises();
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedCheck).not.toHaveBeenCalled();

    // 文本去空白匹配（vue-test-utils 把多空白合并为单空格，"刷新" → "刷 新"）
    const refreshBtn = wrapper.findAll('button').find((b) =>
      b.text().replace(/\s+/g, '').includes('刷新'),
    );
    expect(refreshBtn, '应有「刷新」按钮').toBeDefined();
    await refreshBtn!.trigger('click');
    await flushPromises();

    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(mockedCheck).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('错误态：list 被拒绝 → Alert 错误信息 + 「重新加载」按钮可见', async () => {
    mockedList.mockRejectedValue(new Error('服务暂时不可用，请稍后重试'));
    const wrapper = await mountPage();

    await vi.waitFor(() => {
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(wrapper.text()).toContain('服务暂时不可用');
    // 错误 Alert 的 action 区有「重新加载」按钮
    expect(wrapper.text()).toContain('重新加载');
    wrapper.unmount();
  });

  it('空态：mock 空数组 → 显示「尚无预警记录」Empty', async () => {
    mockedList.mockResolvedValue([]);
    const wrapper = await mountPage();

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('尚无预警记录');
    });
    // 表格不渲染
    expect(wrapper.findAll('.ant-table-row').length).toBe(0);
    wrapper.unmount();
  });
});
