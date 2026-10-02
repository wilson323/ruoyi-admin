/**
 * 生成当时的文档 / HTML 预览判定。
 *
 * 输入是时间线 TEXT_DELTA 拼出的回答（思考段由调用方用 modelMessageParts 剥掉）。
 * 只有整页 HTML 或 markdown 文档才返回预览；短回答和 img 片段返回 null。
 */

/** 可挂到「本次运行」的一块生成预览。 */
export interface LiveGeneratedPreview {
  /** html 进 sandbox iframe；document 只做纯文本。 */
  kind: 'document' | 'html';
  /** 不在流式中时展示的标题。流式标题由组件改成「正在生成」。 */
  title: string;
  /** HTML 已去掉 script 与 on*；文档保持原文，不渲染。 */
  body: string;
}

const HTML_START = /^(?:<!doctype\s+html\b|<html\b)/i;
const HEADING_START = /^(#{1,2})(?!#)[ \t]+(\S[^\n]*)/;
const PREVIEW_LANG = new Set(['html', 'markdown', 'md']);

/**
 * 判断回答要不要在定档前做生成预览。
 *
 * HTML 三种里只认两种前缀加一种围栏：去掉首尾空白后以 `<!doctype html` 或 `<html`
 * 开头（忽略大小写），或出现 ```html 围栏。`<img` 这类片段不是页面。
 * 文档：以 `#` / `##` 标题开头，或 ```md / ```markdown 围栏；正文保持纯文本。
 * 普通短回答返回 null。HTML 正文会先去掉 script 标签和 on* 事件属性。
 *
 * @param answer 模型回答，不应再含未闭合思考段
 * @returns 预览；不该展示时为 null
 *
 * @example
 * liveGeneratedPreview('# 概念说明书\n正文');
 * // { kind: 'document', title: '概念说明书', body: '# 概念说明书\n正文' }
 */
export function liveGeneratedPreview(answer: string): LiveGeneratedPreview | null {
  const text = answer.replace(/\r\n?/g, '\n').trim();
  if (!text) return null;

  if (HTML_START.test(text)) {
    const body = sanitizeHtml(text);
    return { kind: 'html', title: htmlTitle(body), body };
  }

  const heading = headingTitle(text);
  if (heading) {
    return { kind: 'document', title: heading, body: text };
  }

  const fence = firstPreviewFence(text);
  if (!fence) return null;
  if (fence.lang === 'html') {
    const body = sanitizeHtml(fence.body.trim());
    return { kind: 'html', title: htmlTitle(body), body };
  }
  const inner = fence.body.trim();
  return { kind: 'document', title: headingTitle(inner) ?? '文档', body: inner };
}

/**
 * 取 markdown 一级或二级标题的文字。
 *
 * 只认开头的 `#` / `##`，`###` 不算。没有标题时返回 null。
 *
 * @param text 已去掉首尾空白的回答或围栏内容
 * @returns 标题文字；不是一级或二级标题时为 null
 */
function headingTitle(text: string): null | string {
  const match = HEADING_START.exec(text);
  const title = match?.[2]?.trim().replace(/\s+#+\s*$/, '');
  return title || null;
}

/**
 * 找到第一段 html / md / markdown 围栏。
 *
 * 未闭合的围栏把剩余正文都算进去，方便流式变长。其他语言的围栏跳过。
 *
 * @param text 规范化后的回答
 * @returns 围栏语言和内部正文；没有可预览围栏时为 null
 */
function firstPreviewFence(text: string): { body: string; lang: string } | null {
  const open = /(?:^|\n)[ \t]*```[ \t]*([A-Za-z0-9_-]+)[ \t]*\n/g;
  for (const match of text.matchAll(open)) {
    const lang = match[1]!.toLowerCase();
    if (!PREVIEW_LANG.has(lang)) continue;
    const contentStart = (match.index ?? 0) + match[0].length;
    const rest = text.slice(contentStart);
    const close = /\n[ \t]*```[ \t]*(?:\n|$)/.exec(rest);
    return { lang, body: close ? rest.slice(0, close.index) : rest };
  }
  return null;
}

/**
 * 从 HTML 里取 `<title>`；没有则用「页面」。
 *
 * @param html 已经去掉 script 的 HTML
 * @returns 给预览卡用的标题
 */
function htmlTitle(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return title || '页面';
}

/**
 * 去掉 HTML 中的 script 和 on* 事件属性。
 *
 * 只处理标签，不执行页面。调用方还要把结果放进 sandbox="" 的 iframe。
 *
 * @param html 原始 HTML 或围栏内片段
 * @returns 去掉脚本和内联事件后的 HTML
 */
function sanitizeHtml(html: string): string {
  // HTML解析器把自闭合script当作未闭合；先移除，避免吞掉后续可见正文。
  const withoutSelfClosingScripts = html.replace(/<script\b[^>]*\/\s*>/gi, '');
  const document = new DOMParser().parseFromString(withoutSelfClosingScripts, 'text/html');
  document.querySelectorAll('script, iframe, frame, object, embed, link, meta, base, form').forEach((node) => node.remove());
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || /^(?:src|srcset|href|xlink:href|action|formaction|poster|background|data)$/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  const policy = document.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  document.head.prepend(policy);
  return '<!doctype html>' + document.documentElement.outerHTML;
}
