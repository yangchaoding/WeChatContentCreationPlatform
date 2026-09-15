import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowRight, Check, ChevronDown, Heart, Link2, Minus, Plus, RotateCcw, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { defaultSettings } from '../../shared/themes';
import type { ArticleSettings, Theme } from '../../shared/types';

export function ThemeThumbnail({ theme, large = false }: { theme: Theme; large?: boolean }) {
  return <div className={`theme-thumbnail thumb-${theme.headingStyle} ${large ? 'thumb-large' : ''}`} style={{ '--thumb-accent': theme.accent, '--thumb-soft': theme.soft, '--thumb-ink': theme.ink, fontFamily: theme.font === 'serif' ? '"Noto Serif SC", "SimSun", Georgia, serif' : 'inherit' } as CSSProperties} aria-hidden="true">
    <span className="thumb-eyebrow">THE ART OF WORDS</span><strong className="thumb-title">让文字，自成风格</strong><span className="thumb-line" /><span className="thumb-line short" /><span className="thumb-heading">留一点美好，给日常</span><span className="thumb-line" /><span className="thumb-line medium" /><span className="thumb-quote"><i />把喜欢的生活，写进文字里。</span><span className="thumb-line" /><span className="thumb-line short" />
  </div>;
}

function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: () => void; label: string; description?: string }) {
  return <div className="switch-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><button className={`switch ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span /></button></div>;
}

