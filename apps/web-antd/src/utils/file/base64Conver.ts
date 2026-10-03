/**
 * @description: base64 to blob
 */
export function dataURLtoBlob(base64Buf: string): Blob {
  const arr = base64Buf.split(',');
  const typeItem = arr[0];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const mime = typeItem!.match(/:(.*?);/)![1];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const bstr = window.atob(arr[1]!);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    u8arr[n] = bstr.codePointAt(n)!;
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * img url to base64
 * @param url
 */
export function urlToBase64(url: string, mineType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let canvas = document.createElement('CANVAS') as HTMLCanvasElement | null;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ctx = canvas!.getContext('2d');

    const img = new Image();
    img.crossOrigin = '';
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      canvas = null;
    };
    const onError = () => {
      cleanup();
      reject(new Error('图片加载失败'));
    };
    const onLoad = () => {
      try {
        if (!canvas || !ctx) throw new Error('图片画布不可用');
        canvas.height = img.height;
        canvas.width = img.width;
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL(mineType || 'image/png'));
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    };
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
    img.src = url;
  });
}
