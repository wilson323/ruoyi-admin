import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAgentRunSkillReviews, reviewAgentRunSkill, type AgentSkillReview } from '../../../../api/ipd/project-agent';
import SkillsReviewPanel from './skills-review-panel.vue';
vi.mock('../../../../api/ipd/project-agent', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()), listAgentRunSkillReviews: vi.fn(), reviewAgentRunSkill: vi.fn(),
}));
const candidate: AgentSkillReview = { candidateSeq: '9007199254740993', skillName: 'source-check', sha256: 'package-hash', status: 'PENDING',
  files: [{ path: 'SKILL.md', content: '<script>alert(1)</script>\n检查来源', sha256: 'text-hash', encoding: 'utf-8' },
    { path: 'assets/image.png', content: 'AAAA', sha256: 'binary-hash', encoding: 'base64' }], scanSummary: '扫描通过', reviewComment: null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(listAgentRunSkillReviews).mockResolvedValue([candidate]); });
describe('user skill review on the original run', () => {
  it('requires a fresh readback after a saved review instead of submitting the stale pending decision again', async () => {
    const wrapper = mount(SkillsReviewPanel, { props: { runId: 'run-1' } }); await flushPromises();
    vi.mocked(reviewAgentRunSkill).mockResolvedValue({ ...candidate, status: 'PUBLISHED' });
    vi.mocked(listAgentRunSkillReviews).mockRejectedValueOnce(new Error('回读失败'));
    await wrapper.find('[data-testid="skill-review-approve"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('审核结果尚未确认');
    expect(wrapper.find('[data-testid="skill-review-approve"]').attributes('disabled')).toBeDefined();
    await wrapper.find('[data-testid="skill-review-reject"]').trigger('click');
    expect(reviewAgentRunSkill).toHaveBeenCalledTimes(1);
    vi.mocked(listAgentRunSkillReviews).mockResolvedValue([{ ...candidate, status: 'PUBLISHED' }]);
    await wrapper.find('[data-testid="skills-review-refresh"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('已发布的版本');
    expect(wrapper.find('[data-testid="skill-review-approve"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('renders text as inert content and resources as a list, then trusts the GET publication result', async () => {
    const wrapper = mount(SkillsReviewPanel, { props: { runId: 'run-1' } }); await flushPromises();
    expect(wrapper.text()).toContain('待你审核'); expect(wrapper.text()).toContain('<script>alert(1)</script>');
    expect(wrapper.find('script').exists()).toBe(false); expect(wrapper.text()).toContain('assets/image.png');
    expect(wrapper.text()).toContain('binary-hash'); expect(wrapper.text()).not.toContain('AAAA');
    vi.mocked(reviewAgentRunSkill).mockResolvedValue({ ...candidate, status: 'PUBLISHED' });
    vi.mocked(listAgentRunSkillReviews).mockResolvedValue([{ ...candidate, status: 'PUBLISH_FAILED' }]);
    await wrapper.find('[data-testid="skill-review-approve"]').trigger('click'); await flushPromises();
    expect(reviewAgentRunSkill).toHaveBeenCalledWith('run-1', candidate.candidateSeq, { approved: true, sha256: 'package-hash' });
    expect(wrapper.text()).toContain('已同意，发布未完成'); expect(wrapper.text()).toContain('当前不能使用');
    expect(wrapper.text()).not.toContain('已发布的版本'); wrapper.unmount();
  });
  it('locks double clicks and retains errors, without inventing published state', async () => {
    const wrapper = mount(SkillsReviewPanel, { props: { runId: 'run-1' } }); await flushPromises();
    const pending = deferred<AgentSkillReview>(); vi.mocked(reviewAgentRunSkill).mockReturnValueOnce(pending.promise);
    await wrapper.find('[data-testid="skill-review-reject"]').trigger('click');
    await wrapper.find('[data-testid="skill-review-approve"]').trigger('click');
    expect(reviewAgentRunSkill).toHaveBeenCalledTimes(1);
    expect(reviewAgentRunSkill).toHaveBeenCalledWith('run-1', candidate.candidateSeq, { approved: false, sha256: 'package-hash' });
    pending.resolve({ ...candidate, status: 'REJECTED' });
    vi.mocked(listAgentRunSkillReviews).mockResolvedValue([{ ...candidate, status: 'REJECTED' }]);
    await flushPromises(); expect(wrapper.text()).toContain('已决定不采用'); wrapper.unmount();
  });
  it('discards a review receipt and readback after the user opens another run', async () => {
    const wrapper = mount(SkillsReviewPanel, { props: { runId: 'run-1' } }); await flushPromises();
    const pending = deferred<AgentSkillReview>(); vi.mocked(reviewAgentRunSkill).mockReturnValueOnce(pending.promise);
    await wrapper.find('[data-testid="skill-review-approve"]').trigger('click');
    vi.mocked(listAgentRunSkillReviews).mockResolvedValue([]); await wrapper.setProps({ runId: 'run-2' }); await flushPromises();
    pending.resolve({ ...candidate, status: 'PUBLISHED' }); await flushPromises();
    expect(wrapper.find('[data-testid="skills-review-panel"]').exists()).toBe(false);
    expect(listAgentRunSkillReviews).toHaveBeenLastCalledWith('run-2'); wrapper.unmount();
  });
  it('shows review failure and allows a deliberate retry', async () => {
    const wrapper = mount(SkillsReviewPanel, { props: { runId: 'run-1' } }); await flushPromises();
    vi.mocked(reviewAgentRunSkill).mockRejectedValueOnce(new Error('保存失败'));
    await wrapper.find('[data-testid="skill-review-approve"]').trigger('click'); await flushPromises();
    expect(wrapper.find('[data-testid="skills-review-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('待你审核'); expect(wrapper.find('[data-testid="skill-review-approve"]').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
});
