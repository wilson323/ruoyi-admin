import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CropperModal from './cropper-modal.vue';
const modal = vi.hoisted(() => ({
  change: undefined as undefined | ((open: boolean) => void),
}));
vi.mock('@vben/common-ui', () => ({
  useVbenModal: (options: { onOpenChange: (open: boolean) => void }) => {
    modal.change = options.onOpenChange;
    return [
      { template: '<div><slot /></div>' },
      { setState: vi.fn(), close: vi.fn() },
    ];
  },
}));
vi.mock('@vben/locales', () => ({ $t: (key: string) => key }));
vi.mock('./cropper.vue', () => ({
  default: { props: ['src'], template: '<img :src="src" />' },
}));
vi.mock('ant-design-vue', () => ({
  message: { warn: vi.fn() },
  Avatar: { template: '<div />' },
  Space: { template: '<div><slot /></div>' },
  Tooltip: { template: '<div><slot /></div>' },
  Upload: { name: 'TestUpload', props: ['beforeUpload'], template: '<div />' },
}));
class Reader extends EventTarget {
  static LOADING = 1;
  static instances: Reader[] = [];
  readyState = 1;
  result: string | null = null;
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
  const wrapper = mount(CropperModal, { props: { uploadApi: vi.fn() } });
  const select = (name: string) =>
    (
      wrapper.findComponent({ name: 'TestUpload' }).props('beforeUpload') as (
        file: File,
      ) => void
    )(new File(['x'], name));
  return { wrapper, select };
}
describe('裁剪文件读取生命周期', () => {
  it('旧读取不覆盖新图片且完成清理监听', async () => {
    const { wrapper, select } = setup();
    select('old');
    const old = Reader.instances[0]!;
    select('fresh');
    const fresh = Reader.instances[1]!;
    const remove = vi.spyOn(fresh, 'removeEventListener');
    fresh.complete('data:fresh');
    old.complete('data:old');
    await wrapper.vm.$nextTick();
    expect(old.abort).toHaveBeenCalledOnce();
    expect(wrapper.get('img').attributes('src')).toBe('data:fresh');
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['load', 'error', 'abort']),
    );
    wrapper.unmount();
  });
  it.each(['close', 'unmount'])('%s取消未结束读取', async (action) => {
    const { wrapper, select } = setup();
    select('x');
    const reader = Reader.instances[0]!;
    if (action === 'close') modal.change?.(false);
    else wrapper.unmount();
    reader.complete('data:late');
    await wrapper.vm.$nextTick();
    expect(reader.abort).toHaveBeenCalledOnce();
    if (action === 'close') {
      expect(wrapper.find('img').exists()).toBe(false);
      wrapper.unmount();
    }
  });
  it('读取失败通过原uploadError事件披露并清理', () => {
    const { wrapper, select } = setup();
    select('x');
    const reader = Reader.instances[0]!;
    const remove = vi.spyOn(reader, 'removeEventListener');
    reader.dispatchEvent(new Event('error'));
    expect(wrapper.emitted('uploadError')).toEqual([[{ msg: '图片读取失败' }]]);
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['load', 'error', 'abort']),
    );
    wrapper.unmount();
  });
});
