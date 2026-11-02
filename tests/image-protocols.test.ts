import { describe, expect, it } from 'vitest';
import { coverRatios, defaultImageSettings, imageRequestSize, switchImageProtocol } from '../shared/images';
import { configuredEndpoint, inferredModelsAddress, protocolImage, protocolRequest } from '../server/image-protocols';

describe('native image protocols', () => {
  it('switches recognized full endpoints without touching custom URLs or Base URLs', () => {
    expect(switchImageProtocol({ ...defaultImageSettings, address: 'https://p.example/v1/images/generations?version=1' }, 'responses').address).toBe('https://p.example/v1/responses?version=1');
    expect(switchImageProtocol({ ...defaultImageSettings, address: 'https://p.example/private-route' }, 'chat').address).toBe('https://p.example/private-route');
    expect(switchImageProtocol({ ...defaultImageSettings, addressMode: 'base', address: 'https://p.example/v1/' }, 'chat').address).toBe('https://p.example/v1/');
    expect(configuredEndpoint({ address: 'https://p.example/v1/', addressMode: 'base', protocol: 'chat' })).toBe('https://p.example/v1/chat/completions');
  });
  it('derives model lists from each protocol without losing a provider prefix', () => {
    for (const route of ['images/generations', 'responses', 'chat/completions']) expect(inferredModelsAddress({ address: `https://p.example/custom/v1/${route}`, addressMode: 'endpoint', modelsAddress: '' })).toBe('https://p.example/custom/v1/models');
    expect(() => inferredModelsAddress({ address: 'https://p.example/private-route', addressMode: 'endpoint', modelsAddress: '' })).toThrow('模型列表地址');
  });
  it('keeps Responses native tool options and uses a single ratio selection for each protocol', () => {
    const responses = protocolRequest({ ...defaultImageSettings, protocol: 'responses' }, 'prompt');
    expect(responses).toEqual({ model: 'gpt-image-2', input: 'prompt', tools: [{ type: 'image_generation', size: 'auto', output_format: 'png' }], tool_choice: { type: 'image_generation' }, stream: false, store: false });
    expect(protocolRequest({ ...defaultImageSettings, aspectRatio: '16:9' }, 'prompt').size).toBe('1280x720');
    expect(protocolRequest({ ...defaultImageSettings, protocol: 'chat', aspectRatio: '9:16' }, 'prompt').image_config).toEqual({ aspect_ratio: '9:16' });
  });
  it('adapts requested canvases to GPT Image constraints while preserving the selected export ratio', () => {
    for (const ratio of coverRatios) {
      const [width, height] = imageRequestSize(ratio.id, 'gpt-image-2')!.split('x').map(Number);
      expect(width % 16).toBe(0); expect(height % 16).toBe(0);
      expect(width * height).toBeGreaterThanOrEqual(655360);
      expect(width * height).toBeLessThanOrEqual(8294400);
      expect(width / height).toBeCloseTo(ratio.width / ratio.height, 2);
    }
    expect(imageRequestSize('2.35:1', 'gpt-image-2-2026-04-21')).toBe('1280x544');
    expect(imageRequestSize('16:9', 'gpt-image-1.5')).toBe('1536x1024');
    expect(imageRequestSize('9:16', 'gpt-image-1')).toBe('1024x1536');
    expect(imageRequestSize('1:1', 'gpt-image-1-mini')).toBe('1024x1024');
    expect(imageRequestSize('16:9', 'provider-image')).toBe('1024x576');
    expect(protocolRequest({ ...defaultImageSettings, aspectRatio: 'original' }, 'prompt')).not.toHaveProperty('size');
  });
  it('accepts Chat image blocks and explicit Markdown images but not prose links or another protocol envelope', () => {
    const chat = { protocol: 'chat' as const };
    expect(protocolImage({ choices: [{ message: { content: [{ type: 'image_url', image_url: { url: 'https://cdn.example/img.png' } }] } }] }, chat)).toEqual({ url: 'https://cdn.example/img.png' });
    expect(protocolImage({ choices: [{ message: { content: '![封面](https://cdn.example/img.png)' } }] }, chat)).toEqual({ url: 'https://cdn.example/img.png' });
    expect(() => protocolImage({ choices: [{ message: { content: 'Look at https://cdn.example/img.png' } }] }, chat)).toThrow('Chat 未返回图片');
    expect(() => protocolImage({ data: [{ url: 'https://cdn.example/img.png' }] }, chat)).toThrow('Chat 未返回图片');
    expect(() => protocolImage({ status: 'incomplete', output: [{ type: 'image_generation_call', result: 'partial' }] }, { protocol: 'responses' })).toThrow('未完成');
  });
});
