// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageGenerationDialog from '../src/components/ImageGenerationDialog';
import { defaultImageSettings } from '../shared/images';
import { defaultCoverPrompts, type CoverPromptLibrary } from '../shared/image-prompts';
import { webcrypto } from 'node:crypto';

describe('image configuration dialog', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let prompts: CoverPromptLibrary;
  const run = async (action: () => unknown) => { await act(async () => { await action(); }); };
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(label))!;
  const select = async (id: string, value: string) => run(() => { const element = document.getElementById(id) as HTMLSelectElement; element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
  const input = async (id: string, value: string) => run(() => {
    const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const reopen = async () => {
    await run(() => root.unmount()); root = createRoot(host);
    await run(() => root.render(createElement(ImageGenerationDialog, { directory: 'D:/articles', articlePath: 'article.md', content: '# Draft', onClose: vi.fn(), onInsert: vi.fn() })));
  };
  beforeEach(async () => {
    prompts = defaultCoverPrompts();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      if (input === '/api/image-settings' && options?.method === 'GET') return Response.json({ ...defaultImageSettings, hasApiKey: true });
      if (input === '/api/images/models') return Response.json({ models: [{ id: 'gpt-image-2' }, { id: 'gpt-5.6-sol' }] });
      if (input === '/api/image-settings' && options?.method === 'PUT') return Response.json({ ...JSON.parse(String(options.body)), hasApiKey: true });
      if (input === '/api/image-prompts' && options?.method === 'GET') return Response.json(prompts);
      if (input === '/api/image-prompts' && options?.method === 'POST') {
        const draft = JSON.parse(String(options.body));
        const prompt = { ...draft, id: draft.id || `prompt-${prompts.prompts.length}` };
        prompts = { selectedId: prompt.id, prompts: draft.id ? prompts.prompts.map((item) => item.id === draft.id ? prompt : item) : [...prompts.prompts, prompt] };
        return Response.json(prompts);
      }
      if (input === '/api/image-prompts/selection') { prompts = { ...prompts, selectedId: JSON.parse(String(options?.body)).id }; return Response.json(prompts); }
      if (input === '/api/images/generate') return Response.json({ requestId: 'request', directory: 'D:/articles', articlePath: 'article.md', assetPath: 'cover.png', markdownPath: './cover.png', width: 940, height: 400 });
      throw new Error('Unexpected request');
    }));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await run(() => root.render(createElement(ImageGenerationDialog, { directory: 'D:/articles', articlePath: 'article.md', content: '# Draft', onClose: vi.fn(), onInsert: vi.fn() })));
  });
  afterEach(async () => { await run(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  it('has one ratio/size control inside interface settings and fetches models without saving', async () => {
    expect(document.querySelectorAll('#image-ratio')).toHaveLength(1);
    expect(document.getElementById('image-ratio')?.closest('.image-configuration')).toBeTruthy();
    expect(document.querySelector('.cover-ratios')).toBeNull();
    expect(document.body.textContent).not.toContain('接口生成尺寸');
    expect(document.getElementById('image-model')?.tagName).toBe('SELECT');
    await run(() => button('获取模型列表').click());
    expect([...document.querySelectorAll('#image-model option')].map((item) => item.textContent)).toContain('gpt-5.6-sol');
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
    await select('image-model', 'gpt-5.6-sol');
    await select('image-ratio', '16:9');
    await run(() => button('保存接口配置').click());
    const saved = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === 'PUT')!;
    expect(JSON.parse(String(saved[1]?.body))).toMatchObject({ model: 'gpt-5.6-sol', aspectRatio: '16:9' });
    expect(JSON.parse(String(saved[1]?.body))).not.toHaveProperty('size');
  });
  it('switches native protocol paths and ignores an outdated model response', async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    await run(() => button('获取模型列表').click());
    await select('image-protocol', 'responses');
    expect((document.getElementById('image-address') as HTMLInputElement).value).toBe('https://l0veyou.com/responses');
    await run(() => release(Response.json({ models: [{ id: 'stale-model' }] })));
    expect(document.querySelector('#image-model')?.textContent).not.toContain('stale-model');
    expect((document.getElementById('image-model') as HTMLSelectElement).value).toBe('gpt-image-2');
  });
  it('recognizes pasted base and complete URLs before fetching models', async () => {
    const pasteAddress = async (value: string) => run(() => {
      const input = document.getElementById('image-address') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await select('image-protocol', 'responses');
    await pasteAddress('https://new.example/v1');
    expect((document.getElementById('image-address-mode') as HTMLSelectElement).value).toBe('base');
    await run(() => button('获取模型列表').click());
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/images/models')!;
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({ address: 'https://new.example/v1', addressMode: 'base', protocol: 'responses' });
    await pasteAddress('https://new.example/v1/responses');
    expect((document.getElementById('image-address-mode') as HTMLSelectElement).value).toBe('endpoint');
    await select('image-protocol', 'chat');
    expect((document.getElementById('image-address') as HTMLInputElement).value).toBe('https://new.example/v1/chat/completions');
  });
  it('keeps the configured model and offers manual entry after a list error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ message: '模型列表不可用' }, { status: 502 }));
    await run(() => button('获取模型列表').click());
    expect(document.querySelector('[role=alert]')?.textContent).toContain('模型列表不可用');
    const label = [...document.querySelectorAll('label')].find((item) => item.textContent?.includes('手动填写模型'))!;
    await run(() => label.querySelector<HTMLInputElement>('input')!.click());
    expect(document.getElementById('image-model')?.tagName).toBe('INPUT');
    expect((document.getElementById('image-model') as HTMLInputElement).value).toBe('gpt-image-2');
  });
  it('edits and saves the existing prompt without touching connection settings or generating an image', async () => {
    await input('cover-prompt-name', '水彩插画');
    await input('cover-style', '清新的水彩风格，画面中可以有中文标题。');
    expect((document.getElementById('cover-prompt') as HTMLSelectElement).disabled).toBe(true);
    await run(() => button('保存提示词').click());
    expect(prompts.prompts).toHaveLength(1);
    expect(prompts.prompts[0]).toMatchObject({ name: '水彩插画', content: '清新的水彩风格，画面中可以有中文标题。' });
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method !== 'GET').map(([url]) => url)).toEqual(['/api/image-prompts']);
    await reopen();
    expect((document.getElementById('cover-style') as HTMLTextAreaElement).value).toBe('清新的水彩风格，画面中可以有中文标题。');
  });
  it('adds named prompts, remembers selection and sends the chosen content to generation', async () => {
    await run(() => button('新增提示词').click());
    expect(button('保存提示词').disabled).toBe(true); expect(button('生成并插入').disabled).toBe(true);
    await input('cover-prompt-name', '摄影封面'); await input('cover-style', '自然光摄影，突出文章主题。');
    await run(() => button('保存提示词').click());
    const id = prompts.selectedId;
    expect(prompts.prompts).toHaveLength(2);
    await select('cover-prompt', 'default');
    await reopen();
    expect((document.getElementById('cover-prompt') as HTMLSelectElement).value).toBe('default');
    await select('cover-prompt', id);
    await reopen();
    expect((document.getElementById('cover-prompt') as HTMLSelectElement).value).toBe(id);
    await run(() => button('生成并插入').click());
    const generated = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/images/generate')!;
    expect(generated).toBeTruthy();
    expect(JSON.parse(String(generated[1]?.body)).style).toBe('自然光摄影，突出文章主题。');
  });
  it('keeps unsaved text after a failed save and can cancel without overwriting a saved prompt', async () => {
    await run(() => button('新增提示词').click());
    await input('cover-prompt-name', '摄影'); await input('cover-style', '柔和光线摄影。');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ message: '保存失败' }, { status: 500 }));
    await run(() => button('保存提示词').click());
    expect(document.querySelector('[role=alert]')?.textContent).toBe('保存失败');
    expect((document.getElementById('cover-style') as HTMLTextAreaElement).value).toBe('柔和光线摄影。');
    expect(prompts.prompts).toHaveLength(1);
    await run(() => button('取消修改').click());
    expect((document.getElementById('cover-style') as HTMLTextAreaElement).value).toBe(defaultCoverPrompts().prompts[0].content);
  });
});
