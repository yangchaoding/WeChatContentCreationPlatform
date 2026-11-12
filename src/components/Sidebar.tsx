import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderPlus, HelpCircle, PanelLeftClose, Plus, Search, SquarePen, Upload, X } from 'lucide-react';
import type { ArticleSummary, Workspace } from '../../shared/types';
import { compareNames } from '../../shared/name-order';

interface SidebarProps {
  workspace: Workspace | null;
  selectedPath?: string;
  connected: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  onCollapse: () => void;
  onSelect: (path: string) => void;
  onDirectory: () => void;
  onCreate: (folder?: string, directory?: string) => void;
  onCreateFolder?: (folder: string, directory: string) => void;
  onSwitchDirectory?: (directory: string) => void;
  switching?: boolean;
  onImport: (files: File[]) => void;
  onHelp: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

interface ArticleFolder {
  name: string;
  path: string;
  folders: Map<string, ArticleFolder>;
  articles: ArticleSummary[];
  count: number;
}

const createFolder = (name = '', path = ''): ArticleFolder => ({ name, path, folders: new Map(), articles: [], count: 0 });

export default function Sidebar(props: SidebarProps) {
  // Search and folder expansion belong to the current workspace.
  return <WorkspaceSidebar key={props.workspace?.directory || ''} {...props} />;
}

function WorkspaceSidebar({ workspace, selectedPath, connected, mobileOpen, onClose, onCollapse, onSelect, onDirectory, onCreate, onCreateFolder, onSwitchDirectory, switching = false, onImport, onHelp, searchRef }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(new Set());
  const [rootCollapsed, setRootCollapsed] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const tree = useMemo(() => {
    const root = createFolder();
    const addFolder = (segments: string[], articleCount = 0) => {
      let folder = root;
      folder.count += articleCount;
      for (const name of segments) {
        const path = folder.path ? `${folder.path}/${name}` : name;
        if (!folder.folders.has(name)) folder.folders.set(name, createFolder(name, path));
        folder = folder.folders.get(name)!;
        folder.count += articleCount;
      }
      return folder;
    };
    for (const directory of workspace?.directories || []) {
      if (directory.toLowerCase().includes(query)) addFolder(directory.split('/'));
    }
    for (const article of workspace?.articles || []) {
      if (`${article.name} ${article.title} ${article.path}`.toLowerCase().includes(query)) {
        addFolder(article.path.split('/').slice(0, -1), 1).articles.push(article);
      }
    }
    return root;
  }, [workspace?.articles, workspace?.directories, query]);

  useEffect(() => {
    // A restored or newly selected article must remain reachable after search.
    const parts = selectedPath?.split('/').slice(0, -1) || [];
    const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    const reveal = (previous: Set<string>) => {
      if (!ancestors.some((path) => previous.has(path))) return previous;
      return new Set([...previous].filter((path) => !ancestors.includes(path)));
    };
    setCollapsed(reveal);
    setSearchCollapsed(reveal);
  }, [selectedPath]);

  const toggleFolder = (path: string) => {
    const update = query ? setSearchCollapsed : setCollapsed;
    update((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const choose = (path: string) => { onSelect(path); onClose(); };
  const revealFolder = (path: string) => {
    setSearch('');
    setRootCollapsed(false);
    setCollapsed((previous) => new Set([...previous].filter((entry) => entry !== path && !path.startsWith(`${entry}/`))));
  };
  const folderActions = (folder: string, directory: string, name: string) => <div className="folder-actions">
    {onCreateFolder && <button className="icon-button" title={`在「${name}」中新建子文件夹`} aria-label={`在「${name}」中新建子文件夹`} disabled={switching} onClick={() => { revealFolder(folder); onCreateFolder(folder, directory); }}><FolderPlus size={15} /></button>}
    <button className="icon-button" title={`在「${name}」中新建文章`} aria-label={`在「${name}」中新建文章`} disabled={switching} onClick={() => { revealFolder(folder); onCreate(folder, directory); }}><SquarePen size={15} /></button>
  </div>;
  const renderFolder = (folder: ArticleFolder, depth = 0): React.ReactNode => <ul className="article-tree">
    {folder.count === 0 && folder.folders.size === 0 && <li className="folder-empty" style={{ paddingLeft: 11 + Math.min(depth, 6) * 12 }}>暂无 .md 文章</li>}
    {[...folder.folders.values()].sort((a, b) => compareNames(a.name, b.name)).map((child) => {
      const expanded = !(query ? searchCollapsed : collapsed).has(child.path);
      return <li className="article-folder" key={child.path}>
        <button className="folder-heading" style={{ paddingLeft: 9 + Math.min(depth, 6) * 12 }} onClick={() => toggleFolder(child.path)} title={child.path} aria-label={child.name} aria-expanded={expanded}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{expanded ? <FolderOpen size={14} /> : <Folder size={14} />}<span>{child.name}</span><small>{child.count}</small>
        </button>
        {workspace && folderActions(child.path, workspace.directory, child.name)}
        {expanded && renderFolder(child, depth + 1)}
      </li>;
    })}
    {[...folder.articles].sort((a, b) => compareNames(a.name, b.name)).map((article) => <li key={article.path}>
      <button className={`article-item ${selectedPath === article.path ? 'active' : ''} ${depth ? 'in-folder' : ''}`} style={{ paddingLeft: 11 + Math.min(depth, 6) * 12 }} onClick={() => choose(article.path)} title={article.path} aria-current={selectedPath === article.path ? 'page' : undefined}><FileText size={16} strokeWidth={1.55} /><span><strong>{article.name.replace(/\.md$/i, '')}</strong><small>Markdown<span> · </span>{new Date(article.modifiedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</small></span>{selectedPath === article.path && <span className="active-file-dot" />}</button>
    </li>)}
  </ul>;
  return <>
    {mobileOpen && <button className="sidebar-scrim" onClick={onClose} aria-label="收起文章库" />}
    <aside id="workspace-sidebar" className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="工作空间">
      <div className="brand"><img src="/favicon.svg" alt="" /><span className="brand-name">墨排<span className="brand-roman">MOPAI</span></span><span className="brand-badge">创作，从容一点</span><button className="icon-button sidebar-collapse" onClick={onCollapse} title="收起工作空间" aria-label="收起工作空间" aria-controls="workspace-sidebar" aria-expanded="true"><PanelLeftClose size={18} /></button><button className="icon-button mobile-close" onClick={onClose} aria-label="关闭文章库"><X size={18} /></button></div>
      <div className="workspace-label"><span>我的工作空间</span><span className="tiny-label">LOCAL</span></div>
      <button className="add-workspace-button" onClick={onDirectory} disabled={switching}><FolderPlus size={17} /><span>添加文件夹</span><Plus size={15} /></button>
      <div className="search-field"><Search size={15} /><input ref={searchRef} value={search} onChange={(event) => { setSearch(event.target.value); setSearchCollapsed(new Set()); }} placeholder="搜索当前文件夹…" aria-label="搜索文章" /><kbd>Ctrl K</kbd></div>
      <div className="workspace-list-label"><span>文件夹</span><small>{workspace?.folders?.length || (workspace ? 1 : 0)}</small></div>
      <nav className="article-list" aria-label="文章列表">
        {(workspace?.folders || (workspace ? [{ directory: workspace.directory, name: workspace.name }] : [])).map((entry) => {
          const active = entry.directory === workspace?.directory;
          const expanded = active && (!rootCollapsed || Boolean(query));
          return <section className={`workspace-group ${active ? 'is-active' : ''}`} key={entry.directory}>
            <div className="workspace-folder-row">
              <button className="workspace-heading" title={entry.directory} aria-label={entry.name} aria-expanded={expanded} disabled={switching} onClick={() => active ? setRootCollapsed(!rootCollapsed) : onSwitchDirectory?.(entry.directory)}>
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{expanded ? <FolderOpen size={16} /> : <Folder size={16} />}<span>{entry.name}</span>
              </button>
              {folderActions('', entry.directory, entry.name)}
            </div>
            {expanded && (tree.count === 0 && tree.folders.size === 0 ? <div className="list-empty"><FileText size={23} strokeWidth={1.3} /><span>{query ? '没有找到相关文章' : '从第一篇文章开始'}</span><small>{query ? '试试其他关键词' : '点击文件夹右侧的按钮新建文章'}</small></div> : renderFolder(tree))}
          </section>;
        })}
        {!workspace && <div className="list-empty"><FolderOpen size={25} /><span>添加文件夹，开始创作</span></div>}
      </nav>
      <div className="sidebar-actions"><button className="subtle-button" onClick={() => upload.current?.click()} disabled={!workspace}><Upload size={15} /> 导入 Markdown <Plus size={14} /></button><input type="file" multiple accept=".md,text/markdown" ref={upload} hidden onChange={(event) => { onImport(Array.from(event.target.files || [])); event.target.value = ''; }} /></div>
      <div className="sidebar-bottom"><span className={`connection-dot ${connected ? '' : 'offline'}`} /><span>{connected ? '本地文件 · 自动同步' : '正在连接本地服务'}</span><button className="icon-button" title="使用指南" aria-label="使用指南" onClick={onHelp}><HelpCircle size={16} /></button></div>
    </aside>
  </>;
}
