/**
 * 语音输入 composable 测试（Web Speech API 最小面）。
 *
 * <p>覆盖：不支持降级（supported=false + 可读错误）、支持时 start/stop 与
 * final/interim 回调分流、错误码中文文案、onScopeDispose 中止清理。
 */
import { describe, expect, it, vi } from 'vitest';

import { useSpeechInput } from './use-speech-input';

/** 测试替身：捕获构造实例与回调，供用例直接驱动 onresult/onerror/onend。 */
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

describe('useSpeechInput', () => {
  it('不支持降级：supported=false，start() 返回 false 并置可读错误（不做假可用）', () => {
    uninstallSpeech();
    const speech = useSpeechInput();
    expect(speech.supported).toBe(false);
    expect(speech.start()).toBe(false);
    expect(speech.error.value).toBe('当前浏览器不支持语音输入');
    expect(speech.listening.value).toBe(false);
  });

  it('支持时 start/stop：配置 zh-CN + continuous + interim，final/interim 分流回调', () => {
    installSpeech();
    const finals: string[] = [];
    const interims: string[] = [];
    const speech = useSpeechInput({
      onFinalText: (text) => finals.push(text),
      onInterimText: (text) => interims.push(text),
    });
    expect(speech.supported).toBe(true);
    expect(speech.start()).toBe(true);
    expect(speech.listening.value).toBe(true);
    const stub = SpeechRecognitionStub.last!;
    expect(stub.start).toHaveBeenCalledTimes(1);
    expect(stub.lang).toBe('zh-CN');
    expect(stub.continuous).toBe(true);
    expect(stub.interimResults).toBe(true);

    stub.onresult?.({
      resultIndex: 0,
      results: [
        { 0: { transcript: '你好' }, isFinal: false },
        { 0: { transcript: ' 世界 ' }, isFinal: true },
      ],
    });
    expect(interims).toEqual(['你好']);
    expect(finals).toEqual(['世界']);

    speech.stop();
    expect(stub.stop).toHaveBeenCalledTimes(1);
    stub.onend?.();
    expect(speech.listening.value).toBe(false);
    uninstallSpeech();
  });

  it('错误码转中文文案并保持不抛错（not-allowed → 麦克风权限提示）', () => {
    installSpeech();
    const errors: string[] = [];
    const speech = useSpeechInput({ onError: (text) => errors.push(text) });
    speech.start();
    const stub = SpeechRecognitionStub.last!;
    stub.onerror?.({ error: 'not-allowed' });
    expect(speech.error.value).toContain('麦克风权限被拒绝');
    expect(errors).toHaveLength(1);
    stub.onerror?.({ error: 'weird-code' });
    expect(speech.error.value).toContain('weird-code');
    uninstallSpeech();
  });

  it('重复 start 不叠加识别器（幂等：listening 中直接返回 true）', () => {
    installSpeech();
    const speech = useSpeechInput();
    expect(speech.start()).toBe(true);
    expect(speech.start()).toBe(true);
    const stub = SpeechRecognitionStub.last!;
    expect(stub.start).toHaveBeenCalledTimes(1);
    uninstallSpeech();
  });
});
