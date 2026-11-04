// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageGenerationDialog from '../src/components/ImageGenerationDialog';
import { defaultImageSettings } from '../shared/images';

describe('image configuration dialog', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const run = async (action: () => unknown) => { await act(async () => { await action(); }); };
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(label))!;
  const select = async (id: string, value: string) => run(() => { const element = document.getElementById(id) as HTMLSelectElement; element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      if (input === '/api/image-settings' && options?.method === 'GET') return Response.json({ ...defaultImageSettings, hasApiKey: true });
      if (input === '/api/images/models') return Response.json({ models: [{ id: 'gpt-image-2' }, { id: 'gpt-5.6-sol' }] });
      if (input === '/api/image-settings' && options?.method === 'PUT') return Response.json({ ...JSON.parse(String(options.body)), hasApiKey: true });
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
});
