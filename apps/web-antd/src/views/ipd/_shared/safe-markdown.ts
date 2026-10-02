/** 成熟Markdown解析器+净化器；禁止主动HTML、资源与非HTTP(S)链接。 */
import { defineComponent, h } from 'vue';
import DOMPurify from 'dompurify';
import { marked, Renderer } from 'marked';
import './safe-markdown.css';

const renderer = new Renderer();
renderer.html = ({ text }) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderSafeMarkdown(content: string): string {
  const parsed = marked.parse(content, { async: false, gfm: true, renderer });
  return DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
    ALLOW_DATA_ATTR: false,
    FORCE_BODY: true,
  });
}

export default defineComponent({
  name: 'SafeMarkdown',
  props: { content: { type: String, required: true } },
  setup(props) {
    return () => h('div', { class: 'safe-markdown', innerHTML: renderSafeMarkdown(props.content) });
  },
});
