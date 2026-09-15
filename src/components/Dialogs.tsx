import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, ClipboardCheck, Code2, FileCode2, FileText, Folder, FolderOpen, Globe, HardDrive, Info, Link2, LoaderCircle, Plus, Search, Sparkles, Upload } from 'lucide-react';
import type { DirectoryListing, Theme } from '../../shared/types';
import { api, errorMessage, query } from '../lib/api';
import Modal from './Modal';
import { ThemeThumbnail } from './ThemePanel';

export function DirectoryDialog({ directory, onSelect, onClose }: { directory: string; onSelect: (directory: string) => Promise<void>; onClose: () => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [input, setInput] = useState(directory);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);
  const browse = async (target: string) => {
    const request = ++requestNumber.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<DirectoryListing>(`/directories?${query({ path: target })}`);
      if (request !== requestNumber.current) return;
      setListing(result);
      setInput(result.path);
    } catch (failure) { if (request === requestNumber.current) setError(errorMessage(failure)); }
    finally { if (request === requestNumber.current) setLoading(false); }
  };
  useEffect(() => { void browse(directory); }, [directory]);
  const select = async () => { setSaving(true); setError(''); try { await onSelect(input.trim()); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setSaving(false); } };
  return <Modal title="连接你的文章目录" subtitle="把文章放进文件夹，剩下的交给墨排。" onClose={onClose} busy={saving} wide footer={<><span className="footer-hint"><HardDrive size={14} /> 文件始终保存在你的电脑上</span><button className="button button-secondary" onClick={onClose} disabled={saving}>取消</button><button className="button button-primary" onClick={() => void select()} disabled={saving || !input.trim()}>{saving ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />} 使用此目录</button></>}>
    <form className="directory-path" onSubmit={(event) => { event.preventDefault(); void browse(input); }}><Folder size={17} /><input aria-label="本地目录路径" value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入完整的本地目录路径" data-autofocus /><button className="button button-secondary" type="submit" disabled={loading}><ArrowRight size={15} /> 前往</button></form>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="directory-browser"><div className="directory-bookmarks"><span>快速访问</span>{listing?.bookmarks.map((bookmark) => <button key={bookmark.name} className={listing.path === bookmark.path ? 'active' : ''} onClick={() => void browse(bookmark.path)}><Folder size={15} />{bookmark.name}</button>)}</div><div className="directory-contents"><div className="directory-toolbar"><button className="text-button" disabled={!listing?.parent || loading} onClick={() => listing?.parent && void browse(listing.parent)}><ArrowLeft size={14} /> 上一级</button><small>{listing?.directories.length || 0} 个文件夹</small></div><div className="directory-list">{loading ? <div className="loading-placeholder"><LoaderCircle size={24} className="spin" /><span>正在读取目录…</span></div> : listing?.directories.length ? listing.directories.map((child) => <button key={child.path} onClick={() => void browse(child.path)}><Folder size={18} /><span>{child.name}</span><ChevronRight size={14} /></button>) : <div className="directory-empty"><FolderOpen size={28} strokeWidth={1.4} /><p>没有子文件夹</p><small>可以直接使用当前目录</small></div>}</div></div></div>
    <div className="quiet-note"><Info size={15} /><span>会自动读取这个目录及子文件夹里的 .md 文章。修改文章时，会同步保存到原文件。</span></div>
  </Modal>;
}

