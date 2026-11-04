import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { coverPrompt, coverRatios, defaultImageSettings, imageProtocols, imageAddressMode, type CoverRatio, type GeneratedCover, type ImageModelList, type ImageProtocol, type ImageSettings } from '../shared/images';
import { AppError, type WorkspaceService } from './workspace';
import { configuredEndpoint, inferredModelsAddress, protocolImage, protocolRequest, type ImageSource } from './image-protocols';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
type PrivateSettings = Omit<ImageSettings, 'hasApiKey'> & { apiKey: string };
type GenerationStage = 'prepare' | 'request' | 'response' | 'download' | 'convert' | 'save';
interface Job { fingerprint: string; source?: ImageSource; result?: GeneratedCover; lastError?: { stage: GenerationStage; code: string; message: string; at: string } }

function webUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError(400, '请输入完整的 HTTP(S) 请求地址。'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.hash) {
    throw new AppError(400, '请求地址须使用 HTTPS（本机服务可用 HTTP），且不能包含用户名、密码或锚点。');
  }
  return url;
}

export function imageEndpoint(settings: Pick<ImageSettings, 'address' | 'addressMode'> & Partial<Pick<ImageSettings, 'protocol'>>): string {
  webUrl(settings.address);
  return configuredEndpoint(settings);
}

