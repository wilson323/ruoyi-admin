/**
 * 统一内容查看组件单测（设计 §5 口径）：
 * - auto 分流判定（字段优先级 / 文件名后缀）
 * - blob 判定（svg 不算图片、文本 MIME 优先）
 * - sanitize 回归（剥 script、on* 事件与外链 + CSP 注入，语义随迁自 artifact-live-preview.test.ts）
 * - 组件四分流渲染、下载兜底、错误态重试、空态
 * - downloadBlob 落盘工具（收编自 project-agent-panel）
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import IpdContentView from './ipd-content-view.vue';
import {
  downloadBlob,
  isImageBlob,
  isTextualBlob,
  resolveContentViewKind,
  withTargetExtension,
  type IpdContentViewPayload,
} from './ipd-content-view';
import { sanitizeHtml } from './sanitize';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('resolveContentViewKind（auto 分流）', () => {
  const base = { title: 't' } satisfies Partial<IpdContentViewPayload>;
  it('显式 kind 原样返回', () => {
    expect(resolveContentViewKind({ ...base, kind: 'text' })).toBe('text');
    expect(resolveContentViewKind({ ...base, kind: 'binary', download: { fetch: async () => new Blob(), filename: 'a.pdf' } })).toBe('binary');
  });
  it('auto 按字段优先级：text > html > imageUrl > download 后缀', () => {
    expect(resolveContentViewKind({ ...base, kind: 'auto', text: '正文', html: '<p>x</p>' })).toBe('text');
    expect(resolveContentViewKind({ ...base, kind: 'auto', html: '<p>x</p>', imageUrl: 'u' })).toBe('html');
    expect(resolveContentViewKind({ ...base, kind: 'auto', imageUrl: 'u', download: { fetch: async () => new Blob(), filename: 'a.png' } })).toBe('image');
    expect(resolveContentViewKind({ ...base, kind: 'auto', download: { fetch: async () => new Blob(), filename: 'a.png' } })).toBe('image');
    expect(resolveContentViewKind({ ...base, kind: 'auto', download: { fetch: async () => new Blob(), filename: '计划书.docx' } })).toBe('binary');
  });
  it('空内容返回 null（空态）', () => {
    expect(resolveContentViewKind({ ...base, kind: 'auto', text: '   ' })).toBeNull();
    expect(resolveContentViewKind({ ...base, kind: 'auto' })).toBeNull();
  });
});

describe('blob 判定', () => {
  it('svg 不算图片（脚本风险走沙箱/兜底）', () => {
    expect(isImageBlob(new Blob([], { type: 'image/png' }), 'a.txt')).toBe(true);
    expect(isImageBlob(new Blob([], { type: 'image/svg+xml' }), 'a.svg')).toBe(false);
    expect(isImageBlob(new Blob([], { type: '' }), '照片.JPG'.toLowerCase())).toBe(true);
  });
  it('文本 MIME 优先，其次文件名后缀', () => {
    expect(isTextualBlob(new Blob([], { type: 'text/plain' }), 'a.bin')).toBe(true);
    expect(isTextualBlob(new Blob([], { type: 'application/json' }), 'a')).toBe(true);
    expect(isTextualBlob(new Blob([], { type: '' }), '说明.md')).toBe(true);
    expect(isTextualBlob(new Blob([], { type: 'application/pdf' }), 'a.pdf')).toBe(false);
  });
});

describe('sanitizeHtml（语义随迁回归）', () => {
  it('剥 script、on* 事件与外链，注入 CSP', () => {
    const out = sanitizeHtml(
      '<!doctype html><html><head><title>页</title></head><body>'
      + '<script>alert(1)</script><script src="https://evil.example/a.js" />'
      + '<p onclick="evil()">可见</p><img src=x onerror=alert(1)>'
      + '<iframe src="https://evil.test"></iframe><a href="https://evil.test">link</a>'
      + '</body></html>',
    );
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toMatch(/\son[a-z]+\s*=/i);
    expect(out).toContain('可见');
    const parsed = new DOMParser().parseFromString(out, 'text/html');
    expect(parsed.querySelector('iframe, [src], [href]')).toBeNull();
    expect(parsed.head.firstElementChild?.getAttribute('content')).toContain("default-src 'none'");
  });
  it('未闭合 script 不吞正文', () => {
    const out = sanitizeHtml('<html><body><p>可见</p><script>alert(1)');
    expect(out).toContain('可见');
    expect(out.toLowerCase()).not.toContain('<script');
  });
});

describe('downloadBlob', () => {
  it('走临时 anchor 落盘并回收 objectURL', () => {
    const clicks: string[] = [];
    const anchorSpies: Element[] = [];
    const createAnchor = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createAnchor(tag);
      if (tag === 'a') {
        anchorSpies.push(el);
        el.click = () => clicks.push(el.getAttribute('download') ?? '');
      }
      return el;
    });
    const revoke = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
    downloadBlob(new Blob(['x']), '报 告/v1.pdf');
    expect(clicks).toEqual(['报 告_v1.pdf']);
    expect(anchorSpies[0]?.getAttribute('href')).toBe('blob:fake');
    expect(revoke).not.toHaveBeenCalled(); // 异步 setTimeout 回收
  });
});

describe('withTargetExtension（2026-10-08 产物 Word/PDF 落盘名）', () => {
  it('剥掉标题自带的来源扩展名，避免 .md.docx / .md.pdf 双扩展名', () => {
    expect(withTargetExtension('C02_竞品分析_缺项版.md', '.docx')).toBe('C02_竞品分析_缺项版.docx');
    expect(withTargetExtension('C02_竞品分析_缺项版.md', '.pdf')).toBe('C02_竞品分析_缺项版.pdf');
  });
  it('无来源扩展名时只追加', () => {
    expect(withTargetExtension('方案', '.pdf')).toBe('方案.pdf');
    // 前导点不算扩展名（dot > 0 才剥），与 fileSuffix 边界对齐
    expect(withTargetExtension('.隐藏文件', '.pdf')).toBe('.隐藏文件.pdf');
    // 末尾点不算扩展名（dot < length-1 才剥），保留原名不误伤
    expect(withTargetExtension('方案.', '.pdf')).toBe('方案..pdf');
  });
  it('无目标后缀（原始格式下载）时原样返回', () => {
    expect(withTargetExtension('C02_竞品分析_缺项版.md', '')).toBe('C02_竞品分析_缺项版.md');
  });
  it('空名回落到附件', () => {
    expect(withTargetExtension('   ', '.pdf')).toBe('附件.pdf');
    expect(withTargetExtension('', '.docx')).toBe('附件.docx');
  });
});

function mountView(payload: IpdContentViewPayload | null, open = true) {
  return mount(IpdContentView, {
    props: { open, payload },
    attachTo: document.body,
  });
}

describe('IpdContentView 组件', () => {
  it('text 分流渲染纯文本 pre，不解析 HTML', async () => {
    const wrapper = mountView({ kind: 'text', title: '文档', text: '# 标题\n<b>不应加粗</b>' });
    await flushPromises();
    const modal = document.body.querySelector('.ant-modal')!;
    expect(modal.querySelector('[data-testid="ipd-content-text"]')?.textContent).toContain('<b>不应加粗</b>');
    expect(modal.querySelector('iframe')).toBeNull();
    wrapper.unmount();
  });

  it('html 分流进 sandbox iframe，srcdoc 已净化', async () => {
    const wrapper = mountView({ kind: 'html', title: '页面', html: '<html><body><script>alert(1)</script><p>页</p></body></html>' });
    await flushPromises();
    const frame = document.body.querySelector('[data-testid="ipd-content-frame"]') as HTMLIFrameElement;
    expect(frame?.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')?.toLowerCase()).not.toContain('<script');
    wrapper.unmount();
  });

  it('imageUrl 直接渲染图片', async () => {
    const wrapper = mountView({ kind: 'auto', title: '图', imageUrl: 'blob:pic' });
    await flushPromises();
    expect(document.body.querySelector('[data-testid="ipd-content-image"]')).toBeTruthy();
    wrapper.unmount();
  });

  it('pdf：拉回后 iframe 原生预览（2026-10-08 Word/PDF 双格式指令）', async () => {
    const fetcher = vi.fn(async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf');
    try {
      const wrapper = mountView({ kind: 'auto', title: '交付物', download: { fetch: fetcher, filename: '交付物.pdf' } });
      await flushPromises();
      const frame = document.body.querySelector('[data-testid="ipd-content-pdf"]') as HTMLIFrameElement | null;
      expect(frame).toBeTruthy();
      expect(frame?.getAttribute('src')).toBe('blob:pdf');
      expect(fetcher).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    } finally {
      createObjectURL.mockRestore();
    }
  });

  it('binary 兜底：提示不支持在线查看并提供下载', async () => {
    const fetcher = vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'application/octet-stream' }));
    const wrapper = mountView({ kind: 'auto', title: '交付物', download: { fetch: fetcher, filename: '交付物.zip' } });
    await flushPromises();
    const modal = document.body.querySelector('.ant-modal')!;
    expect(modal.textContent).toContain('该格式不支持在线查看');
    expect(fetcher).toHaveBeenCalledTimes(1); // 打开即尝试识别内容
    const downloadBtn = [...modal.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, '') === '下载');
    expect(downloadBtn).toBeTruthy();
    wrapper.unmount();
  });

  it('download 拉回文本类 blob 时直读展示', async () => {
    const fetcher = vi.fn(async () => new Blob(['会议纪要正文'], { type: 'text/plain' }));
    const wrapper = mountView({ kind: 'auto', title: '纪要', download: { fetch: fetcher, filename: '纪要.txt' } });
    await flushPromises();
    expect(document.body.querySelector('[data-testid="ipd-content-fetched-text"]')?.textContent).toContain('会议纪要正文');
    wrapper.unmount();
  });

  it('download 拉回图片 blob 时走 objectURL 展示', async () => {
    const fetcher = vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:img');
    const wrapper = mountView({ kind: 'auto', title: '凭证', download: { fetch: fetcher, filename: '凭证.png' } });
    await flushPromises();
    expect(createObjectURL).toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="ipd-content-image"]')).toBeTruthy();
    wrapper.unmount();
  });

  it('加载失败进入错误态，可重试', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(new Blob(['ok'], { type: 'text/plain' }));
    const wrapper = mountView({ kind: 'auto', title: '附件', download: { fetch: fetcher, filename: '附件.txt' } });
    await flushPromises();
    let modal = document.body.querySelector('.ant-modal')!;
    expect(modal.textContent).toContain('附件加载失败');
    const retry = [...modal.querySelectorAll('button')].find((b) => (b.textContent ?? '').replace(/\s+/g, '') === '重试');
    expect(retry).toBeTruthy();
    retry!.click();
    await flushPromises();
    modal = document.body.querySelector('.ant-modal')!;
    expect(modal.querySelector('[data-testid="ipd-content-fetched-text"]')?.textContent).toContain('ok');
    wrapper.unmount();
  });

  it('空内容显示「暂无内容」', async () => {
    const wrapper = mountView({ kind: 'auto', title: '空' });
    await flushPromises();
    expect(document.body.querySelector('.ant-modal')?.textContent).toContain('暂无内容');
    wrapper.unmount();
  });
});
