/**
 * 语音输入 composable（AI 副驾输入框 · 2026-09-29）。
 *
 * <p>能力边界：走浏览器原生 Web Speech API（SpeechRecognition /
 * webkitSpeechRecognition），**零新增运行时依赖**（21st 参考组件 AiPromptInput /
 * Assistant Tabs 的语音交互范式按本仓规约移植，不引 lucide/framer-motion）。
 * 只做「语音 → 文本」转写回填输入框，不录音、不上传、不落库。
 *
 * <p>降级铁律：浏览器不支持（happy-dom / Safari 旧版 / 非 HTTPS 环境）时
 * supported=false，调用方据此禁用按钮——不做假可用。识别错误只报状态不抛错，
 * 不中断输入流。
 */
import { onScopeDispose, ref, type Ref } from 'vue';

/** Web Speech API 最小面（标准 DOM lib 未收录，按实际用到的成员收窄声明）。 */
interface SpeechRecognitionLike {
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

type SpeechCtor = new () => SpeechRecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: SpeechCtor;
  webkitSpeechRecognition?: SpeechCtor;
}

function getSpeechCtor(): SpeechCtor | undefined {
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export interface UseSpeechInputOptions {
  /** 识别语言（默认 zh-CN）。 */
  lang?: string;
  /** 识别出最终文本（isFinal）时回调，调用方回填输入框。 */
  onFinalText?: (text: string) => void;
  /** 识别错误回调（中文可读文案），只报状态不抛错。 */
  onError?: (message: string) => void;
  /** 中间结果（isFinal=false）回调，供 UI 显示「识别中」。 */
  onInterimText?: (text: string) => void;
}

export interface SpeechInput {
  /** 当前是否在听（录音中态，驱动按钮文案/样式）。 */
  listening: Ref<boolean>;
  /** 最近一次错误文案（空串=无错误）。 */
  error: Ref<string>;
  /** 浏览器是否支持语音识别（不支持则按钮禁用，不做假可用）。 */
  supported: boolean;
  /** 开始识别；不支持时返回 false 并置 error。 */
  start: () => boolean;
  /** 停止识别（保留已识别结果，onend 收尾）。 */
  stop: () => void;
}

/** 识别错误码 → 中文文案（只列常见码，未知码透传兜底）。 */
function speechErrorText(code: string): string {
  switch (code) {
    case 'aborted':
      return '语音识别已取消';
    case 'audio-capture':
      return '未检测到麦克风，请检查输入设备';
    case 'network':
      return '语音服务网络异常，请稍后重试';
    case 'no-speech':
      return '未检测到语音，请重试';
    case 'not-allowed':
      return '麦克风权限被拒绝，请在浏览器地址栏允许麦克风';
    default:
      return `语音识别失败（${code}）`;
  }
}

export function useSpeechInput(options: UseSpeechInputOptions = {}): SpeechInput {
  const listening = ref(false);
  const error = ref('');
  const supported = Boolean(getSpeechCtor());
  let recognition: SpeechRecognitionLike | null = null;

  function stop() {
    recognition?.stop();
  }

  function start(): boolean {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      error.value = '当前浏览器不支持语音输入';
      return false;
    }
    if (listening.value) return true;
    error.value = '';
    const instance = new Ctor();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = options.lang ?? 'zh-CN';
    instance.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? '';
        if (!text) continue;
        if (result.isFinal) {
          options.onFinalText?.(text.trim());
        } else {
          options.onInterimText?.(text);
        }
      }
    };
    instance.onerror = (event) => {
      error.value = speechErrorText(event.error ?? 'unknown');
      options.onError?.(error.value);
    };
    instance.onend = () => {
      listening.value = false;
    };
    recognition = instance;
    listening.value = true;
    instance.start();
    return true;
  }

  onScopeDispose(() => {
    if (recognition) {
      recognition.onend = null;
      recognition.abort();
      recognition = null;
    }
    listening.value = false;
  });

  return { error, listening, start, stop, supported };
}
