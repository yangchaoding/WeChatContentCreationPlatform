// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtInThemes, defaultSettings } from '../shared/themes';
import { copyRichText, exportHtml, renderMarkdown } from '../src/lib/render';

const source = 'user = {"name": "小明", "age": 18}\n#        ↑键     ↑值      ↑键 ↑值\n\n\tprint("<script> & 中文")  \n';
const markdown = '# 代码示例\n\n正文中的 `user["name"]`。\n\n```python\n' + source + '```\n\n后续正文。';
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const blobText = (blob: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('mobile code layout and publication', () => {
  it.each(builtInThemes)('preserves Chinese code, alignment comments and whitespace in $name', (theme) => {
    const result = renderMarkdown(markdown, theme, defaultSettings(theme));
    const doc = parse(result.html);
    const pre = doc.querySelector('pre')!;
    const code = pre.querySelector('code')!;
    expect(code.textContent).toBe(source);
    expect(result.text).toContain(source);
    expect(pre.style.overflowX).toBe('auto');
    expect(pre.style.width).toBe('100%');
    expect(pre.style.boxSizing).toBe('border-box');
    expect(code.style.width).toBe('max-content');
    expect(code.style.minWidth).toBe('100%');
    for (const node of [pre, code, ...code.querySelectorAll<HTMLElement>('span')]) {
      expect(node.style.whiteSpace).toBe('pre');
      expect(node.style.getPropertyPriority('white-space')).toBe('important');
      expect(node.style.wordBreak).toBe('normal');
      expect(node.style.overflowWrap).toBe('normal');
      expect(node.style.wordWrap).toBe('normal');
    }
    expect(doc.querySelector<HTMLElement>('p code')?.style.wordBreak).toBe('break-word');
    expect(doc.querySelector('script, style, [class]')).toBeNull();
  });

  it('keeps imported wrapping rules from breaking block code while preserving custom colors', () => {
    const theme = { ...builtInThemes[0], styles: {
      pre: { 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere', 'word-break': 'break-all', overflow: 'hidden', width: '1200px', 'background-color': '#eeeeee' },
      code: { 'white-space': 'normal', 'word-break': 'break-all' },
    } };
    const doc = parse(renderMarkdown(markdown, theme, defaultSettings(theme)).html);
    const pre = doc.querySelector('pre')!;
    expect(pre.style.overflowX).toBe('auto');
    expect(pre.style.width).toBe('100%');
    expect(pre.style.whiteSpace).toBe('pre');
    expect(pre.style.backgroundColor).toBe('rgb(238, 238, 238)');
    expect(pre.querySelector('code')?.style.whiteSpace).toBe('pre');
    expect(pre.textContent).toBe(source);
  });

  it('copies the same no-wrap markup and exact plain text used in preview', async () => {
    const theme = builtInThemes.find((item) => item.id === 'claude')!;
    const result = renderMarkdown(markdown, theme, defaultSettings(theme));
    let payload: Record<string, Blob> = {};
    vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob | Promise<Blob>>) {} });
    const write = vi.fn(async (items: { data: Record<string, Blob | Promise<Blob>> }[]) => {
      payload = Object.fromEntries(await Promise.all(Object.entries(items[0].data).map(async ([key, value]) => [key, await value])));
    });
    vi.stubGlobal('navigator', { clipboard: { write } });
    await copyRichText(result);
    expect(write).toHaveBeenCalledOnce();
    expect(await blobText(payload['text/html'])).toBe(result.html);
    expect(await blobText(payload['text/plain'])).toBe(result.text);
    expect(parse(await blobText(payload['text/html'])).querySelector('pre code')?.textContent).toBe(source);
  });

  it('exports mobile viewport markup with the same code layout and content', async () => {
    const result = renderMarkdown(markdown, builtInThemes[0], defaultSettings());
    let exported!: Blob;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { exported = blob; return 'blob:export'; }), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await exportHtml(result);
    const html = await blobText(exported);
    expect(html).toContain(result.html);
    expect(parse(html).querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe('width=device-width,initial-scale=1');
    expect(parse(html).querySelector('pre code')?.textContent).toBe(source);
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
  });
});
