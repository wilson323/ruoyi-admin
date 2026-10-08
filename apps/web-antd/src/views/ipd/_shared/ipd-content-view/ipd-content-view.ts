/**
 * IPD 域统一内容查看（设计见《文档预览统一组件设计-20261008.md》）。
 *
 * 四分流：text（纯文本）/ html（sanitize 后沙箱）/ image（viewer）/ binary（下载兜底）。
 * 组件不直接依赖 IPD 会话层：附件拉取由调用方以 fetch 函数注入（页面侧包 ipdDownload），
 * 保证本模块可独立单测。
 */

export type IpdContentViewKind = 'text' | 'html' | 'image' | 'binary';

export interface IpdContentViewDownload {
  /** 拉取附件二进制（调用方包好鉴权，如 () => ipdDownload(path)）。 */
  fetch: () => Promise<Blob>;
  /** 下载落盘名。 */
  filename: string;
}

export interface IpdContentViewPayload {
  /** 显式指定渲染形态；auto 按已有字段与文件名后缀推断。 */
  kind: IpdContentViewKind | 'auto';
  /** 弹窗标题（文档名/附件名）。 */
  title: string;
  /** kind=text 的正文。 */
  text?: string;
  /** kind=html 的正文（渲染前仍会 sanitize）。 */
  html?: string;
  /** kind=image 的图片地址（须为页面可用的鉴权内地址或 data/object URL）。 */
  imageUrl?: string;
  /** 附件下载（binary 兜底与工具条共用）。 */
  download?: IpdContentViewDownload;
}

/** 图片后缀白名单（svg 除外——可携带脚本，按 html 沙箱或 binary 处理）。 */
const IMAGE_SUFFIXES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

/** 文本类 MIME / 后缀：blob 拉回后可安全直读。 */
const TEXT_MIME_PREFIXES = ['text/', 'application/json'];
const TEXT_SUFFIXES = new Set(['txt', 'md', 'log', 'csv', 'json', 'xml', 'yml', 'yaml', 'html', 'htm']);

export function fileSuffix(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** auto 分流：字段优先级 text > html > imageUrl > download（按文件名后缀）。 */
export function resolveContentViewKind(payload: IpdContentViewPayload): IpdContentViewKind | null {
  if (payload.kind !== 'auto') return payload.kind;
  if (typeof payload.text === 'string' && payload.text.trim() !== '') return 'text';
  if (typeof payload.html === 'string' && payload.html.trim() !== '') return 'html';
  if (typeof payload.imageUrl === 'string' && payload.imageUrl !== '') return 'image';
  if (payload.download && IMAGE_SUFFIXES.has(fileSuffix(payload.download.filename))) return 'image';
  if (payload.download) return 'binary';
  return null;
}

/** blob 是否可作为文本直读（MIME 或文件名后缀）。 */
export function isTextualBlob(blob: Blob, filename: string): boolean {
  if (TEXT_MIME_PREFIXES.some((prefix) => blob.type.startsWith(prefix))) return true;
  return TEXT_SUFFIXES.has(fileSuffix(filename));
}

/** blob 是否可按图片直看。svg 走 html 沙箱（脚本风险），不算图片。 */
export function isImageBlob(blob: Blob, filename: string): boolean {
  if (blob.type.startsWith('image/')) return blob.type !== 'image/svg+xml';
  return IMAGE_SUFFIXES.has(fileSuffix(filename));
}

/** 收编自 project-agent-panel.vue 的落盘下载（createObjectURL + 临时 anchor）。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[\\/\u0000-\u001f]/g, '_') || '附件';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
