/**
 * AI 副驾输入框测试（语音 + 文件 + 发送 · 2026-09-29）。
 *
 * <p>覆盖：文本发送（Enter/按钮）、IME 组合期回车不误发、附件登记/移除/随消息
 * 清单发送、语音按钮不支持禁用与支持时转写回填、新会话 reset 事件，
 * 以及 21st AiPromptInput 保真度补齐项（自动增高 / 语音 a11y / 提示区 live region）。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AiComposer from './ai-composer.vue';

/** 测试替身：捕获构造实例与回调（与 use-speech-input.test 同构，互不共享防串态）。 */
class SpeechRecognitionStub {
  static last: null | SpeechRecognitionStub = null;

  abort = vi.fn();

  continuous = false;

  interimResults = false;

  lang = '';

  onend: (() => void) | null = null;

  onerror: ((event: { error?: string }) => void) | null = null;

  onresult: ((event: unknown) => void) | null = null;

  start = vi.fn();

  stop = vi.fn();

  constructor() {
    SpeechRecognitionStub.last = this;
  }
}

function installSpeech() {
  (window as unknown as Record<string, unknown>).SpeechRecognition =
    SpeechRecognitionStub;
}

function uninstallSpeech() {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  SpeechRecognitionStub.last = null;
}

function mountComposer(props: { disabled?: boolean; modelValue?: string } = {}) {
  return mount(AiComposer, {
    props: {
      disabled: props.disabled ?? false,
      modelValue: props.modelValue ?? '',
      sending: false,
      showReset: true,
    },
  });
}

async function typeText(wrapper: ReturnType<typeof mountComposer>, text: string) {
  const input = wrapper.get('[data-testid="ipd-ai-input"]');
  (input.element as HTMLTextAreaElement).value = text;
  await input.trigger('input');
  // v-model 回灌（真实父组件由 v-model 同步，测试用 setProps 模拟）。
  await wrapper.setProps({ modelValue: text });
}

/** 挂载文件到隐藏 input（happy-dom 无 FileList 构造器，defineProperty 注入）。 */
async function pickFiles(wrapper: ReturnType<typeof mountComposer>, files: File[]) {
  const fileInput = wrapper.get('[data-testid="ipd-ai-file-input"]');
  Object.defineProperty(fileInput.element, 'files', {
    configurable: true,
    value: files,
  });
  await fileInput.trigger('change');
}

beforeEach(() => {
  uninstallSpeech();
});

afterEach(() => {
  uninstallSpeech();
});

describe('AiComposer 文本发送', () => {
  it('Enter 发送（防默认换行），载荷含文本与空附件清单', async () => {
    const wrapper = mountComposer();
    await typeText(wrapper, ' 项目风险有哪些 ');
    await wrapper.get('[data-testid="ipd-ai-input"]').trigger('keydown', { key: 'Enter' });
    const sent = wrapper.emitted('send');
    expect(sent).toHaveLength(1);
    expect(sent?.[0]?.[0]).toEqual({ attachments: [], text: '项目风险有哪些' });
  });

  it('Shift+Enter 不发送（换行），IME 组合期回车不误发', async () => {
    const wrapper = mountComposer();
    await typeText(wrapper, '你好');
    await wrapper.get('[data-testid="ipd-ai-input"]').trigger('keydown', {
      isComposing: true,
      key: 'Enter',
    });
    await wrapper.get('[data-testid="ipd-ai-input"]').trigger('keydown', {
      key: 'Enter',
      shiftKey: true,
    });
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('空文本且无附件不发送；发送按钮走同一入口', async () => {
    const wrapper = mountComposer();
    await wrapper.get('[data-testid="ipd-ai-send"]').trigger('click');
    expect(wrapper.emitted('send')).toBeUndefined();
    await typeText(wrapper, '待办');
    await wrapper.get('[data-testid="ipd-ai-send"]').trigger('click');
    expect(wrapper.emitted('send')).toHaveLength(1);
  });

  it('disabled 时不发送（AI 模式占位同样不可发）', async () => {
    const wrapper = mountComposer({ disabled: true, modelValue: '你好' });
    await wrapper.get('[data-testid="ipd-ai-send"]').trigger('click');
    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('新会话按钮发 reset 事件', async () => {
    const wrapper = mountComposer();
    await wrapper.get('[data-testid="ipd-ai-new"]').trigger('click');
    expect(wrapper.emitted('reset')).toHaveLength(1);
  });
});

describe('AiComposer 文件输入', () => {
  it('附件登记 → chip 展示名称/大小 → 发送随消息清单 → 清空', async () => {
    const wrapper = mountComposer();
    await pickFiles(wrapper, [
      new File(['x'], '需求规格.pdf', { type: 'application/pdf' }),
    ]);
    expect(wrapper.find('[data-testid="ipd-ai-attachments"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('需求规格.pdf');
    await typeText(wrapper, '看下附件');
    await wrapper.get('[data-testid="ipd-ai-send"]').trigger('click');
    const payload = wrapper.emitted('send')?.[0]?.[0] as {
      attachments: Array<{ name: string; size: number; type: string }>;
      text: string;
    };
    expect(payload.text).toBe('看下附件');
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0]).toMatchObject({
      name: '需求规格.pdf',
      type: 'application/pdf',
    });
    // 发送后附件区清空（不残留）
    expect(wrapper.find('[data-testid="ipd-ai-attachments"]').exists()).toBe(false);
  });

  it('仅附件无文本也可发送（附件清单载荷）', async () => {
    const wrapper = mountComposer();
    await pickFiles(wrapper, [new File(['abc'], '笔记.txt', { type: 'text/plain' })]);
    await wrapper.get('[data-testid="ipd-ai-send"]').trigger('click');
    const payload = wrapper.emitted('send')?.[0]?.[0] as {
      attachments: Array<{ name: string }>;
      text: string;
    };
    expect(payload.text).toBe('');
    expect(payload.attachments[0]?.name).toBe('笔记.txt');
  });

  it('移除 chip 后不随消息发送', async () => {
    const wrapper = mountComposer();
    await pickFiles(wrapper, [
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
      new File(['y'], 'b.png', { type: 'image/png' }),
    ]);
    await wrapper.get('[data-testid="ipd-ai-attachment-remove"]').trigger('click');
    expect(wrapper.text()).not.toContain('a.pdf');
    await wrapper.get('[data-testid="ipd-ai-send"]').trigger('click');
    const payload = wrapper.emitted('send')?.[0]?.[0] as {
      attachments: Array<{ name: string }>;
    };
    expect(payload.attachments.map((f) => f.name)).toEqual(['b.png']);
  });
});

describe('AiComposer 语音输入', () => {
  it('浏览器不支持：按钮禁用并明示（不做假可用）', () => {
    const wrapper = mountComposer();
    const voice = wrapper.get('[data-testid="ipd-ai-voice"]');
    expect((voice.attributes('disabled') ?? '')).toBeDefined();
    expect((voice.element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.find('[data-testid="ipd-ai-voice-hint"]').text()).toContain(
      '不支持语音输入',
    );
  });

  it('支持时：点击开始识别，final 转写回填输入框，再次点击停止', async () => {
    installSpeech();
    const wrapper = mountComposer({ modelValue: '已有文本' });
    await wrapper.get('[data-testid="ipd-ai-voice"]').trigger('click');
    const stub = SpeechRecognitionStub.last!;
    expect(stub.start).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="ipd-ai-voice"]').text()).toBe('停止');

    stub.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: '补充风险说明' }, isFinal: true }],
    });
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      '已有文本 补充风险说明',
    );

    // interim 显示在提示区，不进输入框
    stub.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: '识别中样例' }, isFinal: false }],
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="ipd-ai-voice-hint"]').text()).toContain(
      '识别中样例',
    );

    await wrapper.get('[data-testid="ipd-ai-voice"]').trigger('click');
    expect(stub.stop).toHaveBeenCalledTimes(1);
    stub.onend?.();
    await flushPromises();
    expect(wrapper.get('[data-testid="ipd-ai-voice"]').text()).toBe('语音');
  });
});

