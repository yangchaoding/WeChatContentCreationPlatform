import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalApp } from '../server/app';
import { compatiblePng, imageEndpoint } from '../server/images';
import { coverPrompt, coverRatios, defaultImageSettings, insertCover } from '../shared/images';
import { parseDocument } from '../shared/document';

let temporary: string;
let articles: string;
let instance: Awaited<ReturnType<typeof createLocalApp>>;
let webp: Buffer;
const config = { ...defaultImageSettings, aspectRatio: 'original', apiKey: 'test-private-key', address: 'https://images.example/v1', addressMode: 'base' };
const generate = (overrides = {}) => ({ requestId: randomUUID(), directory: instance.service.directory, articlePath: 'notes/nested.md', content: '# AI Agent\n\n没有保存的最新内容', style: '扁平插画', ...overrides });

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mopai-images-'));
  articles = path.join(temporary, 'articles');
  await fs.mkdir(path.join(articles, 'notes'), { recursive: true });
  await fs.writeFile(path.join(articles, 'notes/nested.md'), '# Original');
  instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
  webp = await sharp({ create: { width: 16, height: 12, channels: 4, background: { r: 20, g: 100, b: 50, alpha: 0.5 } } }).webp().toBuffer();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await instance.close();
  if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('mopai-images-')) throw new Error('Unexpected cleanup path');
  await fs.rm(temporary, { recursive: true, force: true });
});

describe('image configuration', () => {
  it('resolves the exact endpoint or appends to the configured base without guessing /v1', () => {
    expect(imageEndpoint(defaultImageSettings)).toBe('https://l0veyou.com/images/generations');
    expect(imageEndpoint({ address: 'https://provider.example/v1/', addressMode: 'base' })).toBe('https://provider.example/v1/images/generations');
    expect(imageEndpoint({ address: 'https://provider.example', addressMode: 'base' })).toBe('https://provider.example/images/generations');
    expect(imageEndpoint({ address: 'https://provider.example/custom/image?api-version=1', addressMode: 'endpoint' })).toContain('/custom/image?api-version=1');
  });
  it('persists credentials server-side and never returns them, retaining blank keys only for the same origin', async () => {
    const saved = await request(instance.app).put('/api/image-settings').send(config).expect(200);
    expect(saved.body.hasApiKey).toBe(true);
    expect(saved.text).not.toContain(config.apiKey);
    expect(saved.body).not.toHaveProperty('apiKey');
    await instance.close();
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    const restored = await request(instance.app).get('/api/image-settings').expect(200);
    expect(restored.body.hasApiKey).toBe(true);
    expect(restored.text).not.toContain(config.apiKey);
    expect((await request(instance.app).put('/api/image-settings').send({ ...config, apiKey: '' }).expect(200)).body.hasApiKey).toBe(true);
    expect((await request(instance.app).put('/api/image-settings').send({ ...config, address: 'https://new-provider.example/v1', apiKey: '' }).expect(200)).body.hasApiKey).toBe(false);
  });
  it('clears credentials and rejects invalid transport and configuration values', async () => {
    await request(instance.app).put('/api/image-settings').send(config).expect(200);
    expect((await request(instance.app).put('/api/image-settings').send({ ...config, clearApiKey: true }).expect(200)).body.hasApiKey).toBe(false);
    for (const invalid of [{ address: 'file:///etc/passwd' }, { address: 'https://user:password@images.example/v1' }, { apiKey: 'bad\r\nheader' }, { timeoutSeconds: 0 }, { model: '' }, { protocol: 'other' }, { aspectRatio: '2:0' }]) {
      await request(instance.app).put('/api/image-settings').send({ ...config, ...invalid }).expect(400);
    }
  });
  it('preserves uncropped behavior when loading an old configuration without a ratio', async () => {
    const { aspectRatio: _ratio, ...old } = config;
    await fs.writeFile(path.join(temporary, 'state/image-settings.json'), JSON.stringify(old));
    await instance.close();
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    const result = await request(instance.app).get('/api/image-settings').expect(200);
    expect(result.body.aspectRatio).toBe('original');
    expect(result.body.hasApiKey).toBe(true);
  });
  it('migrates the old separate size setting to one ratio and defaults the protocol to Images', async () => {
    const { protocol: _protocol, modelsAddress: _models, ...legacy } = config;
    await fs.writeFile(path.join(temporary, 'state/image-settings.json'), JSON.stringify({ ...legacy, size: '1024x1024', aspectRatio: '16:9' }));
    await instance.close();
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    const result = await request(instance.app).get('/api/image-settings').expect(200);
    expect(result.body).toMatchObject({ protocol: 'images', aspectRatio: '16:9', hasApiKey: true });
    expect(result.body).not.toHaveProperty('size');
    await request(instance.app).put('/api/image-settings').send(result.body).expect(200);
    expect(JSON.parse(await fs.readFile(path.join(temporary, 'state/image-settings.json'), 'utf8'))).not.toHaveProperty('size');
  });
});