export default function ThemePanel({ themes, selected, settings, onSelect, onSettings, onExtract, onDelete, mobileOpen, onClose }: { themes: Theme[]; selected: Theme; settings: ArticleSettings; onSelect: (theme: Theme) => void; onSettings: (settings: ArticleSettings) => void; onExtract: () => void; onDelete: (theme: Theme) => void; mobileOpen: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'themes' | 'settings'>('themes');
  const [filter, setFilter] = useState<'all' | 'custom' | 'favorite'>('all');
  const [favorites, setFavorites] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem('mopai:favorites') || '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } });
  const toggleFavorite = (id: string) => { const value = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id]; setFavorites(value); localStorage.setItem('mopai:favorites', JSON.stringify(value)); };
  const filtered = themes.filter((theme) => filter === 'all' || (filter === 'custom' ? theme.custom : favorites.includes(theme.id)));
  const patch = (value: Partial<ArticleSettings>) => onSettings({ ...settings, ...value });
  return <>
    {mobileOpen && <button className="theme-scrim" onClick={onClose} aria-label="收起主题面板" />}
    <aside className={`theme-panel ${mobileOpen ? 'theme-panel-open' : ''}`}>
      <div className="theme-tabs" role="tablist" aria-label="排版设置"><button role="tab" aria-selected={tab === 'themes'} className={tab === 'themes' ? 'selected' : ''} onClick={() => setTab('themes')}><Sparkles size={15} /> 排版主题</button><button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}><SlidersHorizontal size={14} /> 样式微调</button><button className="icon-button mobile-close" onClick={onClose} aria-label="关闭主题面板"><X size={18} /></button></div>
      <div className="theme-panel-scroll">
        {tab === 'themes' ? <>
          <div className="theme-intro"><h2>好文字，配好排版<span className="theme-intro-spark">✧</span></h2><p>选一种风格，让内容被认真阅读。</p></div>
          <div className="theme-filters"><div className="filter-segments"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 <span>{themes.length}</span></button><button className={filter === 'custom' ? 'active' : ''} onClick={() => setFilter('custom')}>我的主题</button></div><button className={`icon-button favorite-filter ${filter === 'favorite' ? 'is-favorite' : ''}`} title="我的收藏" aria-label="我的收藏" aria-pressed={filter === 'favorite'} onClick={() => setFilter(filter === 'favorite' ? 'all' : 'favorite')}><Heart size={15} fill={filter === 'favorite' ? 'currentColor' : 'none'} /></button></div>
          <div className="theme-grid">
            {filtered.map((theme) => <div className={`theme-card ${selected.id === theme.id ? 'is-selected' : ''}`} key={theme.id}>
              <button className="theme-card-select" onClick={() => onSelect(theme)} aria-pressed={selected.id === theme.id} aria-label={`应用${theme.name}主题`} title={theme.description}><ThemeThumbnail theme={theme} /><span className="theme-card-caption"><strong>{theme.name}</strong><small>{theme.category}</small></span>{selected.id === theme.id && <span className="theme-selected-mark"><Check size={11} strokeWidth={3} /></span>}</button>
              <button className={`theme-favorite ${favorites.includes(theme.id) ? 'is-favorite' : ''}`} title={favorites.includes(theme.id) ? '取消收藏' : '收藏主题'} aria-label={`${favorites.includes(theme.id) ? '取消收藏' : '收藏'}${theme.name}`} onClick={() => toggleFavorite(theme.id)}><Heart size={12} fill={favorites.includes(theme.id) ? 'currentColor' : 'none'} /></button>
              {theme.custom && <button className="theme-delete" title="移除自定义主题" aria-label={`移除${theme.name}主题`} onClick={() => onDelete(theme)}><Trash2 size={12} /></button>}
            </div>)}
          </div>
          {!filtered.length && <div className="theme-empty">{filter === 'custom' ? <Link2 size={25} /> : <Heart size={25} />}<strong>{filter === 'custom' ? '把喜欢的排版带回来' : '收藏你的心动主题'}</strong><p>{filter === 'custom' ? '从公众号链接中提取主题，留作自己的创作灵感。' : '点击主题卡片上的爱心，下次就能更快找到。'}</p>{filter === 'custom' && <button className="button button-secondary" onClick={onExtract}>提取第一个主题 <ArrowRight size={14} /></button>}</div>}
          {filtered.length > 0 && <p className="theme-footnote"><Check size={12} /> 每一种风格，都为舒适的公众号阅读而设计</p>}
        </> : <div className="settings-content">
          <div className="settings-heading"><div><h2>把细节，调成喜欢的样子</h2><p>正在调整 <span>{selected.name}</span></p></div><button className="icon-button" title="恢复主题默认样式" aria-label="恢复主题默认样式" onClick={() => onSettings(defaultSettings(selected))}><RotateCcw size={16} /></button></div>
          <section className="settings-section"><h3>文字与间距</h3><label className="control-label">正文字体</label><div className="font-select"><button className={settings.font === 'sans' ? 'active' : ''} onClick={() => patch({ font: 'sans' })}><span>现代黑体</span><small>简洁清晰</small></button><button className={settings.font === 'serif' ? 'active serif-option' : 'serif-option'} onClick={() => patch({ font: 'serif' })}><span>人文宋体</span><small>温润耐读</small></button></div>
            <div className="setting-row"><label htmlFor="font-size">正文字号</label><div className="stepper"><button aria-label="减小字号" disabled={settings.fontSize <= 12} onClick={() => patch({ fontSize: settings.fontSize - 1 })}><Minus size={13} /></button><output id="font-size">{settings.fontSize}<small> px</small></output><button aria-label="增大字号" disabled={settings.fontSize >= 22} onClick={() => patch({ fontSize: settings.fontSize + 1 })}><Plus size={13} /></button></div></div>
            <div className="range-label"><label htmlFor="line-height">行间距</label><output>{settings.lineHeight.toFixed(2).replace(/0$/, '')} <small>倍</small></output></div><input id="line-height" type="range" min="1.4" max="2.5" step="0.05" value={settings.lineHeight} onChange={(event) => patch({ lineHeight: Number(event.target.value) })} /><div className="range-ends"><span>紧凑</span><span>舒展</span></div>
            <div className="range-label"><label htmlFor="paragraph-space">段落间距</label><output>{settings.paragraphSpacing} <small>px</small></output></div><input id="paragraph-space" type="range" min="8" max="40" step="1" value={settings.paragraphSpacing} onChange={(event) => patch({ paragraphSpacing: Number(event.target.value) })} />
          </section>
          <section className="settings-section"><h3>主题色</h3><div className="color-swatches">{['#28775b', '#4372ac', '#c57442', '#8a70a8', '#b77382', '#343d48'].map((color) => <button key={color} style={{ backgroundColor: color }} className={settings.accent.toLowerCase() === color ? 'selected' : ''} aria-label={`设置主题色 ${color}`} onClick={() => patch({ accent: color })}>{settings.accent.toLowerCase() === color && <Check size={14} color="white" />}</button>)}<label className="custom-color" title="自定义主题色"><Plus size={14} /><input type="color" value={settings.accent} aria-label="自定义主题色" onChange={(event) => patch({ accent: event.target.value })} /></label></div><span className="color-value">{settings.accent.toUpperCase()}</span></section>
          <section className="settings-section"><h3>阅读细节</h3><Switch label="显示文章标题" checked={settings.showTitle} onChange={() => patch({ showTitle: !settings.showTitle })} /><Switch label="显示作者与日期" checked={settings.showMeta} onChange={() => patch({ showMeta: !settings.showMeta })} /><Switch label="正文两端对齐" checked={settings.justify} onChange={() => patch({ justify: !settings.justify })} /><Switch label="文末附上外链" description="将文章中的外链转为文末参考链接" checked={settings.linkFootnotes} onChange={() => patch({ linkFootnotes: !settings.linkFootnotes })} /></section>
          <div className="settings-note"><Check size={14} /><span>调整会自动保存到当前文章，下一次打开，还是喜欢的样子。</span></div>
        </div>}
      </div>
      <div className="extract-panel"><div className="extract-panel-heading"><span className="extract-icon"><Link2 size={17} /></span><strong>遇见喜欢的公众号排版？</strong><Sparkles size={14} /></div><p>粘贴文章链接，把心动的风格带回来。</p><button onClick={onExtract}><Plus size={14} /> 从链接提取主题 <ArrowRight size={14} /></button></div>
    </aside>
  </>;
}
