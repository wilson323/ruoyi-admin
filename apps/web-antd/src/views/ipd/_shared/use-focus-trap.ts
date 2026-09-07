import { onBeforeUnmount, watch, type Ref } from 'vue';

/**
 * 弹层键盘陷阱（V12-a11y 遗留收口项；零依赖）。
 *
 * 为 role="dialog" 弹层补齐四件事：
 * 1. 开聚焦：打开时聚焦容器内第一个可聚焦元素（无可聚焦元素则聚焦容器本身）；
 * 2. Tab 循环：Tab / Shift+Tab 始终在容器内循环（含焦点逃逸兜底）；
 * 3. Esc 关闭：按 Esc 触发 onEscape（与 backdrop 点击、关闭钮语义一致）；
 * 4. 关还焦：关闭时把焦点还给打开前的元素（触发钮），无则留在原处。
 *
 * <p>实现约定：
 * <ul>
 *   <li>keydown 挂在 document 上——焦点若逃逸到容器外（如点地址栏后回落 body）仍可兜回；</li>
 *   <li>不做 offset/getClientRects 可见性过滤——happy-dom 无布局，过滤会让单测全部失焦；</li>
 *   <li>不做焦点先占（focus guard）——本仓弹层互斥开关，backdrop @click.self 与关闭钮已覆盖鼠标路径。</li>
 * </ul>
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface FocusTrapOptions {
  /** 弹层容器（role="dialog" 元素）；未挂载时为 null，陷阱静默不工作。 */
  target: Ref<HTMLElement | null>;
  /** 打开态；false→true 开聚焦并接管键盘，true→false 还焦并释放。 */
  active: Ref<boolean>;
  /** Esc 关闭回调；不传则 Esc 只被吞掉不动作。 */
  onEscape?: () => void;
}

export function useFocusTrap({ target, active, onEscape }: FocusTrapOptions): void {
  /** 打开前焦点元素（通常是触发钮），关闭时还焦。 */
  let previouslyFocused: HTMLElement | null = null;

  function focusables(): HTMLElement[] {
    const el = target.value;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!active.value) return;
    if (event.key === 'Escape') {
      onEscape?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const el = target.value;
    if (!el) return;
    const list = focusables();
    if (list.length === 0) {
      event.preventDefault();
      el.focus({ preventScroll: true });
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const activeEl = document.activeElement;
    const inside = activeEl instanceof HTMLElement && el.contains(activeEl);
    if (event.shiftKey) {
      if (!inside || activeEl === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      }
      return;
    }
    if (!inside || activeEl === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function handleOpen(): void {
    previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.addEventListener('keydown', onKeydown);
    const list = focusables();
    if (list.length > 0) {
      list[0]!.focus({ preventScroll: true });
    } else {
      target.value?.focus({ preventScroll: true });
    }
  }

  function handleClose(): void {
    document.removeEventListener('keydown', onKeydown);
    if (previouslyFocused?.isConnected) {
      previouslyFocused.focus({ preventScroll: true });
    }
    previouslyFocused = null;
  }

  watch(
    active,
    (open) => {
      if (open) handleOpen();
      else handleClose();
    },
    { immediate: true },
  );

  onBeforeUnmount(handleClose);
}
