import { afterEach, describe, expect, it, vi } from 'vitest';
import { urlToBase64 } from './base64Conver';

class TestImage extends EventTarget {
  static latest: TestImage;
  crossOrigin = '';
  src = '';
  height = 2;
  width = 2;
  constructor() {
    super();
    TestImage.latest = this;
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('图片转换结算与监听释放', () => {
  it.each(['load', 'error', 'canvas-error'])(
    '处理%s并移除两种监听',
    async (outcome) => {
      vi.stubGlobal('Image', TestImage);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
        () => {
          if (outcome === 'canvas-error') throw new Error('tainted');
          return 'data:image/png;base64,ok';
        },
      );
      const pending = urlToBase64('/image');
      const removed = vi.spyOn(TestImage.latest, 'removeEventListener');
      const assertion =
        outcome === 'load'
          ? expect(pending).resolves.toBe('data:image/png;base64,ok')
          : expect(pending).rejects.toThrow(
              outcome === 'error' ? '图片加载失败' : 'tainted',
            );
      TestImage.latest.dispatchEvent(
        new Event(outcome === 'error' ? 'error' : 'load'),
      );
      await assertion;
      expect(removed.mock.calls.map(([type]) => type)).toEqual(
        expect.arrayContaining(['load', 'error']),
      );
    },
  );
});