export function NewArticleDialog({ directory, onCreate, onClose }: { directory: string; onCreate: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => { if (!name.trim()) return; setBusy(true); setError(''); try { await onCreate(name.trim()); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } };
  return <Modal title="新的一页，新的灵感" subtitle="好文章，从一个名字开始。" onClose={onClose} busy={busy} footer={<><button className="button button-secondary" onClick={onClose} disabled={busy}>取消</button><button className="button button-primary" disabled={!name.trim() || busy} onClick={() => void create()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} 创建文章</button></>}>
    <form onSubmit={(event) => { event.preventDefault(); void create(); }}><label className="field-label" htmlFor="article-name">文章名称</label><div className="filename-field"><FileText size={17} /><input id="article-name" data-autofocus value={name} onChange={(event) => setName(event.target.value)} placeholder="给这次创作起个名字" maxLength={100} /><span>.md</span></div><p className="field-help">保存在 <span className="path-text">{directory}</span></p></form>{error && <div className="inline-error" role="alert">{error}</div>}
  </Modal>;
}

export function ExtractDialog({ onApply, onClose }: { onApply: (theme: Theme) => Promise<void>; onClose: () => void }) {
  const [tab, setTab] = useState<'url' | 'html'>('url');
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Theme | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const extract = async () => {
    if ((tab === 'url' && !url.trim()) || (tab === 'html' && !html.trim())) return;
    setBusy(true);
    setError('');
    controller.current = new AbortController();
    try {
      const response = await api<{ theme: Theme }>('/themes/extract', { method: 'POST', body: tab === 'url' ? { url: url.trim() } : { html }, signal: controller.current.signal });
      setResult(response.theme);
    } catch (failure) { if ((failure as Error).name !== 'AbortError') setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    if (!/\.html?$/i.test(file.name) || file.size > 4 * 1024 * 1024) { setError('请选择不超过 4 MB 的 .html 或 .htm 文件。'); return; }
    setHtml(await file.text());
    setFileName(file.name);
    setError('');
  };
  const apply = async () => { if (!result) return; setSaving(true); setError(''); try { await onApply(result); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setSaving(false); } };
  const roleNames: Record<string, string> = { body: '整体风格', p: '正文', h1: '大标题', h2: '章节标题', h3: '小标题', strong: '强调文字', blockquote: '引用', a: '链接', ul: '列表', ol: '有序列表', pre: '代码块', code: '代码', table: '表格' };
  return <Modal title={result ? '把这份风格，收入你的灵感库' : '喜欢的排版，也可以属于你'} subtitle={result ? '为提取的主题起个名字，下一篇文章就能用。' : '从公众号文章中提取颜色、字体和段落样式。'} onClose={onClose} busy={saving} wide footer={result ? <><button className="text-button footer-back" onClick={() => { setResult(null); setError(''); }} disabled={saving}><ArrowLeft size={14} /> 重新提取</button><button className="button button-primary" onClick={() => void apply()} disabled={saving || !result.name.trim()}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} 保存并应用</button></> : <><span className="footer-hint"><Sparkles size={14} /> 让灵感，变成下一次创作</span><button className="button button-primary" onClick={() => void extract()} disabled={busy || (tab === 'url' ? !url.trim() : !html.trim())}>{busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{busy ? '正在提取…' : '提取主题'}</button></>}>
    {result ? <><div className="extraction-result"><ThemeThumbnail theme={result} large /><div className="extraction-details"><span className="success-eyebrow"><Check size={14} /> 已识别文章排版</span><label className="field-label" htmlFor="theme-name">主题名称</label><input id="theme-name" className="text-input" value={result.name} onChange={(event) => setResult({ ...result, name: event.target.value })} maxLength={24} /><p className="source-title" title={result.sourceTitle}>来源：{result.sourceTitle}</p><div className="extraction-palette"><span style={{ backgroundColor: result.accent }} /><span style={{ backgroundColor: result.ink }} /><span style={{ backgroundColor: result.soft }} /><small>{result.fontSize} px · {result.lineHeight} 倍行距</small></div></div></div><div className="detected-roles">{result.extraction?.detectedRoles.filter((role) => roleNames[role]).map((role) => <span key={role}><Check size={11} /> {roleNames[role]}</span>)}</div>{result.extraction?.notes.map((note) => <p className="extraction-note" key={note}><Info size={14} />{note}</p>)}</> : <>
      <div className="source-tabs" role="tablist" aria-label="主题来源"><button role="tab" aria-selected={tab === 'url'} className={tab === 'url' ? 'active' : ''} onClick={() => { setTab('url'); setError(''); }} disabled={busy}><Link2 size={16} /> 公众号链接</button><button role="tab" aria-selected={tab === 'html'} className={tab === 'html' ? 'active' : ''} onClick={() => { setTab('html'); setError(''); }} disabled={busy}><FileCode2 size={16} /> 导入网页</button></div>
      {tab === 'url' ? <><label className="field-label" htmlFor="wechat-url">公众号文章链接</label><div className="url-field"><Link2 size={17} /><input id="wechat-url" data-autofocus placeholder="https://mp.weixin.qq.com/s/…" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} onKeyDown={(event) => { if (event.key === 'Enter') void extract(); }} /></div><p className="field-help">打开喜欢的公众号文章，复制链接后粘贴到这里。</p><div className="extract-explainer"><span><span>01</span><Link2 size={17} /> 粘贴文章链接</span><ChevronRight size={13} /><span><span>02</span><Sparkles size={17} /> 识别排版风格</span><ChevronRight size={13} /><span><span>03</span><Check size={17} /> 应用到你的文章</span></div></> : <><button className={`html-upload ${fileName ? 'has-file' : ''}`} onClick={() => upload.current?.click()} disabled={busy}><span>{fileName ? <FileCode2 size={26} /> : <Upload size={26} />}</span><strong>{fileName || '选择保存的文章网页'}</strong><small>{fileName ? '点击更换文件' : '支持 .html / .htm，最大 4 MB'}</small></button><input ref={upload} hidden type="file" accept=".html,.htm,text/html" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ''; }} /><details className="html-paste"><summary>也可以直接粘贴正文 HTML</summary><textarea aria-label="正文 HTML" placeholder={'<section style="color: #28775b; font-size: 16px;">…</section>'} value={html} onChange={(event) => { setHtml(event.target.value); setFileName(''); }} disabled={busy} /></details><p className="field-help">浏览器中打开文章，按 Ctrl + S 选择「网页，全部」保存，再导入 HTML 文件。</p></>}
      {busy && <div className="extract-progress"><LoaderCircle className="spin" size={17} /><span>{tab === 'url' ? '正在读取文章与正文样式，通常需要几秒钟…' : '正在分析网页中的排版样式…'}</span></div>}
      {tab === 'url' && !busy && <div className="quiet-note"><Info size={15} /><span>部分文章可能需要微信验证。遇到这种情况，可以在浏览器保存网页，再使用「导入网页」。</span></div>}
    </>}
    {error && <div className="inline-error" role="alert">{error}{tab === 'url' && !result && <button className="text-button" onClick={() => { setTab('html'); setError(''); }}>改用导入网页 <ArrowRight size={13} /></button>}</div>}
  </Modal>;
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return <Modal title="从好内容，到好看的公众号" subtitle="专注写作，排版交给墨排。" onClose={onClose} wide footer={<button className="button button-primary" onClick={onClose}>开始创作 <ArrowRight size={15} /></button>}>
    <div className="help-steps"><div><span className="help-step-icon"><FolderOpen size={23} /></span><h3>01 · 连接文章</h3><p>选择放置 .md 文章的本地目录。新增文件会自动出现，也可以直接新建或导入文章。</p></div><div><span className="help-step-icon"><Sparkles size={23} /></span><h3>02 · 找到风格</h3><p>选择主题，微调字号、行距和颜色。每篇文章的排版设置都会自动保存。</p></div><div><span className="help-step-icon"><ClipboardCheck size={23} /></span><h3>03 · 一键复制</h3><p>点击「复制到公众号」，然后在公众号后台的图文正文编辑区按 Ctrl + V 粘贴。</p></div></div>
    <div className="help-details"><h3>让发布更顺利的几个小细节</h3><p><strong>本地图片</strong> 可以在墨排预览，粘贴后请在公众号中单独上传并确认位置。公众号也可能对远程图片做防盗链处理。</p><p><strong>文章链接</strong> 可能受公众号外链规则限制。在「样式微调」开启「文末附上外链」，可保留完整的参考地址。</p><p><strong>主题提取</strong> 复用正文可识别的颜色、字体与样式。装饰图片、动态效果、外部 CSS 不会被提取；复杂布局与原文可能略有差异。</p><p><strong>本地保存</strong> 编辑会自动写回原文件。遇到外部修改冲突时，请先下载当前草稿，再重载文件。</p></div>
    <div className="shortcuts"><span><kbd>Ctrl / ⌘</kbd><kbd>S</kbd> 保存文章</span><span><kbd>Ctrl / ⌘</kbd><kbd>K</kbd> 搜索文章</span></div>
  </Modal>;
}