async function atomicJson(filename: string, value: unknown) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new AppError(413, '图片服务返回的数据过大，请降低尺寸后重试。');
  }
  if (!response.body) throw new AppError(502, '图片服务返回了空内容。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new AppError(413, '图片服务返回的数据过大，请降低尺寸后重试。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function compatiblePng(input: Buffer, aspectRatio: CoverRatio = 'original'): Promise<{ data: Buffer; width: number; height: number }> {
  if (input.length > MAX_IMAGE_BYTES) throw new AppError(413, '图片超过 20 MB，请降低尺寸后重试。');
  try {
    const image = sharp(input, { limitInputPixels: 40_000_000, animated: false });
    const metadata = await image.metadata();
    if (!metadata.format || !['png', 'jpeg', 'webp', 'avif', 'heif', 'gif', 'tiff'].includes(metadata.format)) throw new Error('Unsupported image');
    const ratio = coverRatios.find((item) => item.id === aspectRatio);
    const resized = image.rotate().resize(ratio ? { width: ratio.width, height: ratio.height, fit: 'cover', position: 'centre' } : { width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
    const { data, info } = await resized.flatten({ background: '#ffffff' }).toColourspace('srgb').png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new Error('PNG too large');
    return { data, width: info.width, height: info.height };
  } catch { throw new AppError(422, '无法把返回内容转换为 PNG 图片，请检查渠道是否返回了有效图片。'); }
}

export class ImageService {
  private settings: PrivateSettings = { ...defaultImageSettings, apiKey: '' };
  private settingsQueue = Promise.resolve();
  private active = new Map<string, { fingerprint: string; promise: Promise<GeneratedCover> }>();
  constructor(private workspace: WorkspaceService) {}
  private get settingsFile() { return path.join(this.workspace.storageDirectory, 'image-settings.json'); }
  private get jobsDirectory() { return path.join(this.workspace.storageDirectory, 'image-jobs'); }

  async init() {
    await fs.mkdir(this.jobsDirectory, { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(this.settingsFile, 'utf8'));
      this.settings = this.validate(saved, this.settings);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError(500, '图片接口配置无法读取，请检查 .mopai/image-settings.json。');
    }
  }

  get publicSettings(): ImageSettings {
    const { apiKey, ...settings } = this.settings;
    return { ...settings, hasApiKey: Boolean(apiKey) };
  }

  private validate(input: unknown, previous: PrivateSettings, allowEmptyModel = false): PrivateSettings {
    if (!input || typeof input !== 'object') throw new AppError(400, '图片配置无效。');
    const value = input as Record<string, unknown>;
    const field = (key: string, max: number) => {
      if (typeof value[key] !== 'string' || value[key].length > max || /[\r\n\0]/.test(value[key])) throw new AppError(400, '图片配置字段格式不正确。');
      return value[key].trim();
    };
    const address = field('address', 2048);
    const addressMode = value.addressMode;
    const model = field('model', 200);
    const protocol = value.protocol ?? 'images';
    if (!imageProtocols.some((item) => item.id === protocol)) throw new AppError(400, '请选择 Images、Responses 或 Chat 协议。');
    const modelsAddress = value.modelsAddress === undefined ? '' : field('modelsAddress', 2048);
    // Existing configurations keep the uncropped behavior until a ratio is selected.
    const aspectRatio = value.aspectRatio ?? 'original';
    if (aspectRatio !== 'original' && !coverRatios.some((ratio) => ratio.id === aspectRatio)) throw new AppError(400, '请选择支持的封面比例。');
    const responseFormat = value.responseFormat;
    const timeoutSeconds = value.timeoutSeconds;
    if (!['endpoint', 'base'].includes(String(addressMode)) || !['auto', 'url', 'b64_json'].includes(String(responseFormat)) || (!model && !allowEmptyModel) || !Number.isInteger(timeoutSeconds) || Number(timeoutSeconds) < 30 || Number(timeoutSeconds) > 600) throw new AppError(400, '请检查地址类型、模型、返回格式和超时时间（30–600 秒）。');
    const origin = webUrl(address).origin;
    if (modelsAddress && webUrl(modelsAddress).origin !== origin) throw new AppError(400, '模型列表地址必须与生成接口属于同一来源，避免把密钥发送给其他渠道。');
    const supplied = value.apiKey === undefined ? '' : field('apiKey', 4096);
    const apiKey = value.clearApiKey === true ? '' : supplied || (origin === webUrl(previous.address).origin ? previous.apiKey : '');
    return { address, addressMode: imageAddressMode(address, addressMode as ImageSettings['addressMode']), protocol: protocol as ImageProtocol, modelsAddress, model, aspectRatio: aspectRatio as CoverRatio, responseFormat: responseFormat as ImageSettings['responseFormat'], timeoutSeconds: Number(timeoutSeconds), apiKey };
  }

  async saveSettings(value: unknown) {
    const next = this.settingsQueue.then(async () => {
      const settings = this.validate(value, this.settings);
      await atomicJson(this.settingsFile, settings);
      this.settings = settings;
    });
    this.settingsQueue = next.catch(() => {});
    await next;
    return this.publicSettings;
  }

  async listModels(input?: unknown): Promise<ImageModelList> {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new AppError(400, '接口配置无效。');
    const settings = input === undefined ? this.settings : this.validate({ ...this.publicSettings, ...input as object }, this.settings, true);
    if (!settings.apiKey) throw new AppError(400, '请先填写 API 密钥。切换渠道时需要填写该渠道的密钥。');
    const endpoint = inferredModelsAddress(settings);
    webUrl(endpoint);
    const signal = AbortSignal.timeout(Math.min(settings.timeoutSeconds, 30) * 1000);
    try {
      const response = await fetch(endpoint, { method: 'GET', signal, redirect: 'error', headers: { Authorization: `Bearer ${settings.apiKey}`, Accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(502, `获取模型列表失败（HTTP ${response.status}）。请检查密钥、模型列表地址，或手动填写模型。`, 'MODELS_PROVIDER_ERROR');
      }
      const body = await boundedBody(response, 2 * 1024 * 1024);
      let payload: { data?: unknown[] };
      try { payload = JSON.parse(body.toString('utf8')); }
      catch { throw new AppError(502, '模型列表不是有效 JSON，请检查模型列表地址。', 'MODELS_RESPONSE_INVALID'); }
      if (!Array.isArray(payload?.data)) throw new AppError(502, '模型列表缺少 data 数组，可手动填写模型或修改模型列表地址。', 'MODELS_RESPONSE_INVALID');
      const models = new Map<string, { id: string; name?: string }>();
      for (const entry of payload.data.slice(0, 5000)) {
        if (!entry || typeof entry !== 'object') continue;
        const { id, name, display_name } = entry as Record<string, unknown>;
        if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\r\n\0]/.test(id) || id.includes(settings.apiKey)) continue;
        const label = typeof display_name === 'string' ? display_name : typeof name === 'string' ? name : undefined;
        models.set(id, { id, ...(label ? { name: label.replaceAll(settings.apiKey, '[密钥已隐藏]').slice(0, 200) } : {}) });
      }
      return { models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(signal.aborted ? 504 : 502, signal.aborted ? '获取模型列表超时，请稍后重试或手动填写模型。' : '无法连接模型列表接口，请检查地址和网络，或手动填写模型。', 'MODELS_REQUEST_FAILED');
    }
  }

  async generate(input: { requestId: string; directory: string; articlePath: string; content: string; style: string }): Promise<GeneratedCover> {
    if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(input.requestId)) throw new AppError(400, '生成请求标识无效。');
    if (!input.content.trim()) throw new AppError(400, '先写一些文章内容，再生成封面。');
    const settings = { ...this.settings };
    if (!settings.apiKey) throw new AppError(400, '请先在接口配置中保存 API 密钥。');
    const root = this.workspace.directory;
    if (input.directory !== root) throw new AppError(409, '文章目录已切换，请重新打开封面窗口。', 'WORKSPACE_CHANGED');
    await this.workspace.resolveFile(input.articlePath, { root });
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...input, settings })).digest('hex');
    const filename = path.join(this.jobsDirectory, `${input.requestId}.json`);
    let job: Job = { fingerprint };
    try { job = JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError(500, '无法读取封面生成记录。'); }
    if (job.fingerprint !== fingerprint) throw new AppError(409, '这次请求的文章或配置已变更，请开始新的生成。');
    if (job.result) {
      try { await this.workspace.resolveFile(job.result.assetPath, { root, markdown: false }); }
      catch { throw new AppError(410, '已生成的封面文件已被移动或删除，请重新生成。'); }
      return job.result;
    }
    const active = this.active.get(input.requestId);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new AppError(409, '同一请求不能同时用于不同文章或配置。');
      return active.promise;
    }
    if (this.active.size) throw new AppError(409, '已有一张封面正在生成，请稍候。');
    const promise = this.run(input, settings, root, filename, job);
    this.active.set(input.requestId, { fingerprint, promise });
    try { return await promise; } finally { this.active.delete(input.requestId); }
  }

  private async run(input: { requestId: string; articlePath: string; content: string; style: string }, settings: PrivateSettings, root: string, filename: string, job: Job): Promise<GeneratedCover> {
    const endpoint = imageEndpoint(settings);
    const signal = AbortSignal.timeout(settings.timeoutSeconds * 1000);
    let stage: GenerationStage = 'prepare';
    try {
      await atomicJson(filename, job);
      if (!job.source) {
        stage = 'request';
        const response = await fetch(endpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json', 'X-Request-Id': input.requestId },
          body: JSON.stringify(protocolRequest(settings, coverPrompt(input.content, input.articlePath, input.style, settings.aspectRatio))),
        });
        if (!response.ok) {
          let upstream = '';
          try {
            const payload = JSON.parse((await boundedBody(response, 64 * 1024)).toString('utf8'));
            const message = payload?.error?.message ?? payload?.message;
            if (typeof message === 'string') upstream = message.replaceAll(settings.apiKey, '[密钥已隐藏]').replace(/Bearer\s+\S+|sk-[a-zA-Z0-9_-]+/gi, '[密钥已隐藏]').replace(/https?:\/\/\S+/gi, '[渠道地址]').replace(/\s+/g, ' ').slice(0, 240);
          } catch { /* HTML gateway errors and oversized bodies use the status-based explanation. */ }
          if (/image generation is not enabled for this group/i.test(upstream)) throw new AppError(502, `图片服务返回 HTTP ${response.status}：当前 API 密钥所属分组未开通图片生成，请联系渠道开通或更换密钥。`, 'IMAGE_PERMISSION_DENIED');
          const detail = response.status === 401 || response.status === 403 ? '请检查 API 密钥和模型权限。' : response.status === 429 ? '额度不足或请求过于频繁，请稍后重试。' : response.status === 400 || response.status === 422 ? '请检查模型、尺寸及返回格式是否符合渠道要求。' : '请检查请求地址或稍后重试。';
          throw new AppError(502, `图片服务返回 HTTP ${response.status}。${detail}${upstream ? ` 渠道提示：${upstream}` : ''}`, 'IMAGE_PROVIDER_ERROR');
        }
        stage = 'response';
        let payload: unknown;
        const body = await boundedBody(response, 30 * 1024 * 1024);
        try { payload = JSON.parse(body.toString('utf8')); }
        catch { throw new AppError(502, '图片服务没有返回有效的 JSON。', 'IMAGE_RESPONSE_INVALID'); }
        job.source = protocolImage(payload, settings);
        // Persist the upstream result before downloading: a retry resumes this step without generating again.
        stage = 'save';
        await atomicJson(filename, job);
      }
      stage = 'download';
      const bytes = job.source.b64_json ? this.decodeBase64(job.source.b64_json) : await this.download(job.source.url!, endpoint, settings.apiKey, signal);
      stage = 'convert';
      const png = await compatiblePng(bytes, settings.aspectRatio);
      // Capture the starting root; another window switching workspace cannot redirect this file write.
      stage = 'save';
      await this.workspace.resolveFile(input.articlePath, { root });
      const articleDirectory = path.posix.dirname(input.articlePath.replace(/\\/g, '/'));
      const assetPath = path.posix.join(articleDirectory, `cover-${input.requestId}.png`);
      const target = await this.workspace.resolveFile(assetPath, { root, creating: true, markdown: false });
      try { await fs.writeFile(target, png.data, { flag: 'wx' }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await fs.readFile(await this.workspace.resolveFile(assetPath, { root, markdown: false }))).equals(png.data)) throw error;
      }
      const result: GeneratedCover = { requestId: input.requestId, directory: root, articlePath: input.articlePath, assetPath, markdownPath: `./${path.posix.basename(assetPath)}`, width: png.width, height: png.height, aspectRatio: settings.aspectRatio };
      await atomicJson(filename, { fingerprint: job.fingerprint, result });
      return result;
    } catch (error) {
      const failure = this.failure(error, stage, signal.aborted);
      // Record actionable, sanitized diagnostics without article text, API keys or signed URLs.
      job.lastError = { stage, code: failure.code, message: failure.message, at: new Date().toISOString() };
      await atomicJson(filename, job).catch(() => {});
      throw failure;
    }
  }

  private failure(error: unknown, stage: GenerationStage, timedOut: boolean): AppError {
    const labels: Record<GenerationStage, string> = { prepare: '准备生成记录', request: '请求图片服务', response: '读取生成结果', download: '下载图片', convert: '转换图片', save: '保存图片及生成记录' };
    if (timedOut && !(error instanceof AppError)) return new AppError(504, `${labels[stage]}超时。可使用同一请求重试；已收到的图片会继续下载。`, 'IMAGE_TIMEOUT');
    if (error instanceof AppError) {
      if (error.code === 'ERROR') error.code = `IMAGE_${stage.toUpperCase()}_FAILED`;
      return error;
    }
    const code = (error as { code?: string; cause?: { code?: string } })?.cause?.code || (error as { code?: string })?.code;
    const details: Record<string, string> = {
      ENOTFOUND: '无法解析服务域名，请检查请求地址或网络。',
      EAI_AGAIN: '域名解析暂时失败，请稍后重试。',
      ECONNREFUSED: '连接被拒绝，请检查请求地址和端口。',
      ECONNRESET: '服务中断了连接，请稍后重试。',
      UND_ERR_SOCKET: '服务中断了连接，请稍后重试。',
      UND_ERR_CONNECT_TIMEOUT: '连接图片服务超时，请检查网络或代理。',
      UND_ERR_HEADERS_TIMEOUT: '图片服务迟迟未响应，请稍后重试。',
      CERT_HAS_EXPIRED: '图片服务证书已过期，请联系渠道修复。',
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: '无法验证图片服务证书，请检查渠道证书或代理设置。',
    };
    if (stage === 'prepare' || stage === 'save') return new AppError(500, `${labels[stage]}失败。请检查本地目录是否可写、文件是否被占用以及磁盘空间，然后使用同一请求重试。`, 'IMAGE_SAVE_FAILED');
    // Raw transport errors may contain credentials or URL signatures, so only known codes are exposed.
    return new AppError(502, `${labels[stage]}失败。${details[code || ''] || '请检查渠道连接，然后使用同一请求重试。'}`, `IMAGE_${stage.toUpperCase()}_FAILED`);
  }

  private decodeBase64(value: string): Buffer {
    const encoded = value.replace(/^data:image\/[\w.+-]+;base64,/, '').replace(/\s/g, '');
    if (!/^[A-Za-z\d+/]+={0,2}$/.test(encoded) || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new AppError(422, '返回的 Base64 图片无效或超过 20 MB。');
    return Buffer.from(encoded, 'base64');
  }

  private async download(source: string, endpoint: string, apiKey: string, signal: AbortSignal): Promise<Buffer> {
    let url = webUrl(new URL(source, endpoint).href);
    for (let redirects = 0; redirects < 5; redirects++) {
      const response = await fetch(url, { signal, redirect: 'manual', headers: url.origin === new URL(endpoint).origin ? { Authorization: `Bearer ${apiKey}` } : {} });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) break;
        url = webUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new AppError(502, `图片下载返回 HTTP ${response.status}。可重试下载；若临时链接已过期，请重新生成。`); }
      return boundedBody(response, MAX_IMAGE_BYTES);
    }
    throw new AppError(502, '图片下载重定向次数过多。');
  }
}
