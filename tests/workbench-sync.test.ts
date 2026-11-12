// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkbench } from '../src/hooks/useWorkbench';
import { builtInThemes, systemDefaultTheme } from '../shared/themes';
import type { Article } from '../shared/types';

class MockEvents {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  error() { this.onerror?.(); }
  message(type: string, detail = {}) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type, ...detail }) })); }
}

describe('workbench change notifications', () => {
  let host: HTMLDivElement, root: ReturnType<typeof createRoot>, events: MockEvents;
  let workbench: ReturnType<typeof useWorkbench>;
  let article: Article;
  const notify = vi.fn();
  const run = async (action: () => unknown) => { await act(async () => { await action(); }); };
  const advance = (ms: number) => run(() => vi.advanceTimersByTimeAsync(ms));
  const workspace = () => ({ directory: 'D:/articles', name: 'articles', directories: [], articles: [article], truncated: false });
  const count = (path: string) => vi.mocked(fetch).mock.calls.filter(([url]) => new URL(String(url), 'http://localhost').pathname === `/api/${path}`).length;
  function Harness() { workbench = useWorkbench(notify); return null; }

  beforeEach(async () => {
    vi.useFakeTimers(); notify.mockClear(); localStorage.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('EventSource', class extends MockEvents { constructor() { super(); events = this; } });
    article = { path: 'article.md', name: 'article.md', title: 'Original', content: '# Original', size: 10, modifiedAt: '2026-11-04T00:00:00Z', revision: 'initial' };
    vi.stubGlobal('fetch', vi.fn(async (input: string, options: RequestInit = {}) => {
      const pathname = new URL(input, 'http://localhost').pathname;
      if (pathname === '/api/workspace') return Response.json(workspace());
      if (pathname === '/api/themes') return Response.json({ themes: builtInThemes, defaultThemeId: systemDefaultTheme.id });
      if (pathname === '/api/article') {
        if (options.method === 'PUT') {
          const body = JSON.parse(String(options.body));
          article = { ...article, content: body.content, revision: 'saved' };
        }
        return Response.json(article);
      }
      throw new Error(`Unexpected request: ${pathname}`);
    }));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await run(() => root.render(createElement(Harness)));
    await run(() => { events.open(); events.message('watch-status', { watching: true }); });
    expect(workbench.loading).toBe(false);
    vi.mocked(fetch).mockClear();
  });
  afterEach(async () => {
    await run(() => root.unmount()); host.remove();
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('does not poll workspace or themes while the event stream and file watcher are healthy', async () => {
    await advance(120000);
    expect(fetch).not.toHaveBeenCalled();
    expect(workbench.connected).toBe(true);
  });
  it('saves the current draft before creating an article in a nested target folder', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, options = {}) => {
      if (String(url) === '/api/articles') {
        const body = JSON.parse(String(options.body));
        return Response.json({ ...article, path: body.path, name: '新文章.md', content: body.content, revision: 'new' });
      }
      return originalFetch(url, options);
    });
    await run(() => workbench.setContent('# 保留当前草稿'));
    await run(() => workbench.createArticle('新文章', '课程/练习', 'D:/articles'));
    const writes = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'PUT' || options?.method === 'POST');
    expect(writes.map(([url]) => url)).toEqual(['/api/article', '/api/articles']);
    const created = JSON.parse(String(writes[1][1]!.body));
    expect(created.path).toBe('课程/练习/新文章.md');
    expect(created.content).toContain('# 新文章\n');
    expect(created.content).not.toContain('课程/练习');
    expect(article.content).toBe('# 保留当前草稿');
    expect(workbench.article?.path).toBe('课程/练习/新文章.md');
    expect(workbench.workspace?.articles.some((item) => item.path === '课程/练习/新文章.md')).toBe(true);
  });
  it('rejects stale creation targets and preserves the draft when saving fails', async () => {
    await run(() => expect(workbench.createArticle('新文章', '', 'D:/different')).rejects.toThrow('已切换'));
    await run(() => expect(workbench.createFolder('新目录', '', 'D:/different')).rejects.toThrow('已切换'));
    expect(fetch).not.toHaveBeenCalled();
    await run(() => workbench.setContent('# 未保存草稿'));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ message: '保存冲突', code: 'FILE_CONFLICT' }, { status: 409 }));
    await run(() => expect(workbench.createArticle('新文章', '课程')).rejects.toThrow('保存问题'));
    expect(count('articles')).toBe(0);
    expect(workbench.content).toBe('# 未保存草稿');
    expect(workbench.switching).toBe(false);
  });
  it('refreshes only the changed resource and coalesces bursts', async () => {
    await run(() => { for (let i = 0; i < 8; i++) events.message('files-changed'); });
    await advance(250);
    expect(count('workspace')).toBe(1); expect(count('themes')).toBe(0);
    await run(() => { events.message('themes-changed'); events.message('themes-changed'); });
    await advance(250);
    expect(count('workspace')).toBe(1); expect(count('themes')).toBe(1);
    await run(() => { events.message('workspace-changed'); events.message('themes-changed'); });
    await advance(250);
    expect(count('workspace')).toBe(2); expect(count('themes')).toBe(2);
  });
  it('queues one follow-up for changes received during an active refresh', async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    await run(() => events.message('files-changed')); await advance(250);
    await run(() => { for (let i = 0; i < 5; i++) events.message('files-changed'); }); await advance(250);
    expect(count('workspace')).toBe(1);
    await run(() => release(Response.json(workspace())));
    expect(count('workspace')).toBe(2); expect(count('themes')).toBe(0);
  });
  it('uses fallback polling while disconnected and stops after reconnection', async () => {
    await run(() => events.error()); await advance(30000);
    expect(count('workspace')).toBe(2); expect(count('themes')).toBe(2);
    await run(() => { events.open(); events.message('watch-status', { watching: true }); }); await advance(250);
    expect(count('workspace')).toBe(3); expect(count('themes')).toBe(3);
    await advance(60000);
    expect(count('workspace')).toBe(3); expect(count('themes')).toBe(3);
  });
  it('falls back when the watcher fails and skips background polling while the page is hidden', async () => {
    await run(() => events.message('watch-error')); await advance(15000);
    expect(count('workspace')).toBe(1);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await advance(45000); expect(count('workspace')).toBe(1);
    visibility.mockReturnValue('visible');
    await run(() => document.dispatchEvent(new Event('visibilitychange'))); await advance(250);
    expect(count('workspace')).toBe(2);
    await run(() => events.message('watch-status', { watching: true })); await advance(250);
    expect(count('workspace')).toBe(3);
    await advance(30000); expect(count('workspace')).toBe(3);
  });
  it('still refreshes on focus, loads external edits and protects unsaved drafts', async () => {
    article = { ...article, content: '# External change', revision: 'external-1', modifiedAt: '2026-11-04T01:00:00Z' };
    await run(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); }); await advance(250);
    expect(count('workspace')).toBe(1); expect(count('themes')).toBe(1);
    expect(workbench.content).toBe('# External change');
    await run(() => workbench.setContent('# Unsaved draft'));
    article = { ...article, content: '# Another external change', revision: 'external-2', modifiedAt: '2026-11-04T02:00:00Z' };
    await run(() => events.message('files-changed')); await advance(250);
    expect(workbench.content).toBe('# Unsaved draft');
    expect(workbench.saveError).toContain('其他编辑器修改');
    expect(count('themes')).toBe(1);
  });
  it('cleans up scheduled refreshes, fallback timers and focus listeners on unmount', async () => {
    await run(() => { events.error(); events.message('files-changed'); });
    await run(() => root.unmount());
    await run(() => window.dispatchEvent(new Event('focus'))); await advance(60000);
    expect(events.closed).toBe(true); expect(fetch).not.toHaveBeenCalled();
    root = createRoot(host);
  });
});
