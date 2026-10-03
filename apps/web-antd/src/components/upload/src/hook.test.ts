import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadFile } from 'ant-design-vue';
import { useImagePreview } from './hook';
vi.mock('@vben/locales', () => ({ $t: (key: string) => key }));
vi.mock('#/api/system/oss', () => ({ ossInfo: vi.fn() }));
class Reader extends EventTarget {
  static LOADING = 1;
  static instances: Reader[] = [];
  readyState = 1;
  result: string | null = null;
  error = new Error('read failed');
  abort = vi.fn(() => {
    this.readyState = 2;
    this.dispatchEvent(new Event('abort'));
  });
  readAsDataURL() {}
  constructor() {
    super();
    Reader.instances.push(this);
  }
  complete(value: string) {
    this.result = value;
    this.readyState = 2;
    this.dispatchEvent(new Event('load'));
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  Reader.instances = [];
});
function setup() {
  vi.stubGlobal('FileReader', Reader);
  let hook!: ReturnType<typeof useImagePreview>;
  const wrapper = mount(
    defineComponent({
      setup() {
        hook = useImagePreview();
        return () => null;
      },
    }),
  );
  const file = (name: string) =>
    ({ name, originFileObj: new File(['x'], name) }) as UploadFile;
  return { wrapper, hook, file };
}
describe('预览读取生命周期', () => {
  it('旧读取不能覆盖新文件，结束时移除监听', async () => {
    const { wrapper, hook, file } = setup();
    const old = hook.handlePreview(file('old'));
    const first = Reader.instances[0]!;
    const fresh = hook.handlePreview(file('fresh'));
    const second = Reader.instances[1]!;
    const remove = vi.spyOn(second, 'removeEventListener');
    first.complete('old');
    second.complete('fresh');
    await Promise.all([old, fresh]);
    expect(first.abort).toHaveBeenCalledOnce();
    expect(hook.previewImage.value).toBe('fresh');
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['load', 'error', 'abort']),
    );
    wrapper.unmount();
  });
  it.each(['cancel', 'unmount'])(
    '%s后不重新打开预览且读取Promise结算',
    async (action) => {
      const { wrapper, hook, file } = setup();
      const pending = hook.handlePreview(file('x'));
      const reader = Reader.instances[0]!;
      if (action === 'cancel') hook.handleCancel();
      else wrapper.unmount();
      reader.complete('late');
      await pending;
      await flushPromises();
      expect(reader.abort).toHaveBeenCalledOnce();
      expect(hook.previewVisible.value).toBe(false);
      if (action === 'cancel') wrapper.unmount();
    },
  );
  it('错误明确拒绝并移除监听', async () => {
    const { wrapper, hook, file } = setup();
    const pending = hook.handlePreview(file('x'));
    const reader = Reader.instances[0]!;
    const remove = vi.spyOn(reader, 'removeEventListener');
    const assertion = expect(pending).rejects.toThrow('read failed');
    reader.dispatchEvent(new Event('error'));
    await assertion;
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['load', 'error', 'abort']),
    );
    expect(hook.previewVisible.value).toBe(false);
    wrapper.unmount();
  });
});
