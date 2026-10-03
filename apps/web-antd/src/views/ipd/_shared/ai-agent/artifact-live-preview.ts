/**
 * 可信文档交付后的正文展示。
 *
 * deliveredDocumentPreview 仅从服务端持久化的父交付回执确认 DOCUMENT 身份，生成交付即预览。
 * liveGeneratedPreview 只解析已确认正文的展示形态；标题、HTML 和模型自报不能授予文档身份。
 * 普通回答与澄清不进入文档预览；可信文档没有标题时仍由交付消费者以纯文本展示。
 */

import type { AgentRunEvent } from '../../../../api/ipd/project-agent';

/** 可挂到「本次运行」的一块生成预览。 */
export interface LiveGeneratedPreview {
  /** html 进 sandbox iframe；document 只做纯文本。 */
  kind: 'document' | 'html';
  /** 不在流式中时展示的标题。流式标题由组件改成「正在生成」。 */
  title: string;
  /** HTML 已去掉 script 与 on*；文档保持原文，不渲染。 */
  body: string;
}

/** Only a persisted parent delivery receipt identifies a document; headings and model claims do not. */
export function deliveredDocumentPreview(events: readonly AgentRunEvent[]): LiveGeneratedPreview | null {
  const delivered = [...events].reverse().find(event => {
    if (event.type !== 'ARTIFACT' || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
    const payload = event.payload as Record<string, unknown>;
    return payload.outputKind === 'DOCUMENT' && payload.attachmentOrigin === 'IPD_NATIVE_DELIVERY_V1'
      && typeof payload.versionId === 'string' && !!payload.versionId
      && typeof payload.contentHash === 'string' && !!payload.contentHash
      && typeof payload.content === 'string' && !!payload.content.trim();
  });
  if (!delivered) return null;
  const payload = delivered.payload as Record<string, unknown>;
  const content = payload.content as string;
  const preview = liveGeneratedPreview(content);
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : preview?.title ?? '文档';
  return preview ? { ...preview, title } : { kind: 'document', title, body: content };
}

const HTML_START = /^(?:<!doctype\s+html\b|<html\b)/i;
const HEADING_START = /^(#{1,2})(?!#)[ \t]+(\S[^\n]*)/;
const PREVIEW_LANG = new Set(['html', 'markdown', 'md']);

/**
 * 解析可信文档正文的 HTML 或纯文本展示形态，不决定其文档身份。
 *
 * HTML 三种里只认两种前缀加一种围栏：去掉首尾空白后以 `<!doctype html` 或 `<html`
 * 开头（忽略大小写），或出现 ```html 围栏。`<img` 这类片段不是页面。
 * 标题：从开头的 `#` / `##` 或 ```md / ```markdown 围栏提取；正文保持纯文本。
 * 未识别形态返回 null，由 deliveredDocumentPreview 按真实回执标题和全文回退为纯文本。
 * HTML 正文会先去掉 script 标签和 on* 事件属性。
 *
 * @param answer 已确认的文档正文
 * @returns 已识别的展示形态；未识别时为 null，不表示该正文不是文档
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
