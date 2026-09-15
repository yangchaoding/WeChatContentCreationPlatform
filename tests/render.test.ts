// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { builtInThemes, defaultSettings } from '../shared/themes';
import { renderMarkdown } from '../src/lib/render';

const theme = builtInThemes[0];
function render(source: string, overrides = {}) {
  const result = renderMarkdown(source, theme, { ...defaultSettings(theme), ...overrides }, { filename: '文章.md', articlePath: 'notes/文章.md', directory: 'D:\\articles' });
  const document = new DOMParser().parseFromString(result.html, 'text/html');
  return { ...result, document };
}

describe('WeChat-compatible rendering', () => {
  it('embeds inline heading, paragraph, quote and emphasis styles', () => {
    const { document } = render('# 标题\n\n正文 **重点**\n\n## 章节\n\n> 引用');
    expect(document.querySelector('h2')?.style.borderLeft).toContain('3px');
    expect(document.querySelector('p')?.style.fontSize).toBe('15px');
    expect(document.querySelector('strong')?.style.color).toBe('rgb(40, 119, 91)');
    expect(document.querySelector('blockquote')?.style.backgroundColor).toBe('rgb(240, 246, 241)');
    expect(document.querySelector('style')).toBeNull();
  });
  it('renders GFM tables, nested lists, line breaks and highlighted code', () => {
    const { document } = render('# 标题\n\n| 名称 | 内容 |\n| --- | --- |\n| A | B |\n\n- 第一项\n  - 第二项\n\n第一行\n第二行\n\n```js\nconst value = "hello";\n```');
    expect(document.querySelectorAll('table th')).toHaveLength(2);
    expect(document.querySelector('ul ul li')?.textContent).toContain('第二项');
    expect(document.querySelector('br')).not.toBeNull();
    expect(document.querySelectorAll('pre code span[style]').length).toBeGreaterThan(0);
    expect(document.querySelector('[class]')).toBeNull();
  });
  it('strips scripts, event handlers, unsafe URLs and raw CSS', () => {
    const { html, document } = render('# 安全\n\n<script>alert(1)</script><iframe src="https://evil.example"></iframe><p onclick="alert(1)" style="position:fixed;background:url(https://evil.example)">正文</p><a href="javascript:alert(1)">链接</a><img src="data:image/svg+xml;base64,PHN2Zz4=" onerror="alert(2)">');
    expect(html).not.toMatch(/<script|<iframe|onclick|onerror|javascript:|position:\s*fixed|evil\.example/);
    expect(document.querySelector('img')?.hasAttribute('src')).toBe(false);
  });
  it('resolves local images against nested article paths and rejects escaping images', () => {
    const result = render('![本地图](../images/photo.png)\n\n![外部图](https://example.com/photo.jpg)\n\n![越界图](../../secret.png)');
    const images = result.document.querySelectorAll('img');
    expect(result.localImages).toBe(1);
    const source = new URL(images[0].src);
    expect(source.searchParams.get('path')).toBe('images/photo.png');
    expect(source.searchParams.get('directory')).toBe('D:\\articles');
    expect(images[1].src).toBe('https://example.com/photo.jpg');
    expect(images[2].hasAttribute('src')).toBe(false);
  });
  it('honors title, metadata, custom typography and footnote options', () => {
    const result = render('---\ntitle: 我的文章\nauthor: 小墨\ndate: 2026-09-15\n---\n# 我的文章\n\n正文 [资源](https://example.com) 和 [同一资源](https://example.com)', { showTitle: false, showMeta: false, fontSize: 18, lineHeight: 2.1, paragraphSpacing: 26, linkFootnotes: true });
    expect(result.document.querySelector('h1')).toBeNull();
    expect(result.text).not.toContain('小墨');
    expect(result.document.querySelector('p')?.style.fontSize).toBe('18px');
    expect(result.document.querySelector('p')?.style.lineHeight).toBe('2.1');
    expect(result.document.querySelector('p')?.style.marginBottom).toBe('26px');
    expect(result.document.querySelectorAll('sup')).toHaveLength(2);
    expect(result.text.match(/\[1\] https:\/\/example\.com/g)).toHaveLength(1);
  });
  it('produces distinct structures for all eight built-in themes', () => {
    const results = builtInThemes.map((candidate) => renderMarkdown('# 标题\n\n## 章节\n\n> 引用', candidate, defaultSettings(candidate)).html);
    expect(new Set(results).size).toBe(8);
    expect(results[4]).toContain('text-align: center');
    expect(results[2]).toContain('border-bottom: 1px solid');
  });
});
