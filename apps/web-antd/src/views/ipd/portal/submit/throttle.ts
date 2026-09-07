// 页38 游客提交-限流节流 composable（A6 R4 修复）。
//
// 触发条件：提交请求被后端业务码 40011「请求过于频繁」或 HTTP 429 / message 含"过于频繁"/"rate"
// 限流命中 → 按钮 disabled 5s + 倒计时文案展示 + 蜜罐命中时不触发(直接拒绝提示)。
//
// 设计约束：
// - reactive ref 仅在 composable 内部闭包；mount 内单例存活，不必全局单例。
// - 节流时长默认 5s，由 triggerThrottle 的入参覆写（便于测试用 1s）。
// - onUnmounted 兜底清 interval，避免路由切换时残留计时器。
import { onUnmounted, ref } from 'vue';

import { IpdRequestError } from '../../../../api/ipd/auth';

export const DEFAULT_THROTTLE_SECONDS = 5;

export interface UseSubmitThrottleReturn {
  /** 当前剩余秒数；>0 表示正在节流。 */
  readonly countdown: ReturnType<typeof ref<number>>;
  /** 暴露给模板的"是否在节流中"标记，submitting 仅防重入，throttle 应对 UI 锁定。 */
  readonly active: ReturnType<typeof ref<boolean>>;
  /** 节流提示文案（含"请等待 X 秒后重试"），给错误条复用。 */
  readonly message: ReturnType<typeof ref<string>>;
  /** 检测 cause 是否为限流错误；落 40011 / HTTP 429 / 文本匹配 三档。 */
  isThrottleError: (cause: unknown) => boolean;
  /** 启动节流倒计时。多次调用以最后一次入参为准；节流期间调用会被忽略避免叠加。 */
  triggerThrottle: (seconds?: number) => void;
  /** 主动取消（成功提交 / 表单重置 / 蜜罐拒收等场景）。 */
  stopThrottle: () => void;
}

/** 工具导出：把 IpdRequestError 等异常收敛为可检测错误形状（code/status/text 三元）。 */
export interface RateLimitProbe {
  code: number;
  message: string;
  status: number;
}

function asProbe(cause: unknown): RateLimitProbe {
  if (cause instanceof IpdRequestError) {
    return { code: cause.code ?? 0, message: cause.message ?? '', status: cause.status ?? 0 };
  }
  if (cause instanceof Error) return { code: 0, message: cause.message, status: 0 };
  return { code: 0, message: '', status: 0 };
}

/**
 * 限流识别：与后端 ApiV1ErrorCode.java 40011、HTTP 429、文本"过于频繁"/"rate"
 * 任一匹配即视为限流。蜜罐命中属于"拒绝"而非"限流"，由调用方分支判断。
 */
function detectRateLimit(cause: unknown): boolean {
  const probe = asProbe(cause);
  if (probe.code === 40011) return true;
  if (probe.status === 429) return true;
  const text = probe.message.toLowerCase();
  return text.includes('过于频繁') || text.includes('rate limit') || text.includes('rate-limit');
}

export function useSubmitThrottle(): UseSubmitThrottleReturn {
  const countdown = ref(0);
  const active = ref(false);
  const message = ref('');
  let timer: ReturnType<typeof setInterval> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function stopThrottle() {
    clearTimer();
    countdown.value = 0;
    active.value = false;
    message.value = '';
  }

  function triggerThrottle(seconds: number = DEFAULT_THROTTLE_SECONDS) {
    if (active.value) return; // 已节流期间忽略后续触发，避免叠加/抖动
    const safeSeconds = Math.max(1, Math.floor(seconds));
    countdown.value = safeSeconds;
    active.value = true;
    message.value = `请等待 ${safeSeconds} 秒后重试`;
    clearTimer();
    timer = setInterval(() => {
      countdown.value -= 1;
      if (countdown.value <= 0) {
        stopThrottle();
      } else {
        message.value = `请等待 ${countdown.value} 秒后重试`;
      }
    }, 1000);
  }

  onUnmounted(() => {
    clearTimer();
  });

  return {
    active,
    countdown,
    isThrottleError: detectRateLimit,
    message,
    stopThrottle,
    triggerThrottle,
  };
}
