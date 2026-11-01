import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, LoaderCircle, Settings2, Sparkles } from 'lucide-react';
import Modal from './Modal';
import { api, errorMessage, query } from '../lib/api';
import { copyImage } from '../lib/render';
import { coverRatios, defaultCoverStyle, defaultImageSettings, type GeneratedCover, type ImageSettings } from '../../shared/images';

export default function ImageGenerationDialog({ directory, articlePath, content, onInsert, onClose }: {
  directory: string;
  articlePath: string;
  content: string;
  onInsert: (cover: GeneratedCover) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<ImageSettings>(defaultImageSettings);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [style, setStyle] = useState(defaultCoverStyle);
  const [configOpen, setConfigOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<GeneratedCover | null>(null);
  const [inserted, setInserted] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<{ requestId: string; directory: string; articlePath: string; content: string; style: string } | null>(null);
  const disabled = loading || saving || busy;
  const locked = disabled || attempted;
  useEffect(() => {
    let active = true;
    void api<ImageSettings>('/image-settings').then((value) => {
      if (!active) return;
      setSettings(value);
      setConfigOpen(!value.hasApiKey);
    }).catch((failure) => { if (active) { setError(errorMessage(failure)); setLoadFailed(true); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const saveSettings = async () => {
    const saved = await api<ImageSettings>('/image-settings', { method: 'PUT', body: { ...settings, apiKey, clearApiKey } });
    setSettings(saved);
    setApiKey('');
    setClearApiKey(false);
    return saved;
  };
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true); setError(''); setMessage('');
    try { await saveSettings(); setMessage('接口配置已保存到本机'); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setSaving(false); inFlight.current = false; }
  };
  const insert = (cover: GeneratedCover) => {
    onInsert(cover);
    setInserted(true);
    setMessage('封面已插入文章开头，文章会自动保存。');
  };
  const generate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      if (!pending.current) {
        if (apiKey || clearApiKey) { try { sessionStorage.removeItem('mopai:pending-cover'); } catch { /* Optional recovery state. */ } }
        const saved = await saveSettings();
        if (!saved.hasApiKey) { setConfigOpen(true); throw new Error('请填写 API 密钥。切换到新渠道时需要重新填写。'); }
        const body = { directory, articlePath, content, style };
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ body, settings: saved })));
        const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        let requestId = crypto.randomUUID();
        // Preserve only an opaque hash and request ID, never article text or the API key.
        try {
          const previous = JSON.parse(sessionStorage.getItem('mopai:pending-cover') || 'null');
          if (previous?.signature === signature && typeof previous.requestId === 'string') requestId = previous.requestId;
          sessionStorage.setItem('mopai:pending-cover', JSON.stringify({ signature, requestId }));
        } catch { /* Generation still works when browser storage is disabled. */ }
        pending.current = { ...body, requestId };
      }
      setAttempted(true);
      const cover = await api<GeneratedCover>('/images/generate', { method: 'POST', body: pending.current });
      setResult(cover);
      try { sessionStorage.removeItem('mopai:pending-cover'); } catch { /* Optional recovery state. */ }
      insert(cover);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const reset = () => {
    pending.current = null;
    setResult(null); setInserted(false); setAttempted(false); setError(''); setMessage('');
    try { sessionStorage.removeItem('mopai:pending-cover'); } catch { /* Optional recovery state. */ }
  };
  const assetUrl = result ? `/api/assets?${query({ path: result.assetPath, directory: result.directory, format: 'png' })}` : '';
  const copy = async () => {
    setError('');
    try { await copyImage(assetUrl); setMessage('PNG 图片已复制，可在公众号正文中粘贴。'); }
    catch (failure) { setError(errorMessage(failure)); }
  };

  return <Modal title="生成文章封面" subtitle="根据当前文章内容生成一张图片，并插入正文开头。" wide busy={busy || saving} onClose={onClose} footer={<>
    <button className="button button-secondary" disabled={busy || saving} onClick={onClose}>{result ? '完成' : '关闭'}</button>
    {result ? <button className="button button-secondary" onClick={reset}>准备重新生成</button> : <>
      {attempted && <button className="text-button" disabled={busy} onClick={reset}>调整后重新生成</button>}
      <button className="button button-primary" disabled={disabled || loadFailed || !content.trim()} onClick={() => void generate()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{busy ? '正在生成并保存…' : attempted ? '重试同一请求' : '生成并插入'}</button>
    </>}
  </>}>
    {loading ? <p className="field-help"><LoaderCircle size={15} className="spin" /> 正在读取接口配置…</p> : <>
      <details className="image-configuration" open={configOpen} onToggle={(event) => setConfigOpen(event.currentTarget.open)}>
        <summary><Settings2 size={15} /> 接口配置 <span>{settings.hasApiKey ? '已保存密钥' : '尚未配置密钥'}</span></summary>
        <div className="image-settings-grid">
          <label className="field-label image-field-full">地址类型<select className="text-input" value={settings.addressMode} disabled={locked} onChange={(event) => setSettings({ ...settings, addressMode: event.target.value as ImageSettings['addressMode'] })}><option value="endpoint">完整请求地址（原样使用）</option><option value="base">Base URL（追加 /images/generations）</option></select></label>
          <label className="field-label image-field-full">请求地址<input className="text-input" value={settings.address} disabled={locked} onChange={(event) => setSettings({ ...settings, address: event.target.value })} placeholder="https://api.openai.com/v1/images/generations" autoComplete="off" /></label>
          <label className="field-label image-field-full">API 密钥<input className="text-input" type="password" value={apiKey} disabled={locked} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? '已保存，留空保留；更换渠道请填写新密钥' : 'sk-…'} autoComplete="new-password" spellCheck={false} /></label>
          {settings.hasApiKey && <label className="image-key-clear image-field-full"><input type="checkbox" checked={clearApiKey} disabled={locked} onChange={(event) => setClearApiKey(event.target.checked)} /> 清除已保存的密钥</label>}
          <label className="field-label">图片模型<input className="text-input" value={settings.model} disabled={locked} onChange={(event) => setSettings({ ...settings, model: event.target.value })} placeholder="例如 gpt-image-2" /></label>
          <label className="field-label">接口生成尺寸<input className="text-input" value={settings.size} disabled={locked} onChange={(event) => setSettings({ ...settings, size: event.target.value })} placeholder="留空使用渠道默认值" list="image-sizes" /><datalist id="image-sizes"><option value="1024x1024" /><option value="1024x576" /><option value="576x1024" /><option value="1024x768" /><option value="768x1024" /><option value="1K" /><option value="auto" /></datalist></label>
          <label className="field-label">返回格式<select className="text-input" value={settings.responseFormat} disabled={locked} onChange={(event) => setSettings({ ...settings, responseFormat: event.target.value as ImageSettings['responseFormat'] })}><option value="auto">自动（不发送此参数）</option><option value="b64_json">Base64</option><option value="url">图片链接</option></select></label>
          <label className="field-label">超时时间（秒）<input className="text-input" type="number" min="30" max="600" value={settings.timeoutSeconds} disabled={locked} onChange={(event) => setSettings({ ...settings, timeoutSeconds: Number(event.target.value) })} /></label>
        </div>
        <p className="field-help">Base URL 按填写的路径追加接口，不自动添加 /v1。模型与生成尺寸须由渠道支持；聊天模型不一定能用于文生图。</p>
        <p className="field-help">接口尺寸与下方成图比例独立。默认请求 1024x1024；渠道支持时，可填入相同比例的尺寸，减少裁切。</p>
        <p className="field-help">密钥保存在本机服务端，不会回传到页面。文章内容会发送给所配置的图片服务。</p>
        <button className="button button-secondary" disabled={locked || loadFailed} onClick={() => void save()}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} 保存接口配置</button>
      </details>
      <div className="cover-ratio-heading"><span className="field-label">成图比例</span><button className="text-button" disabled={locked} aria-pressed={settings.aspectRatio === 'original'} onClick={() => setSettings({ ...settings, aspectRatio: 'original' })}>{settings.aspectRatio === 'original' ? '已选：保留原始比例' : '保留原始比例'}</button></div>
      <div className="cover-ratios" role="radiogroup" aria-label="封面比例">{coverRatios.map((ratio) => <button key={ratio.id} type="button" role="radio" aria-checked={settings.aspectRatio === ratio.id} className={settings.aspectRatio === ratio.id ? 'selected' : ''} disabled={locked} onClick={() => setSettings({ ...settings, aspectRatio: ratio.id })}><span className="ratio-icon"><i style={{ width: `${Math.min(34, 24 * ratio.width / ratio.height)}px`, height: `${Math.min(24, 34 * ratio.height / ratio.width)}px` }} /></span><span><strong>{ratio.id} <small>{ratio.label}</small></strong><small>{ratio.width} × {ratio.height}</small></span></button>)}</div>
      <p className="field-help">2.35:1 用于公众号列表和内容推荐。按所选比例构图；返回比例不同时居中裁切，不拉伸。下载 PNG 后，可在公众号后台选择为列表封面。</p>
      <label className="field-label" htmlFor="cover-style">画面要求</label>
      <textarea id="cover-style" className="image-style-input" value={style} maxLength={2000} disabled={locked} onChange={(event) => setStyle(event.target.value)} />
      <p className="field-help">文章：{articlePath}。自动结合标题、摘要和正文；每次生成一张。</p>
      {busy && <p className="extract-progress" role="status"><LoaderCircle size={17} className="spin" /> 正在生成、下载并转换为 PNG，请稍候…</p>}
      {result && <div className="generated-cover"><img src={assetUrl} alt="生成的文章封面" /><div><span>{result.aspectRatio && result.aspectRatio !== 'original' ? `${result.aspectRatio} · ` : ''}{result.width} × {result.height} · PNG · 已保存到文章目录</span><div className="cover-actions"><button className="button button-secondary" onClick={() => void copy()}><Copy size={14} /> 复制封面图片</button><a className="button button-secondary" href={`${assetUrl}&download=1`} download><Download size={14} /> 下载 PNG</a>{!inserted && <button className="button button-primary" onClick={() => { try { insert(result); } catch (failure) { setError(errorMessage(failure)); } }}>插入文章开头</button>}</div></div></div>}
      <p className="field-help">复制文章时会嵌入 PNG 图片。若公众号过滤图片，可用「复制封面图片」单独粘贴，或下载后上传。</p>
      {attempted && !result && !busy && <p className="field-help">重试沿用同一请求标识；已返回的图片只重试下载。是否对重复生成去重，取决于渠道对 X-Request-Id 的支持。</p>}
    </>}
    {message && <p className="image-success" role="status"><Check size={14} /> {message}</p>}
    {error && <div className="inline-error" role="alert">{error}</div>}
  </Modal>;
}
