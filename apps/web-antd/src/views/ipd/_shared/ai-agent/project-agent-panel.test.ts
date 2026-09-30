/**
 * ProjectAgentPanel 组合行为（单测层，接口替身；不是联调证据）。
 *
 * 覆盖：功能关闭时展示后端原因且不触达副驾流、只提交服务端 ID、幂等键重试复用 / 改输入换新、
 * 时间线只随事件出现、运行级反馈仅在结束后且挂在持久 runId、取消、项目切换重置。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamCopilot } from '../../../../api/ipd/ai-copilot';
import { IpdRequestError } from '../../../../api/ipd/auth';
import {
  cancelAgentRun,
  createProjectAgentRun,
  fetchAgentRun,
  fetchAgentRunEvents,
  fetchProjectAgentCapabilities,
  listProjectAgentRuns,
  type ProjectAgentCapabilities,
} from '../../../../api/ipd/project-agent';
import ProjectAgentPanel from './project-agent-panel.vue';
import { useIpdAiWorkspace } from '../ai-workspace/use-ai-workspace';

vi.mock('../../../../api/ipd/project-agent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cancelAgentRun: vi.fn(),
  createProjectAgentRun: vi.fn(),
  fetchAgentRun: vi.fn(),
  fetchAgentRunEvents: vi.fn(),
  fetchProjectAgentCapabilities: vi.fn(),
  listProjectAgentRuns: vi.fn(),
  saveAiFeedback: vi.fn(),
}));
vi.mock('../../../../api/ipd/ai-copilot', () => ({ streamCopilot: vi.fn(), chatCopilot: vi.fn() }));

/** 单包单模型：面板会自动选中。 */
const CAPS: ProjectAgentCapabilities = {
  packs: [
    {
      code: 'ipd.market',
      version: '1.2.0',
      name: '市场分析',
      description: '',
      stages: [],
      actionCodes: ['A-01'],
      available: true,
      unavailableReason: null,
      skills: [{ name: 'swot', version: '1', sha256: 's', available: true, reason: null }],
      tools: [{ id: '0007', name: '检索', readOnly: true, available: true, reason: null }],
    },
  ],
  models: [{ id: '0012', name: '通用模型', available: true, reason: null }],
};

/** 运行详情替身。 */
function detailOf(
  status: 'RUNNING' | 'SUCCEEDED' | 'WAITING_APPROVAL',
  actionCode: null | string = 'A-01',
) {
  return {
    runId: 'run-1',
    projectId: 'p-1',
    agentId: 'a',
    status,
    actionCode,
    configSnapshot: { capabilityPackCode: 'ipd.market', capabilityPackVersion: '1.2.0', modelConfigId: '0012', skills: [], toolIds: [] },
    errorCode: null,
    createdAt: 'x',
    finishedAt: null,
  };
}

