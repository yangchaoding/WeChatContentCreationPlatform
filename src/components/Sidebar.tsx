import { useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderSync, HelpCircle, Plus, Search, Sparkles, Upload, X } from 'lucide-react';
import type { ArticleSummary, Workspace } from '../../shared/types';

interface SidebarProps {
  workspace: Workspace | null;
  selectedPath?: string;
  connected: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  onDirectory: () => void;
  onCreate: () => void;
  onImport: (files: File[]) => void;
  onHelp: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

export default function Sidebar({ workspace, selectedPath, connected, mobileOpen, onClose, onSelect, onDirectory, onCreate, onImport, onHelp, searchRef }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const upload = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => {
    const result = new Map<string, ArticleSummary[]>();
    const articles = workspace?.articles.filter((article) => `${article.name} ${article.title} ${article.path}`.toLowerCase().includes(search.toLowerCase())) || [];
    for (const article of articles) {
      const folder = article.path.includes('/') ? article.path.split('/').slice(0, -1).join(' / ') : '';
      result.set(folder, [...(result.get(folder) || []), article]);
    }
    return [...result].sort(([a], [b]) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'zh-CN'));
  }, [workspace, search]);
  const choose = (path: string) => { onSelect(path); onClose(); };
  return <>
    {mobileOpen && <button className="sidebar-scrim" onClick={onClose} aria-label="收起文章库" />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><img src="/favicon.svg" alt="" /><span className="brand-name">墨排<span className="brand-roman">MOPAI</span></span><span className="brand-badge">创作，从容一点</span><button className="icon-button mobile-close" onClick={onClose} aria-label="关闭文章库"><X size={18} /></button></div>
      <div className="workspace-label"><span>我的工作空间</span><span className="tiny-label">LOCAL</span></div>
      <button className="workspace-switch" onClick={onDirectory} title={workspace?.directory || '连接文章目录'}><span className="folder-tile"><FolderOpen size={19} strokeWidth={1.6} /></span><span className="workspace-name"><strong>{workspace?.name === 'articles' ? '我的文章' : workspace?.name || '选择文章目录'}</strong><small>本地 Markdown 文件夹</small></span><ChevronDown size={14} /></button>
      <div className="library-heading"><span><Folder size={16} /> 文章库 <span className="count-badge">{workspace?.articles.length || 0}</span></span><button className="icon-button" title="新建文章" aria-label="新建文章" onClick={onCreate} disabled={!workspace}><Plus size={18} /></button></div>
      <div className="search-field"><Search size={15} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文章…" aria-label="搜索文章" /><kbd>⌘ K</kbd></div>
      <nav className="article-list" aria-label="文章列表">
        {groups.length === 0 && <div className="list-empty"><FileText size={25} strokeWidth={1.3} /><span>{search ? '没有找到相关文章' : '从第一篇文章开始'}</span><small>{search ? '试试其他关键词' : '放入 .md 文件，灵感就位'}</small></div>}
        {groups.map(([folder, articles]) => <div className="article-group" key={folder}>
          {folder && <button className="folder-heading" onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(folder)) next.delete(folder); else next.add(folder); return next; })} aria-expanded={!collapsed.has(folder)}>{collapsed.has(folder) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<Folder size={14} /><span>{folder}</span><small>{articles.length}</small></button>}
          {(!collapsed.has(folder) || search) && articles.map((article) => <button key={article.path} className={`article-item ${selectedPath === article.path ? 'active' : ''} ${folder ? 'in-folder' : ''}`} onClick={() => choose(article.path)} title={article.path} aria-current={selectedPath === article.path ? 'page' : undefined}><FileText size={16} strokeWidth={1.55} /><span><strong>{article.name.replace(/\.md$/i, '')}</strong><small>Markdown<span> · </span>{new Date(article.modifiedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</small></span>{selectedPath === article.path && <span className="active-file-dot" />}</button>)}
        </div>)}
      </nav>
      <div className="sidebar-actions"><button className="subtle-button" onClick={() => upload.current?.click()} disabled={!workspace}><Upload size={15} /> 导入 Markdown <Plus size={14} /></button><input type="file" multiple accept=".md,text/markdown" ref={upload} hidden onChange={(event) => { onImport(Array.from(event.target.files || [])); event.target.value = ''; }} /></div>
      <button className="sidebar-tip" onClick={onHelp}><span className="tip-mark"><Sparkles size={17} strokeWidth={1.5} /><span>让好内容，有好看的样子。</span></span><span className="tip-bottom">一点排版灵感，刚刚好 <ArrowUpRight size={14} /></span><span className="tip-decoration" aria-hidden="true">Aa</span></button>
      <div className="sidebar-bottom"><span className={`connection-dot ${connected ? '' : 'offline'}`} /><span>{connected ? '本地文件 · 自动同步' : '正在连接本地服务'}</span><button className="icon-button" title="使用指南" aria-label="使用指南" onClick={onHelp}><HelpCircle size={16} /></button></div>
    </aside>
  </>;
}
