import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, LoaderCircle, Plus, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import Modal from './Modal';
import { api, errorMessage, query } from '../lib/api';
import { copyImage } from '../lib/render';
import { coverRatios, defaultCoverStyle, defaultImageSettings, imageProtocols, imageAddressMode, protocolPath, switchImageProtocol, type GeneratedCover, type ImageModel, type ImageModelList, type ImageProtocol, type ImageSettings } from '../../shared/images';
import { defaultCoverPrompts, MAX_COVER_PROMPTS, MAX_PROMPT_CONTENT, MAX_PROMPT_NAME, type CoverPromptLibrary } from '../../shared/image-prompts';

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
  const [promptLibrary, setPromptLibrary] = useState(defaultCoverPrompts);
  const [promptId, setPromptId] = useState(promptLibrary.selectedId);
  const [promptName, setPromptName] = useState(promptLibrary.prompts[0].name);
  const [promptSaving, setPromptSaving] = useState(false);
  const promptNameInput = useRef<HTMLInputElement | null>(null);
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
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [manualModel, setManualModel] = useState(false);
  const modelsRequest = useRef(0);
  const modelsController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const pending = useRef<{ requestId: string; directory: string; articlePath: string; content: string; style: string } | null>(null);
  const disabled = loading || saving || busy || promptSaving;
  const locked = disabled || attempted;
  const selectedPrompt = promptLibrary.prompts.find((item) => item.id === promptId);
  const promptDirty = !selectedPrompt || promptName !== selectedPrompt.name || style !== selectedPrompt.content;
  const applyPromptLibrary = (library: CoverPromptLibrary) => {
    const prompt = library.prompts.find((item) => item.id === library.selectedId)!;
    setPromptLibrary(library); setPromptId(prompt.id); setPromptName(prompt.name); setStyle(prompt.content);
  };
  useEffect(() => {
    let active = true;
    void Promise.all([api<ImageSettings>('/image-settings'), api<CoverPromptLibrary>('/image-prompts')]).then(([value, library]) => {
      if (!active) return;
      setSettings({ ...value, addressMode: imageAddressMode(value.address, value.addressMode) });
      setConfigOpen(!value.hasApiKey);
      applyPromptLibrary(library);
    }).catch((failure) => { if (active) { setError(errorMessage(failure)); setLoadFailed(true); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; modelsRequest.current++; modelsController.current?.abort(); };
  }, []);
  useEffect(() => { if (!promptId) promptNameInput.current?.focus(); }, [promptId]);

  const persistPrompt = async (selectionId?: string) => {
    if (inFlight.current || locked || loadFailed || (selectionId && promptDirty)) return;
    inFlight.current = true;
    setPromptSaving(true); setError(''); setMessage('');
    try {
      const library = await api<CoverPromptLibrary>(selectionId ? '/image-prompts/selection' : '/image-prompts', {
        method: selectionId ? 'PUT' : 'POST',
        body: selectionId ? { id: selectionId } : { ...(promptId ? { id: promptId } : {}), name: promptName, content: style },
      });
      applyPromptLibrary(library);
      setMessage(selectionId ? '已切换提示词，下次打开会继续使用。' : '提示词已保存到本机，下次打开可直接使用。');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPromptSaving(false); inFlight.current = false; }
  };
  const newPrompt = () => {
    setPromptId(''); setPromptName(''); setStyle(''); setError(''); setMessage('');
  };

  const invalidateModels = () => {
    modelsRequest.current++;
    modelsController.current?.abort();
    setModels([]); setModelsLoaded(false); setModelsLoading(false); setModelsError('');
  };
  const updateConnection = (patch: Partial<ImageSettings>) => {
    invalidateModels();
    setSettings((value) => {
      const next = { ...value, ...patch };
      return { ...next, addressMode: imageAddressMode(next.address, next.addressMode) };
    });
  };
  const fetchModels = async () => {
    if (modelsLoading || locked) return;
    const sequence = ++modelsRequest.current;
    modelsController.current?.abort();
    modelsController.current = new AbortController();
    setModelsLoading(true); setModelsError('');
    try {
      const value = await api<ImageModelList>('/images/models', { method: 'POST', body: { ...settings, apiKey, clearApiKey }, signal: modelsController.current.signal });
      if (sequence !== modelsRequest.current) return;
      setModels(value.models); setModelsLoaded(true);
    } catch (failure) { if (sequence === modelsRequest.current && (failure as Error).name !== 'AbortError') setModelsError(errorMessage(failure)); }
    finally { if (sequence === modelsRequest.current) setModelsLoading(false); }
  };

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

  return <Modal title="生成文章封面" subtitle="根据当前文章内容生成一张图片，并插入正文开头。" wide busy={busy || saving || promptSaving} onClose={onClose} footer={<>
    <button className="button button-secondary" disabled={busy || saving || promptSaving} onClick={onClose}>{result ? '完成' : '关闭'}</button>
    {result ? <button className="button button-secondary" onClick={reset}>准备重新生成</button> : <>
      {attempted && <button className="text-button" disabled={busy} onClick={reset}>调整后重新生成</button>}
      <button className="button button-primary" disabled={disabled || modelsLoading || loadFailed || !content.trim() || !settings.model.trim() || !style.trim()} onClick={() => void generate()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{busy ? '正在生成并保存…' : attempted ? '重试同一请求' : '生成并插入'}</button>
    </>}
  </>}>
    {loading ? <p className="field-help"><LoaderCircle size={15} className="spin" /> 正在读取接口配置…</p> : <>
      <details className="image-configuration" open={configOpen} onToggle={(event) => setConfigOpen(event.currentTarget.open)}>
        <summary><Settings2 size={15} /> 接口配置 <span>{settings.hasApiKey ? '已保存密钥' : '尚未配置密钥'}</span></summary>
        <div className="image-settings-grid">
          <label className="field-label image-field-full">接口协议<select id="image-protocol" className="text-input" value={settings.protocol} disabled={locked} onChange={(event) => { invalidateModels(); setSettings(switchImageProtocol(settings, event.target.value as ImageProtocol)); }}>{imageProtocols.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="field-label image-field-full">地址类型<select id="image-address-mode" className="text-input" value={settings.addressMode} disabled={locked} onChange={(event) => updateConnection({ addressMode: event.target.value as ImageSettings['addressMode'] })}><option value="endpoint">完整请求地址（原样使用）</option><option value="base">Base URL（追加 {protocolPath(settings.protocol)}）</option></select></label>
          <label className="field-label image-field-full">请求地址<input id="image-address" className="text-input" value={settings.address} disabled={locked} onChange={(event) => updateConnection({ address: event.target.value })} placeholder={`https://api.openai.com/v1${protocolPath(settings.protocol)}`} autoComplete="off" /><span className="field-help">自动识别 /v1 等基础地址和 /responses 等完整接口地址；自定义路径可选择地址类型。</span></label>
          <label className="field-label image-field-full">API 密钥<input className="text-input" type="password" value={apiKey} disabled={locked} onChange={(event) => { invalidateModels(); setApiKey(event.target.value); }} placeholder={settings.hasApiKey ? '已保存，留空保留；更换渠道请填写新密钥' : 'sk-…'} autoComplete="new-password" spellCheck={false} /></label>
          {settings.hasApiKey && <label className="image-key-clear image-field-full"><input type="checkbox" checked={clearApiKey} disabled={locked} onChange={(event) => { invalidateModels(); setClearApiKey(event.target.checked); }} /> 清除已保存的密钥</label>}
          <div className="image-field-full image-model-picker"><div className="image-model-heading"><label className="field-label" htmlFor="image-model">{settings.protocol === 'responses' ? '调用模型' : '图片模型'}</label><button className="text-button" disabled={locked || modelsLoading || !settings.address.trim()} onClick={() => void fetchModels()}>{modelsLoading ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{modelsLoading ? '正在获取…' : '获取模型列表'}</button></div>
            {manualModel ? <input id="image-model" className="text-input" value={settings.model} disabled={locked} onChange={(event) => setSettings({ ...settings, model: event.target.value })} placeholder="填写渠道提供的模型 ID" /> : <select id="image-model" className="text-input" value={settings.model} disabled={locked || modelsLoading} onChange={(event) => setSettings({ ...settings, model: event.target.value })}><option value="" disabled>请选择模型</option>{settings.model && !models.some((item) => item.id === settings.model) && <option value={settings.model}>{settings.model}{modelsLoaded ? '（当前配置，未在列表中）' : '（当前配置）'}</option>}{models.map((model) => <option key={model.id} value={model.id}>{model.id}{model.name && model.name !== model.id ? ` · ${model.name}` : ''}</option>)}</select>}
            <div className="image-model-footer"><label><input type="checkbox" checked={manualModel} disabled={locked} onChange={(event) => setManualModel(event.target.checked)} /> 手动填写模型</label>{modelsLoaded && <span>{models.length ? `已获取 ${models.length} 个模型` : '渠道未返回可选模型'}</span>}</div>
            {modelsError && <p className="inline-error" role="alert">{modelsError}</p>}
          </div>
          <label className="field-label image-field-full">图片比例／尺寸<select id="image-ratio" className="text-input" value={settings.aspectRatio} disabled={locked} onChange={(event) => setSettings({ ...settings, aspectRatio: event.target.value as ImageSettings['aspectRatio'] })}>{coverRatios.map((ratio) => <option key={ratio.id} value={ratio.id}>{ratio.id} · {ratio.label} · {ratio.width} × {ratio.height}</option>)}<option value="original">自动 · 使用渠道默认尺寸，保留原始比例</option></select></label>
          {settings.protocol === 'images' && <label className="field-label">返回格式<select className="text-input" value={settings.responseFormat} disabled={locked} onChange={(event) => setSettings({ ...settings, responseFormat: event.target.value as ImageSettings['responseFormat'] })}><option value="auto">自动（不发送此参数）</option><option value="b64_json">Base64</option><option value="url">图片链接</option></select></label>}
          <label className="field-label">超时时间（秒）<input className="text-input" type="number" min="30" max="600" value={settings.timeoutSeconds} disabled={locked} onChange={(event) => setSettings({ ...settings, timeoutSeconds: Number(event.target.value) })} /><span className="field-help">生成和下载分别计时，各自最多等待此时长。</span></label>
          <details className="image-field-full model-address-details"><summary>自定义模型列表地址</summary><label className="field-label">模型列表地址<input className="text-input" value={settings.modelsAddress} disabled={locked} placeholder="留空自动使用同一渠道的 /models" onChange={(event) => updateConnection({ modelsAddress: event.target.value })} /></label></details>
        </div>
        <p className="field-help">{settings.protocol === 'responses' ? 'Responses 直接调用原生 /responses，使用图像生成工具；请选择支持该工具的调用模型。' : settings.protocol === 'chat' ? 'Chat 直接调用 /chat/completions，需要渠道支持图片输出扩展。普通文本回复不会作为图片。' : 'Images 直接调用图片生成接口，请求画布按所选比例和模型适配。若渠道限制尺寸，可选“自动”。'}</p>
        <p className="field-help">{settings.protocol === 'images' ? '返回图片会校正到所选比例／尺寸，不拉伸。' : settings.protocol === 'responses' ? '所选比例用于构图和最终尺寸；原生图像工具使用自动画布，必要时居中裁切。' : '所选比例通过 image_config.aspect_ratio 请求，渠道返回比例不同时居中裁切。'}模型列表不代表出图权限，实际支持情况以渠道为准。</p>
        <p className="field-help">密钥保存在本机服务端，不会回传到页面。文章内容会发送给所配置的图片服务。</p>
        <button className="button button-secondary" disabled={locked || modelsLoading || loadFailed || !settings.model.trim()} onClick={() => void save()}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} 保存接口配置</button>
      </details>
      <p className="field-help">{imageProtocols.find((item) => item.id === settings.protocol)?.label} · {settings.model} · {settings.aspectRatio === 'original' ? '自动尺寸' : settings.aspectRatio}。可展开接口配置修改。</p>
      <section className="cover-prompt-editor" aria-label="画面提示词">
        <div className="cover-prompt-heading"><label className="field-label" htmlFor="cover-prompt">画面提示词</label><button className="text-button" disabled={locked || loadFailed || promptDirty || promptLibrary.prompts.length >= MAX_COVER_PROMPTS} onClick={newPrompt}><Plus size={14} /> 新增提示词</button></div>
        <select id="cover-prompt" className="text-input" value={promptId} disabled={locked || loadFailed || promptDirty} onChange={(event) => void persistPrompt(event.target.value)}>{!promptId && <option value="">新提示词（未保存）</option>}{promptLibrary.prompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}</select>
        <label className="field-label" htmlFor="cover-prompt-name">提示词名称</label>
        <input id="cover-prompt-name" ref={promptNameInput} className="text-input" value={promptName} maxLength={MAX_PROMPT_NAME} disabled={locked || loadFailed} placeholder="例如：水彩插画、科技感封面" onChange={(event) => { setPromptName(event.target.value); setMessage(''); }} />
        <label className="field-label" htmlFor="cover-style">提示词内容</label>
        <textarea id="cover-style" className="image-style-input" value={style} maxLength={MAX_PROMPT_CONTENT} disabled={locked || loadFailed} onChange={(event) => { setStyle(event.target.value); setMessage(''); }} />
        <div className="cover-prompt-footer"><span>{promptDirty ? '未保存 · ' : ''}{style.length} / {MAX_PROMPT_CONTENT}</span><div>{promptDirty && <button className="text-button" disabled={locked} onClick={() => { applyPromptLibrary(promptLibrary); setError(''); setMessage(''); }}>取消修改</button>}<button className="button button-secondary" disabled={locked || loadFailed || !promptDirty || !promptName.trim() || !style.trim()} onClick={() => void persistPrompt()}>{promptSaving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} 保存提示词</button></div></div>
        <p className="field-help">{promptDirty ? '修改后请保存或取消，再切换、新增提示词。未保存的内容仅用于本次生成。' : '可修改当前提示词并保存，或新增常用提示词。下次打开会恢复上次选择。'}</p>
      </section>
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
