/**
 * HTML 预览的公共净化工具（单一事实源）。
 *
 * 2026-10-08 从 artifact-live-preview.ts 抽出：IpdContentView 与生成预览共用同一套
 * sanitize 语义——移除 script/iframe 等危险节点、剥外链与事件属性、注入 CSP。
 * 禁止在任何页面复制本实现（见《IPD前端内容查看接入规范-20261008》§5）。
 */

/**
 * 从 HTML 里取 `<title>`；没有则用「页面」。
 *
 * @param html 已经去掉 script 的 HTML
 * @returns 给预览卡用的标题
 */
export function htmlTitle(html: string): string {
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
export function sanitizeHtml(html: string): string {
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
