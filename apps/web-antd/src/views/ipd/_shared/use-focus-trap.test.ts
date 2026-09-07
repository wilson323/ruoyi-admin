/**
 * V12-a11y focus-trap 单测——纯 happy-dom，零新依赖。
 *
 * <p>断言四件事（与 use-focus-trap.ts 文档契约一一对应）：
 * <ol>
 *   <li>激活：打开态 true 时，容器内第一个可聚焦元素被 .focus()；</li>
 *   <li>Tab 循环：最后一个元素 + Tab → 回到第一个；第一个 + Shift+Tab → 跳到最后一个；</li>
 *   <li>Esc：触发 onEscape，且弹层仍由调用方决定是否真的关闭（回调语义）。</li>
 *   <li>关还焦：active 从 true 变 false 后，焦点还给 previouslyFocused（本次测试中为触发钮）。</li>
 * </ol>
 *
 * <p>用 v-show 而非 v-if 让 dialog 始终在 DOM（ref 始终可绑定，陷阱目标稳定），
 * 仅在 active 切换时控制可见性——这更接近生产使用模式（v-if 重建会丢失 previouslyFocused）。
 */
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFocusTrap } from './use-focus-trap';

interface Fixture {
  wrapper: ReturnType<typeof mount>;
  trigger: HTMLButtonElement;
  open: ReturnType<typeof ref<boolean>>;
  onEscape: ReturnType<typeof vi.fn>;
  first: () => HTMLInputElement;
  mid: () => HTMLButtonElement;
  last: () => HTMLButtonElement;
}

function setup(): Fixture {
  const trigger = ref<HTMLButtonElement | null>(null);
  const dialog = ref<HTMLDivElement | null>(null);
  const open = ref(false);
  const onEscape = vi.fn();

  const Comp = defineComponent({
    setup() {
      useFocusTrap({ target: dialog, active: open, onEscape });
      return () =>
        h('div', [
          h(
            'button',
            { ref: trigger, id: 'trigger', type: 'button' },
            '打开',
          ),
          h(
            'div',
            {
              ref: dialog,
              role: 'dialog',
              tabindex: '-1',
              style: open.value ? '' : 'display:none',
              'data-dialog': 'true',
            },
            [
              h('input', { type: 'text', 'data-testid': 'first', tabindex: '0' }),
              h('button', { 'data-testid': 'mid', type: 'button' }, '中'),
              h('button', { 'data-testid': 'last', type: 'button' }, '末'),
            ],
          ),
        ]);
    },
  });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const wrapper = mount(Comp, { attachTo: host });
  return {
    wrapper,
    trigger: trigger.value!,
    open,
    onEscape,
    first: () => host.querySelector<HTMLInputElement>('[data-testid="first"]')!,
    mid: () => host.querySelector<HTMLButtonElement>('[data-testid="mid"]')!,
    last: () => host.querySelector<HTMLButtonElement>('[data-testid="last"]')!,
  };
}

describe('useFocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('打开：第一个可聚焦元素获得焦点', async () => {
    const f = setup();
    f.trigger.focus();
    f.open.value = true;
    await nextTick();
    expect(document.activeElement).toBe(f.first());
    f.wrapper.unmount();
  });

  it('Tab 循环：末元素 + Tab 回到首元素', async () => {
    const f = setup();
    f.open.value = true;
    await nextTick();
    f.last().focus();
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(f.first());
    f.wrapper.unmount();
  });

  it('Shift+Tab 循环：首元素 + Shift+Tab 跳到末元素', async () => {
    const f = setup();
    f.open.value = true;
    await nextTick();
    f.first().focus();
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey: true }));
    await nextTick();
    expect(document.activeElement).toBe(f.last());
    f.wrapper.unmount();
  });

  it('Esc：触发 onEscape 回调', async () => {
    const f = setup();
    f.open.value = true;
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.onEscape).toHaveBeenCalledTimes(1);
    f.wrapper.unmount();
  });

  it('关闭：焦点还到触发钮（previouslyFocused）', async () => {
    const f = setup();
    f.trigger.focus();
    f.open.value = true;
    await nextTick();
    f.open.value = false;
    await nextTick();
    expect(document.activeElement).toBe(f.trigger);
    f.wrapper.unmount();
  });
});