describe('provider model discovery', () => {
  beforeEach(async () => { await request(instance.app).put('/api/image-settings').send(config).expect(200); });
  it('uses GET models with the saved key, removes duplicates and exposes no provider secrets', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'gpt-image-2', display_name: 'Image 2', secret: config.apiKey }, { id: 'gpt-5.6-sol' }, { id: 'gpt-image-2' }, { id: config.apiKey }, { id: 1 }, {}] }));
    vi.stubGlobal('fetch', fetcher);
    const response = await request(instance.app).get('/api/images/models').expect(200);
    expect(response.body.models.map((model: { id: string }) => model.id)).toEqual(['gpt-5.6-sol', 'gpt-image-2']);
    expect(response.text).not.toContain(config.apiKey);
    expect(fetcher.mock.calls[0][0]).toBe('https://images.example/v1/models');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${config.apiKey}` } });
  });
  it('fetches unsaved connection settings without persisting or replacing the selected model', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'custom-image' }] }));
    vi.stubGlobal('fetch', fetcher);
    await request(instance.app).post('/api/images/models').send({ ...config, address: 'https://new.example/custom/responses', addressMode: 'endpoint', protocol: 'responses', model: '', apiKey: 'new-test-key' }).expect(200);
    expect(fetcher.mock.calls[0][0]).toBe('https://new.example/custom/models');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer new-test-key');
    expect((await request(instance.app).get('/api/image-settings')).body).toMatchObject({ address: config.address, model: config.model, protocol: 'images' });
  });
  it('supports a custom same-origin models address and never sends a saved key to a different provider', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetcher);
    await request(instance.app).post('/api/images/models').send({ ...config, address: 'https://new.example/v1', apiKey: '' }).expect(400);
    await request(instance.app).post('/api/images/models').send({ ...config, modelsAddress: 'https://other.example/models' }).expect(400);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await request(instance.app).post('/api/images/models').send({ ...config, modelsAddress: 'https://images.example/catalog?version=1' }).expect(200);
    expect(response.body.models).toEqual([]);
    expect(fetcher.mock.calls[0][0]).toBe('https://images.example/catalog?version=1');
  });
  it('reports unsupported model lists without following redirects or leaking upstream error bodies', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(config.apiKey, { status: 302, headers: { Location: 'https://other.example/models' } }))
      .mockResolvedValueOnce(Response.json({ models: [] })).mockResolvedValueOnce(new Response('<html>login</html>'));
    vi.stubGlobal('fetch', fetcher);
    const failed = await request(instance.app).get('/api/images/models').expect(502);
    expect(failed.text).not.toContain(config.apiKey);
    expect(failed.body.message).toContain('HTTP 302');
    expect((await request(instance.app).get('/api/images/models').expect(502)).body.code).toBe('MODELS_RESPONSE_INVALID');
    await request(instance.app).get('/api/images/models').expect(502);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('cover generation', () => {
  beforeEach(async () => { await request(instance.app).put('/api/image-settings').send(config).expect(200); });
  it('calls Responses natively and extracts the image-generation tool result without converting through Chat', async () => {
    await request(instance.app).put('/api/image-settings').send({ ...config, protocol: 'responses', model: 'gpt-5.6-sol' }).expect(200);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'completed', output: [{ type: 'image_generation_call', result: webp.toString('base64') }] }));
    vi.stubGlobal('fetch', fetcher);
    const response = await request(instance.app).post('/api/images/generate').send(generate()).expect(200);
    expect(response.body.width).toBe(16);
    expect(fetcher.mock.calls[0][0]).toBe('https://images.example/v1/responses');
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'gpt-5.6-sol', tools: [{ type: 'image_generation' }], tool_choice: { type: 'image_generation' }, stream: false });
    expect(body.input).toContain('没有保存的最新内容');
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('prompt');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('calls Chat Completions directly and decodes inline image data from message.images', async () => {
    await request(instance.app).put('/api/image-settings').send({ ...config, protocol: 'chat', aspectRatio: '16:9' }).expect(200);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { role: 'assistant', images: [{ type: 'image_url', image_url: { url: `data:image/webp;base64,${webp.toString('base64')}` } }] } }] }));
    vi.stubGlobal('fetch', fetcher);
    const result = await request(instance.app).post('/api/images/generate').send(generate()).expect(200);
    expect(result.body).toMatchObject({ width: 1024, height: 576 });
    expect(fetcher.mock.calls[0][0]).toBe('https://images.example/v1/chat/completions');
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ modalities: ['text', 'image'], messages: [{ role: 'user' }], image_config: { aspect_ratio: '16:9' } });
    expect(body).not.toHaveProperty('input');
    expect(body).not.toHaveProperty('tools');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects text-only Chat results and never falls back to a different protocol on errors', async () => {
    await request(instance.app).put('/api/image-settings').send({ ...config, protocol: 'chat' }).expect(200);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'I can describe an image. See https://example.com.' } }] }))
      .mockResolvedValueOnce(new Response('unsupported', { status: 400 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await request(instance.app).post('/api/images/generate').send(generate()).expect(502)).body.code).toBe('IMAGE_RESPONSE_MISSING');
    await request(instance.app).put('/api/image-settings').send({ ...config, protocol: 'responses' }).expect(200);
    await request(instance.app).post('/api/images/generate').send(generate()).expect(502);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['https://images.example/v1/chat/completions', 'https://images.example/v1/responses']);
  });
  it('uses the current draft, downloads a temporary URL, converts WebP bytes to PNG, and saves beside a nested article', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ url: 'https://cdn.example/image.webp' }] })).mockResolvedValueOnce(new Response(webp, { headers: { 'Content-Type': 'image/webp' } }));
    vi.stubGlobal('fetch', fetcher);
    const body = generate();
    const response = await request(instance.app).post('/api/images/generate').send(body).expect(200);
    const [endpoint, options] = fetcher.mock.calls[0];
    expect(endpoint).toBe('https://images.example/v1/images/generations');
    expect(options.headers['X-Request-Id']).toBe(body.requestId);
    expect(JSON.parse(options.body)).toMatchObject({ model: config.model, n: 1 });
    expect(JSON.parse(options.body)).not.toHaveProperty('size');
    expect(JSON.parse(options.body).prompt).toContain('没有保存的最新内容');
    expect(JSON.parse(options.body)).not.toHaveProperty('response_format');
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
    expect(response.body.assetPath).toBe(`notes/cover-${body.requestId}.png`);
    expect(response.body.markdownPath).toBe(`./cover-${body.requestId}.png`);
    expect(await sharp(await fs.readFile(path.join(articles, response.body.assetPath))).metadata()).toMatchObject({ format: 'png', space: 'srgb', width: 16, height: 12, hasAlpha: false });
    expect(await fs.readFile(path.join(articles, 'notes/nested.md'), 'utf8')).toBe('# Original');
    const downloaded = await request(instance.app).get('/api/assets').query({ path: response.body.assetPath, directory: body.directory, format: 'png', download: '1' }).expect(200);
    expect(downloaded.headers['content-type']).toContain('image/png');
    expect(downloaded.headers['content-disposition']).toContain('attachment');
  });
  it('handles base64 responses and returns a cached result across a service restart', async () => {
    await request(instance.app).put('/api/image-settings').send({ ...config, responseFormat: 'b64_json' }).expect(200);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: webp.toString('base64') }] }));
    vi.stubGlobal('fetch', fetcher);
    const body = generate();
    const first = await request(instance.app).post('/api/images/generate').send(body).expect(200);
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.response_format).toBe('b64_json');
    expect(payload).not.toHaveProperty('size');
    await instance.close();
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    const second = await request(instance.app).post('/api/images/generate').send(body).expect(200);
    expect(second.body).toEqual(first.body);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await request(instance.app).post('/api/images/generate').send({ ...body, content: 'different' }).expect(409);
  });
  it('uses the unified ratio for both Images API size and the final 2.35:1 cover', async () => {
    await request(instance.app).put('/api/image-settings').send({ ...config, model: 'gpt-image-2', aspectRatio: '2.35:1' }).expect(200);
    const input = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#aaccbb' } }).png().toBuffer();
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: input.toString('base64') }] }));
    vi.stubGlobal('fetch', fetcher);
    const body = generate();
    const response = await request(instance.app).post('/api/images/generate').send(body).expect(200);
    expect(response.body).toMatchObject({ width: 940, height: 400, aspectRatio: '2.35:1' });
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload).toMatchObject({ model: 'gpt-image-2', size: '1280x544' });
    expect(payload.prompt).toContain('2.35:1');
    expect(payload.prompt).toContain('公众号列表和内容推荐');
    expect(await sharp(await fs.readFile(path.join(articles, response.body.assetPath))).metadata()).toMatchObject({ width: 940, height: 400, format: 'png' });
    await instance.close();
    instance = await createLocalApp({ storageDirectory: path.join(temporary, 'state'), initialDirectory: articles });
    expect((await request(instance.app).get('/api/image-settings')).body.aspectRatio).toBe('2.35:1');
    expect((await request(instance.app).post('/api/images/generate').send(body).expect(200)).body).toEqual(response.body);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('resumes downloads without generating again after an expiring URL temporarily fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ url: 'https://cdn.example/result' }] }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(webp));
    vi.stubGlobal('fetch', fetcher);
    const body = generate();
    await request(instance.app).post('/api/images/generate').send(body).expect(502);
    await request(instance.app).post('/api/images/generate').send(body).expect(200);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('deduplicates simultaneous requests and preserves X-Request-Id after transport failure', async () => {
    const body = generate();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error(`network ${config.apiKey}`)).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return Response.json({ data: [{ b64_json: webp.toString('base64') }] });
    });
    vi.stubGlobal('fetch', fetcher);
    const failed = await request(instance.app).post('/api/images/generate').send(body).expect(502);
    expect(failed.text).not.toContain(config.apiKey);
    const [one, two] = await Promise.all([request(instance.app).post('/api/images/generate').send(body), request(instance.app).post('/api/images/generate').send(body)]);
    expect(one.status).toBe(200); expect(two.status).toBe(200);
    expect(one.body).toEqual(two.body);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => call[1].headers['X-Request-Id'])).toEqual([body.requestId, body.requestId]);
  });
  it('does not leak the credential through redirect downloads or error responses', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ url: '/file' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://cdn.example/final' } }))
      .mockResolvedValueOnce(new Response(webp));
    vi.stubGlobal('fetch', fetcher);
    await request(instance.app).post('/api/images/generate').send(generate()).expect(200);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    expect(fetcher.mock.calls[2][1].headers).not.toHaveProperty('Authorization');
    fetcher.mockResolvedValueOnce(new Response(`bad ${config.apiKey}`, { status: 401 }));
    const result = await request(instance.app).post('/api/images/generate').send(generate()).expect(502);
    expect(result.body.message).toContain('HTTP 401');
    expect(result.text).not.toContain(config.apiKey);
  });
  it('keeps a running generation in its original directory if another window switches workspace', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const body = generate();
    const response = request(instance.app).post('/api/images/generate').send(body).then((value) => value);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const other = path.join(temporary, 'other');
    await fs.mkdir(other);
    await instance.service.setDirectory(other);
    release(Response.json({ data: [{ b64_json: webp.toString('base64') }] }));
    const result = await response;
    expect(result.status).toBe(200);
    expect(result.body.directory).toBe(body.directory);
    expect(await fs.readdir(other)).toEqual([]);
    expect(await fs.stat(path.join(articles, result.body.assetPath))).toBeDefined();
  });
  it('explains provider group permissions and redacts secrets in structured upstream messages', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'Image generation is not enabled for this group' } }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ error: { message: `Invalid token ${config.apiKey} Bearer sk-another-secret` } }, { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    const permission = await request(instance.app).post('/api/images/generate').send(generate()).expect(502);
    expect(permission.body.message).toContain('所属分组未开通图片生成');
    expect(permission.body.code).toBe('IMAGE_PERMISSION_DENIED');
    const secret = await request(instance.app).post('/api/images/generate').send(generate()).expect(502);
    expect(secret.text).not.toContain(config.apiKey);
    expect(secret.text).not.toContain('sk-another-secret');
  });
  it('bounds chunked image streams even without Content-Length and reports a timeout clearly', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ url: 'https://cdn.example/too-big' }] }))
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { for (let i = 0; i < 21; i++) controller.enqueue(new Uint8Array(1024 * 1024)); controller.close(); } })));
    vi.stubGlobal('fetch', fetcher);
    await request(instance.app).post('/api/images/generate').send(generate()).expect(413);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(AbortSignal.abort());
    fetcher.mockRejectedValueOnce(new Error('aborted'));
    const timeout = await request(instance.app).post('/api/images/generate').send(generate()).expect(504);
    expect(timeout.body.message).toContain('同一请求重试');
  });
  it('separates request transport failures from downloads and records sanitized diagnostics', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(Object.assign(new Error(`fetch failed ${config.apiKey}`), { cause: { code: 'UND_ERR_SOCKET' } }));
    vi.stubGlobal('fetch', fetcher);
    const body = generate();
    const failed = await request(instance.app).post('/api/images/generate').send(body).expect(502);
    expect(failed.body).toMatchObject({ code: 'IMAGE_REQUEST_FAILED' });
    expect(failed.body.message).toContain('请求图片服务失败');
    expect(failed.body.message).toContain('服务中断了连接');
    const record = await fs.readFile(path.join(temporary, 'state/image-jobs', `${body.requestId}.json`), 'utf8');
    expect(JSON.parse(record).lastError).toMatchObject({ stage: 'request', code: 'IMAGE_REQUEST_FAILED' });
    expect(record).not.toContain(config.apiKey);
    fetcher.mockResolvedValueOnce(Response.json({ data: [{ url: 'https://cdn.example/img.png' }] })).mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    const download = await request(instance.app).post('/api/images/generate').send(generate()).expect(502);
    expect(download.body).toMatchObject({ code: 'IMAGE_DOWNLOAD_FAILED' });
    expect(download.body.message).toContain('无法解析服务域名');
  });
  it('identifies an interrupted response body and preserves received images when local persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error('stream closed')); } }))));
    const interrupted = await request(instance.app).post('/api/images/generate').send(generate()).expect(502);
    expect(interrupted.body.code).toBe('IMAGE_RESPONSE_FAILED');
    expect(interrupted.body.message).toContain('读取生成结果失败');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: webp.toString('base64') }] })));
    const body = generate();
    // A directory at the output filename simulates a collision without changing OS permissions.
    await fs.mkdir(path.join(articles, `notes/cover-${body.requestId}.png`));
    const failed = await request(instance.app).post('/api/images/generate').send(body);
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(failed.body.code).toBe('IMAGE_SAVE_FAILED');
    const record = JSON.parse(await fs.readFile(path.join(temporary, 'state/image-jobs', `${body.requestId}.json`), 'utf8'));
    expect(record.source.b64_json).toBe(webp.toString('base64'));
    expect(record.lastError.stage).toBe('save');
  });
  it('rejects malformed output, oversized streams, traversal, and stale workspaces', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }))
      .mockResolvedValueOnce(new Response('small', { headers: { 'Content-Length': String(40 * 1024 * 1024) } }));
    vi.stubGlobal('fetch', fetcher);
    await request(instance.app).post('/api/images/generate').send(generate()).expect(502);
    await request(instance.app).post('/api/images/generate').send(generate()).expect(422);
    await request(instance.app).post('/api/images/generate').send(generate()).expect(413);
    await request(instance.app).post('/api/images/generate').send(generate({ articlePath: '../../outside.md' })).expect(403);
    await request(instance.app).post('/api/images/generate').send(generate({ directory: 'elsewhere' })).expect(409);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('cover aspect ratios', () => {
  it.each(coverRatios)('outputs $id at $width × $height', async (ratio) => {
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#aaccbb' } }).png().toBuffer();
    const result = await compatiblePng(source, ratio.id);
    expect(result.width).toBe(ratio.width);
    expect(result.height).toBe(ratio.height);
    expect(await sharp(result.data).metadata()).toMatchObject({ format: 'png', space: 'srgb', width: ratio.width, height: ratio.height });
  });
  it('crops symmetrically without stretching a central circle', async () => {
    const source = await sharp(Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" fill="white"/><circle cx="512" cy="512" r="100" fill="red"/></svg>')).png().toBuffer();
    const result = await compatiblePng(source, '2.35:1');
    const { data, info } = await sharp(result.data).raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset] > 200 && data[offset + 1] < 50 && data[offset + 2] < 50) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    expect(Math.abs((maxX - minX) - (maxY - minY))).toBeLessThanOrEqual(2);
    expect(Math.abs((minX + maxX) / 2 - info.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs((minY + maxY) / 2 - info.height / 2)).toBeLessThanOrEqual(1);
  });
});

describe('cover document handling', () => {
  it('inserts after YAML, preserves newlines and edits, and is idempotent', () => {
    const original = '\uFEFF---\r\ntitle: 原标题\r\nauthor: neo\r\n---\r\n# 最新正文\r\n';
    const next = insertCover(original, './cover-test.png');
    expect(next).toBe('\uFEFF---\r\ntitle: 原标题\r\nauthor: neo\r\n---\r\n![文章封面](./cover-test.png)\r\n\r\n# 最新正文\r\n');
    expect(parseDocument(next).metadata.title).toBe('原标题');
    expect(insertCover(next, './cover-test.png')).toBe(next);
  });
  it('uses title and summary, removes embedded images, and bounds long prompts while retaining the ending', () => {
    const prompt = coverPrompt('---\ntitle: 标题\nsummary: 摘要\n---\n![旧图](data:image/png;base64,xxx)\n' + '主题'.repeat(9000) + '\n文章结论', 'fallback.md', '水彩');
    expect(prompt).toContain('文章标题：标题');
    expect(prompt).toContain('文章摘要：摘要');
    expect(prompt).toContain('水彩');
    expect(prompt).toContain('文章结论');
    expect(prompt).not.toContain('data:image');
    expect(prompt.length).toBeLessThan(12500);
  });
});
