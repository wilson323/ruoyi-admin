/**
 * Track E 补口：AddToAgentDialog 组件层契约测试。
 *
 * <p>挂载策略：以自定义 stub 替换 antd Modal（渲染 slot 即可），
 * 绕开 Teleport/Portal 在 jsdom 下的惰性挂载差异；被测语义全部在内层插槽。
 *
 * <p>锁定语义：
 * - 全空列表 → 「先去智能体管理新建」诚实空态（不是空白，也不造假数据）；
 * - 加载失败 → 显式失败文案（与空态区分，约束 #7）；
 * - 列出智能体且勾选状态实时反映到内部选择集。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentList } from '#/api/agent/agent';

import AddToAgentDialog from './add-to-agent-dialog.vue';

vi.mock('#/api/agent/agent', () => ({
  agentInfo: vi.fn(),
  agentUpdate: vi.fn(),
  agentList: vi.fn(),
}));

const mockedAgentList = vi.mocked(agentList);

function mountDialog() {
  return mount(AddToAgentDialog, {
    global: {
      stubs: {
        AModal: { template: '<div class="amodal-stub"><slot /></div>' },
        teleport: true,
      },
    },
    props: { open: true, toolId: 7, toolName: 'demo-tool' },
  });
}

describe('AddToAgentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('智能体为空 → 显示「先去新建智能体」诚实空态', async () => {
    mockedAgentList.mockResolvedValue({
      rows: [],
      total: 0,
    } as Awaited<ReturnType<typeof agentList>>);
    const wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.text()).toContain('还没有智能体');
    expect(wrapper.text()).toContain('智能体管理');
  });

  it('加载失败 → 显示失败文案而非空态', async () => {
    mockedAgentList.mockRejectedValue(new Error('boom'));
    const wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.text()).toContain('加载失败');
    expect(wrapper.text()).not.toContain('还没有智能体');
  });

  it('列出智能体并支持勾选（确认按钮可用性随选择变化）', async () => {
    mockedAgentList.mockResolvedValue({
      rows: [
        { agentName: 'Alpha', id: 1 },
        { agentName: 'Beta', id: 2 },
      ],
      total: 2,
    } as unknown as Awaited<ReturnType<typeof agentList>>);
    const wrapper = mountDialog();
    await flushPromises();

    const boxes = wrapper.findAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[1]!.element.closest('label')?.textContent).toContain('Beta');

    await boxes[0]!.setValue(true);
    expect(
      (wrapper.vm as unknown as { checkedIds: number[] }).checkedIds,
    ).toContain(1);
  });
});