describe('AiComposer 21st 保真度补齐（自动增高 / a11y）', () => {
  /** happy-dom 不排版（scrollHeight 恒 0），按用例注入高度以验证夹取逻辑。 */
  function stubScrollHeight(wrapper: ReturnType<typeof mountComposer>, value: number) {
    Object.defineProperty(
      wrapper.get('[data-testid="ipd-ai-input"]').element,
      'scrollHeight',
      { configurable: true, value },
    );
  }

  it('内容未超上界：按内容增高且不出滚动条', async () => {
    const wrapper = mountComposer();
    stubScrollHeight(wrapper, 60);
    await typeText(wrapper, '两行内容');
    const el = wrapper.get('[data-testid="ipd-ai-input"]').element as HTMLTextAreaElement;
    expect(el.style.height).toBe('60px');
    expect(el.style.overflowY).toBe('hidden');
  });

  it('内容超上界：夹到 max 高度并转滚动条（不无限增高）', async () => {
    const wrapper = mountComposer();
    stubScrollHeight(wrapper, 480);
    await typeText(wrapper, '很长的内容');
    const el = wrapper.get('[data-testid="ipd-ai-input"]').element as HTMLTextAreaElement;
    expect(el.style.height).toBe('120px');
    expect(el.style.overflowY).toBe('auto');
  });

  it('scrollHeight 缺省（0）时兜到 min 高度，不塌陷为 0', async () => {
    const wrapper = mountComposer();
    await typeText(wrapper, '一行');
    const el = wrapper.get('[data-testid="ipd-ai-input"]').element as HTMLTextAreaElement;
    expect(el.style.height).toBe('34px');
  });

  it('语音按钮 aria-pressed 随录音态翻转，aria-label 随可用态变化', async () => {
    const wrapper = mountComposer();
    const voice = wrapper.get('[data-testid="ipd-ai-voice"]');
    // 不支持：aria-pressed=false 且 label 明示不可用
    expect(voice.attributes('aria-pressed')).toBe('false');
    expect(voice.attributes('aria-label')).toBe('当前浏览器不支持语音输入');

    installSpeech();
    const supported = mountComposer();
    const supportedVoice = supported.get('[data-testid="ipd-ai-voice"]');
    expect(supportedVoice.attributes('aria-label')).toBe('开始语音输入');
    await supportedVoice.trigger('click');
    expect(supportedVoice.attributes('aria-pressed')).toBe('true');
    expect(supportedVoice.attributes('aria-label')).toBe('停止语音输入');
  });

  it('提示区是 live region（role=status + aria-live=polite），读屏可播报识别中', () => {
    const hint = mountComposer().get('[data-testid="ipd-ai-voice-hint"]');
    expect(hint.attributes('role')).toBe('status');
    expect(hint.attributes('aria-live')).toBe('polite');
  });
});
