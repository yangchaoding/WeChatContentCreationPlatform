import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clipboard, Code2, Copy, Download, Eye, FileText, FolderOpen, LayoutDashboard, LoaderCircle, Menu, Monitor, MoreHorizontal, PanelLeft, PanelLeftClose, PanelRight, PanelsTopLeft, Plus, RefreshCw, Save, ShieldCheck, Smartphone, Sparkles, SquarePen, UploadCloud, X } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ThemePanel from './components/ThemePanel';
import Editor from './components/Editor';
import Modal from './components/Modal';
import { DirectoryDialog, ExtractDialog, HelpDialog, NewArticleDialog } from './components/Dialogs';
import { useWorkbench } from './hooks/useWorkbench';
import { articleTitle, wordCount } from '../shared/document';
import type { Theme } from '../shared/types';
import { copyRichText, downloadFile, exportHtml, renderMarkdown } from './lib/render';
import { errorMessage } from './lib/api';

interface Toast { id: number; message: string; kind: 'success' | 'error' | 'info' }
type View = 'edit' | 'split' | 'preview';
type Dialog = 'directory' | 'new' | 'extract' | 'help' | null;

export default function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((previous) => [...previous.slice(-2), { id, message, kind }]);
    window.setTimeout(() => setToasts((previous) => previous.filter((toast) => toast.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);
  const workbench = useWorkbench(notify);
  const { workspace, article, content, setContent, settings, theme, themes } = workbench;
  const [view, setView] = useState<View>('preview');
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Theme | null>(null);
  const [previewWidth, setPreviewWidth] = useState(390);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const dragCount = useRef(0);
  const deferredContent = useDeferredValue(content);
  const rendered = useMemo(() => renderMarkdown(deferredContent, theme, settings, { filename: article?.name, articlePath: article?.path, directory: workspace?.directory }), [deferredContent, theme, settings, article?.name, article?.path, workspace?.directory]);
  const title = useMemo(() => articleTitle(content, article?.name || '开始你的创作'), [content, article?.name]);
  const words = useMemo(() => wordCount(deferredContent), [deferredContent]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.scrollTop = 0;
  }, [article?.path, workspace?.directory]);
  useEffect(() => {
    if (!paperRef.current) return;
    const observer = new ResizeObserver(([entry]) => setPreviewWidth(Math.round(entry.contentRect.width)));
    observer.observe(paperRef.current);
    return () => observer.disconnect();
  }, [view, article?.path, workbench.loading]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!dialog) void workbench.retrySave(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !dialog) { event.preventDefault(); setSidebarOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); }
      if (event.key === 'Escape') { setExportMenu(false); setSidebarOpen(false); setThemesOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dialog, workbench.retrySave]);
  useEffect(() => {
    if (!exportMenu) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setExportMenu(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [exportMenu]);

  const copy = async () => {
    if (!article || copying) return;
    setCopying(true);
    try {
      const current = renderMarkdown(content, theme, settings, { filename: article.name, articlePath: article.path, directory: workspace?.directory });
      await copyRichText(current);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
      notify(current.localImages ? `已复制排版。文中 ${current.localImages} 张本地图片请在公众号后台上传。` : '排版已复制，去公众号正文编辑区粘贴吧。');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { setCopying(false); }
  };
  const exportCurrent = () => {
    exportHtml(renderMarkdown(content, theme, settings, { filename: article?.name, articlePath: article?.path, directory: workspace?.directory }));
    setExportMenu(false);
    notify('已导出包含排版样式的 HTML');
  };
  const downloadDraft = () => { downloadFile(content, article?.name || `${title}.md`); setExportMenu(false); };
  const showDialog = (value: Dialog) => { setDialog(value); setSidebarOpen(false); setThemesOpen(false); };
  const closeDialog = () => setDialog(null);
  const viewOptions: { id: View; label: string; icon: typeof Eye }[] = [{ id: 'edit', label: '编辑', icon: Code2 }, { id: 'split', label: '双栏', icon: PanelsTopLeft }, { id: 'preview', label: '预览', icon: Eye }];

  return <div className="app-shell" onDragEnter={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dragCount.current++; setDragging(true); } }} onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }} onDragLeave={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) { dragCount.current--; if (dragCount.current <= 0) setDragging(false); } }} onDrop={(event) => { event.preventDefault(); setDragging(false); dragCount.current = 0; if (event.dataTransfer.files.length) void workbench.importArticles(Array.from(event.dataTransfer.files)); }}>
    <Sidebar workspace={workspace} selectedPath={article?.path} connected={workbench.connected} mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onSelect={(path) => void workbench.selectArticle(path)} onDirectory={() => showDialog('directory')} onCreate={() => showDialog('new')} onImport={(files) => void workbench.importArticles(files)} onHelp={() => showDialog('help')} searchRef={searchRef} />
    <div className="app-main"><header className="topbar"><div className="breadcrumbs"><button className="icon-button library-toggle" onClick={() => setSidebarOpen(true)} aria-label="打开文章库"><PanelLeft size={19} /></button><LayoutDashboard size={15} /><span>工作空间</span><ChevronRight size={13} /><strong>文章排版</strong></div><span className="topbar-motto">让文字，自成风格<span>✧</span></span><div className="topbar-end"><span className="local-badge"><span /> 本地工作台</span><button className="icon-button" title="使用指南" aria-label="打开使用指南" onClick={() => showDialog('help')}><CircleHelp size={18} strokeWidth={1.5} /></button><span className="user-avatar" aria-hidden="true">墨</span></div></header>
      <div className="content-layout"><main className="workbench">
        <div className="document-header"><div className="document-heading"><div className="document-heading-line"><span className="document-icon"><FileText size={18} strokeWidth={1.5} /></span><h1 title={title}>{article ? title : '让好内容，从这里开始'}</h1></div><div className="document-subline"><span>{article?.path || '你的 Markdown 创作空间'}</span>{article && <><i /> <span className={`save-state state-${workbench.saveStatus}`}>{workbench.saveStatus === 'saving' ? <LoaderCircle size={11} className="spin" /> : workbench.saveStatus === 'saved' ? <CheckCheck size={12} /> : workbench.saveStatus === 'error' ? <span className="error-dot" /> : <span className="pending-dot" />}{({ saved: '已自动保存', pending: '等待保存', saving: '正在保存', error: '保存遇到问题' })[workbench.saveStatus]}</span></>}</div></div>
          <div className="document-actions"><div className="export-control" ref={menuRef}><button className="button export-button" aria-label="导出文章" aria-expanded={exportMenu} disabled={!article} onClick={() => setExportMenu(!exportMenu)}><Download size={16} /><span>导出</span><ChevronDown size={12} /></button>{exportMenu && <div className="dropdown-menu" role="menu"><button role="menuitem" onClick={exportCurrent}><Code2 size={15} /><span>导出排版 HTML<small>保留文章的完整样式</small></span></button><button role="menuitem" onClick={downloadDraft}><FileText size={15} /><span>下载 Markdown<small>保留原始文字与标记</small></span></button></div>}</div><button className={`button button-primary copy-button ${copied ? 'copied' : ''}`} onClick={() => void copy()} disabled={!article || copying} aria-label="复制到公众号">{copying ? <LoaderCircle size={16} className="spin" /> : copied ? <Check size={16} /> : <Copy size={16} />}<span>{copied ? '复制成功' : '复制到公众号'}</span></button></div>
        </div>
        <div className="view-toolbar"><div className="view-tabs" role="tablist" aria-label="编辑视图">{viewOptions.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={14} />{label}</button>)}</div><div className="view-toolbar-end"><span className="current-theme"><span style={{ background: settings.accent }} />{theme.name}</span><button className="icon-button refresh-button" title="同步本地文件" aria-label="同步本地文件" onClick={() => void workbench.refresh(true)}><RefreshCw size={14} /></button><span className="toolbar-divider" /><button className="theme-toggle text-button" onClick={() => setThemesOpen(true)}><Sparkles size={14} /> 排版主题</button><span className="live-preview-label"><span /> 实时预览</span></div></div>
        {workbench.saveError && <div className="save-error-banner" role="alert"><span>{workbench.saveError}</span><div><button onClick={() => void workbench.retrySave()}>重试保存</button><button onClick={() => { downloadDraft(); void workbench.reloadArticle(); }}>下载草稿并重载</button></div></div>}
        {workbench.loading ? <div className="workbench-loading"><span className="loading-logo"><img src="/favicon.svg" alt="" /></span><h2>为你的文字，准备一个好地方</h2><p><LoaderCircle size={15} className="spin" /> 正在读取本地文章…</p></div> : workbench.loadError ? <div className="empty-workbench"><span className="empty-illustration"><FolderOpen size={36} strokeWidth={1.2} /></span><h2>还没有连上本地工作台</h2><p>{workbench.loadError}</p><button className="button button-primary" onClick={() => void workbench.initialize()}><RefreshCw size={15} />重新连接</button></div> : !article ? <div className="empty-workbench"><span className="empty-eyebrow">A LITTLE SPACE FOR BIG IDEAS</span><span className="empty-illustration"><SquarePen size={37} strokeWidth={1.1} /><Sparkles size={18} /></span><h2>每个好故事，都从这里开始。</h2><p>新建一篇文章，或把 Markdown 文件放进当前目录。<br />让灵感有处安放，让文字自成风格。</p><div><button className="button button-primary" onClick={() => showDialog('new')}><Plus size={16} /> 写第一篇文章</button><button className="button button-secondary" onClick={() => showDialog('directory')}><FolderOpen size={16} /> 连接已有目录</button></div></div> : <div className={`writing-area view-${view} ${workbench.switching ? 'is-switching' : ''}`}>
          {view !== 'preview' && <Editor key={`${workspace?.directory}:${article.path}`} value={content} onChange={setContent} filename={article.name} disabled={workbench.switching} />}
          {view !== 'edit' && <section className="preview-panel"><div className="preview-toolbar"><span className="preview-caption"><Eye size={13} />文章预览</span><div className="device-switch" role="group" aria-label="预览设备"><button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')} aria-pressed={device === 'mobile'} aria-label="手机预览"><Smartphone size={13} /><span>手机</span></button><button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')} aria-pressed={device === 'desktop'} aria-label="桌面预览"><Monitor size={13} /><span>桌面</span></button></div><span className="preview-dimension">{previewWidth} <span>px</span></span></div><div className="preview-canvas" ref={previewRef}><div className={`article-paper device-${device}`} ref={paperRef}><div className="paper-topline"><span /><span /><span /><i /></div><div className="rendered-article" role="region" aria-label="文章预览内容" dangerouslySetInnerHTML={{ __html: rendered.html }} /><div className="paper-end"><span /><i>✧</i><span /></div></div><div className="preview-end-note"><span /> 每一个好想法，都值得被好好呈现 <span /></div></div></section>}
        </div>}
        <footer className="statusbar"><div><span><AlignLeft size={12} /> {words.toLocaleString()} 字</span><i /><span>约 {Math.max(1, Math.ceil(words / 350))} 分钟阅读</span>{workspace?.truncated && <span className="status-warning">部分大文件或深层目录未载入</span>}</div><div>{rendered.localImages > 0 ? <span className="status-warning">{rendered.localImages} 张本地图片需在公众号上传</span> : <span className="wechat-ready"><ShieldCheck size={12} /> 为公众号阅读而设计</span>}<span className="status-version">MOPAI 1.0</span></div></footer>
      </main><ThemePanel themes={themes} selected={theme} settings={settings} onSelect={workbench.selectTheme} onSettings={workbench.setSettings} onExtract={() => showDialog('extract')} onDelete={setPendingDelete} mobileOpen={themesOpen} onClose={() => setThemesOpen(false)} /></div>
    </div>
    {dialog === 'directory' && <DirectoryDialog directory={workspace?.directory || ''} onSelect={workbench.changeDirectory} onClose={closeDialog} />}
    {dialog === 'new' && <NewArticleDialog directory={workspace?.directory || ''} onCreate={async (name) => { await workbench.createArticle(name); setView('split'); }} onClose={closeDialog} />}
    {dialog === 'extract' && <ExtractDialog onApply={workbench.addTheme} onClose={closeDialog} />}
    {dialog === 'help' && <HelpDialog onClose={closeDialog} />}
    {pendingDelete && <Modal title={`移除「${pendingDelete.name}」？`} subtitle="移除后，可以从原文再次提取这个主题。" onClose={() => setPendingDelete(null)} footer={<><button className="button button-secondary" onClick={() => setPendingDelete(null)}>保留主题</button><button className="button button-danger" onClick={() => { void workbench.deleteTheme(pendingDelete); setPendingDelete(null); }}>移除主题</button></>}><p className="delete-explanation">已经保存的 Markdown 文章会保留。使用此主题的文章下次打开时，会恢复到默认主题。</p></Modal>}
    {dragging && <div className="drop-overlay"><div><UploadCloud size={40} strokeWidth={1.3} /><h2>把灵感，放到这里</h2><p>松开鼠标，导入 Markdown 文章</p></div></div>}
    <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className={`toast toast-${toast.kind}`} key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.kind === 'error' ? <CircleHelp size={17} /> : toast.kind === 'info' ? <Sparkles size={17} /> : <Check size={17} />}<span>{toast.message}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToasts((previous) => previous.filter((item) => item.id !== toast.id))}><X size={14} /></button></div>)}</div>
  </div>;
}
