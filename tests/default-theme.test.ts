// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useWorkbench, type Notify } from '../src/hooks/useWorkbench';
import { builtInThemes, defaultSettings, systemDefaultTheme } from '../shared/themes';
import type { Article, Theme, ThemeLibrary } from '../shared/types';

const theme = (id: string) => builtInThemes.find((item) => item.id === id)!;
const article = (path: string, content = `# ${path}`): Article => ({ path, name: path, title: path, content, size: content.length, modifiedAt: '2026-10-25T00:00:00Z', revision: 'initial' });

describe('default theme in the workbench', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let workbench: ReturnType<typeof useWorkbench>;
  let library: ThemeLibrary;
  let articles: Map<string, Article>;
  let failDefault: boolean;
  let writes: { path: string; body: Record<string, any> }[];
  let notify: Mock<Notify>;
  const run = async (action: () => unknown) => { await act(async () => { await action(); }); };
  function Harness() { workbench = useWorkbench(notify); return null; }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('EventSource', class { close() {} });
    localStorage.clear();
    notify = vi.fn();
    failDefault = false;
    writes = [];
    library = { themes: [...builtInThemes].reverse(), defaultThemeId: 'claude' };
    articles = new Map([
      ['article.md', article('article.md')],
      ['saved.md', { ...article('saved.md'), settings: { ...defaultSettings(theme('sunset')), fontSize: 18, showMeta: false } }],
    ]);
    vi.stubGlobal('fetch', vi.fn(async (input: string, options: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const body = options.body ? JSON.parse(String(options.body)) : {};
      if (options.method !== 'GET') writes.push({ path: url.pathname, body });
      if (url.pathname === '/api/themes/default') {
        if (failDefault) return Response.json({ message: '默认主题保存失败' }, { status: 500 });
        library.defaultThemeId = body.themeId;
        return Response.json(library);
      }
      if (url.pathname === '/api/themes') return Response.json(library);
      if (url.pathname.startsWith('/api/themes/') && options.method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
        library.themes = library.themes.filter((item) => item.id !== id);
        if (library.defaultThemeId === id) library.defaultThemeId = systemDefaultTheme.id;
        return Response.json(library);
      }
      if (url.pathname === '/api/workspace') return Response.json({ directory: 'D:/articles', name: 'articles', directories: [], articles: [...articles.values()], truncated: false });
      if (url.pathname === '/api/article-settings') {
        articles.get(body.path)!.settings = body.settings;
        return Response.json({ ok: true });
      }
      if (url.pathname === '/api/articles') {
        const created = article(body.path, body.content);
        articles.set(created.path, created);
        return Response.json(created);
      }
      if (url.pathname === '/api/articles/import') {
        const imported = body.files.map((file: { name: string; content: string }) => article(file.name, file.content));
        for (const item of imported) articles.set(item.path, item);
        return Response.json({ articles: imported });
      }
      if (url.pathname === '/api/article') {
        if (options.method === 'PUT') articles.set(body.path, { ...articles.get(body.path)!, content: body.content, revision: 'saved' });
        return Response.json(articles.get(body.path || url.searchParams.get('path')));
      }
      throw new Error(`Unexpected request: ${options.method} ${url.pathname}`);
    }));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await run(() => root.render(createElement(Harness)));
    expect(workbench.loading).toBe(false);
    expect(workbench.loadError).toBe('');
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the saved default regardless of theme ordering and keeps explicit article styles', async () => {
    expect(workbench.theme.id).toBe('claude');
    expect(workbench.settings).toEqual(defaultSettings(theme('claude')));
    await run(() => workbench.selectArticle('saved.md'));
    expect(workbench.settings).toMatchObject({ themeId: 'sunset', fontSize: 18, showMeta: false });
    await run(() => workbench.setDefaultTheme(theme('programming')));
    expect(workbench.defaultThemeId).toBe('programming');
    expect(workbench.settings).toMatchObject({ themeId: 'sunset', fontSize: 18, showMeta: false });
    await run(() => workbench.selectArticle('article.md'));
    expect(workbench.theme.id).toBe('programming');
  });

  it('updates inherited styles immediately without saving an article-specific override or discarding a draft', async () => {
    act(() => workbench.setContent('# 未保存的修改'));
    await run(() => workbench.setDefaultTheme(theme('programming')));
    expect(workbench.settings).toEqual(defaultSettings(theme('programming')));
    expect(workbench.content).toBe('# 未保存的修改');
    expect(workbench.saveStatus).toBe('pending');
    expect(writes.map((write) => write.path)).toEqual(['/api/themes/default']);
    await run(() => workbench.flush());
    expect(articles.get('article.md')!.settings).toBeUndefined();
    expect(writes.some((write) => write.path === '/api/article-settings')).toBe(false);
    await run(() => workbench.setDefaultTheme(theme('ink')));
    expect(workbench.theme.id).toBe('ink');
  });

  it('preserves both pending and saved individual adjustments when defaults change', async () => {
    act(() => workbench.setSettings({ ...workbench.settings, fontSize: 21 }));
    await run(() => workbench.setDefaultTheme(theme('programming')));
    expect(workbench.settings).toMatchObject({ themeId: 'claude', fontSize: 21 });
    await run(() => workbench.flush());
    await run(() => workbench.setDefaultTheme(theme('ink')));
    expect(workbench.settings).toMatchObject({ themeId: 'claude', fontSize: 21 });
    expect(articles.get('article.md')!.settings?.fontSize).toBe(21);
  });

  it('applies the default to newly created and imported articles', async () => {
    await run(() => workbench.createArticle('新文章'));
    expect(workbench.article?.path).toBe('新文章.md');
    expect(workbench.theme.id).toBe('claude');
    const file = new File(['# 导入'], '导入.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', { value: async () => '# 导入' });
    await run(() => workbench.importArticles([file]));
    expect(workbench.article?.path).toBe('导入.md');
    expect(workbench.theme.id).toBe('claude');
  });

  it('keeps the previous default and permits retry when saving fails', async () => {
    failDefault = true;
    await run(() => workbench.setDefaultTheme(theme('programming')));
    expect(workbench.defaultThemeId).toBe('claude');
    expect(workbench.theme.id).toBe('claude');
    expect(workbench.savingDefaultThemeId).toBeNull();
    expect(notify).toHaveBeenLastCalledWith('默认主题保存失败', 'error');
    failDefault = false;
    await run(() => workbench.setDefaultTheme(theme('programming')));
    expect(workbench.defaultThemeId).toBe('programming');
  });

  it('synchronizes changes from another window and falls back after deleting the default custom theme', async () => {
    const custom: Theme = { ...theme('claude'), id: 'custom-test', name: '自定义默认', custom: true };
    library = { themes: [...library.themes, custom], defaultThemeId: custom.id };
    await run(() => workbench.refresh());
    expect(workbench.theme.id).toBe(custom.id);
    await run(() => workbench.deleteTheme(custom));
    expect(workbench.defaultThemeId).toBe(systemDefaultTheme.id);
    expect(workbench.theme.id).toBe(systemDefaultTheme.id);
    expect(workbench.themes.some((item) => item.id === custom.id)).toBe(false);
    expect(writes.some((write) => write.path === '/api/article-settings')).toBe(false);
  });

  it('ignores an older refresh response after a new default has been saved', async () => {
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    const oldLibrary = structuredClone(library);
    let release!: () => void;
    let delayed = false;
    fetchMock.mockImplementation((input, options) => {
      if (String(input) === '/api/themes' && !delayed) {
        delayed = true;
        return new Promise((resolve) => { release = () => resolve(Response.json(oldLibrary)); });
      }
      return original(input, options);
    });
    let refresh!: Promise<void>;
    await run(() => { refresh = workbench.refresh(); });
    await run(() => workbench.setDefaultTheme(theme('programming')));
    await run(async () => { release(); await refresh; });
    expect(workbench.defaultThemeId).toBe('programming');
    expect(workbench.theme.id).toBe('programming');
  });

  it('retains unsaved style adjustments across external article updates and subsequent default changes', async () => {
    act(() => workbench.setSettings({ ...workbench.settings, fontSize: 20 }));
    articles.set('article.md', { ...articles.get('article.md')!, content: '# 外部更新', revision: 'external', modifiedAt: '2026-10-25T01:00:00Z' });
    await run(() => workbench.refresh());
    expect(workbench.content).toBe('# 外部更新');
    await run(() => workbench.setDefaultTheme(theme('programming')));
    expect(workbench.settings).toMatchObject({ themeId: 'claude', fontSize: 20 });
    await run(() => workbench.flush());
    expect(articles.get('article.md')!.settings?.fontSize).toBe(20);
  });

  it('inserts a completed cover into the latest draft and saves it without losing intervening edits', async () => {
    const cover = { requestId: 'example', directory: 'D:/articles', articlePath: 'article.md', assetPath: 'cover.png', markdownPath: './cover.png', width: 1024, height: 1024 };
    await run(() => workbench.setContent('# Latest draft\n\nWritten during generation'));
    await run(() => workbench.insertGeneratedCover(cover));
    expect(workbench.content).toBe('![文章封面](./cover.png)\n\n# Latest draft\n\nWritten during generation');
    await run(() => workbench.insertGeneratedCover(cover));
    expect(workbench.content.match(/!\[文章封面\]/g)).toHaveLength(1);
    await run(() => workbench.flush());
    expect(articles.get('article.md')?.content).toBe(workbench.content);
  });

  it('refuses to insert a cover if the user has switched article or workspace', async () => {
    const cover = { requestId: 'example', directory: 'D:/articles', articlePath: 'article.md', assetPath: 'cover.png', markdownPath: './cover.png', width: 1024, height: 1024 };
    await run(() => workbench.selectArticle('saved.md'));
    expect(() => workbench.insertGeneratedCover(cover)).toThrow('切回原文章');
    expect(() => workbench.insertGeneratedCover({ ...cover, directory: 'elsewhere', articlePath: 'saved.md' })).toThrow('切回原文章');
    expect(workbench.content).toBe('# saved.md');
  });
});
