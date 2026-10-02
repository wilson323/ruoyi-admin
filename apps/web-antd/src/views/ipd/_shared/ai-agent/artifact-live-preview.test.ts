import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { liveGeneratedPreview } from './artifact-live-preview';
import ArtifactLivePreview from './artifact-live-preview.vue';

describe('liveGeneratedPreview', () => {
  it('treats a doctype or html document as an HTML page', () => {
    const preview = liveGeneratedPreview(
      '  <!DOCTYPE html>\n<html><head><title>概念页</title></head><body><p>正文</p></body></html>',
    );
    expect(preview?.kind).toBe('html');
    expect(preview?.title).toBe('概念页');
    expect(preview?.body).toContain('<p>正文</p>');

    const htmlTag = liveGeneratedPreview('<HTML lang="zh"><body>hi</body></html>');
    expect(htmlTag?.kind).toBe('html');
    expect(htmlTag?.title).toBe('页面');
  });

  it('treats an html fence as HTML and drops the fence markers', () => {
    const preview = liveGeneratedPreview('```html\n<p>围栏</p>\n```');
    expect(preview?.kind).toBe('html');
    expect(preview?.body).toContain('<p>围栏</p>');
    expect(preview?.body).not.toContain('```');
  });

  it('treats a markdown heading or md fence as a plain-text document', () => {
    expect(liveGeneratedPreview('# 概念说明书\n正文')).toEqual({
      kind: 'document',
      title: '概念说明书',
      body: '# 概念说明书\n正文',
    });

    const second = liveGeneratedPreview('## 二级\n内容');
    expect(second?.kind).toBe('document');
    expect(second?.title).toBe('二级');
    expect(second?.body).toBe('## 二级\n内容');

    const fenced = liveGeneratedPreview('```md\n# 围栏文档\n段落\n```');
    expect(fenced?.kind).toBe('document');
    expect(fenced?.title).toBe('围栏文档');
    expect(fenced?.body).toContain('段落');
    expect(fenced?.body).not.toContain('```');

    const markdown = liveGeneratedPreview('```markdown\n没有标题的说明\n```');
    expect(markdown?.kind).toBe('document');
    expect(markdown?.title).toBe('文档');
    expect(markdown?.body).toContain('没有标题的说明');
  });

  it('returns null for an ordinary short answer', () => {
    expect(liveGeneratedPreview('需求验证是确认实现满足需求。')).toBeNull();
    expect(liveGeneratedPreview('### 三级标题不算文档')).toBeNull();
    expect(liveGeneratedPreview('')).toBeNull();
    expect(liveGeneratedPreview('   ')).toBeNull();
  });

  it('does not treat an img fragment as a page', () => {
    expect(liveGeneratedPreview('<img src=x onerror=alert(1)>')).toBeNull();
    expect(liveGeneratedPreview('<img src="a.png">')).toBeNull();
  });

  it('strips script tags and inline event handlers from HTML', () => {
    const preview = liveGeneratedPreview(
      '<!doctype html><html><body><script>alert(1)</script><script src="https://evil.example/a.js" />'
      + '<p onclick="evil()" onerror=\'bad\'>可见</p><img src=x onerror=alert(1)></body></html>',
    );
    expect(preview?.kind).toBe('html');
    expect(preview?.body.toLowerCase()).not.toContain('<script');
    expect(preview?.body).not.toContain('alert(1)');
    expect(preview?.body).not.toContain('evil');
    expect(preview?.body).not.toMatch(/\son[a-z]+\s*=/i);
    expect(preview?.body).toContain('可见');

    const partial = liveGeneratedPreview('<!doctype html><html><body><p>可见</p><script>alert(1)');
    expect(partial?.body).toContain('可见');
    expect(partial?.body).not.toContain('alert');
    expect(partial?.body.toLowerCase()).not.toContain('<script');
  });
});

describe('ArtifactLivePreview', () => {
  it('puts HTML in a sandboxed iframe and renders documents as plain text', () => {
    const html = mount(ArtifactLivePreview, {
      props: {
        loading: true,
        preview: liveGeneratedPreview(
          '<!doctype html><html><body><script>alert(1)</script><p>页</p></body></html>',
        )!,
      },
    });
    const frame = html.get('[data-testid="artifact-html-frame"]');
    expect(frame.element.tagName).toBe('IFRAME');
    expect(html.html()).toMatch(/sandbox=""/);
    expect(html.html()).not.toContain('allow-scripts');
    expect(frame.attributes('srcdoc')?.toLowerCase()).not.toContain('<script');
    expect(html.get('.live-preview-title').text()).toBe('正在生成');

    const doc = mount(ArtifactLivePreview, {
      props: { preview: liveGeneratedPreview('# 概念说明书\n正文')! },
    });
    expect(doc.find('iframe').exists()).toBe(false);
    expect(doc.get('[data-testid="artifact-live-preview"]').text()).toContain('概念说明书');
    expect(doc.get('.live-preview-doc').text()).toContain('正文');
    expect(doc.get('.live-preview-title').text()).toBe('概念说明书');
    expect(doc.get('.live-preview-doc').text()).toContain('# 概念说明书');
    expect(doc.find('h1').exists()).toBe(false);
  });
});

it('blocks external resources, navigation and hostile policy replacement', () => {
  const body = liveGeneratedPreview('<html><head><meta http-equiv="refresh" content="0;url=https://evil.test"><style>body{background:url(https://evil.test/a)}</style></head><body><img src="https://evil.test/x"><iframe src="https://evil.test"></iframe><a href="https://evil.test">link</a></body></html>')!.body;
  const document = new DOMParser().parseFromString(body, 'text/html');
  expect(document.querySelector('iframe, [src], [href], meta[http-equiv="refresh"]')).toBeNull();
  expect(document.head.firstElementChild?.getAttribute('content')).toContain("default-src 'none'");
});
