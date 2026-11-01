// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtInThemes, defaultSettings } from '../shared/themes';
import { copyImage, copyRichText, coverImageSource, embedLocalImages, renderMarkdown } from '../src/lib/render';
import { insertCover } from '../shared/images';

const theme = builtInThemes[0];
const render = (source: string) => renderMarkdown(source, theme, defaultSettings(theme), { articlePath: 'notes/a.md', directory: 'D:/articles' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const blobText = (blob: Blob) => new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('image clipboard and export preparation', () => {
  it('embeds real PNG data in HTML, deduplicates downloads and preserves remote images', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await embedLocalImages(render('![文章封面](./cover.png)\n\n![again](./cover.png)\n\n![remote](https://example.com/image.png)'));
    expect(result.html).not.toContain('/api/assets');
    expect(result.html.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(result.html).toContain(png.toString('base64'));
    expect(result.html).toContain('https://example.com/image.png');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('format')).toBe('png');
    expect(result.localImages).toBe(0);
  });
  it('writes prepared HTML and plain text to the clipboard and a real PNG for separate image copy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(png, { headers: { 'Content-Type': 'image/png' } })));
    let payload: Record<string, Blob> = {};
    vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob | Promise<Blob>>) {} });
    const write = vi.fn(async (items: { data: Record<string, Blob | Promise<Blob>> }[]) => {
      payload = Object.fromEntries(await Promise.all(Object.entries(items[0].data).map(async ([key, value]) => [key, await value])));
    });
    vi.stubGlobal('navigator', { clipboard: { write } });
    const result = render('![文章封面](./cover.png)\n\n# Hello');
    await copyRichText(result);
    expect(await blobText(payload['text/html'])).toContain('data:image/png;base64,');
    expect(await blobText(payload['text/plain'])).toContain('Hello');
    await copyImage(coverImageSource(result)!);
    expect(Object.keys(payload)).toEqual(['image/png']);
    expect(payload['image/png'].size).toBe(png.length);
  });
  it('fails explicitly on missing images rather than copying broken local URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: '图片不存在' }, { status: 404 })));
    await expect(embedLocalImages(render('![文章封面](./gone.png)'))).rejects.toThrow('图片不存在');
  });
  it('keeps the generated cover ahead of auto-added title and metadata, and replaces the old cover on regeneration', () => {
    const first = './cover-11111111-1111-4111-8111-111111111111.png';
    const second = './cover-22222222-2222-4222-8222-222222222222.png';
    const source = '---\ntitle: Title\ncategory: Cat\nauthor: Author\n---\n正文';
    const updated = insertCover(insertCover(source, first), second);
    expect(updated).not.toContain(first);
    expect(updated).toContain(second);
    const html = new DOMParser().parseFromString(render(updated).html, 'text/html');
    expect(html.querySelector('section')?.firstElementChild?.querySelector('img')?.alt).toBe('文章封面');
  });
});
