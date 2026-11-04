import { useCallback, useEffect, useRef, useState } from 'react';
import { builtInThemes, defaultSettings, systemDefaultTheme } from '../../shared/themes';
import type { Article, ArticleSettings, Theme, ThemeLibrary, Workspace } from '../../shared/types';
import { api, ApiError, errorMessage, query } from '../lib/api';
import { insertCover, type GeneratedCover } from '../../shared/images';

export type Notify = (message: string, kind?: 'success' | 'error' | 'info') => void;
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';
type RefreshScope = 'all' | 'workspace' | 'themes';
const mergeScope = (a: RefreshScope, b: RefreshScope): RefreshScope => a === b ? a : 'all';

export function useWorkbench(notify: Notify) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [content, setContentState] = useState('');
  const [settings, setSettingsState] = useState<ArticleSettings>(defaultSettings());
  const [themes, setThemes] = useState<Theme[]>(builtInThemes);
  const [defaultThemeId, setDefaultThemeId] = useState(systemDefaultTheme.id);
  const [savingDefaultThemeId, setSavingDefaultThemeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveError, setSaveError] = useState('');
  const [switching, setSwitching] = useState(false);
  const workspaceRef = useRef(workspace);
  const articleRef = useRef(article);
  const contentRef = useRef(content);
  const settingsRef = useRef(settings);
  const themesRef = useRef(themes);
  const themeLibraryVersion = useRef(0);
  const defaultThemeRef = useRef(defaultThemeId);
  const inheritsThemeRef = useRef(true);
  const savingDefaultThemeRef = useRef(false);
  const savedSettingsRef = useRef('');
  const savePromise = useRef<Promise<boolean> | null>(null);
  const settingsPromise = useRef<Promise<boolean> | null>(null);
  const switchingRef = useRef(false);
  const loadSequence = useRef(0);
  const initialized = useRef(false);
  const errorRef = useRef('');
  const refreshPromise = useRef<Promise<void> | null>(null);
  const queuedRefresh = useRef<{ scope: RefreshScope; reportError: boolean } | null>(null);

  const updateWorkspace = useCallback((value: Workspace) => { workspaceRef.current = value; setWorkspace(value); }, []);
  const updateThemes = useCallback((value: Theme[]) => { themeLibraryVersion.current++; themesRef.current = value; setThemes(value); }, []);
  const updateThemeLibrary = useCallback((library: ThemeLibrary) => {
    const fallback = library.themes.find((theme) => theme.id === library.defaultThemeId) || systemDefaultTheme;
    updateThemes(library.themes);
    defaultThemeRef.current = fallback.id;
    setDefaultThemeId(fallback.id);
    if (inheritsThemeRef.current || !library.themes.some((theme) => theme.id === settingsRef.current.themeId)) {
      inheritsThemeRef.current = true;
      const next = defaultSettings(fallback);
      const signature = JSON.stringify(next);
      if (signature !== JSON.stringify(settingsRef.current)) {
        settingsRef.current = next;
        // Inherited defaults are not an individual article's saved preference.
        savedSettingsRef.current = signature;
        setSettingsState(next);
        if (!errorRef.current && !savePromise.current) setSaveStatus(articleRef.current && contentRef.current !== articleRef.current.content ? 'pending' : 'saved');
      }
    }
  }, [updateThemes]);
  const applyArticle = useCallback((value: Article | null, root?: string) => {
    articleRef.current = value;
    contentRef.current = value?.content || '';
    const selectedTheme = themesRef.current.find((theme) => theme.id === value?.settings?.themeId);
    const fallback = themesRef.current.find((theme) => theme.id === defaultThemeRef.current) || systemDefaultTheme;
    inheritsThemeRef.current = !(value?.settings && selectedTheme);
    const nextSettings = value?.settings && selectedTheme ? { ...defaultSettings(selectedTheme), ...value.settings } : defaultSettings(fallback);
    settingsRef.current = nextSettings;
    savedSettingsRef.current = JSON.stringify(nextSettings);
    setArticle(value);
    setContentState(value?.content || '');
    setSettingsState(nextSettings);
    setSaveStatus('saved');
    setSaveError('');
    errorRef.current = '';
    if (value && root) localStorage.setItem(`mopai:article:${root}`, value.path);
  }, []);

  const markError = useCallback((error: unknown) => {
    const message = errorMessage(error);
    errorRef.current = message;
    setSaveError(message);
    setSaveStatus('error');
    notify(message, 'error');
  }, [notify]);

  const saveContent = useCallback(async (): Promise<boolean> => {
    if (savePromise.current) {
      const success = await savePromise.current;
      if (!success) return false;
    }
    const current = articleRef.current;
    const root = workspaceRef.current;
    const draft = contentRef.current;
    if (!current || !root || current.content === draft) return true;
    if (errorRef.current) return false;
    setSaveStatus('saving');
    const promise = (async () => {
      try {
        const saved = await api<Article>('/article', { method: 'PUT', body: { path: current.path, content: draft, revision: current.revision, directory: root.directory } });
        if (articleRef.current?.path === saved.path && workspaceRef.current?.directory === root.directory) {
          articleRef.current = saved;
          setArticle(saved);
          setSaveStatus(contentRef.current === saved.content && savedSettingsRef.current === JSON.stringify(settingsRef.current) ? 'saved' : 'pending');
          const activeWorkspace = workspaceRef.current;
          if (activeWorkspace) updateWorkspace({ ...activeWorkspace, articles: activeWorkspace.articles.map((item) => item.path === saved.path ? { path: saved.path, name: saved.name, title: saved.title, size: saved.size, modifiedAt: saved.modifiedAt } : item) });
        }
        return true;
      } catch (error) { markError(error); return false; }
    })();
    savePromise.current = promise;
    try { return await promise; } finally { savePromise.current = null; }
  }, [markError, updateWorkspace]);

  const saveSettings = useCallback(async (): Promise<boolean> => {
    if (settingsPromise.current) {
      const success = await settingsPromise.current;
      if (!success) return false;
    }
    const current = articleRef.current;
    const root = workspaceRef.current;
    const value = settingsRef.current;
    const signature = JSON.stringify(value);
    if (!current || !root || signature === savedSettingsRef.current) return true;
    const promise = (async () => {
      try {
        await api('/article-settings', { method: 'PUT', body: { path: current.path, directory: root.directory, settings: value } });
        if (articleRef.current?.path === current.path && workspaceRef.current?.directory === root.directory) {
          savedSettingsRef.current = signature;
          if (!errorRef.current) setSaveStatus(contentRef.current === articleRef.current.content && JSON.stringify(settingsRef.current) === signature ? 'saved' : 'pending');
        }
        return true;
      } catch (error) { markError(error); return false; }
    })();
    settingsPromise.current = promise;
    try { return await promise; } finally { settingsPromise.current = null; }
  }, [markError]);

  const flush = useCallback(async () => {
    if (!(await saveContent())) return false;
    if (!(await saveSettings())) return false;
    // A keystroke during an in-flight write belongs in the same flush operation.
    if (articleRef.current && articleRef.current.content !== contentRef.current) return saveContent();
    return true;
  }, [saveContent, saveSettings]);

  const chooseInitial = useCallback(async (root: Workspace) => {
    const stored = localStorage.getItem(`mopai:article:${root.directory}`);
    const first = root.articles.find((item) => item.path === stored) || root.articles.find((item) => item.name === '把生活调成自己喜欢的频道.md') || root.articles[0];
    const value = first ? await api<Article>(`/article?${query({ path: first.path, directory: root.directory })}`) : null;
    applyArticle(value, root.directory);
  }, [applyArticle]);

  const initialize = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [root, themeList] = await Promise.all([api<Workspace>('/workspace'), api<ThemeLibrary>('/themes')]);
      updateThemeLibrary(themeList);
      updateWorkspace(root);
      await chooseInitial(root);
      initialized.current = true;
      setConnected(true);
    } catch (error) { setLoadError(errorMessage(error)); setConnected(false); }
    finally { setLoading(false); }
  }, [chooseInitial, updateThemeLibrary, updateWorkspace]);

  useEffect(() => { void initialize(); }, [initialize]);

  const performRefresh = useCallback(async (reportError: boolean, scope: RefreshScope) => {
    if (switchingRef.current || !initialized.current) return;
    try {
      const libraryVersion = themeLibraryVersion.current;
      const [root, themeList] = await Promise.all([
        scope === 'themes' ? Promise.resolve(null) : api<Workspace>('/workspace'),
        scope === 'workspace' ? Promise.resolve(null) : api<ThemeLibrary>('/themes'),
      ]);
      if (switchingRef.current) return;
      if (themeList && libraryVersion === themeLibraryVersion.current) updateThemeLibrary(themeList);
      setConnected(true);
      if (!root) return;
      const oldRoot = workspaceRef.current;
      const current = articleRef.current;
      if (root.directory !== oldRoot?.directory) {
        if (current && (contentRef.current !== current.content || savedSettingsRef.current !== JSON.stringify(settingsRef.current))) {
          if (!errorRef.current) markError(new Error('文章目录已在另一个窗口切换。当前草稿仍保留，请先下载草稿，再重新载入工作空间。'));
          return;
        }
        updateWorkspace(root);
        await chooseInitial(root);
        return;
      }
      updateWorkspace(root);
      if (!current) { if (root.articles.length) await chooseInitial(root); return; }
      const summary = root.articles.find((item) => item.path === current.path);
      if (!summary) {
        if (contentRef.current !== current.content) {
          if (!errorRef.current) markError(new Error('这篇文章已在目录中移走或删除。请先下载当前草稿，再重新载入。'));
        } else await chooseInitial(root);
        return;
      }
      if (summary.modifiedAt !== current.modifiedAt && !savePromise.current) {
        const updated = await api<Article>(`/article?${query({ path: current.path, directory: root.directory })}`);
        if (articleRef.current?.path !== current.path || articleRef.current.revision !== current.revision || switchingRef.current || workspaceRef.current?.directory !== root.directory) return;
        if (updated.revision !== articleRef.current.revision) {
          if (contentRef.current !== articleRef.current.content) {
            if (!errorRef.current) markError(new Error('检测到其他编辑器修改了文章。当前草稿仍保留，请先下载草稿，再重新载入文件。'));
          } else {
            const styleDraft = settingsRef.current;
            const hasStyleDraft = savedSettingsRef.current !== JSON.stringify(styleDraft);
            applyArticle(updated, root.directory);
            if (hasStyleDraft) { inheritsThemeRef.current = false; settingsRef.current = styleDraft; setSettingsState(styleDraft); }
          }
        }
      }
    } catch (error) { setConnected(false); if (reportError) notify(errorMessage(error), 'error'); }
  }, [applyArticle, chooseInitial, markError, notify, updateThemeLibrary, updateWorkspace]);

  const refresh = useCallback((reportError = false, scope: RefreshScope = 'all'): Promise<void> => {
    const queued = queuedRefresh.current;
    queuedRefresh.current = { scope: queued ? mergeScope(queued.scope, scope) : scope, reportError: reportError || Boolean(queued?.reportError) };
    if (refreshPromise.current) return refreshPromise.current;
    const promise = (async () => {
      try {
        // Keep one request batch in flight; changes arriving during it get one merged follow-up.
        while (queuedRefresh.current) {
          const next = queuedRefresh.current;
          queuedRefresh.current = null;
          await performRefresh(next.reportError, next.scope);
        }
      } finally { refreshPromise.current = null; }
    })();
    refreshPromise.current = promise;
    return promise;
  }, [performRefresh]);

  useEffect(() => {
    const events = new EventSource('/api/events');
    let opened = false, hasOpened = false, watching = false, receivedWatchStatus = false;
    let interval: number | undefined, debounce: number | undefined, scheduled: RefreshScope | null = null;
    const schedule = (scope: RefreshScope) => {
      scheduled = scheduled ? mergeScope(scheduled, scope) : scope;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        const next = scheduled;
        scheduled = null;
        if (next) void refresh(false, next);
      }, 250);
    };
    const updateFallback = () => {
      if (opened && watching) { window.clearInterval(interval); interval = undefined; }
      else if (interval === undefined) interval = window.setInterval(() => {
        if (document.visibilityState !== 'hidden') void refresh();
      }, 15000);
    };
    events.onmessage = (event) => {
      let message: { type?: string; watching?: boolean };
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'files-changed' || message.type === 'workspace-changed') schedule('workspace');
      else if (message.type === 'themes-changed') schedule('themes');
      else if (message.type === 'watch-status') {
        const recovering = receivedWatchStatus && !watching && message.watching === true;
        receivedWatchStatus = true;
        watching = message.watching === true;
        updateFallback();
        if (recovering) schedule('all');
      } else if (message.type === 'watch-error') { watching = false; updateFallback(); }
    };
    events.onopen = () => {
      opened = true; setConnected(true); updateFallback();
      if (hasOpened) schedule('all');
      hasOpened = true;
    };
    events.onerror = () => { opened = false; watching = false; setConnected(false); updateFallback(); };
    updateFallback();
    const onFocus = () => schedule('all');
    const onVisibility = () => { if (document.visibilityState !== 'hidden' && (!opened || !watching)) schedule('all'); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      events.close(); window.clearInterval(interval); window.clearTimeout(debounce);
      window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const setContent = useCallback((value: string) => { contentRef.current = value; setContentState(value); if (!errorRef.current) setSaveStatus('pending'); }, []);
  const setSettings = useCallback((value: ArticleSettings | ((previous: ArticleSettings) => ArticleSettings)) => {
    const next = typeof value === 'function' ? value(settingsRef.current) : value;
    if (JSON.stringify(next) === JSON.stringify(settingsRef.current)) return;
    inheritsThemeRef.current = false;
    settingsRef.current = next;
    setSettingsState(next);
    if (!errorRef.current) setSaveStatus('pending');
  }, []);
  useEffect(() => {
    if (!article || article.content === content || errorRef.current || switching) return;
    const timer = window.setTimeout(() => { void saveContent(); }, 900);
    return () => window.clearTimeout(timer);
  }, [content, article, saveContent, switching]);
  useEffect(() => {
    if (!article || savedSettingsRef.current === JSON.stringify(settings) || switching) return;
    const timer = window.setTimeout(() => { void saveSettings(); }, 500);
    return () => window.clearTimeout(timer);
  }, [settings, article, saveSettings, switching]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (articleRef.current && (contentRef.current !== articleRef.current.content || JSON.stringify(settingsRef.current) !== savedSettingsRef.current)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const selectArticle = useCallback(async (articlePath: string) => {
    if (switchingRef.current || articleRef.current?.path === articlePath) return;
    if (!(await flush())) { notify('请先处理保存问题，当前文章仍保留在编辑区。', 'error'); return; }
    const root = workspaceRef.current;
    if (!root) return;
    const sequence = ++loadSequence.current;
    switchingRef.current = true;
    setSwitching(true);
    try {
      const selected = await api<Article>(`/article?${query({ path: articlePath, directory: root.directory })}`);
      if (sequence === loadSequence.current) applyArticle(selected, root.directory);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { switchingRef.current = false; setSwitching(false); }
  }, [applyArticle, flush, notify]);

  const changeDirectory = useCallback(async (directory: string) => {
    if (!(await flush())) throw new Error('请先处理当前文章的保存问题，再切换目录。');
    switchingRef.current = true;
    setSwitching(true);
    try {
      const root = await api<Workspace>('/workspace', { method: 'POST', body: { directory } });
      updateWorkspace(root);
      await chooseInitial(root);
      notify('已连接文章目录');
    } finally { switchingRef.current = false; setSwitching(false); }
  }, [chooseInitial, flush, notify, updateWorkspace]);

  const createArticle = useCallback(async (name: string) => {
    if (!(await flush())) throw new Error('请先处理当前文章的保存问题。');
    const root = workspaceRef.current;
    if (!root) return;
    const filename = /\.md$/i.test(name) ? name : `${name}.md`;
    const created = await api<Article>('/articles', { method: 'POST', body: { path: filename, content: `# ${filename.replace(/\.md$/i, '')}\n\n从这里，写下你的第一句话。\n`, directory: root.directory } });
    applyArticle(created, root.directory);
    await refresh();
    notify('新文章已创建');
  }, [applyArticle, flush, notify, refresh]);

  const importArticles = useCallback(async (files: File[]) => {
    if (!(await flush())) return;
    const root = workspaceRef.current;
    if (!root) return;
    if (!files.length) return;
    if (files.length > 30 || files.some((file) => !/\.md$/i.test(file.name)) || files.reduce((size, file) => size + file.size, 0) > 5 * 1024 * 1024) { notify('请选择最多 30 篇 .md 文件，总大小不超过 5 MB。', 'error'); return; }
    try {
      const payload = await Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() })));
      const result = await api<{ articles: Article[] }>('/articles/import', { method: 'POST', body: { directory: root.directory, files: payload } });
      applyArticle(result.articles[0], root.directory);
      await refresh();
      notify(`已导入 ${result.articles.length} 篇文章`);
    } catch (error) { notify(errorMessage(error), 'error'); }
  }, [applyArticle, flush, notify, refresh]);

  const selectTheme = useCallback((theme: Theme) => {
    setSettings({ ...defaultSettings(theme), showTitle: settingsRef.current.showTitle, showMeta: settingsRef.current.showMeta, linkFootnotes: settingsRef.current.linkFootnotes });
  }, [setSettings]);

  const setDefaultTheme = useCallback(async (theme: Theme) => {
    if (savingDefaultThemeRef.current || theme.id === defaultThemeRef.current) return;
    savingDefaultThemeRef.current = true;
    setSavingDefaultThemeId(theme.id);
    try {
      const library = await api<ThemeLibrary>('/themes/default', { method: 'PUT', body: { themeId: theme.id } });
      updateThemeLibrary(library);
      notify(`已将「${theme.name}」设为默认主题`);
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { savingDefaultThemeRef.current = false; setSavingDefaultThemeId(null); }
  }, [notify, updateThemeLibrary]);

  const addTheme = useCallback(async (theme: Theme) => {
    const result = await api<{ theme: Theme }>('/themes', { method: 'POST', body: { theme } });
    updateThemes([...themesRef.current.filter((item) => item.id !== result.theme.id), result.theme]);
    selectTheme(result.theme);
    notify('主题已保存并应用到当前文章');
  }, [notify, selectTheme, updateThemes]);

  const deleteTheme = useCallback(async (theme: Theme) => {
    try {
      const library = await api<ThemeLibrary>(`/themes/${encodeURIComponent(theme.id)}`, { method: 'DELETE' });
      updateThemeLibrary(library);
      notify('已移除自定义主题');
    } catch (error) { notify(errorMessage(error), 'error'); }
  }, [notify, updateThemeLibrary]);

  const retrySave = useCallback(async () => { errorRef.current = ''; setSaveError(''); if (await flush()) notify('文章与排版设置已保存'); }, [flush, notify]);
  const reloadArticle = useCallback(async () => {
    try {
      const root = await api<Workspace>('/workspace');
      updateWorkspace(root);
      const current = articleRef.current;
      if (current && root.articles.some((item) => item.path === current.path)) applyArticle(await api<Article>(`/article?${query({ path: current.path, directory: root.directory })}`), root.directory);
      else await chooseInitial(root);
      notify('已重新载入本地文件');
    } catch (error) { notify(errorMessage(error), 'error'); }
  }, [applyArticle, chooseInitial, notify, updateWorkspace]);

  const insertGeneratedCover = useCallback((cover: GeneratedCover) => {
    if (switchingRef.current || workspaceRef.current?.directory !== cover.directory || articleRef.current?.path !== cover.articlePath) {
      throw new Error('封面已保存到原文章目录。请切回原文章后，再点击插入。');
    }
    setContent(insertCover(contentRef.current, cover.markdownPath));
  }, [setContent]);

  return { workspace, article, content, setContent, insertGeneratedCover, settings, setSettings, themes, defaultThemeId, savingDefaultThemeId, setDefaultTheme, theme: themes.find((item) => item.id === settings.themeId) || themes.find((item) => item.id === defaultThemeId) || systemDefaultTheme, loading, connected, loadError, saveStatus, saveError, switching, initialize, refresh, flush, selectArticle, changeDirectory, createArticle, importArticles, selectTheme, addTheme, deleteTheme, retrySave, reloadArticle };
}