/** 挂载面板并等待能力加载完成。 */
async function mountPanel(projectId: null | string = 'p-1') {
  const wrapper = mount(ProjectAgentPanel, { props: { projectId, actionCode: 'A-01', pollIntervalMs: 1000 } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchProjectAgentCapabilities).mockResolvedValue(CAPS);
  vi.mocked(createProjectAgentRun).mockResolvedValue({ runId: 'run-1', status: 'PENDING' });
  vi.mocked(fetchAgentRun).mockResolvedValue(detailOf('RUNNING'));
  vi.mocked(fetchAgentRunEvents).mockResolvedValue({ events: [], nextSeq: 0, terminal: false });
  vi.mocked(listProjectAgentRuns).mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ProjectAgentPanel', () => {
  it('shows the backend reason when the feature is off and never falls back to the copilot stream', async () => {
    vi.mocked(fetchProjectAgentCapabilities).mockRejectedValue(
      new IpdRequestError('x', 403, 30001, 'http', '项目智能体功能未开启，请联系管理员'),
    );
    const wrapper = await mountPanel();
    const alert = wrapper.findComponent({ name: 'AAlert' });
    expect(alert.props('description')).toBe('项目智能体功能未开启，请联系管理员');
    expect(wrapper.find('[data-testid="panel-submit"]').exists()).toBe(false);
    expect(streamCopilot).not.toHaveBeenCalled();

    await wrapper.find('[data-testid="panel-cap-retry"]').trigger('click');
    expect(fetchProjectAgentCapabilities).toHaveBeenCalledTimes(2);
  });

  it('asks for a project when projectId is empty and does not call the backend', async () => {
    const wrapper = await mountPanel(null);
    expect(wrapper.find('[data-testid="panel-no-project"]').exists()).toBe(true);
    expect(fetchProjectAgentCapabilities).not.toHaveBeenCalled();
    expect(listProjectAgentRuns).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('更早的运行没有列表接口');
  });

  it('submits only server-returned IDs with a UUID idempotency key, and shows no timeline items without events', async () => {
    const wrapper = await mountPanel();
    const submit = wrapper.find('[data-testid="panel-submit"]');
    expect(submit.attributes('disabled')).toBeDefined();

    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();

    const [projectId, input] = vi.mocked(createProjectAgentRun).mock.calls[0]!;
    expect(projectId).toBe('p-1');
    expect(input).toMatchObject({
      capabilityPackCode: 'ipd.market',
      capabilityPackVersion: '1.2.0',
      modelConfigId: '0012',
      skillNames: ['swot'],
      toolIds: ['0007'],
      actionCode: 'A-01',
      message: '分析竞品',
    });
    expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(wrapper.find('[data-testid="timeline-waiting"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="ai-feedback-bar"]').exists()).toBe(false);
  });

  it('submitText from the host composer uses the same create path and does not call the copilot stream', async () => {
    const wrapper = await mountPanel();
    const result = await wrapper.vm.submitText('分析竞品');
    await flushPromises();
    expect(result).toBe('started');
    expect(createProjectAgentRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createProjectAgentRun).mock.calls[0]?.[1]).toMatchObject({ message: '分析竞品' });
    expect(streamCopilot).not.toHaveBeenCalled();
  });

  it('reuses the idempotency key when retrying the same submission, and rotates it after an edit', async () => {
    vi.mocked(createProjectAgentRun).mockRejectedValue(new IpdRequestError('x', 0, 0, 'transport'));
    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="panel-submit-error"]').text()).toBe('无法连接服务，请检查网络后重试');

    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品和定价');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();

    const keys = vi.mocked(createProjectAgentRun).mock.calls.map(([, input]) => input.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('renders events as they arrive and offers run feedback only after terminal', async () => {
    vi.mocked(fetchAgentRunEvents)
      .mockResolvedValueOnce({
        events: [{ seq: 1, type: 'STEP', payload: { title: '检索资料' }, createdAt: 'x' }],
        nextSeq: 1,
        terminal: false,
      })
      .mockResolvedValueOnce({
        events: [{ seq: 2, type: 'RUN_FINISHED', payload: { status: 'SUCCEEDED' }, createdAt: 'x' }],
        nextSeq: 2,
        terminal: true,
      });
    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="ai-feedback-bar"]').exists()).toBe(false);

    vi.mocked(fetchAgentRun).mockResolvedValue(detailOf('SUCCEEDED'));
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="panel-status"]').text()).toBe('已完成');
    const bar = wrapper.find('[data-testid="ai-feedback-bar"]');
    expect(bar.exists()).toBe(true);
    expect(bar.find('[data-testid="feedback-up"]').attributes('aria-label')).toBe('本次运行有帮助');
  });

  it('cancels an active run through the cancel endpoint', async () => {
    vi.mocked(cancelAgentRun).mockResolvedValue({ runId: 'run-1', status: 'CANCEL_REQUESTED' });
    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce({
      events: [{ seq: 1, type: 'RUN_STARTED', payload: {}, createdAt: 'x' }],
      nextSeq: 1,
      terminal: false,
    });
    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();

    await wrapper.find('[data-testid="panel-cancel"]').trigger('click');
    await flushPromises();
    expect(cancelAgentRun).toHaveBeenCalledWith('run-1');
    expect(wrapper.find('[data-testid="panel-status"]').text()).toBe('取消中');
    expect(wrapper.find('[data-testid="panel-cancel"]').exists()).toBe(false);
  });

  it('resets the run and reloads capabilities when the project switches', async () => {
    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce({
      events: [{ seq: 1, type: 'STEP', payload: { title: 'A 项目步骤' }, createdAt: 'x' }],
      nextSeq: 1,
      terminal: false,
    });
    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(1);

    await wrapper.setProps({ projectId: 'p-2' });
    await flushPromises();
    expect(fetchProjectAgentCapabilities).toHaveBeenLastCalledWith('p-2');
    expect(wrapper.findAll('[data-testid="timeline-item"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="timeline-idle"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="panel-status"]').exists()).toBe(false);
  });

  it('lists server runs for the selected project, searches by q, and opens a row from seq 0', async () => {
    vi.mocked(listProjectAgentRuns).mockResolvedValue([
      {
        runId: '9007199254740993',
        status: 'SUCCEEDED',
        actionCode: 'C02',
        capabilityPackCode: 'ipd.market',
        capabilityPackVersion: '1.0.0',
        createdAt: '2026-09-30T01:00:00Z',
        finishedAt: '2026-09-30T01:02:00Z',
        inputChars: 8,
        artifactTitles: ['竞品报告'],
        artifactExcerpt: '摘录不是提问',
      },
    ]);
    useIpdAiWorkspace().setPane('steps');
    const wrapper = await mountPanel();
    expect(listProjectAgentRuns).toHaveBeenCalledWith('p-1', {});
    expect(wrapper.text()).not.toContain('没有匹配的运行');
    expect(wrapper.find('[data-testid="agent-run-history-row"]').text()).toContain('C02');
    expect(wrapper.find('[data-testid="agent-run-history-row"]').text()).toContain('竞品报告');
    expect(wrapper.find('[data-testid="agent-run-history-row"]').text()).toContain('8 字');
    expect(wrapper.text()).not.toContain('摘录不是提问');
    expect(wrapper.text()).not.toContain('更早的运行没有列表接口');

    await wrapper.find('[data-testid="agent-run-history-query"]').setValue('C02');
    await flushPromises();
    expect(listProjectAgentRuns).toHaveBeenCalledWith('p-1', { q: 'C02' });

    vi.mocked(fetchAgentRunEvents).mockResolvedValueOnce({
      events: [{ seq: 1, type: 'STEP', payload: { title: '历史步骤' }, createdAt: 'x' }],
      nextSeq: 1,
      terminal: true,
    });
    await wrapper.find('[data-testid="agent-run-history-row"]').trigger('click');
    await flushPromises();
    expect(fetchAgentRun).toHaveBeenCalledWith('9007199254740993');
    expect(fetchAgentRunEvents).toHaveBeenCalledWith('9007199254740993', 0);
    expect(useIpdAiWorkspace().pane.value).toBe('cards');
    expect(wrapper.text()).toContain('历史步骤');
  });

  it('shows execute and revise on an unbound plan wait, and confirming cancels then creates with the verbatim steps', async () => {
    vi.mocked(cancelAgentRun).mockResolvedValue({ runId: 'run-1', status: 'CANCEL_REQUESTED' });
    const wrapper = await mountPanel();
    vi.mocked(fetchAgentRun).mockResolvedValue(detailOf('WAITING_APPROVAL', null));
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [
        {
          seq: 1,
          type: 'STEP',
          payload: { kind: 'INTENT', needsPlan: true, steps: ['旧句子'] },
          createdAt: 'x',
        },
        {
          seq: 2,
          type: 'STEP',
          payload: {
            kind: 'AWAIT_USER',
            reason: 'PLAN_CONFIRM',
            steps: ['核对功能', '核对价格（不要改写）'],
          },
          createdAt: 'x',
        },
      ],
      nextSeq: 2,
      terminal: false,
    });
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="intent-plan-execute"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="intent-plan-revise"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('步骤来自动作技能，本次按此执行');

    const firstKey = vi.mocked(createProjectAgentRun).mock.calls[0]?.[1].idempotencyKey;
    await wrapper.find('[data-testid="intent-plan-execute"]').trigger('click');
    await flushPromises();

    expect(cancelAgentRun).toHaveBeenCalledTimes(1);
    expect(cancelAgentRun).toHaveBeenCalledWith('run-1');
    expect(createProjectAgentRun).toHaveBeenCalledTimes(2);
    const body = vi.mocked(createProjectAgentRun).mock.calls[1]?.[1];
    expect(body?.message).toBe('按已确认计划执行\n核对功能\n核对价格（不要改写）');
    expect(body).not.toHaveProperty('actionCode');
    expect(body?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(body?.idempotencyKey).not.toBe(firstKey);
    const cancelAt = vi.mocked(cancelAgentRun).mock.invocationCallOrder[0] ?? 0;
    const createAt = vi.mocked(createProjectAgentRun).mock.invocationCallOrder[1] ?? 0;
    expect(createAt).toBeGreaterThan(cancelAt);
  });

  it('shows the two buttons when the same run only has an unbound plan intent', async () => {
    const wrapper = await mountPanel();
    vi.mocked(fetchAgentRun).mockResolvedValue(detailOf('WAITING_APPROVAL', null));
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [{
        seq: 1,
        type: 'STEP',
        payload: { kind: 'INTENT', needsPlan: true, steps: ['核对功能', '核对价格'] },
        createdAt: 'x',
      }],
      nextSeq: 1,
      terminal: false,
    });
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="intent-plan-execute"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="intent-plan-revise"]').exists()).toBe(true);
  });

  it('focuses the existing input on revise and does not send another request', async () => {
    const wrapper = await mountPanel();
    vi.mocked(fetchAgentRun).mockResolvedValue(detailOf('WAITING_APPROVAL', null));
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [{
        seq: 1,
        type: 'STEP',
        payload: { kind: 'AWAIT_USER', reason: 'PLAN_CONFIRM', steps: ['核对功能'] },
        createdAt: 'x',
      }, {
        seq: 2,
        type: 'STEP',
        payload: { kind: 'INTENT', needsPlan: true, steps: ['核对功能'] },
        createdAt: 'x',
      }],
      nextSeq: 2,
      terminal: false,
    });
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();

    const box = wrapper.get('[data-testid="panel-message"]');
    const textarea = box.element instanceof HTMLTextAreaElement
      ? box.element
      : box.element.querySelector('textarea');
    expect(textarea).toBeTruthy();
    const focus = vi.spyOn(textarea!, 'focus');
    const creates = vi.mocked(createProjectAgentRun).mock.calls.length;
    const cancels = vi.mocked(cancelAgentRun).mock.calls.length;
    const eventReads = vi.mocked(fetchAgentRunEvents).mock.calls.length;
    const detailReads = vi.mocked(fetchAgentRun).mock.calls.length;

    await wrapper.find('[data-testid="intent-plan-revise"]').trigger('click');
    await flushPromises();

    expect(focus).toHaveBeenCalled();
    expect(createProjectAgentRun).toHaveBeenCalledTimes(creates);
    expect(cancelAgentRun).toHaveBeenCalledTimes(cancels);
    expect(fetchAgentRunEvents).toHaveBeenCalledTimes(eventReads);
    expect(fetchAgentRun).toHaveBeenCalledTimes(detailReads);
  });

  it('hides plan buttons on a clarification wait', async () => {
    const wrapper = await mountPanel();
    vi.mocked(fetchAgentRun).mockResolvedValue(detailOf('WAITING_APPROVAL', null));
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [
        {
          seq: 1,
          type: 'STEP',
          payload: { kind: 'INTENT', needsPlan: true, needsClarification: true, steps: ['核对功能'] },
          createdAt: 'x',
        },
        {
          seq: 2,
          type: 'STEP',
          payload: { kind: 'AWAIT_USER', reason: 'CLARIFICATION', questions: ['范围还没定'] },
          createdAt: 'x',
        },
      ],
      nextSeq: 2,
      terminal: false,
    });
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="intent-plan-execute"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="intent-plan-revise"]').exists()).toBe(false);
  });

  it('keeps a bound plan card free of execute and shows the skill-step sentence', async () => {
    const wrapper = await mountPanel();
    vi.mocked(fetchAgentRun).mockResolvedValue(detailOf('RUNNING', 'C02'));
    vi.mocked(fetchAgentRunEvents).mockResolvedValue({
      events: [{
        seq: 1,
        type: 'STEP',
        payload: {
          kind: 'INTENT',
          needsPlan: true,
          steps: ['核对功能', '核对价格'],
        },
        createdAt: 'x',
      }, {
        seq: 2,
        type: 'STEP',
        payload: { kind: 'AWAIT_USER', reason: 'PLAN_CONFIRM', steps: ['核对功能', '核对价格'] },
        createdAt: 'x',
      }],
      nextSeq: 2,
      terminal: false,
    });
    await wrapper.find('[data-testid="panel-message"]').setValue('分析竞品');
    await wrapper.find('[data-testid="panel-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="intent-plan-execute"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="intent-bound-plan"]').text()).toBe('步骤来自动作技能，本次按此执行');
  });
});
