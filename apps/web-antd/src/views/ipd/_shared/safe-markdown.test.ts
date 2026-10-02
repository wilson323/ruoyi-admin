// @vitest-environment jsdom
/** DOMPurify官方不支持happy-dom；净化断言使用jsdom。 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SafeMarkdown, { renderSafeMarkdown } from './safe-markdown';

describe('safe Markdown', () => {
  it('渲染标题、强调、表格及代码而不显示语法标记', () => {
    const wrapper = mount(SafeMarkdown, { props: { content: '# 标题\n\n**强调**\n\n| 项目 | 值 |\n| --- | --- |\n| 费用率 | 12.83% |\n\n```js\nconst x = 1;\n```' } });
    expect(wrapper.get('h1').text()).toBe('标题'); expect(wrapper.get('strong').text()).toBe('强调');
    expect(wrapper.get('table td').text()).toBe('费用率'); expect(wrapper.get('pre code').text()).toContain('const x = 1;');
  });
  it('剔除脚本、事件、主动资源及危险链接协议', () => {
    const html = renderSafeMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil.test"></iframe>\n\n[危险](javascript:alert%281%29) [资源](data:text/html,x) [安全](https://example.com) ![外部图](https://evil.test/a.png)');
    const element = document.createElement('div'); element.innerHTML = html;
    expect(element.querySelector('script,img,iframe,[onerror]')).toBeNull();
    expect([...element.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([null, null, 'https://example.com']);
  });
  it('保留含强调与链接的列表项语义', () => {
    const wrapper = mount(SafeMarkdown, { props: { content: '- **平台定位**：[载体](https://example.com)\n- **四冲突**：保留列表\n- 普通项目' } });
    expect(wrapper.findAll('ul > li')).toHaveLength(3);
    expect(wrapper.get('ul > li strong').text()).toBe('平台定位');
    expect(wrapper.get('ul > li a').attributes('href')).toBe('https://example.com');
  });

});
